from datetime import date, datetime
from pydantic import BaseModel, Field


class RFQAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rfq_id: int
    vendor_tier: str
    vendor_name: str | None = None
    vendor_contact: str | None = None
    vendor_id: int | None = None
    filename: str
    content_type: str | None = None
    size: int | None = None
    created_at: datetime | None = None


class RFQAttachmentVendorUpdate(BaseModel):
    vendor_name: str | None = None
    vendor_contact: str | None = None
    vendor_id: int | None = None


class RFQCreate(BaseModel):
    """One RFQ = one requisition + one buyer + an explicit set of that buyer's lines.
    pr_item_ids omitted = every line of the buyer that is ready for an RFQ; buyer_id omitted = the
    caller (a user who may work all lines can raise it for another buyer)."""
    p2p_request_id: int
    requires_technical_evaluation: bool = False
    pr_item_ids: list[int] | None = None
    buyer_id: int | None = None


class RFQLinesUpdate(BaseModel):
    """Replace the line set of a DRAFT RFQ (same eligibility as create)."""
    pr_item_ids: list[int] = Field(default_factory=list)


class RFQItemResponse(BaseModel):
    """One requisition line on an RFQ. open_qty = what is still to order on the line
    right now (not on a PO, not short-closed); withdrawn_* set once the line left the RFQ."""
    model_config = {"from_attributes": True}

    id: int
    pr_item_id: int
    store_item_id: int | None = None
    item_code: str | None = None
    item_name: str | None = None
    unit: str | None = None
    quantity: float = 0
    open_qty: float | None = None
    withdrawn_at: datetime | None = None
    withdrawn_reason: str | None = None


class RFQUpdate(BaseModel):
    """Only allowed while status='draft' (or by an admin override) — see
    routes/rfq.py update_rfq."""

    single_quotation_reason: str | None = None
    comments: str | None = None
    payment_terms: str | None = None
    delivery_lead_time: str | None = None
    late_delivery_clause: str | None = None
    requires_technical_evaluation: bool | None = None


class VendorQuotationCreate(BaseModel):
    vendor_name: str
    vendor_id: int | None = None
    quoted_price: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    remarks: str | None = None


class VendorQuotationUpdate(BaseModel):
    vendor_name: str | None = None
    vendor_id: int | None = None
    quoted_price: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    remarks: str | None = None


class VendorQuotationEvaluatePayload(BaseModel):
    status: str
    remarks: str | None = None


class VendorQuotationSelectPayload(BaseModel):
    vendor_quotation_id: int


class VendorQuotationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rfq_id: int
    p2p_request_id: int
    vendor_name: str
    vendor_id: int | None = None
    quoted_price: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    remarks: str | None = None
    technical_status: str
    technical_remarks: str | None = None
    technical_evaluated_by_id: int | None = None
    technical_evaluated_at: datetime | None = None
    commercial_status: str
    commercial_remarks: str | None = None
    commercial_evaluated_by_id: int | None = None
    commercial_evaluated_at: datetime | None = None
    is_selected: bool
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    created_by_name: str | None = None
    technical_evaluated_by_name: str | None = None
    commercial_evaluated_by_name: str | None = None


class RFQResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rfq_number: str
    p2p_request_id: int
    status: str

    is_single_quotation: bool
    single_quotation_reason: str | None = None
    comments: str | None = None
    requires_technical_evaluation: bool = False

    terms_conditions: str | None = None
    payment_terms: str | None = None
    delivery_lead_time: str | None = None
    late_delivery_clause: str | None = None
    quote_due_date: date | None = None
    invite_message: str | None = None

    created_by_id: int | None = None
    locked_by_id: int | None = None
    locked_at: datetime | None = None
    # The buyer who owns this RFQ (None only on old RFQs whose buyer left).
    buyer_id: int | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    attachments: list[RFQAttachmentResponse] = Field(default_factory=list)
    vendor_quotations: list[VendorQuotationResponse] = Field(default_factory=list)
    items: list[RFQItemResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    p2p_number: str | None = None
    p2p_status: str | None = None
    p2p_created_at: datetime | None = None
    p2p_required_date: date | None = None
    created_by_name: str | None = None
    buyer_name: str | None = None
    # Emailed RFQs: vendors invited, and PR lines awarded on the comparison
    # (awarded > 0 = ready for Purchase Orders › Create PO).
    invite_count: int = 0
    awarded_line_count: int = 0
    # Vendors holding at least one awarded line, and the other vendors who quoted.
    awarded_vendors: list[str] = Field(default_factory=list)
    other_quoted_vendors: list[str] = Field(default_factory=list)
