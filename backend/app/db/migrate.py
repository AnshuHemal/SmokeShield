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
    "ended_at": "DATETIME",
}

CAMERA_COLUMNS = {
    "imgsz": "INTEGER",
    "detect_smoke": "BOOLEAN NOT NULL DEFAULT 1",
    "smoke_confidence": "FLOAT",
    "ignore_areas": "JSON",
}


def _add_missing(conn, inspector, table: str, wanted: dict[str, str]) -> None:
    if table not in inspector.get_table_names():
        return  # fresh database - create_all builds it
    existing = {c["name"] for c in inspector.get_columns(table)}
    for name, ddl in wanted.items():
        if name not in existing:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def migrate(engine: Engine) -> None:
    inspector = inspect(engine)
    with engine.begin() as conn:
        _add_missing(conn, inspector, "incidents", INCIDENT_COLUMNS)
        _add_missing(conn, inspector, "cameras", CAMERA_COLUMNS)
