import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException
from fastapi.staticfiles import StaticFiles

from .api import cameras, detect, events, health, incidents, stats
from .config import BASE_DIR, settings
from .db.session import init_db
from .services.camera_manager import CameraManager
from .services.detector import YoloDetector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if not hasattr(app.state, "detector"):  # tests inject their own
        detector = YoloDetector(settings.model_file, settings.image_size, settings.device)
        await asyncio.to_thread(detector.load)
        app.state.detector = detector
    app.state.manager = CameraManager(app.state.detector)
    await asyncio.to_thread(app.state.manager.start)
    yield
    await asyncio.to_thread(app.state.manager.stop_all)


app = FastAPI(title="SmokeShield API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (health, detect, cameras, incidents, stats, events):
    app.include_router(module.router)

app.mount("/snapshots", StaticFiles(directory=settings.snapshot_dir), name="snapshots")

class SPAStaticFiles(StaticFiles):
    """Static files with client-side-routing fallback: /monitor, /incidents... load index.html on refresh."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            norm = path.replace("\\", "/")  # Starlette hands us OS-style separators on Windows
            if exc.status_code != 404 or norm.startswith(("api/", "ws/", "snapshots/")) or "." in norm.rsplit("/", 1)[-1]:
                raise  # real API / asset misses stay 404
            return await super().get_response("index.html", scope)


# Serve the built frontend (npm run build) when present, for single-process deployment.
_dist = BASE_DIR.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/", SPAStaticFiles(directory=_dist, html=True), name="frontend")
