import io
import uuid
import zipfile
from datetime import datetime

import numpy as np

from ..config import settings
from ..db.models import Incident
from ..db.session import SessionLocal, utcnow
from ..schemas.detection import Detection
from ..schemas.incident import IncidentOut
from .imaging import annotate, encode_jpeg

CLASS_IDS = {"smoke": 0, "fire": 1}  # same order as the D-Fire training data


def log_incident(
    frame: np.ndarray,
    detections: list[Detection],
    source: str,
    camera_id: int | None = None,
    camera_name: str | None = None,
) -> Incident | None:
    """Persist the strongest detection with an annotated and a clean snapshot."""
    if not detections:
        return None
    top = max(detections, key=lambda d: d.confidence)
    stem = uuid.uuid4().hex
    (settings.snapshot_dir / f"{stem}.jpg").write_bytes(encode_jpeg(annotate(frame, detections)))
    (settings.snapshot_dir / f"{stem}_raw.jpg").write_bytes(encode_jpeg(frame, 90))
    with SessionLocal() as db:
        inc = Incident(
            label=top.label,
            confidence=top.confidence,
            source=source,
            snapshot=f"{stem}.jpg",
            raw_snapshot=f"{stem}_raw.jpg",
            detections=[d.model_dump() for d in detections],
            camera_id=camera_id,
            camera_name=camera_name,
            ended_at=utcnow(),  # the episode is still going; this moves forward as it keeps being seen
        )
        db.add(inc)
        db.commit()
        return inc


def touch_incident(incident_id: int, seen_at: datetime | None = None) -> None:
    """Extend an ongoing incident: the hazard was seen again."""
    with SessionLocal() as db:
        inc = db.get(Incident, incident_id)
        if inc:
            inc.ended_at = seen_at or utcnow()
            db.commit()


def improve_incident(incident_id: int, frame: np.ndarray, detections: list[Detection], seen_at: datetime | None = None) -> None:
    """Replace the incident's pictures with a better (more confident) frame from the same episode."""
    if not detections:
        return
    top = max(detections, key=lambda d: d.confidence)
    with SessionLocal() as db:
        inc = db.get(Incident, incident_id)
        if not inc:
            return
        if inc.snapshot:
            (settings.snapshot_dir / inc.snapshot).write_bytes(encode_jpeg(annotate(frame, detections)))
        if inc.raw_snapshot:
            (settings.snapshot_dir / inc.raw_snapshot).write_bytes(encode_jpeg(frame, 90))
        inc.confidence = top.confidence
        inc.detections = [d.model_dump() for d in detections]
        inc.ended_at = seen_at or utcnow()
        db.commit()


def delete_files(inc: Incident) -> None:
    for name in (inc.snapshot, inc.raw_snapshot):
        if name:
            (settings.snapshot_dir / name).unlink(missing_ok=True)


def to_out(inc: Incident) -> IncidentOut:
    out = IncidentOut.model_validate(inc)
    out.snapshot_url = _url(inc.snapshot)
    out.raw_url = _url(inc.raw_snapshot)
    if inc.ended_at:
        out.duration_s = round(max(0.0, (inc.ended_at - inc.created_at).total_seconds()), 1)
    return out


def _url(name: str | None) -> str | None:
    if not name:
        return None
    path = settings.snapshot_dir / name
    version = int(path.stat().st_mtime) if path.exists() else 0  # a snapshot rewritten in place must not be served stale
    return f"/snapshots/{name}?v={version}"


def build_training_zip(incidents: list[Incident]) -> bytes:
    """YOLO-format hard-example set from reviewed incidents.

    real         -> clean frame + the model's boxes (seed labels; spot-check before training)
    false_alarm  -> clean frame + empty label file (a negative example)
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for inc in incidents:
            if not inc.raw_snapshot or inc.status not in ("real", "false_alarm"):
                continue
            path = settings.snapshot_dir / inc.raw_snapshot
            if not path.exists():
                continue
            name = f"incident_{inc.id}_{inc.status}"
            z.write(path, f"images/{name}.jpg")
            lines = []
            if inc.status == "real":
                for d in inc.detections or []:
                    x1, y1, x2, y2 = d["box"]
                    lines.append(
                        f"{CLASS_IDS[d['label']]} {(x1 + x2) / 2:.6f} {(y1 + y2) / 2:.6f} {x2 - x1:.6f} {y2 - y1:.6f}"
                    )
            z.writestr(f"labels/{name}.txt", "\n".join(lines))
        z.writestr(
            "data.yaml",
            "path: .\ntrain: images\nval: images\nnames:\n  0: smoke\n  1: fire\n",
        )
    return buf.getvalue()
