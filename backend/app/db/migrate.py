"""Tiny additive migration so existing SQLite files keep their data when new columns appear.

For anything beyond adding nullable/defaulted columns, move to Alembic.
"""

from sqlalchemy import Engine, inspect, text

INCIDENT_COLUMNS = {
    "raw_snapshot": "VARCHAR(128)",
    "detections": "JSON",
    "camera_id": "INTEGER",
    "camera_name": "VARCHAR(80)",
    "status": "VARCHAR(16) NOT NULL DEFAULT 'new'",
    "reviewed_at": "DATETIME",
}


def migrate(engine: Engine) -> None:
    inspector = inspect(engine)
    if "incidents" not in inspector.get_table_names():
        return  # fresh database - create_all builds everything
    existing = {c["name"] for c in inspector.get_columns("incidents")}
    with engine.begin() as conn:
        for name, ddl in INCIDENT_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE incidents ADD COLUMN {name} {ddl}"))
