from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .system import UtcDatetime


class ModelVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    filename: str
    location: Literal["bundled", "uploaded"]
    size_mb: float
    notes: str | None
    classes: list[str] | None
    params_m: float | None  # millions of parameters
    latency_ms: float | None
    precision: float | None
    recall: float | None
    map50: float | None
    map50_95: float | None
    is_active: bool
    file_exists: bool
    created_at: UtcDatetime
    activated_at: UtcDatetime | None
    deactivated_at: UtcDatetime | None


class ModelMetaUpdate(BaseModel):
    """Editable facts. Fields that are not sent stay unchanged; null clears a metric."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=500)
    precision: float | None = Field(default=None, ge=0, le=1)
    recall: float | None = Field(default=None, ge=0, le=1)
    map50: float | None = Field(default=None, ge=0, le=1)
    map50_95: float | None = Field(default=None, ge=0, le=1)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v
