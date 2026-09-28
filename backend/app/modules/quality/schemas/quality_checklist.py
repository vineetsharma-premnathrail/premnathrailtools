from datetime import datetime
from pydantic import BaseModel, Field


class QualityChecklistItemPayload(BaseModel):
    parameter: str
    method: str | None = None
    acceptance_criteria: str | None = None
    sort_order: int = 0


class QualityChecklistItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    parameter: str
    method: str | None = None
    acceptance_criteria: str | None = None
    sort_order: int


class QualityChecklistCreate(BaseModel):
    name: str
    description: str | None = None
    category: str | None = None
    items: list[QualityChecklistItemPayload] = Field(default_factory=list)


class QualityChecklistUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    status: str | None = None
    items: list[QualityChecklistItemPayload] | None = None


class QualityChecklistResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    description: str | None = None
    category: str | None = None
    status: str
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    items: list[QualityChecklistItemResponse] = Field(default_factory=list)
