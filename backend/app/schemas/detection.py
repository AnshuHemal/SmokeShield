from typing import Literal

from pydantic import BaseModel

Label = Literal["fire", "smoke"]


class Detection(BaseModel):
    label: Label
    confidence: float
    # normalised [x1, y1, x2, y2] in 0..1 so any client can scale it to its own canvas
    box: tuple[float, float, float, float]


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
