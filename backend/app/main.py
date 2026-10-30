import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from .api import cameras, detect, events, health, incidents, models, stats
from .config import BASE_DIR, settings
from .db.session import init_db
from .services import model_registry
from .services.camera_manager import CameraManager
from .services.model_manager import ModelError, ModelManager, default_loader, measure_latency, ProbeResult

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("smokeshield")


def _load_initial_model(manager: ModelManager) -> None:
    """Load the active registered version (or the configured weights file) into the manager."""
    version = model_registry.initial_version()
    path = model_registry.resolve_path(version) if version else settings.model_file
    if not path.is_file():
        log.warning("No model weights at %s - detection disabled until a model is activated", path)
        return
    try:
        det = manager.loader(path)
    except ModelError as exc:
        log.error("Could not load %s: %s", path.name, exc)
        return
    manager.set_current(det, version.id if version else None, version.name if version else path.name)
    if version:
        model_registry.save_probe(version.id, ProbeResult(list(det.classes), getattr(det, "params", None), measure_latency(det)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Tests inject a fake detector and loader; production loads the active version from the registry.
    injected = getattr(app.state, "detector", None)
    models_mgr = ModelManager(getattr(app.state, "model_loader", None) or default_loader)
    if injected is not None and not isinstance(injected, ModelManager):
        models_mgr.set_current(injected)
    else:
        await asyncio.to_thread(model_registry.seed_from_disk, settings.bundled_models_dir, settings.model_file.name)
        await asyncio.to_thread(_load_initial_model, models_mgr)
    app.state.models = models_mgr
    app.state.detector = models_mgr  # the one handle every worker and route predicts through
    app.state.manager = CameraManager(models_mgr)
    await asyncio.to_thread(app.state.manager.start)
    yield
    await asyncio.to_thread(app.state.manager.stop_all)


app = FastAPI(title="SmokeShield API", version="2.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (health, detect, cameras, incidents, stats, events, models):
    app.include_router(module.router)

app.mount("/snapshots", StaticFiles(directory=settings.snapshot_dir), name="snapshots")


class SPAStaticFiles(StaticFiles):
    """Static files with client-side-routing fallback: /monitor, /incidents... load index.html on refresh."""

    async def get_response(self, path: str, scope):
        norm = path.replace("\\", "/")  # Starlette hands us OS-style separators on Windows
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or norm.startswith(("api/", "ws/", "snapshots/")) or "." in norm.rsplit("/", 1)[-1]:
                raise  # real API / asset misses stay 404
            response = await super().get_response("index.html", scope)
            norm = "index.html"
        if norm.startswith("assets/"):
            # Vite fingerprints these files (index-<hash>.js), so a new build gets new URLs: cache forever.
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif norm in ("", ".", "index.html"):
            # The entry page names the current bundle: always revalidate, or users keep running the old UI.
            response.headers["Cache-Control"] = "no-cache"
        return response


# Serve the built frontend (npm run build) when present, for single-process deployment.
_dist = BASE_DIR.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/", SPAStaticFiles(directory=_dist, html=True), name="frontend")
