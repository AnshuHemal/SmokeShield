from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import Incident
from ..db.session import utcnow
from ..schemas.incident import HourBucket, StatsOut
from ..services.camera_manager import CameraManager
from .deps import get_db, get_manager

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats", response_model=StatsOut)
def stats(db: Session = Depends(get_db), manager: CameraManager = Depends(get_manager)):
    by_label = dict(db.execute(select(Incident.label, func.count()).group_by(Incident.label)).all())
    by_status = dict(db.execute(select(Incident.status, func.count()).group_by(Incident.status)).all())
    total = sum(by_label.values())
    avg = db.scalar(select(func.avg(Incident.confidence))) or 0.0

    start = utcnow().replace(minute=0, second=0, microsecond=0) - timedelta(hours=23)
    buckets = {start + timedelta(hours=i): {"fire": 0, "smoke": 0} for i in range(24)}
    for created_at, label in db.execute(select(Incident.created_at, Incident.label).where(Incident.created_at >= start)):
        key = created_at.replace(minute=0, second=0, microsecond=0)
        if key in buckets:
            buckets[key][label] += 1

    real, false_alarms = by_status.get("real", 0), by_status.get("false_alarm", 0)
    reviewed = real + false_alarms
    cams_total, cams_online = manager.counts()
    return StatsOut(
        total=total,
        fire=by_label.get("fire", 0),
        smoke=by_label.get("smoke", 0),
        last_24h=sum(b["fire"] + b["smoke"] for b in buckets.values()),
        avg_confidence=round(float(avg), 4),
        hourly=[HourBucket(start=k.strftime("%Y-%m-%dT%H:00:00Z"), **v) for k, v in buckets.items()],
        reviewed=reviewed,
        real=real,
        false_alarms=false_alarms,
        false_alarm_rate=round(false_alarms / reviewed, 4) if reviewed else None,
        cameras_total=cams_total,
        cameras_online=cams_online,
    )
