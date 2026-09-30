"""Schemas for lifecycle checklist templates (HR > Masters)."""
from datetime import datetime

from pydantic import BaseModel, Field


class HrChecklistTemplateCreate(BaseModel):
    event_type: str
    category: str
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    default_owner_user_id: int | None = None
    sort_order: int | None = None
    is_active: bool = True


class HrChecklistTemplateUpdate(BaseModel):
    event_type: str | None = None
    category: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    default_owner_user_id: int | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class HrChecklistTemplateResponse(BaseModel):
    id: int
    event_type: str
    category: str
    title: str
    description: str | None = None
    default_owner_user_id: int | None = None
    sort_order: int = 0
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    default_owner_name: str | None = None
