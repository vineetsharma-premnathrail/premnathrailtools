from datetime import datetime
from pydantic import BaseModel


class QualityInspectionPlanLinePayload(BaseModel):
    characteristic_id: int
    sequence: int = 10
    nominal: float | None = None
    min_value: float | None = None
    max_value: float | None = None
    classification: str | None = None
    method: str | None = None
    aql: float | None = None
    remarks: str | None = None


class QualityInspectionPlanLineResponse(QualityInspectionPlanLinePayload):
    model_config = {"from_attributes": True}

    id: int
    characteristic_code: str | None = None
    characteristic_name: str | None = None
    char_type: str | None = None
    unit: str | None = None
    effective_classification: str | None = None


class QualityInspectionPlanCreate(BaseModel):
    item_id: int
    inspection_type: str
    title: str | None = None
    sampling_type: str = "aql"
    aql: float | None = None
    inspection_level: str = "II"
    fixed_sample_size: int | None = None
    remarks: str | None = None
    lines: list[QualityInspectionPlanLinePayload] = []


class QualityInspectionPlanUpdate(BaseModel):
    title: str | None = None
    sampling_type: str | None = None
    aql: float | None = None
    inspection_level: str | None = None
    fixed_sample_size: int | None = None
    remarks: str | None = None
    lines: list[QualityInspectionPlanLinePayload] | None = None


class QualityInspectionPlanResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    plan_number: str
    item_id: int | None = None
    item_name: str
    item_code: str | None = None
    inspection_type: str
    revision: int = 1
    supersedes_id: int | None = None
    title: str | None = None
    sampling_type: str = "aql"
    aql: float | None = None
    inspection_level: str = "II"
    fixed_sample_size: int | None = None
    sampling_plan: str | None = None
    status: str
    remarks: str | None = None
    created_by_id: int | None = None
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    obsoleted_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    lines: list[QualityInspectionPlanLineResponse] = []

    # Denormalized display fields, filled in by the route.
    created_by_name: str | None = None
    approved_by_name: str | None = None
    line_count: int = 0
