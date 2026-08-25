from datetime import date, datetime
from pydantic import BaseModel


class InquiryCreate(BaseModel):
    org_id: int
    org_contact_id: int | None = None
    railway_zone: str | None = None
    division: str | None = None
    lead_source: str | None = None
    bd_owner: str | None = None
    sales_engineer: str | None = None
    status: str = "Requirement Received"
    current_stage: str = "Customer Requirement"
    product: str | None = None
    product_category: str | None = None
    product_spec: str | None = None
    quantity: float | None = None
    unit: str | None = None
    required_delivery_date: date | None = None
    delivery_location: str | None = None
    requirement_desc: str | None = None
    detailed_requirement: str | None = None
    inspection_req: str | None = None
    warranty_req: str | None = None
    budget: float | None = None
    expected_value: float | None = None
    probability: int | None = None
    expected_order_date: date | None = None
    priority: str = "Medium"
    next_followup_date: date | None = None
    followup_priority: str | None = None
    followup_assigned_to: str | None = None
    followup_remarks: str | None = None


class InquiryUpdate(BaseModel):
    org_id: int | None = None
    org_contact_id: int | None = None
    railway_zone: str | None = None
    division: str | None = None
    lead_source: str | None = None
    bd_owner: str | None = None
    sales_engineer: str | None = None
    status: str | None = None
    current_stage: str | None = None
    product: str | None = None
    product_category: str | None = None
    product_spec: str | None = None
    quantity: float | None = None
    unit: str | None = None
    required_delivery_date: date | None = None
    delivery_location: str | None = None
    requirement_desc: str | None = None
    detailed_requirement: str | None = None
    inspection_req: str | None = None
    warranty_req: str | None = None
    budget: float | None = None
    expected_value: float | None = None
    probability: int | None = None
    expected_order_date: date | None = None
    priority: str | None = None
    next_followup_date: date | None = None
    followup_priority: str | None = None
    followup_assigned_to: str | None = None
    followup_remarks: str | None = None


class InquiryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    universal_id: str
    org_id: int
    org_contact_id: int | None = None
    railway_zone: str | None = None
    division: str | None = None
    lead_source: str | None = None
    bd_owner: str | None = None
    sales_engineer: str | None = None
    status: str
    current_stage: str
    product: str | None = None
    product_category: str | None = None
    product_spec: str | None = None
    quantity: float | None = None
    unit: str | None = None
    required_delivery_date: date | None = None
    delivery_location: str | None = None
    requirement_desc: str | None = None
    detailed_requirement: str | None = None
    inspection_req: str | None = None
    warranty_req: str | None = None
    budget: float | None = None
    expected_value: float | None = None
    probability: int | None = None
    expected_order_date: date | None = None
    priority: str
    next_followup_date: date | None = None
    followup_priority: str | None = None
    followup_assigned_to: str | None = None
    followup_remarks: str | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    is_deleted: bool = False


class StageLogEntry(BaseModel):
    stage: str
    notes: str | None = None
