from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from .detection import Detection, Label
from .system import UtcDatetime

Source = Literal["live", "image", "video", "camera"]
ReviewStatus = Literal["new", "real", "false_alarm"]


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: UtcDatetime
    label: Label
    confidence: float
    source: Source
    status: ReviewStatus
    reviewed_at: UtcDatetime | None = None
    camera_id: int | None = None
    camera_name: str | None = None
    snapshot_url: str | None = None
    raw_url: str | None = None
    detections: list[Detection] = []

    @field_validator("detections", mode="before")
    @classmethod
    def _legacy_null(cls, v):
        return v or []  # incidents saved before boxes were stored have NULL here


class ReviewIn(BaseModel):
    status: ReviewStatus


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
    reviewed: int
    real: int
    false_alarms: int
    false_alarm_rate: float | None  # false_alarms / reviewed; None until something is reviewed
    cameras_total: int
    cameras_online: int
