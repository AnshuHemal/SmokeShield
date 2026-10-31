import re
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..config import settings
from .detection import Detection
from .system import UtcDatetime

SourceType = Literal["stream", "file", "device"]
CameraStatus = Literal["starting", "ok", "smoke", "fire", "offline", "disabled"]
STREAM_SCHEMES = {"rtsp", "rtsps", "rtmp", "http", "https"}
_CRED = re.compile(r"(://[^:/@]+:)[^@/]+@")


def mask_source(source_type: str, source: str) -> str:
    """Hide the password of rtsp://user:pass@host URLs before they leave the API."""
    return _CRED.sub(r"\1***@", source) if source_type == "stream" else source


class Point(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class CameraFields(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    source_type: SourceType
    source: str = Field(min_length=1, max_length=512)
    enabled: bool = True
    confidence: float = Field(settings.confidence, ge=0.1, le=0.95)
    confirm_frames: int = Field(settings.confirm_frames, ge=1, le=10)
    confirm_window: int = Field(settings.confirm_window, ge=1, le=10)
    cooldown: int = Field(settings.camera_cooldown, ge=5, le=3600)
    imgsz: Literal[640, 960, 1280] | None = None  # larger finds smaller flames but is slower; None = model default
    zone: list[tuple[float, float]] | None = None

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("zone")
    @classmethod
    def _zone(cls, v):
        if v is None or len(v) == 0:
            return None
        if len(v) < 3 or len(v) > 32:
            raise ValueError("zone needs 3-32 points")
        if any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in v):
            raise ValueError("zone points must be normalised to 0..1")
        return v

    @model_validator(mode="after")
    def _check(self):
        if self.confirm_frames > self.confirm_window:
            raise ValueError("confirm_frames cannot exceed confirm_window")
        s = self.source.strip()
        if self.source_type == "stream":
            if urlparse(s).scheme.lower() not in STREAM_SCHEMES or not urlparse(s).hostname:
                raise ValueError("stream source must be an rtsp://, rtmp://, http:// or https:// URL")
        elif self.source_type == "device":
            if not re.fullmatch(r"\d{1,2}", s):
                raise ValueError("device source must be a camera index such as 0")
        else:  # file: an uploaded video, referenced by bare filename only
            if "/" in s or "\\" in s or s.startswith("."):
                raise ValueError("file source must be an uploaded video filename")
        self.source = s
        return self


class CameraCreate(CameraFields):
    pass


class CameraUpdate(BaseModel):
    """Partial update; the merged result is re-validated as a full CameraFields."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    source_type: SourceType | None = None
    source: str | None = None
    enabled: bool | None = None
    confidence: float | None = None
    confirm_frames: int | None = None
    confirm_window: int | None = None
    cooldown: int | None = None
    imgsz: int | None = None
    zone: list[tuple[float, float]] | None = None


class CameraOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    source_type: SourceType
    source: str
    enabled: bool
    confidence: float
    confirm_frames: int
    confirm_window: int
    cooldown: int
    imgsz: int | None
    zone: list[tuple[float, float]] | None
    created_at: UtcDatetime


class CameraState(BaseModel):
    id: int
    status: CameraStatus
    fps: float = 0.0
    latency_ms: float = 0.0
    detections: list[Detection] = []  # confirmed boxes, including last-known ones held for a moment
    pending: list[Detection] = []  # seen but not confirmed yet
    last_frame_at: float | None = None  # unix seconds
    error: str | None = None


class UploadedVideo(BaseModel):
    filename: str
    size_mb: float
