from datetime import datetime
from pydantic import BaseModel, Field


class RFQAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rfq_id: int
    vendor_tier: str
    vendor_name: str | None = None
    vendor_contact: str | None = None
    filename: str
    content_type: str | None = None
    size: int | None = None
    created_at: datetime | None = None


class RFQAttachmentVendorUpdate(BaseModel):
    vendor_name: str | None = None
    vendor_contact: str | None = None


class RFQCreate(BaseModel):
    p2p_request_id: int
    requires_technical_evaluation: bool = False


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

    payment_terms: str | None = None
    delivery_lead_time: str | None = None
    late_delivery_clause: str | None = None

    created_by_id: int | None = None
    locked_by_id: int | None = None
    locked_at: datetime | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    attachments: list[RFQAttachmentResponse] = Field(default_factory=list)
    vendor_quotations: list[VendorQuotationResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    p2p_number: str | None = None
    p2p_status: str | None = None
    created_by_name: str | None = None
