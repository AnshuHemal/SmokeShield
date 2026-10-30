from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SMOKESHIELD_", env_file=".env", extra="ignore")

    model_path: str = "models/best.pt"
    confidence: float = 0.40
    image_size: int = 640
    device: str = ""
    incident_cooldown: float = 15.0
    cors_origins: list[str] = ["http://localhost:5173"]
    max_upload_mb: int = 100
    max_video_frames: int = 300

    @property
    def model_file(self) -> Path:
        p = Path(self.model_path)
        return p if p.is_absolute() else BASE_DIR / p

    @property
    def data_dir(self) -> Path:
        d = BASE_DIR / "data"
        d.mkdir(exist_ok=True)
        return d

    @property
    def snapshot_dir(self) -> Path:
        d = self.data_dir / "snapshots"
        d.mkdir(exist_ok=True)
        return d


settings = Settings()
