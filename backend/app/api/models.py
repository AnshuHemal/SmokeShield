import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db.models import ModelVersion
from ..schemas.model import ModelMetaUpdate, ModelVersionOut
from ..services import model_registry as registry
from ..services.camera_manager import CameraManager
from ..services.model_manager import ModelError, ModelManager
from .deps import get_db, get_manager, get_models

router = APIRouter(prefix="/api/models", tags=["models"])


def _get(db: Session, version_id: int) -> ModelVersion:
    v = db.get(ModelVersion, version_id)
    if not v:
        raise HTTPException(404, "Model version not found")
    return v


def _validation_error(exc: ValidationError) -> HTTPException:
    msg = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors())
    return HTTPException(422, msg)


def _guard(fn, *args):
    """Translate registry errors into HTTP errors."""
    try:
        return fn(*args)
    except registry.RegistryNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except registry.RegistryConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ModelError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("", response_model=list[ModelVersionOut])
def list_models(db: Session = Depends(get_db)):
    rows = db.scalars(select(ModelVersion).order_by(ModelVersion.created_at.desc(), ModelVersion.id.desc()))
    return [registry.to_out(v) for v in rows]


@router.post("", response_model=ModelVersionOut, status_code=201)
async def upload_model(
    file: UploadFile = File(...),
    name: str = Form(...),
    notes: str | None = Form(None),
    precision: float | None = Form(None),
    recall: float | None = Form(None),
    map50: float | None = Form(None),
    map50_95: float | None = Form(None),
    db: Session = Depends(get_db),
    models: ModelManager = Depends(get_models),
):
    """Register new weights. They are loaded and timed to prove they work, but are NOT made live."""
    if not settings.model_upload_enabled:
        raise HTTPException(403, "Model uploads are disabled on this server")
    if Path(file.filename or "").suffix.lower() != ".pt":
        raise HTTPException(400, "Upload a YOLO weights file (.pt)")
    try:
        meta = ModelMetaUpdate(name=name, notes=notes or None, precision=precision, recall=recall, map50=map50, map50_95=map50_95)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    if (db.scalar(select(func.count()).select_from(ModelVersion)) or 0) >= settings.max_model_versions:
        raise HTTPException(409, f"Version limit reached ({settings.max_model_versions}) - delete an old model first")

    stored = f"{uuid.uuid4().hex}.pt"
    path = settings.uploaded_models_dir / stored
    limit = settings.max_model_mb * 1024 * 1024
    size = 0
    try:
        with path.open("wb") as out:  # stream to disk, never hold the whole file in memory
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File exceeds {settings.max_model_mb} MB")
                out.write(chunk)
        if size == 0:
            raise HTTPException(400, "The uploaded file is empty")

        digest = await asyncio.to_thread(registry.file_sha256, path)
        twin = db.scalar(select(ModelVersion).where(ModelVersion.sha256 == digest))
        if twin:
            raise HTTPException(409, f'This exact file is already registered as "{twin.name}"')

        try:
            _, probe = await asyncio.to_thread(models.probe, path)
        except ModelError as exc:
            raise HTTPException(422, str(exc)) from exc

        version = ModelVersion(
            name=meta.name, filename=stored, location="uploaded", sha256=digest, size_bytes=size,
            notes=meta.notes, precision=meta.precision, recall=meta.recall, map50=meta.map50, map50_95=meta.map50_95,
        )
        registry.apply_probe(version, probe)
        db.add(version)
        db.commit()
    except BaseException:
        path.unlink(missing_ok=True)  # a rejected upload leaves nothing behind
        raise
    return registry.to_out(version)


@router.patch("/{version_id}", response_model=ModelVersionOut)
def update_model(version_id: int, body: ModelMetaUpdate, db: Session = Depends(get_db)):
    v = _get(db, version_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "name" and value is None:
            continue  # a name is required; null only makes sense for the optional fields
        setattr(v, field, value)
    db.commit()
    return registry.to_out(v)


@router.post("/rollback", response_model=ModelVersionOut)
async def rollback_model(
    models: ModelManager = Depends(get_models),
    cameras: CameraManager = Depends(get_manager),
):
    v = await asyncio.to_thread(_guard, registry.rollback, models)
    await asyncio.to_thread(cameras.refresh)
    return registry.to_out(v)


@router.post("/{version_id}/activate", response_model=ModelVersionOut)
async def activate_model(
    version_id: int,
    models: ModelManager = Depends(get_models),
    cameras: CameraManager = Depends(get_manager),
):
    """Hot-swap the live model. Cameras keep running; the new model serves their very next frame."""
    v = await asyncio.to_thread(_guard, registry.activate, models, version_id)
    await asyncio.to_thread(cameras.refresh)  # starts workers that were waiting for a first model
    return registry.to_out(v)


@router.post("/{version_id}/benchmark", response_model=ModelVersionOut)
async def benchmark_model(version_id: int, db: Session = Depends(get_db), models: ModelManager = Depends(get_models)):
    """Load the weights and re-measure classes, size and speed on this server."""
    v = _get(db, version_id)
    try:
        _, probe = await asyncio.to_thread(models.probe, registry.resolve_path(v))
    except ModelError as exc:
        raise HTTPException(422, str(exc)) from exc
    registry.apply_probe(v, probe)
    db.commit()
    return registry.to_out(v)


@router.delete("/{version_id}", status_code=204)
async def delete_model(version_id: int, models: ModelManager = Depends(get_models)):
    await asyncio.to_thread(_guard, registry.delete, models, version_id)
