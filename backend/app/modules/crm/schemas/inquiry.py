from datetime import date, datetime
from pydantic import BaseModel


class InquiryLineItemPayload(BaseModel):
    product: str | None = None
    product_category: str | None = None
    product_spec: str | None = None
    quantity: float | None = None


class InquiryLineItemResponse(InquiryLineItemPayload):
    model_config = {"from_attributes": True}

    id: int


class InquiryCreate(BaseModel):
    org_id: int
    org_contact_id: int
    railway_zone: str | None = None
    division: str | None = None
    inquiry_date: date | None = None
    lead_source: str
    bd_owner: str | None = None
    sales_engineer: str | None = None
    # Opportunity owner / sales engineer as users (the name fields above follow them).
    bd_owner_id: int | None = None
    sales_engineer_id: int | None = None
    # Win / loss — required when the inquiry closes as not ordered (crm/services/opportunity.py).
    lost_reason_code: str | None = None
    lost_to_competitor: str | None = None
    lost_remarks: str | None = None
    status: str = "Lead"
    current_stage: str = "Requirement Received"
    current_status_note: str | None = None
    product: str | None = None
    product_category: str | None = None
    product_spec: str | None = None
    quantity: float | None = None
    additional_items: list[InquiryLineItemPayload] | None = None
    required_delivery_date: date | None = None
    delivery_location: str | None = None
    requirement_desc: str | None = None
    project_details: str | None = None
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
    # Only for an admin moving the stage back — required then, logged on the timeline.
    stage_reason: str | None = None
    org_id: int | None = None
    org_contact_id: int | None = None
    railway_zone: str | None = None
    division: str | None = None
    inquiry_date: date | None = None
    lead_source: str | None = None
    bd_owner: str | None = None
    sales_engineer: str | None = None
    # Opportunity owner / sales engineer as users (the name fields above follow them).
    bd_owner_id: int | None = None
    sales_engineer_id: int | None = None
    # Win / loss — required when the inquiry closes as not ordered (crm/services/opportunity.py).
    lost_reason_code: str | None = None
    lost_to_competitor: str | None = None
    lost_remarks: str | None = None
    status: str | None = None
    current_stage: str | None = None
    current_status_note: str | None = None
    product: str | None = None
    product_category: str | None = None
    product_spec: str | None = None
    quantity: float | None = None
    additional_items: list[InquiryLineItemPayload] | None = None
    required_delivery_date: date | None = None
    delivery_location: str | None = None
    requirement_desc: str | None = None
    project_details: str | None = None
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
    # Set on the detail view when a live sales order was raised from this inquiry
    # (sent to Sales) — the inquiry is then read-only for everyone.
    sales_order_number: str | None = None
    universal_id: str
    org_id: int
    org_contact_id: int | None = None
    railway_zone: str | None = None
    division: str | None = None
    inquiry_date: date | None = None
    lead_source: str | None = None
    bd_owner: str | None = None
    sales_engineer: str | None = None
    # Opportunity owner / sales engineer as users (the name fields above follow them).
    bd_owner_id: int | None = None
    sales_engineer_id: int | None = None
    # Win / loss — required when the inquiry closes as not ordered (crm/services/opportunity.py).
    lost_reason_code: str | None = None
    lost_to_competitor: str | None = None
    lost_remarks: str | None = None
    closed_at: datetime | None = None
    status: str
    current_stage: str
    current_status_note: str | None = None
    product: str | None = None
    product_category: str | None = None
    product_spec: str | None = None
    quantity: float | None = None
    additional_items: list[InquiryLineItemResponse] = []
    required_delivery_date: date | None = None
    delivery_location: str | None = None
    requirement_desc: str | None = None
    project_details: str | None = None
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
    technical_offer_number: str | None = None
    technical_offer_sent_at: datetime | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    is_deleted: bool = False


class StageLogEntry(BaseModel):
    stage: str
    notes: str | None = None
