import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db.models import Camera
from ..schemas.camera import (
    CameraCreate,
    CameraFields,
    CameraOut,
    CameraState,
    CameraUpdate,
    UploadedVideo,
    mask_source,
)
from ..services.camera_manager import CameraManager
from ..services.camera_worker import grab_one_frame, open_capture
from ..services.imaging import encode_jpeg
from .deps import get_db, get_manager

router = APIRouter(prefix="/api/cameras", tags=["cameras"])

MAX_CAMERAS = 16
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}
NO_STORE = {"Cache-Control": "no-store"}


def _out(cam: Camera) -> CameraOut:
    out = CameraOut.model_validate(cam)
    out.source = mask_source(cam.source_type, cam.source)
    return out


def _validation_error(exc: ValidationError) -> HTTPException:
    msg = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors())
    return HTTPException(422, msg)


def _get(db: Session, camera_id: int) -> Camera:
    cam = db.get(Camera, camera_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    return cam


def _check_file_exists(fields: CameraFields) -> None:
    if fields.source_type == "file" and not (settings.video_dir / fields.source).is_file():
        raise HTTPException(422, "Uploaded video not found - upload it again")


# ---- static routes first, so they are not captured by /{camera_id} ----

@router.get("", response_model=list[CameraOut])
def list_cameras(db: Session = Depends(get_db)):
    return [_out(c) for c in db.scalars(select(Camera).order_by(Camera.id))]


@router.get("/status", response_model=list[CameraState])
def camera_status(manager: CameraManager = Depends(get_manager)):
    return manager.states()


class PreviewIn(BaseModel):
    source_type: str
    source: str


@router.post("/preview", responses={200: {"content": {"image/jpeg": {}}}})
async def preview_source(body: PreviewIn):
    """Grab one frame from a source that is not saved yet (used by the zone editor)."""
    try:
        fields = CameraFields(name="preview", source_type=body.source_type, source=body.source)  # type: ignore[arg-type]
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    _check_file_exists(fields)
    frame = await asyncio.to_thread(grab_one_frame, fields.source_type, fields.source)
    if frame is None:
        raise HTTPException(502, "Could not read a frame from this source")
    return Response(encode_jpeg(frame, 85), media_type="image/jpeg", headers=NO_STORE)


@router.post("/upload-video", response_model=UploadedVideo, status_code=201)
async def upload_video(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in VIDEO_EXTENSIONS:
        raise HTTPException(400, f"Unsupported video type (allowed: {', '.join(sorted(VIDEO_EXTENSIONS))})")
    name = f"{uuid.uuid4().hex}{ext}"
    path = settings.video_dir / name
    limit = settings.max_upload_mb * 1024 * 1024
    size = 0
    try:
        with path.open("wb") as out:  # stream to disk; never hold the whole file in memory
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB")
                out.write(chunk)

        def _playable() -> bool:
            cap = open_capture("file", name)
            try:
                return bool(cap and cap.isOpened() and cap.read()[0])
            finally:
                if cap:
                    cap.release()

        if not await asyncio.to_thread(_playable):
            raise HTTPException(400, "Could not decode this video file")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return UploadedVideo(filename=name, size_mb=round(size / 1024 / 1024, 2))


@router.post("", response_model=CameraOut, status_code=201)
def create_camera(body: CameraCreate, db: Session = Depends(get_db), manager: CameraManager = Depends(get_manager)):
    if (db.scalar(select(func.count()).select_from(Camera)) or 0) >= MAX_CAMERAS:
        raise HTTPException(409, f"Camera limit reached ({MAX_CAMERAS})")
    _check_file_exists(body)
    cam = Camera(**body.model_dump())
    db.add(cam)
    db.commit()
    manager.apply(cam)
    return _out(cam)


@router.get("/{camera_id}", response_model=CameraOut)
def get_camera(camera_id: int, db: Session = Depends(get_db)):
    return _out(_get(db, camera_id))


@router.patch("/{camera_id}", response_model=CameraOut)
def update_camera(
    camera_id: int,
    body: CameraUpdate,
    db: Session = Depends(get_db),
    manager: CameraManager = Depends(get_manager),
):
    cam = _get(db, camera_id)
    changes = body.model_dump(exclude_unset=True)
    # The API masks stream passwords; a client echoing the masked URL back must not overwrite the real one.
    if changes.get("source") and "***@" in changes["source"] and changes.get("source_type", cam.source_type) == cam.source_type:
        changes.pop("source")
    current = {f: getattr(cam, f) for f in CameraFields.model_fields}
    try:
        merged = CameraFields(**{**current, **changes})
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    _check_file_exists(merged)
    for field, value in merged.model_dump().items():
        setattr(cam, field, value)
    db.commit()
    manager.apply(cam)
    return _out(cam)


@router.delete("/{camera_id}", status_code=204)
def delete_camera(camera_id: int, db: Session = Depends(get_db), manager: CameraManager = Depends(get_manager)):
    cam = _get(db, camera_id)
    manager.remove(camera_id)
    video = cam.source if cam.source_type == "file" else None
    db.delete(cam)
    db.commit()
    if video and not db.scalar(select(func.count()).select_from(Camera).where(Camera.source == video)):
        (settings.video_dir / video).unlink(missing_ok=True)


@router.get("/{camera_id}/frame", responses={200: {"content": {"image/jpeg": {}}}, 204: {"description": "No frame yet"}})
def latest_frame(camera_id: int, manager: CameraManager = Depends(get_manager)):
    """Latest annotated frame (boxes + zone). The dashboard polls this a few times per second."""
    worker = manager.worker(camera_id)
    jpeg = worker.latest_jpeg() if worker else None
    if jpeg is None:
        return Response(status_code=204, headers=NO_STORE)
    return Response(jpeg, media_type="image/jpeg", headers=NO_STORE)


@router.get("/{camera_id}/snapshot", responses={200: {"content": {"image/jpeg": {}}}})
async def raw_snapshot(camera_id: int, db: Session = Depends(get_db), manager: CameraManager = Depends(get_manager)):
    """Clean (unannotated) frame, for drawing the detection zone."""
    cam = _get(db, camera_id)
    worker = manager.worker(camera_id)
    jpeg = worker.latest_raw_jpeg() if worker else None
    if jpeg is None:
        frame = await asyncio.to_thread(grab_one_frame, cam.source_type, cam.source)
        if frame is None:
            raise HTTPException(502, "Could not read a frame from this camera")
        jpeg = encode_jpeg(frame, 85)
    return Response(jpeg, media_type="image/jpeg", headers=NO_STORE)
