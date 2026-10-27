from datetime import date, datetime
from pydantic import BaseModel, Field

from app.modules.p2p.schemas.purchase_order import P2PPurchaseOrderResponse


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
    # project_inhouse must be "Project" or "Inhouse" — enforced with a
    # per-line message in create_p2p_request (kept optional here so the route
    # can name the offending line instead of a bare pydantic 422).
    # store_item_id is the line's identity (picked from the Item Master; the
    # route 422s a line without one). item_name / part_code / unit / category
    # are filled in from the master by the server — anything sent is ignored.
    # id: on edit, the existing line this row updates (keeps its attachments).
    id: int | None = None
    store_item_id: int | None = None
    item_name: str = ""
    make: str | None = None
    part_code: str | None = None
    unit: str | None = None
    quantity: float = 1
    project_inhouse: str | None = None
    category: str | None = None
    ship_to: str | None = None
    # Project unit (vehicle / lot) this line is bought for. Required on a
    # 'Project' line when the PR is charged to a sales order / project
    # that has one; auto-filled when derivable (p2p/order_project_links.py).
    order_project_element_id: int | None = None


class P2PRequestItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    store_item_id: int | None = None
    item_code: str | None = None
    item_name: str
    make: str | None = None
    part_code: str | None = None
    unit: str | None = None
    quantity: float
    project_inhouse: str | None = None
    category: str | None = None
    ship_to: str | None = None
    fulfillment_status: str = "pending"
    stock_status: str | None = None
    stock_available_qty: float | None = None
    stock_checked_at: datetime | None = None
    issued_from_location_id: int | None = None
    issued_qty: float | None = None
    material_issue_id: int | None = None
    # Project unit (vehicle / lot) this line is for — ProjectUnitChip.
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    order_project_number: str | None = None
    order_project_element_no: str | None = None
    order_project_element_label: str | None = None
    order_project_display: str | None = None
    attachments: list[P2PRequestAttachmentResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    issued_from_location_name: str | None = None
    # Buyer of this line (by its item type); None = the requisition's assigned buyer.
    buyer_id: int | None = None
    buyer_name: str | None = None


class P2PRequestItemStockLocationInfo(BaseModel):
    location_id: int | None = None
    location_name: str | None = None
    on_hand_qty: float = 0
    reserved_qty: float = 0
    available_qty: float = 0


class P2PRequestItemStockCheckResponse(BaseModel):
    matched: bool
    store_item_id: int | None = None
    store_item_code: str | None = None
    store_item_name: str | None = None
    part_code_matched: bool = False
    requested_qty: float
    ship_to_location: P2PRequestItemStockLocationInfo | None = None
    total_across_locations: P2PRequestItemStockLocationInfo | None = None
    # Every warehouse holding available stock, most first — lets the buyer
    # issue even when the line's Ship To is blank or isn't a store location.
    locations: list[P2PRequestItemStockLocationInfo] = []
    message: str | None = None


class P2PRequestIssueFromStockPayload(BaseModel):
    location_id: int
    quantity: float | None = None
    comment: str | None = None


class P2PRequestCreate(BaseModel):
    project_label: str | None = None
    # Account assignment (p2p/account_assignment.py): one category + its FK.
    account_assignment: str | None = None
    sales_order_id: int | None = None
    cost_center_id: int | None = None
    work_order_id: int | None = None
    internal_order_id: int | None = None
    # New development: the R&D project (internal_order_id is then derived by the server).
    rnd_project_id: int | None = None
    order_project_id: int | None = None
    # None (the PR form since 2026-10-27): the lines' item types decide what is
    # bought and who buys each line; numbered P2P-[YEAR]-[NUMBER]. A code is still
    # sent by the internal callers that raise category-based requisitions.
    category_code: str | None = None
    required_date: date | None = None
    requirement_type: str | None = None
    priority: str = "medium"
    # 'existing' | 'new'. Who approves is the approval engine's business
    # (Organization › Approval Workflows); project_type is available to its
    # stage conditions. Approver names sent by older clients are ignored.
    # Optional only so a draft can be saved without it — submit 400s when blank.
    project_type: str | None = None
    # What the purchase is for (P2P_PURPOSES, p2p/purpose.py) — decides what it
    # must be charged to. Sent by the PR form since 2026-10-23; when set,
    # project_type is derived from it.
    purpose: str | None = None
    remarks: str | None = None
    items: list[P2PRequestItemPayload] = Field(default_factory=list)
    # True = keep as a private draft (no approval, light validation).
    save_as_draft: bool = False


class P2PRequestEdit(P2PRequestCreate):
    """Full re-write of a requisition's header + lines (edit_p2p_request).
    Lines are replaced wholesale. save_as_draft=False sends it for approval."""


class P2PRequestUpdate(BaseModel):
    """Purchase-team-only free-edit of header fields. Status and the three
    approver slots are deliberately NOT here — see update_p2p_request, which
    rejects them (extra="allow" only so it can name them in the error)."""

    model_config = {"extra": "allow"}

    project_label: str | None = None
    required_date: date | None = None
    requirement_type: str | None = None
    priority: str | None = None
    remarks: str | None = None


class P2PRequestActionPayload(BaseModel):
    reason: str | None = None


class P2PRequestApprovePayload(BaseModel):
    # Required in practice: the approve routes 400 on a blank comment (kept
    # optional here so the route can give a human message instead of a bare
    # pydantic 422).
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


class P2PRequestCreatePOItemPricing(BaseModel):
    """Pricing for one PR line item, keyed by that item's id (P2PRequestItem.id)
    — matches this PO's price/tax back to a specific requisitioned line
    instead of trusting a single hand-typed PO total (see
    compute_line_total in service.py, same pattern the RFQ PO-draft flow
    already uses)."""
    pr_item_id: int
    unit_price: float | None = None
    tax_rate: float | None = None


class P2PRequestCreatePOPayload(BaseModel):
    po_number: str
    po_date: date | None = None
    po_value: float | None = None
    expected_delivery: date | None = None
    ordered_quantity: float | None = None
    item_pricing: list[P2PRequestCreatePOItemPricing] = Field(default_factory=list)


class P2PRequestApprovalResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    role: str
    role_label: str | None = None
    approver_id: int
    approver_name: str | None = None
    approved_at: datetime | None = None
    comment: str | None = None


class P2PRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    p2p_number: str
    category_code: str
    category_label: str | None = None
    project_label: str | None = None
    account_assignment: str | None = None
    sales_order_id: int | None = None
    cost_center_id: int | None = None
    work_order_id: int | None = None
    internal_order_id: int | None = None
    rnd_project_id: int | None = None
    rnd_project_label: str | None = None
    order_project_id: int | None = None
    order_project_number: str | None = None
    account_assignment_label: str | None = None
    project_type: str | None = None
    purpose: str | None = None
    approval_scheme: str | None = None
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
    purchase_head_approved_by_name: str | None = None
    purchase_head_comment: str | None = None
    director_approved_at: datetime | None = None
    director_approved_by_name: str | None = None
    director_comment: str | None = None
    partner_approved_at: datetime | None = None
    partner_approved_by_name: str | None = None
    partner_comment: str | None = None
    # Manager-matrix PRs (project_type set): the per-role approver slots, and
    # the any-one-approves PO stamp. Legacy PRs leave these empty and use the
    # per-role columns above instead.
    approvals: list[P2PRequestApprovalResponse] = Field(default_factory=list)
    po_approved_by_id: int | None = None
    po_approved_by_name: str | None = None
    po_approved_role: str | None = None
    po_approved_role_label: str | None = None
    po_approved_at: datetime | None = None
    po_approval_comment: str | None = None
    # Labels of the roles that may approve the PO ("any one of ..."), for
    # display; empty on legacy PRs.
    po_approval_role_labels: list[str] = Field(default_factory=list)
    # Who the PO goes to, per role — the people picked on the PR plus every
    # Director — so the PO Approval panel can name them.
    po_approval_panel: list[dict] = Field(default_factory=list)
    pending_approval_roles: list[str] = Field(default_factory=list)
    pending_po_approval_roles: list[str] = Field(default_factory=list)
    rejected_by_role: str | None = None
    rejected_by_name: str | None = None
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
    # The latest non-cancelled PO with its lines — filled on the single-PR
    # GET so PO approvers (who usually lack the 'purchase' app and so can't
    # call /p2p/purchase-orders) see exactly what they are signing.
    purchase_order: P2PPurchaseOrderResponse | None = None
    # The central approval engine's view of this requisition for the viewer
    # (app/modules/p2p/approvals.py approval_info): request_id, entity_type /
    # entity_id (p2p_request or p2p_purchase_order), status, stage, waiting_on,
    # can_decide, can_stand_in, pr_request_id, po_id. None = no engine request
    # (an item still on the old approval path, or not loaded for this row).
    engine_approval: dict | None = None
    # Whether the viewer may edit the requisition's content now (single-PR
    # GET only) — and, when not but it's theirs, why (e.g. RFQ started).
    can_edit: bool = False
    edit_block_reason: str | None = None
