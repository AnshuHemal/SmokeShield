import uuid

import numpy as np
import pytest
from sqlalchemy import select

from app.config import settings
from app.db.models import Incident
from app.db.session import SessionLocal, init_db
from app.schemas.detection import Detection
from app.services.confirmation import TrackResult
from app.services.episodes import EpisodeRecorder
from app.services.incidents import log_incident

FRAME = np.full((48, 64, 3), 100, np.uint8)


def make_incident(camera_name: str | None = None) -> Incident:
    init_db()
    return log_incident(FRAME, [Detection(label="fire", confidence=0.8, box=(0.1, 0.1, 0.6, 0.6))], "camera", 1, camera_name)


def files_of(inc: Incident):
    return [settings.snapshot_dir / inc.snapshot, settings.snapshot_dir / inc.raw_snapshot]


def test_delete_removes_the_record_and_both_snapshots(client):
    inc = make_incident()
    paths = files_of(inc)
    assert all(p.exists() for p in paths)
    assert client.delete(f"/api/incidents/{inc.id}").status_code == 204
    assert not any(p.exists() for p in paths)
    assert client.delete(f"/api/incidents/{inc.id}").status_code == 404  # already gone


def test_bulk_delete_removes_many_and_skips_unknown_ids(client):
    a, b = make_incident(), make_incident()
    paths = files_of(a) + files_of(b)
    res = client.post("/api/incidents/bulk-delete", json={"ids": [a.id, b.id, 999_999_999]})
    assert res.status_code == 200 and res.json() == {"deleted": 2}
    assert not any(p.exists() for p in paths)
    listed = {i["id"] for i in client.get("/api/incidents?limit=500").json()}
    assert a.id not in listed and b.id not in listed


@pytest.mark.parametrize("body", [{"ids": []}, {"ids": list(range(501))}, {}, {"ids": ["x"]}])
def test_bulk_delete_rejects_empty_oversized_or_malformed_requests(client, body):
    assert client.post("/api/incidents/bulk-delete", json=body).status_code == 422


def test_a_hazard_still_in_view_is_recorded_again_after_its_incident_was_deleted(client):
    """Deleting an incident mid-episode must not make the recorder silently drop the rest of the fire."""
    name = f"cam-{uuid.uuid4().hex[:8]}"
    rec = EpisodeRecorder("camera", 1, name, merge_window=30)
    d = Detection(label="fire", confidence=0.7, box=(0.1, 0.1, 0.6, 0.6))
    seen = TrackResult(active={"fire"}, shown=[d], current=[d])

    def rows():
        with SessionLocal() as db:
            return list(db.scalars(select(Incident).where(Incident.camera_name == name).order_by(Incident.id)))

    init_db()
    rec.process(FRAME, seen, now=0)
    first = rows()
    assert len(first) == 1
    assert client.delete(f"/api/incidents/{first[0].id}").status_code == 204

    for t in range(1, 8):  # the fire is still there; the next "still going" write finds the row missing
        rec.process(FRAME, seen, now=float(t))
    after = rows()
    assert len(after) == 1  # SQLite may reuse the freed id, so count rows and compare the new snapshot instead
    assert after[0].raw_snapshot != first[0].raw_snapshot
    client.delete(f"/api/incidents/{after[0].id}")
