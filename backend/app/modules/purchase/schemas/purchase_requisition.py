from datetime import date, datetime
from pydantic import BaseModel, Field


class PurchaseRequisitionItemAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_url: str | None = None
    created_at: datetime | None = None


class PurchaseRequisitionItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    service_material_id: int
    material_name: str
    part_number: str | None = None
    unit: str
    quantity_requested: float
    quantity_received: float
    item_status: str
    remarks: str | None = None
    attachments: list[PurchaseRequisitionItemAttachmentResponse] = Field(default_factory=list)


class PurchaseRequisitionItemUpdate(BaseModel):
    remarks: str | None = None


class PurchaseRequisitionUpdate(BaseModel):
    vendor: str | None = None
    po_number: str | None = None
    po_date: date | None = None
    expected_delivery_date: date | None = None
    notes: str | None = None
    status: str | None = None


class PurchaseRequisitionActionPayload(BaseModel):
    reason: str | None = None


class PurchaseRequisitionRaisePayload(BaseModel):
    priority: str = "medium"
    required_by_date: date | None = None
    reason: str | None = None
    category_code: str | None = None
    requirement_type: str | None = None
    approver_id: int | None = None
    approver_name: str | None = None


class PurchaseRequisitionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    pr_number: str
    project_id: int
    service_request_id: int
    status: str
    raised_by_id: int | None = None
    priority: str = "medium"
    required_by_date: date | None = None
    purchase_reason: str | None = None
    category_code: str | None = None
    category_label: str | None = None
    requirement_type: str | None = None
    approver_id: int | None = None
    approver_name: str | None = None
    vendor: str | None = None
    po_number: str | None = None
    po_date: date | None = None
    expected_delivery_date: date | None = None
    notes: str | None = None
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    closed_by_id: int | None = None
    closed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[PurchaseRequisitionItemResponse] = []

    # Denormalized display fields, filled in by the route (not stored on the
    # PR row itself) so the list/detail UI doesn't need separate lookups.
    project_label: str | None = None
    client_company: str | None = None
    site_name: str | None = None
    sr_request_number: str | None = None
    raised_by_name: str | None = None
    department: str | None = None
