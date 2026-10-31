from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Incident
from ..db.session import utcnow
from ..schemas.incident import BulkDeleteIn, BulkDeleteOut, IncidentOut, ReviewIn
from ..services.incidents import build_training_zip, delete_incidents, to_out
from .deps import get_db

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


def _get(db: Session, incident_id: int) -> Incident:
    inc = db.get(Incident, incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")
    return inc


@router.get("", response_model=list[IncidentOut])
def list_incidents(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    label: str | None = Query(None, pattern="^(fire|smoke)$"),
    status: str | None = Query(None, pattern="^(new|real|false_alarm)$"),
    camera_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = select(Incident).order_by(Incident.created_at.desc(), Incident.id.desc())
    if label:
        q = q.where(Incident.label == label)
    if status:
        q = q.where(Incident.status == status)
    if camera_id is not None:
        q = q.where(Incident.camera_id == camera_id)
    return [to_out(i) for i in db.scalars(q.offset(offset).limit(limit))]


@router.get("/export/training")
def export_training_set(db: Session = Depends(get_db)):
    """Download reviewed incidents as a YOLO dataset (real -> boxes, false alarm -> negative example)."""
    rows = list(db.scalars(select(Incident).where(Incident.status.in_(("real", "false_alarm")))))
    if not rows:
        raise HTTPException(404, "No reviewed incidents yet - mark some as Real or False alarm first")
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return Response(
        build_training_zip(rows),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="smokeshield-hard-examples-{stamp}.zip"'},
    )


@router.patch("/{incident_id}/review", response_model=IncidentOut)
def review_incident(incident_id: int, body: ReviewIn, db: Session = Depends(get_db)):
    inc = _get(db, incident_id)
    inc.status = body.status
    inc.reviewed_at = None if body.status == "new" else utcnow()
    db.commit()
    return to_out(inc)


@router.post("/bulk-delete", response_model=BulkDeleteOut)
def delete_many(body: BulkDeleteIn, db: Session = Depends(get_db)):
    """Delete several incidents at once. Ids that no longer exist are skipped, so a retry or a stale list is harmless."""
    rows = list(db.scalars(select(Incident).where(Incident.id.in_(set(body.ids)))))
    return BulkDeleteOut(deleted=delete_incidents(db, rows))


@router.delete("/{incident_id}", status_code=204)
def delete_incident(incident_id: int, db: Session = Depends(get_db)):
    delete_incidents(db, [_get(db, incident_id)])
