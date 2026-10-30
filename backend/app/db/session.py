from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from ..config import settings

engine = create_engine(
    f"sqlite:///{settings.data_path / 'smokeshield.db'}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    """Naive UTC timestamp (SQLite has no tz support); the API serialises it with a trailing Z."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)
    from .migrate import migrate

    migrate(engine)  # add columns to databases created by older versions
    Base.metadata.create_all(engine)
