import io
import uuid
import zipfile

import numpy as np

from ..config import settings
from ..db.models import Incident
from ..db.session import SessionLocal
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
        )
        db.add(inc)
        db.commit()
        return inc


def delete_files(inc: Incident) -> None:
    for name in (inc.snapshot, inc.raw_snapshot):
        if name:
            (settings.snapshot_dir / name).unlink(missing_ok=True)


def to_out(inc: Incident) -> IncidentOut:
    out = IncidentOut.model_validate(inc)
    out.snapshot_url = f"/snapshots/{inc.snapshot}" if inc.snapshot else None
    out.raw_url = f"/snapshots/{inc.raw_snapshot}" if inc.raw_snapshot else None
    return out


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
