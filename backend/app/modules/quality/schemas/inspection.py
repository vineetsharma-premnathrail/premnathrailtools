from datetime import date, datetime
from pydantic import BaseModel, Field


class QualityInspectionResultPayload(BaseModel):
    parameter: str
    method: str | None = None
    acceptance_criteria: str | None = None
    observed_value: str | None = None
    result: str | None = None
    sort_order: int = 0


class QualityInspectionResultResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    parameter: str
    method: str | None = None
    acceptance_criteria: str | None = None
    observed_value: str | None = None
    result: str | None = None
    sort_order: int


class QualityInspectionAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    filename: str
    file_path: str
    uploaded_by_id: int | None = None
    created_at: datetime | None = None


class QualityInspectionCreate(BaseModel):
    inspection_type: str
    inspection_plan_id: int | None = None
    item_name: str
    item_code: str | None = None
    batch_number: str | None = None
    quantity_inspected: float | None = None
    quantity_accepted: float | None = None
    quantity_rejected: float | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    p2p_request_id: int | None = None
    project_label: str | None = None
    inspection_date: date
    remarks: str | None = None
    results: list[QualityInspectionResultPayload] = Field(default_factory=list)


class QualityInspectionUpdate(BaseModel):
    inspection_plan_id: int | None = None
    item_name: str | None = None
    item_code: str | None = None
    batch_number: str | None = None
    quantity_inspected: float | None = None
    quantity_accepted: float | None = None
    quantity_rejected: float | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    p2p_request_id: int | None = None
    project_label: str | None = None
    inspection_date: date | None = None
    remarks: str | None = None
    status: str | None = None
    results: list[QualityInspectionResultPayload] | None = None


class QualityInspectionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    inspection_number: str
    inspection_type: str
    inspection_plan_id: int | None = None
    item_name: str
    item_code: str | None = None
    batch_number: str | None = None
    quantity_inspected: float | None = None
    quantity_accepted: float | None = None
    quantity_rejected: float | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    p2p_request_id: int | None = None
    project_label: str | None = None
    inspected_by_id: int | None = None
    inspection_date: date
    status: str
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    results: list[QualityInspectionResultResponse] = Field(default_factory=list)
    attachments: list[QualityInspectionAttachmentResponse] = Field(default_factory=list)

    # Denormalized display field, filled in by the route.
    inspected_by_name: str | None = None
