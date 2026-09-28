from datetime import datetime
from pydantic import BaseModel


class QualityInspectionPlanCreate(BaseModel):
    item_name: str
    item_code: str | None = None
    inspection_type: str
    checklist_id: int | None = None
    standard_id: int | None = None
    sampling_plan: str | None = None


class QualityInspectionPlanUpdate(BaseModel):
    item_name: str | None = None
    item_code: str | None = None
    inspection_type: str | None = None
    checklist_id: int | None = None
    standard_id: int | None = None
    sampling_plan: str | None = None
    status: str | None = None


class QualityInspectionPlanResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    plan_number: str
    item_name: str
    item_code: str | None = None
    inspection_type: str
    checklist_id: int | None = None
    standard_id: int | None = None
    sampling_plan: str | None = None
    status: str
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    checklist_name: str | None = None
    standard_code: str | None = None
