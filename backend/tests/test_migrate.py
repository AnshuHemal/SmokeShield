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


def test_cameras_and_incidents_gain_the_new_columns_without_losing_rows(tmp_path):
    from sqlalchemy import inspect

    engine = create_engine(f"sqlite:///{tmp_path / 'v2.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE cameras (id INTEGER PRIMARY KEY, name VARCHAR(80), source_type VARCHAR(16), source VARCHAR(512), "
                          "enabled BOOLEAN, confidence FLOAT, confirm_frames INTEGER, confirm_window INTEGER, cooldown INTEGER, zone JSON, created_at DATETIME)"))
        conn.execute(text("INSERT INTO cameras (name, source_type, source, enabled, confidence, confirm_frames, confirm_window, cooldown) "
                          "VALUES ('Old cam', 'device', '0', 1, 0.4, 3, 5, 30)"))
        conn.execute(text("CREATE TABLE incidents (id INTEGER PRIMARY KEY, created_at DATETIME, label VARCHAR(16), confidence FLOAT, source VARCHAR(16), snapshot VARCHAR(128))"))

    migrate(engine)
    migrate(engine)  # idempotent

    insp = inspect(engine)
    assert "imgsz" in {c["name"] for c in insp.get_columns("cameras")}
    assert "ended_at" in {c["name"] for c in insp.get_columns("incidents")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT name, imgsz FROM cameras")).one() == ("Old cam", None)  # kept, default detail
