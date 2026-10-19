from datetime import date, datetime
from pydantic import BaseModel


class QualityCustomerComplaintPhotoResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    file_name: str
    caption: str | None = None
    uploaded_by_id: int | None = None
    created_at: datetime | None = None
    uploaded_by_name: str | None = None


class QualityCustomerComplaintCreate(BaseModel):
    source: str = "email"
    source_reference: str | None = None
    service_ticket_id: int | None = None
    customer_name: str | None = None
    customer_org_id: int | None = None
    erp_project_id: int | None = None
    contact_person: str | None = None
    item_id: int | None = None
    item_name: str | None = None
    serial_number: str | None = None
    batch_number: str | None = None
    quantity_affected: float | None = None
    category: str | None = None
    defect_code_id: int | None = None
    description: str
    severity: str = "minor"
    complaint_date: date | None = None
    owner_id: int | None = None
    remarks: str | None = None


class QualityCustomerComplaintUpdate(BaseModel):
    source: str | None = None
    source_reference: str | None = None
    service_ticket_id: int | None = None
    customer_name: str | None = None
    customer_org_id: int | None = None
    erp_project_id: int | None = None
    contact_person: str | None = None
    item_id: int | None = None
    item_name: str | None = None
    serial_number: str | None = None
    batch_number: str | None = None
    quantity_affected: float | None = None
    category: str | None = None
    defect_code_id: int | None = None
    description: str | None = None
    severity: str | None = None
    complaint_date: date | None = None
    owner_id: int | None = None
    containment_notes: str | None = None
    resolution_notes: str | None = None
    remarks: str | None = None
    replacement_cost: float | None = None
    travel_cost: float | None = None
    rework_cost: float | None = None
    other_cost: float | None = None


class QualityComplaintInvestigatePayload(BaseModel):
    owner_id: int | None = None


class QualityComplaintResponsePayload(BaseModel):
    response_text: str | None = None


class QualityComplaintFeedbackPayload(BaseModel):
    accepted: bool
    reference: str | None = None
    remarks: str | None = None


class QualityComplaintClosePayload(BaseModel):
    resolution_notes: str | None = None


class QualityComplaintRejectPayload(BaseModel):
    reason: str | None = None


class QualityCustomerComplaintResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    complaint_number: str
    source: str
    source_reference: str | None = None
    service_ticket_id: int | None = None
    customer_name: str
    customer_org_id: int | None = None
    erp_project_id: int | None = None
    contact_person: str | None = None
    item_id: int | None = None
    item_name: str | None = None
    item_code: str | None = None
    serial_number: str | None = None
    batch_number: str | None = None
    quantity_affected: float | None = None
    category: str | None = None
    defect_code_id: int | None = None
    description: str
    severity: str
    status: str
    complaint_date: date
    received_by_id: int | None = None
    owner_id: int | None = None
    ncr_id: int | None = None
    capa_id: int | None = None
    investigation_started_at: datetime | None = None
    containment_notes: str | None = None
    repeat_of_id: int | None = None
    response_text: str | None = None
    response_sent_at: datetime | None = None
    customer_accepted_at: datetime | None = None
    customer_acceptance_reference: str | None = None
    replacement_cost: float | None = None
    travel_cost: float | None = None
    rework_cost: float | None = None
    other_cost: float | None = None
    resolution_notes: str | None = None
    rejection_reason: str | None = None
    closed_at: datetime | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    received_by_name: str | None = None
    owner_name: str | None = None
    project_label: str | None = None
    category_label: str | None = None
    defect_code_label: str | None = None
    ncr_number: str | None = None
    capa_number: str | None = None
    capa_status: str | None = None
    capa_effective: bool = False
    repeat_of_number: str | None = None
    total_cost: float | None = 0  # None = hidden (Quality › Complaints › costs switch)
    response_days: int | None = None
    age_days: int = 0
    photos: list[QualityCustomerComplaintPhotoResponse] = []
