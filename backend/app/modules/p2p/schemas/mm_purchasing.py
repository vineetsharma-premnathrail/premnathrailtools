"""Schemas for ME47/ME49 line quotations, ME21N PO split, ME22N amendments
and ME11/ME01/ME1P info records / source list / price history."""
from datetime import date, datetime

from pydantic import BaseModel, Field


# ── ME47 line-level quotation ────────────────────────────────────────────

class VendorQuotationItemPayload(BaseModel):
    pr_item_id: int
    unit_price: float = Field(gt=0)
    discount_pct: float | None = Field(default=None, ge=0, lt=100)
    gst_rate: float | None = Field(default=None, ge=0, le=100)
    delivery_days: int | None = Field(default=None, ge=0, le=3650)
    make_offered: str | None = None
    remarks: str | None = None


class VendorQuotationItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    vendor_quotation_id: int
    pr_item_id: int
    store_item_id: int | None = None
    quantity: float | None = None
    unit_price: float
    discount_pct: float | None = None
    gst_rate: float | None = None
    delivery_days: int | None = None
    make_offered: str | None = None
    remarks: str | None = None
    is_awarded: bool = False
    award_reason: str | None = None
    awarded_at: datetime | None = None


class LineQuotationCreate(BaseModel):
    """A vendor's full quote: header terms + one price per PR line quoted.
    The vendor must be picked from the vendor master (shared with Finance)."""
    vendor_id: int
    quote_ref: str | None = None
    valid_until: date | None = None
    freight_total: float | None = Field(default=None, ge=0)
    packing_total: float | None = Field(default=None, ge=0)
    delivery_time: str | None = None
    payment_terms: str | None = None
    remarks: str | None = None
    items: list[VendorQuotationItemPayload] = Field(default_factory=list)


class LineQuotationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rfq_id: int
    p2p_request_id: int
    vendor_id: int | None = None
    vendor_name: str
    quote_ref: str | None = None
    valid_until: date | None = None
    freight_total: float | None = None
    packing_total: float | None = None
    quoted_price: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    remarks: str | None = None
    technical_status: str
    commercial_status: str
    is_selected: bool
    items: list[VendorQuotationItemResponse] = Field(default_factory=list)


class QuotationAward(BaseModel):
    pr_item_id: int
    vendor_quotation_item_id: int
    # Required when the chosen quote is not the line's L1.
    reason: str | None = None


class QuotationAwardPayload(BaseModel):
    awards: list[QuotationAward] = Field(min_length=1)


# ── ME21N split ──────────────────────────────────────────────────────────

class POSplitLine(BaseModel):
    pr_item_id: int
    quantity: float | None = Field(default=None, gt=0)  # default: all that is left to order
    delivery_date: date | None = None
    ship_to_location_id: int | None = None
    vendor_quotation_item_id: int | None = None
    unit_price: float | None = Field(default=None, gt=0)
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    # Needed when unit_price differs from the awarded quotation price.
    price_override_reason: str | None = None


class POSplitGroup(BaseModel):
    vendor_id: int
    vendor_quotation_id: int | None = None
    # Needed when this vendor isn't the L1 for a line it gets and the line has no award.
    selection_reason: str | None = None
    plant_branch_id: int | None = None
    ship_to_location_id: int | None = None
    expected_delivery: date | None = None
    delivery_terms: str | None = None
    lines: list[POSplitLine] = Field(min_length=1)


class POSplitPayload(BaseModel):
    po_date: date | None = None
    plant_branch_id: int | None = None
    ship_to_location_id: int | None = None
    pos: list[POSplitGroup] = Field(min_length=1)


class POLineDetailUpdate(BaseModel):
    id: int
    delivery_date: date | None = None
    ship_to_location_id: int | None = None


class PODraftDetailsPayload(BaseModel):
    """Draft-only ME21N fields: plant / ship-to and per-line delivery dates."""
    plant_branch_id: int | None = None
    ship_to_location_id: int | None = None
    lines: list[POLineDetailUpdate] = Field(default_factory=list)


# ── ME22N amendment ──────────────────────────────────────────────────────

class POAmendmentLineChange(BaseModel):
    po_item_id: int
    quantity: float | None = None
    unit_price: float | None = None
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    delivery_date: date | None = None


class POAmendmentLineAdd(BaseModel):
    store_item_id: int
    pr_item_id: int | None = None
    quantity: float = Field(gt=0)
    unit_price: float = Field(gt=0)
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    delivery_date: date | None = None
    specification: str | None = None


class POAmendmentCreate(BaseModel):
    reason: str
    changes: list[POAmendmentLineChange] = Field(default_factory=list)
    add_lines: list[POAmendmentLineAdd] = Field(default_factory=list)
    delete_po_item_ids: list[int] = Field(default_factory=list)
    expected_delivery: date | None = None
    delivery_terms: str | None = None


class POAmendmentWithdrawPayload(BaseModel):
    reason: str | None = None


class POAmendmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    purchase_order_id: int
    amendment_no: int
    reason: str
    status: str
    changes: list = Field(default_factory=list)
    before: dict = Field(default_factory=dict)
    after: dict = Field(default_factory=dict)
    old_total: float | None = None
    new_total: float | None = None
    requested_by_id: int | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_comment: str | None = None
    created_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    po_number: str | None = None
    requested_by_name: str | None = None
    decided_by_name: str | None = None
    approval_request_id: int | None = None
    waiting_on: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


# ── ME11 / ME01 ──────────────────────────────────────────────────────────

class InfoRecordPayload(BaseModel):
    vendor_id: int | None = None
    store_item_id: int | None = None
    unit_price: float | None = Field(default=None, ge=0)
    lead_time_days: int | None = Field(default=None, ge=0, le=3650)
    min_order_qty: float | None = Field(default=None, ge=0)
    valid_from: date | None = None
    valid_to: date | None = None
    make: str | None = None
    remarks: str | None = None
    is_active: bool | None = None


class InfoRecordLinkPayload(BaseModel):
    store_item_id: int


class SourceListPayload(BaseModel):
    store_item_id: int | None = None
    vendor_id: int | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    is_fixed: bool | None = None
    is_blocked: bool | None = None
    remarks: str | None = None
