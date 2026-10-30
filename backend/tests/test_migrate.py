from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db.migrate import migrate
from app.db.models import Incident
from app.schemas.incident import IncidentOut


def test_old_database_is_upgraded_in_place(tmp_path):
    """A v1 database (no review/camera columns) must keep its rows and become readable."""
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE incidents (id INTEGER PRIMARY KEY, created_at DATETIME, label VARCHAR(16), "
            "confidence FLOAT, source VARCHAR(16), snapshot VARCHAR(128))"
        ))
        conn.execute(text(
            "INSERT INTO incidents (created_at, label, confidence, source, snapshot) "
            "VALUES ('2026-10-29 09:00:00', 'fire', 0.81, 'image', 'old.jpg')"
        ))

    migrate(engine)
    migrate(engine)  # idempotent

    with Session(engine) as db:
        inc = db.query(Incident).one()
        out = IncidentOut.model_validate(inc)
    assert out.status == "new" and out.detections == [] and out.camera_id is None
    assert out.created_at.isoformat().endswith("Z") is False  # raw model keeps naive time...
    assert out.model_dump(mode="json")["created_at"].endswith("Z")  # ...the API output carries the Z
