from datetime import date, datetime
from pydantic import BaseModel


# ---------- Quotations ----------

class QuotationLineItemPayload(BaseModel):
    description: str | None = None
    model_number: str | None = None
    quantity: float | None = None
    unit_price: float | None = None
    gst_percent: float | None = None
    subtotal: float | None = None
    total: float | None = None


class QuotationLineItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    description: str | None = None
    model_number: str | None = None
    quantity: float | None = None
    unit_price: float | None = None
    gst_percent: float | None = None
    subtotal: float | None = None
    total: float | None = None


class QuotationCreate(BaseModel):
    quotation_type: str = "Domestic"
    gst_type: str = "CGST_SGST"
    quote_date: date | None = None
    technical_offer_number: str | None = None
    technical_offer_date: date | None = None
    client_name: str | None = None
    client_contact_name: str | None = None
    client_contact_email: str | None = None
    client_contact_phone: str | None = None
    valid_until: date | None = None
    price: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    submitted_date: date | None = None
    customer_response: str = "— Awaiting —"
    discount: float | None = None
    discount_type: str | None = None
    quote_conditions: str | None = None
    notes: str | None = None
    items: list[QuotationLineItemPayload] = []


class QuotationReviseItem(BaseModel):
    """Only the line item's price can be revised post-creation — never its description,
    model, quantity, or GST%. `id` identifies the existing QuotationLineItem row."""
    id: int
    unit_price: float | None = None


class QuotationUpdate(BaseModel):
    """Once a quotation is created, only these fields may change — a limited revision, not a
    full edit. `customer_response`/`submitted_date` are status tracking, not content, so they
    don't count as a revision. Anything else requires creating a new quotation instead."""
    payment_terms: str | None = None
    valid_until: date | None = None
    delivery_time: str | None = None
    customer_response: str | None = None
    submitted_date: date | None = None
    items: list[QuotationReviseItem] | None = None


class QuotationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    inquiry_id: int
    quot_number: str | None = None
    revision_number: int
    quotation_type: str
    gst_type: str
    quote_date: date | None = None
    technical_offer_number: str | None = None
    technical_offer_date: date | None = None
    client_name: str | None = None
    client_contact_name: str | None = None
    client_contact_email: str | None = None
    client_contact_phone: str | None = None
    valid_until: date | None = None
    price: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    submitted_date: date | None = None
    customer_response: str
    discount: float | None = None
    discount_type: str | None = None
    quote_conditions: str | None = None
    notes: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    items: list[QuotationLineItemResponse] = []


# ---------- Stage Logs ----------

class StageLogResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    related_module: str
    related_id: int
    universal_id: str | None = None
    stage: str
    entered_by_id: int | None = None
    entered_by_name: str | None = None
    notes: str | None = None
    created_at: datetime | None = None
