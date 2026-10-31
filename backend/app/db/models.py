from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .session import Base, utcnow


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    source_type: Mapped[str] = mapped_column(String(16))  # stream | file | device
    source: Mapped[str] = mapped_column(String(512))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # per-camera sensitivity
    confidence: Mapped[float] = mapped_column(Float, default=0.40)
    confirm_frames: Mapped[int] = mapped_column(Integer, default=3)
    confirm_window: Mapped[int] = mapped_column(Integer, default=5)
    cooldown: Mapped[int] = mapped_column(Integer, default=30)  # merge window: detections this close share one incident
    imgsz: Mapped[int | None] = mapped_column(Integer, nullable=True)  # inference size; None = the model's default
    zone: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [[x, y], ...] normalised polygon
    # smoke is the class that shadows and steam fool, so it gets its own switch and its own (stricter) threshold
    detect_smoke: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    smoke_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)  # None = same as `confidence`
    ignore_areas: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [[x1, y1, x2, y2], ...] known false-alarm spots
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ModelVersion(Base):
    """One registered YOLO weights file. Exactly one row is active (the model serving detections)."""

    __tablename__ = "model_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    filename: Mapped[str] = mapped_column(String(128))
    location: Mapped[str] = mapped_column(String(16))  # bundled (backend/models) | uploaded (data/models)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # facts read from the weights when they were loaded
    classes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    params: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)  # median on this server
    # accuracy as reported by the person who trained it (e.g. from the Colab validation table)
    precision: Mapped[float | None] = mapped_column(Float, nullable=True)
    recall: Mapped[float | None] = mapped_column(Float, nullable=True)
    map50: Mapped[float | None] = mapped_column(Float, nullable=True)
    map50_95: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # drives "roll back"


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    label: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(16))  # live | image | video | camera
    snapshot: Mapped[str | None] = mapped_column(String(128), nullable=True)  # annotated JPEG
    raw_snapshot: Mapped[str | None] = mapped_column(String(128), nullable=True)  # clean JPEG (for retraining)
    detections: Mapped[list | None] = mapped_column(JSON, nullable=True)
    camera_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    camera_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # last time this episode was seen
    status: Mapped[str] = mapped_column(String(16), default="new")  # new | real | false_alarm
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
