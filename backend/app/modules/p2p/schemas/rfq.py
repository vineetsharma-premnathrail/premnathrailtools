from datetime import datetime
from pydantic import BaseModel, Field


class RFQAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rfq_id: int
    vendor_tier: str
    filename: str
    content_type: str | None = None
    size: int | None = None
    created_at: datetime | None = None


class RFQCreate(BaseModel):
    p2p_request_id: int


class RFQUpdate(BaseModel):
    """Only allowed while status='draft' (or by an admin override) — see
    routes/rfq.py update_rfq."""

    single_quotation_reason: str | None = None
    comments: str | None = None
    payment_terms: str | None = None
    delivery_lead_time: str | None = None
    ld_clause: str | None = None


class RFQResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rfq_number: str
    p2p_request_id: int
    status: str

    is_single_quotation: bool
    single_quotation_reason: str | None = None
    comments: str | None = None

    payment_terms: str | None = None
    delivery_lead_time: str | None = None
    ld_clause: str | None = None

    created_by_id: int | None = None
    locked_by_id: int | None = None
    locked_at: datetime | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    attachments: list[RFQAttachmentResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    p2p_number: str | None = None
    created_by_name: str | None = None
