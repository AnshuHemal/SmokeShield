from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SMOKESHIELD_", env_file=".env", extra="ignore")

    # model
    model_path: str = "models/best.pt"
    confidence: float = 0.40
    image_size: int = 640
    device: str = ""

    # alerting defaults (each camera can override these)
    confirm_frames: int = 3  # alarm only if a hazard shows in N of the last M frames
    confirm_window: int = 5
    camera_cooldown: int = 30  # seconds between incidents of the same camera
    incident_cooldown: float = 15.0  # browser-webcam: detections closer together than this merge into one incident
    alarm_hold_seconds: float = 3.0  # keep an alarm (and its box) this long after the last sighting, so it cannot blink
    instant_confidence: float = 0.75  # one detection this confident confirms at once, without waiting for N frames
    weak_floor: float = 0.05  # detections down to this confidence are reported as "weak" (never alarmed on)
    device_capture_width: int = 1280  # ask server webcams for this size (many default to 640x480)
    device_capture_height: int = 720

    # camera workers
    worker_fps: float = 4.0  # max inference rate per camera
    stream_timeout_ms: int = 5000

    # uploads
    max_upload_mb: int = 100
    max_video_frames: int = 300

    # model registry
    model_upload_enabled: bool = True  # .pt files can run code when loaded: switch off on shared hosts
    max_model_mb: int = 200
    max_model_versions: int = 20

    # storage / web
    data_dir: str = "data"
    cors_origins: list[str] = ["http://localhost:5173"]

    @property
    def model_file(self) -> Path:
        p = Path(self.model_path)
        return p if p.is_absolute() else BASE_DIR / p

    def _dir(self, *parts: str) -> Path:
        base = Path(self.data_dir)
        d = (base if base.is_absolute() else BASE_DIR / base).joinpath(*parts)
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def bundled_models_dir(self) -> Path:
        """Folder next to the configured weights file (backend/models by default)."""
        return self.model_file.parent

    @property
    def uploaded_models_dir(self) -> Path:
        return self._dir("models")

    @property
    def data_path(self) -> Path:
        return self._dir()

    @property
    def snapshot_dir(self) -> Path:
        return self._dir("snapshots")

    @property
    def video_dir(self) -> Path:
        return self._dir("videos")


settings = Settings()
