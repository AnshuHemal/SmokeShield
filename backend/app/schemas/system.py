from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, PlainSerializer

# DB timestamps are naive UTC; always emit them with a Z so browsers convert to local time correctly.
UtcDatetime = Annotated[datetime, PlainSerializer(lambda d: d.isoformat() + "Z", return_type=str)]


class HealthOut(BaseModel):
    status: Literal["ok", "model_missing"]
    model_loaded: bool
    model_path: str
    classes: list[str]
    device: str
    cameras_total: int = 0
    cameras_online: int = 0
