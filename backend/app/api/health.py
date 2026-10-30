from fastapi import APIRouter, Depends, Request

from ..config import settings
from ..schemas.system import HealthOut
from ..services.camera_manager import CameraManager
from .deps import get_manager

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", response_model=HealthOut)
def health(request: Request, manager: CameraManager = Depends(get_manager)):
    det = request.app.state.detector
    total, online = manager.counts()
    return HealthOut(
        status="ok" if det.loaded else "model_missing",
        model_loaded=det.loaded,
        model_path=str(settings.model_file),
        classes=det.classes,
        device=det.device,
        cameras_total=total,
        cameras_online=online,
    )
