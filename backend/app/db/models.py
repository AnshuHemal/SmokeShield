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
    cooldown: Mapped[int] = mapped_column(Integer, default=30)
    zone: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [[x, y], ...] normalised polygon
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


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
    status: Mapped[str] = mapped_column(String(16), default="new")  # new | real | false_alarm
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
