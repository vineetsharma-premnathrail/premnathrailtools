from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, Field, model_validator

# Fixed vocabularies (no metadata customization) — must match the frontend selects in
# components/crm/InquiryDetailPanel.tsx and CUSTOMER_RESPONSES in components/crm/constants.ts.
QuotationType = Literal["Domestic", "Export"]
GstType = Literal["CGST_SGST", "IGST"]
DiscountType = Literal["percent", "flat"]
PricingMode = Literal["itemwise", "lumpsum"]
CustomerResponse = Literal["— Awaiting —", "Accepted", "Rejected", "Negotiating"]


# ---------- Quotations ----------

class QuotationLineItemPayload(BaseModel):
    description: str | None = None
    model_number: str | None = None
    details: str | None = None
    quantity: float | None = Field(default=None, gt=0, description="Line quantity — must be more than 0.")
    unit_price: float | None = Field(default=None, ge=0, description="Unit price — cannot be negative.")
    gst_percent: float | None = Field(default=None, ge=0, le=100, description="GST % — between 0 and 100.")
    subtotal: float | None = None
    total: float | None = None
    # Product master link + pricing-condition override reason (products/linking.py).
    product_id: int | None = None
    # The product's application this line is quoted for — required on every saved line
    # (checked in routes/workflow.py so the message can name the product's applications).
    application_id: int | None = None
    price_override_reason: str | None = None


class QuotationLineItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    description: str | None = None
    model_number: str | None = None
    details: str | None = None
    quantity: float | None = None
    unit_price: float | None = None
    gst_percent: float | None = None
    subtotal: float | None = None
    total: float | None = None
    product_id: int | None = None
    application_id: int | None = None
    # Display names, filled by routes/workflow.quotation_out (not columns).
    product_code: str | None = None
    product_name: str | None = None
    application_name: str | None = None
    list_price: float | None = None
    price_override_reason: str | None = None


class QuotationCreate(BaseModel):
    quotation_type: QuotationType = "Domestic"
    gst_type: GstType = "CGST_SGST"
    quote_date: date | None = None
    # The R&D Technical Offer quoted against — number and date are copied from it on save.
    technical_offer_id: int | None = None
    client_name: str | None = None
    client_contact_name: str | None = None
    client_contact_email: str | None = None
    client_contact_phone: str | None = None
    valid_until: date | None = None
    pricing_mode: PricingMode = "itemwise"
    price: float | None = Field(default=None, ge=0, description="Lump-sum total price (before GST) — cannot be negative.")
    lump_sum_gst_percent: float | None = Field(default=None, ge=0, le=100, description="GST % on the lump-sum price — between 0 and 100.")
    delivery_time: str | None = None
    payment_terms: str | None = None
    submitted_date: date | None = None
    customer_response: CustomerResponse = "— Awaiting —"
    discount: float | None = Field(default=None, ge=0, description="Discount — cannot be negative.")
    discount_type: DiscountType | None = None
    quote_conditions: str | None = None
    notes: str | None = None
    items: list[QuotationLineItemPayload] = []

    @model_validator(mode="after")
    def _check_discount_and_validity(self):
        if self.discount and (self.discount_type or "percent") == "percent" and self.discount > 100:
            raise ValueError(
                f"Discount is {self.discount}% — a percent discount cannot exceed 100%. "
                "Enter 100 or less, or switch the discount type to a flat amount."
            )
        if self.valid_until and self.quote_date and self.valid_until < self.quote_date:
            raise ValueError(
                f"Valid Until ({self.valid_until.isoformat()}) is before the Quote Date ({self.quote_date.isoformat()}). "
                "Set Valid Until on or after the quote date."
            )
        if self.pricing_mode == "lumpsum" and not self.price:
            raise ValueError(
                "Pricing is set to Lump sum but Total Price is empty. "
                "Enter the total price for the whole offer, or switch Pricing to Item-wise."
            )
        return self


class QuotationUpdate(BaseModel):
    """A revision may change anything on the quotation — header, client, pricing,
    terms and the full line-item list (`items`, when sent, replaces every line).
    Only fields actually sent are applied. `customer_response`/`submitted_date`
    are status tracking, not content, so on their own they are not a revision."""
    quotation_type: QuotationType | None = None
    gst_type: GstType | None = None
    quote_date: date | None = None
    technical_offer_id: int | None = None
    client_name: str | None = None
    client_contact_name: str | None = None
    client_contact_email: str | None = None
    client_contact_phone: str | None = None
    valid_until: date | None = None
    pricing_mode: PricingMode | None = None
    price: float | None = Field(default=None, ge=0, description="Lump-sum total price (before GST) — cannot be negative.")
    lump_sum_gst_percent: float | None = Field(default=None, ge=0, le=100, description="GST % on the lump-sum price — between 0 and 100.")
    delivery_time: str | None = None
    payment_terms: str | None = None
    discount: float | None = Field(default=None, ge=0, description="Discount — cannot be negative.")
    discount_type: DiscountType | None = None
    quote_conditions: str | None = None
    notes: str | None = None
    customer_response: CustomerResponse | None = None
    submitted_date: date | None = None
    items: list[QuotationLineItemPayload] | None = None


class QuotationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    inquiry_id: int
    quot_number: str | None = None
    revision_number: int
    quotation_type: str
    gst_type: str
    quote_date: date | None = None
    technical_offer_id: int | None = None
    technical_offer_number: str | None = None
    technical_offer_date: date | None = None
    client_name: str | None = None
    client_contact_name: str | None = None
    client_contact_email: str | None = None
    client_contact_phone: str | None = None
    valid_until: date | None = None
    pricing_mode: str = "itemwise"
    price: float | None = None
    lump_sum_gst_percent: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    submitted_date: date | None = None
    customer_response: str
    # Document status (crm/services/quotation_status.py) — the source of truth.
    status: str = "draft"
    submitted_at: datetime | None = None
    approved_at: datetime | None = None
    approved_by_id: int | None = None
    sent_at: datetime | None = None
    decided_at: datetime | None = None
    status_comment: str | None = None
    discount: float | None = None
    discount_type: str | None = None
    quote_conditions: str | None = None
    notes: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    items: list[QuotationLineItemResponse] = []


class QuotationActionPayload(BaseModel):
    """submit / withdraw / send / accept / lost / reopen / approve / reject / return."""
    comment: str | None = Field(default=None, max_length=2000)
    sent_on: date | None = None


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
