from datetime import date, datetime
from pydantic import BaseModel, Field


class P2PPurchaseOrderItemPayload(BaseModel):
    item_name: str
    make: str | None = None
    part_code: str | None = None
    unit: str | None = None
    quantity: float = Field(default=1, gt=0)
    unit_price: float | None = Field(default=None, gt=0)
    tax_rate: float | None = Field(default=None, ge=0, le=100)


class P2PPurchaseOrderItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    store_item_id: int | None = None
    item_code: str | None = None
    item_name: str
    make: str | None = None
    part_code: str | None = None
    specification: str | None = None
    unit: str | None = None
    quantity: float
    unit_price: float | None = None
    tax_rate: float | None = None
    line_total: float | None = None
    # Item category (stock / service / asset) — read-only, from the Item Master type.
    category: str = "stock"
    # ME21N line detail (2026-10-14).
    pr_item_id: int | None = None
    delivery_date: date | None = None
    ship_to_location_id: int | None = None
    vendor_quotation_item_id: int | None = None
    price_source: str | None = None
    price_override_reason: str | None = None
    # Order Project element (vehicle / lot) this line is for (from its PR line) — OrderProjectChip.
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    order_project_number: str | None = None
    order_project_element_no: str | None = None
    order_project_element_label: str | None = None
    order_project_display: str | None = None


class P2PPurchaseOrderCreate(BaseModel):
    p2p_request_id: int | None = None
    po_number: str | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    po_date: date | None = None
    expected_delivery: date | None = None
    delivery_terms: str | None = None
    # Which RFQ quote the PO goes to (L1..L4; default L1). Any other than L1
    # needs selection_reason — buying from a costlier quote must be justified.
    vendor_tier: str | None = None
    selection_reason: str | None = None
    items: list[P2PPurchaseOrderItemPayload] = Field(default_factory=list)


class P2PPurchaseOrderUpdate(BaseModel):
    """Delivery-detail edits only. Status is deliberately NOT here — a PO's
    status only moves through the RFQ submit / PO approval / GRN flows, never
    by a direct edit that could skip Purchase Head -> Director -> Partner
    (extra="allow" only so the route can name a rejected key in its error)."""

    model_config = {"extra": "allow"}

    expected_delivery: date | None = None
    delivery_terms: str | None = None
    # Finance internal order the PO is bought for (its open value is the
    # order's commitment). null clears it.
    internal_order_id: int | None = None


class P2PPurchaseOrderItemLinkPayload(BaseModel):
    """Links an older PO line (raised before lines carried the Item Master id)
    to its Item Master item, so goods can be received against it."""
    store_item_id: int


class P2PPurchaseOrderItemPricingPayload(BaseModel):
    id: int
    unit_price: float = Field(gt=0)
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    # Omitted = leave the line's specification as it is.
    specification: str | None = None


class P2PPurchaseOrderDraftUpdatePayload(BaseModel):
    """Edits to a still-draft PO from the RFQ screen — delivery details plus
    per-line prices, which must all be filled before the PO can be sent for
    approval (see rfq.submit_po_draft). Terms & conditions are not editable:
    they come from Procurement → Settings + the vendor master."""

    expected_delivery: date | None = None
    delivery_terms: str | None = None
    items: list[P2PPurchaseOrderItemPricingPayload] | None = None


class P2PPurchaseOrderResponse(BaseModel):
    model_config = {"from_attributes": True}
    lock_version: int | None = None  # SM12 optimistic lock — echo back as X-Lock-Version

    id: int
    po_number: str
    p2p_request_id: int | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    status: str
    po_date: date
    expected_delivery: date | None = None
    delivery_terms: str | None = None
    terms_conditions: str | None = None
    revision: int = 0
    total_value: float | None = None
    internal_order_id: int | None = None
    # ME21N / ME22N (2026-10-14).
    plant_branch_id: int | None = None
    ship_to_location_id: int | None = None
    vendor_quotation_id: int | None = None
    amendment_no: int = 0
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[P2PPurchaseOrderItemResponse] = Field(default_factory=list)

    document_filename: str | None = None
    document_content_type: str | None = None
    document_size: int | None = None
    document_uploaded_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    p2p_request_number: str | None = None
    created_by_name: str | None = None
    document_uploaded_by_name: str | None = None
    assigned_buyer_id: int | None = None
    assigned_buyer_name: str | None = None
