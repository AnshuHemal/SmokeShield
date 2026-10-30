from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Label = Literal["fire", "smoke"]
Source = Literal["live", "image", "video"]


class Detection(BaseModel):
    label: Label
    confidence: float
    # normalised [x1, y1, x2, y2] in 0..1 so any client can scale it to its own canvas
    box: tuple[float, float, float, float]


class HealthOut(BaseModel):
    status: Literal["ok", "model_missing"]
    model_loaded: bool
    model_path: str
    classes: list[str]
    device: str


class ImageResult(BaseModel):
    detections: list[Detection]
    latency_ms: float
    alert: bool
    annotated: str  # data URL (JPEG)
    incident_id: int | None = None


class TimelinePoint(BaseModel):
    time_s: float
    fire: float
    smoke: float


class VideoResult(BaseModel):
    frames_analysed: int
    duration_s: float
    fire_frames: int
    smoke_frames: int
    peak_confidence: float
    alert: bool
    timeline: list[TimelinePoint]
    peak_frame: str | None  # data URL (JPEG) of the highest-confidence frame
    incident_id: int | None = None


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    label: Label
    confidence: float
    source: Source
    snapshot_url: str | None = None


class HourBucket(BaseModel):
    start: str  # ISO-8601 UTC hour start, e.g. 2026-10-29T09:00:00Z; clients format it in local time
    fire: int
    smoke: int


class StatsOut(BaseModel):
    total: int
    fire: int
    smoke: int
    last_24h: int
    avg_confidence: float
    hourly: list[HourBucket]
