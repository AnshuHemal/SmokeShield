from collections.abc import Iterator

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from ..config import settings
from ..db.session import SessionLocal
from ..services.camera_manager import CameraManager
from ..services.detector import DetectorLike
from ..services.model_manager import ModelManager


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


def get_detector(request: Request) -> DetectorLike:
    det: DetectorLike = request.app.state.detector
    if not det.loaded:
        raise HTTPException(503, f"Model weights not found at {settings.model_file}. See README for training/setup.")
    return det


def get_manager(request: Request) -> CameraManager:
    return request.app.state.manager


def get_models(request: Request) -> ModelManager:
    return request.app.state.models
