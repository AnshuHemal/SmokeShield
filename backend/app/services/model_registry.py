"""Registered model versions: what exists, which one is live, and how to switch or roll back safely."""

import hashlib
import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from ..config import settings
from ..db.models import ModelVersion
from ..db.session import SessionLocal, utcnow
from ..schemas.model import ModelVersionOut
from .model_manager import ModelError, ModelManager, ProbeResult

log = logging.getLogger("smokeshield.registry")


class RegistryNotFound(Exception):
    pass


class RegistryConflict(Exception):
    """The request is valid but not allowed in the current state (e.g. deleting the active model)."""


def models_dir(location: str) -> Path:
    return settings.bundled_models_dir if location == "bundled" else settings.uploaded_models_dir


def resolve_path(v: ModelVersion) -> Path:
    # filenames are generated or read from our own folders; never trust a stored path component
    return models_dir(v.location) / Path(v.filename).name


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def to_out(v: ModelVersion) -> ModelVersionOut:
    return ModelVersionOut(
        id=v.id,
        name=v.name,
        filename=v.filename,
        location=v.location,  # type: ignore[arg-type]
        size_mb=round(v.size_bytes / 1024 / 1024, 2),
        notes=v.notes,
        classes=v.classes,
        params_m=round(v.params / 1e6, 1) if v.params else None,
        latency_ms=v.latency_ms,
        precision=v.precision,
        recall=v.recall,
        map50=v.map50,
        map50_95=v.map50_95,
        is_active=v.is_active,
        file_exists=resolve_path(v).is_file(),
        created_at=v.created_at,
        activated_at=v.activated_at,
        deactivated_at=v.deactivated_at,
    )


def apply_probe(v: ModelVersion, probe: ProbeResult) -> None:
    v.classes, v.params, v.latency_ms = probe.classes, probe.params, probe.latency_ms


def save_probe(version_id: int, probe: ProbeResult) -> None:
    with SessionLocal() as db:
        v = db.get(ModelVersion, version_id)
        if v:
            apply_probe(v, probe)
            db.commit()


def _pretty(stem: str) -> str:
    return stem.replace("_", " ").replace("-", " ").strip().title() or "Model"


# ---------------------------------------------------------------- startup

def seed_from_disk(bundled_dir: Path, preferred_filename: str | None) -> None:
    """Register any *.pt already sitting in the models folder, and make sure one version is active.

    This lets an install that predates the registry (a plain models/best.pt) show up with no manual step.
    """
    if not bundled_dir.is_dir():
        return
    with SessionLocal() as db:
        known = {v.filename for v in db.scalars(select(ModelVersion).where(ModelVersion.location == "bundled"))}
        for p in sorted(bundled_dir.glob("*.pt")):
            if p.name in known:
                continue
            db.add(
                ModelVersion(
                    name=_pretty(p.stem),
                    filename=p.name,
                    location="bundled",
                    sha256=file_sha256(p),
                    size_bytes=p.stat().st_size,
                    created_at=datetime.utcfromtimestamp(p.stat().st_mtime),
                )
            )
            log.info("Registered model %s", p.name)
        db.commit()

        if db.scalar(select(ModelVersion).where(ModelVersion.is_active)) is None:
            rows = list(db.scalars(select(ModelVersion).where(ModelVersion.location == "bundled")))
            pick = next((r for r in rows if r.filename == preferred_filename), None) or (
                max(rows, key=lambda r: r.created_at) if rows else None
            )
            if pick:
                pick.is_active, pick.activated_at = True, utcnow()
                db.commit()


def initial_version() -> ModelVersion | None:
    """The version marked active whose weights still exist, or None."""
    with SessionLocal() as db:
        v = db.scalar(select(ModelVersion).where(ModelVersion.is_active))
        return v if v and resolve_path(v).is_file() else None


# ---------------------------------------------------------------- switching

def activate(manager: ModelManager, version_id: int) -> ModelVersion:
    """Load a version and make it live. The old model keeps serving until the new one has loaded cleanly."""
    with manager.swap_lock:
        with SessionLocal() as db:
            v = db.get(ModelVersion, version_id)
            if v is None:
                raise RegistryNotFound("Model version not found")
            if v.is_active and manager.loaded and manager.version_id == v.id:
                return v  # already live
            det, probe = manager.probe(resolve_path(v))  # raises ModelError; nothing has changed yet
            now = utcnow()
            for prev in db.scalars(select(ModelVersion).where(ModelVersion.is_active)):
                prev.is_active, prev.deactivated_at = False, now
            v.is_active, v.activated_at, v.deactivated_at = True, now, None
            apply_probe(v, probe)
            db.commit()
            manager.set_current(det, v.id, v.name)
            log.warning("Model switched to %s (#%s)", v.name, v.id)
            return v


def rollback(manager: ModelManager) -> ModelVersion:
    """Re-activate the version that was live most recently before the current one."""
    with manager.swap_lock:
        with SessionLocal() as db:
            candidates = db.scalars(
                select(ModelVersion)
                .where(ModelVersion.is_active.is_(False), ModelVersion.deactivated_at.is_not(None))
                .order_by(ModelVersion.deactivated_at.desc())
            )
            target = next((v for v in candidates if resolve_path(v).is_file()), None)
        if target is None:
            raise RegistryConflict("There is no previous model to roll back to")
        return activate(manager, target.id)


def delete(manager: ModelManager, version_id: int) -> None:
    with manager.swap_lock:
        with SessionLocal() as db:
            v = db.get(ModelVersion, version_id)
            if v is None:
                raise RegistryNotFound("Model version not found")
            if v.is_active:
                raise RegistryConflict("The active model cannot be deleted - activate another version first")
            resolve_path(v).unlink(missing_ok=True)
            db.delete(v)
            db.commit()


__all__ = [
    "ModelError", "RegistryConflict", "RegistryNotFound", "activate", "apply_probe", "delete", "file_sha256",
    "initial_version", "resolve_path", "rollback", "save_probe", "seed_from_disk", "to_out",
]
