from datetime import date, datetime
from pydantic import BaseModel, Field


class P2PRequestAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    p2p_request_id: int
    item_id: int | None = None
    doc_type: str
    filename: str
    content_type: str | None = None
    size: int | None = None
    created_at: datetime | None = None


class P2PRequestItemPayload(BaseModel):
    item_name: str
    make: str | None = None
    part_code: str | None = None
    unit: str | None = None
    quantity: float = 1
    project_inhouse: str | None = None
    category: str | None = None
    ship_to: str | None = None


class P2PRequestItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_name: str
    make: str | None = None
    part_code: str | None = None
    unit: str | None = None
    quantity: float
    project_inhouse: str | None = None
    category: str | None = None
    ship_to: str | None = None
    stock_item_id: int | None = None
    attachments: list[P2PRequestAttachmentResponse] = Field(default_factory=list)


class P2PRequestItemStockLinkPayload(BaseModel):
    stock_item_id: int | None = None


class P2PRequestCreate(BaseModel):
    project_label: str | None = None
    category_code: str
    required_date: date | None = None
    requirement_type: str | None = None
    priority: str = "medium"
    # Department Head, Project Head, Plant Head — each picked by search-select
    # on the New PR form from users flagged with that role; any left unpicked
    # (e.g. no department head configured) simply isn't part of the approval
    # chain for this PR. `approver_id`/`approver_name` is the Department Head
    # slot's underlying column name (see P2PRequest model).
    approver_id: int | None = None
    approver_name: str | None = None
    project_head_id: int | None = None
    project_head_name: str | None = None
    plant_head_id: int | None = None
    plant_head_name: str | None = None
    remarks: str | None = None
    items: list[P2PRequestItemPayload] = Field(default_factory=list)


class P2PRequestUpdate(BaseModel):
    """Purchase-team-only free-edit of header fields, and/or a manual status
    override — mirrors app.modules.purchase's PurchaseRequisitionUpdate."""

    project_label: str | None = None
    required_date: date | None = None
    requirement_type: str | None = None
    priority: str | None = None
    approver_id: int | None = None
    approver_name: str | None = None
    project_head_id: int | None = None
    project_head_name: str | None = None
    plant_head_id: int | None = None
    plant_head_name: str | None = None
    remarks: str | None = None
    status: str | None = None


class P2PRequestActionPayload(BaseModel):
    reason: str | None = None


class P2PRequestApprovePayload(BaseModel):
    comment: str | None = None


class P2PRequestAssignBuyerPayload(BaseModel):
    assigned_buyer_id: int
    assignment_date: date | None = None


class P2PRequestQuotationPayload(BaseModel):
    vendor: str | None = None
    rfq_number: str | None = None
    quotation: str | None = None
    quotation_date: date | None = None
    vendor_comparison: str | None = None


class P2PRequestSelectVendorPayload(BaseModel):
    selected_vendor: str


class P2PRequestCreatePOPayload(BaseModel):
    po_number: str
    po_date: date | None = None
    po_value: float | None = None
    expected_delivery: date | None = None
    ordered_quantity: float | None = None


class P2PRequestReceivePayload(BaseModel):
    received_quantity: float
    grn_number: str | None = None
    receipt_date: date | None = None
    receiving_remarks: str | None = None
    # Where the received stock physically lands — required only if at least
    # one item on the PR has a stock_item_id mapped (see PURCHASE_STORE_INTEGRATION.md).
    store_location_id: int | None = None


class P2PRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    p2p_number: str
    category_code: str
    category_label: str | None = None
    project_label: str | None = None
    required_date: date | None = None
    requirement_type: str | None = None
    request_date: date
    department: str | None = None
    requested_by_id: int | None = None
    priority: str
    approver_id: int | None = None
    approver_name: str | None = None
    department_head_approved_at: datetime | None = None
    department_head_comment: str | None = None
    project_head_id: int | None = None
    project_head_name: str | None = None
    project_head_approved_at: datetime | None = None
    project_head_comment: str | None = None
    plant_head_id: int | None = None
    plant_head_name: str | None = None
    plant_head_approved_at: datetime | None = None
    plant_head_comment: str | None = None
    purchase_head_approved_at: datetime | None = None
    purchase_head_comment: str | None = None
    director_approved_at: datetime | None = None
    director_comment: str | None = None
    md_approved_at: datetime | None = None
    md_comment: str | None = None
    pending_approval_roles: list[str] = Field(default_factory=list)
    pending_po_approval_roles: list[str] = Field(default_factory=list)
    rejected_by_role: str | None = None
    remarks: str | None = None
    status: str
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    rejected_reason: str | None = None
    cancelled_reason: str | None = None
    closed_by_id: int | None = None
    closed_at: datetime | None = None

    assigned_buyer_id: int | None = None
    assignment_date: date | None = None

    vendor: str | None = None
    rfq_number: str | None = None
    quotation: str | None = None
    quotation_date: date | None = None
    vendor_comparison: str | None = None
    selected_vendor: str | None = None

    po_number: str | None = None
    po_date: date | None = None
    po_value: float | None = None
    expected_delivery: date | None = None

    ordered_quantity: float | None = None
    received_quantity: float | None = None
    pending_quantity: float | None = None
    receipt_status: str | None = None
    grn_number: str | None = None
    receipt_date: date | None = None
    receiving_remarks: str | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    items: list[P2PRequestItemResponse] = Field(default_factory=list)
    attachments: list[P2PRequestAttachmentResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    requested_by_name: str | None = None
    assigned_buyer_name: str | None = None
