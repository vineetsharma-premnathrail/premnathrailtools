from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator
from app.core.validators import validate_email_format


class ServiceMaterialCreate(BaseModel):
    material_name: str
    part_number: str | None = None
    quantity: float = 1
    unit: str = "pcs"
    supplier: str | None = None
    status: str | None = "pending"
    availability: str | None = "in_stock"


class ServiceMaterialUpdate(BaseModel):
    material_name: str | None = None
    part_number: str | None = None
    quantity: float | None = None
    unit: str | None = None
    supplier: str | None = None
    status: str | None = None
    availability: str | None = None


class ServiceMaterialResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    service_request_id: int
    material_name: str
    part_number: str | None = None
    quantity: float
    unit: str
    supplier: str | None = None
    status: str | None = None
    availability: str | None = None
    created_at: datetime | None = None

    pr_id: int | None = None
    pr_number: str | None = None
    pr_status: str | None = None
    received_quantity: float = 0
    receiving_status: str = "pending"


class MaterialReceivePayload(BaseModel):
    received_quantity: float


class ServiceRequestAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    service_request_id: int
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_path: str | None = None
    sharepoint_url: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


class ServiceRequestCreate(BaseModel):
    project_id: int
    issue_title: str
    issue_description: str | None = None
    issue_category: str | None = None
    priority: str = "medium"
    assigned_service_person_id: int | None = None
    assigned_to_name: str | None = None
    expected_date_to_attend: date | None = None
    sub_category: str | None = None
    failure_mode: str | None = None
    expected_completion_date: date | None = None
    reported_by_name: str | None = None
    reported_by_phone: str | None = None
    reported_by_email: str | None = None
    service_report_notes: str | None = None
    status: str = "open"

    _validate_email = field_validator("reported_by_email")(validate_email_format)


class ServiceRequestUpdate(BaseModel):
    issue_title: str | None = None
    issue_description: str | None = None
    issue_category: str | None = None
    sub_category: str | None = None
    failure_mode: str | None = None
    status: str | None = None
    priority: str | None = None
    assigned_service_person_id: int | None = None
    assigned_to_name: str | None = None
    expected_date_to_attend: date | None = None
    expected_completion_date: date | None = None
    root_cause: str | None = None
    resolution_description: str | None = None
    preventive_actions: str | None = None
    service_report_notes: str | None = None
    actual_date_attended: date | None = None
    actual_completion_date: date | None = None
    service_cost: float | None = None
    transport_cost: float | None = None
    reported_by_name: str | None = None
    reported_by_phone: str | None = None
    reported_by_email: str | None = None

    _validate_email = field_validator("reported_by_email")(validate_email_format)


class ServiceRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    request_number: str
    project_id: int
    issue_title: str
    issue_description: str | None = None
    issue_category: str | None = None
    sub_category: str | None = None
    failure_mode: str | None = None
    status: str
    priority: str
    assigned_service_person_id: int | None = None
    assigned_to_name: str | None = None
    expected_date_to_attend: date | None = None
    expected_completion_date: date | None = None
    actual_date_attended: date | None = None
    actual_completion_date: date | None = None
    service_report_notes: str | None = None
    root_cause: str | None = None
    resolution_description: str | None = None
    preventive_actions: str | None = None

    service_cost: float = 0
    transport_cost: float = 0
    accommodation_cost: float = 0
    miscellaneous_cost: float = 0
    total_material_cost: float = 0
    tax_percentage: float = 18.0
    tax_amount: float = 0
    total_bill: float = 0
    payment_status: str | None = None
    invoice_number: str | None = None

    is_locked: bool = False
    is_deleted: bool = False
    created_by_id: int | None = None
    created_at: datetime | None = None
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    updated_at: datetime | None = None
    reported_by_name: str | None = None
    reported_by_phone: str | None = None
    reported_by_email: str | None = None

    sla_response_hours: int | None = None
    sla_resolution_hours: int | None = None
    sla_response_met: bool | None = None
    sla_resolution_met: bool | None = None
    first_response_at: datetime | None = None
    resolution_at: datetime | None = None

    attachments: list[ServiceRequestAttachmentResponse] = Field(default_factory=list)
    materials: list[ServiceMaterialResponse] = Field(default_factory=list)
