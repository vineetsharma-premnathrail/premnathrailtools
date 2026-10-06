from datetime import datetime
from pydantic import BaseModel


class QualityFirstArticleCreate(BaseModel):
    item_id: int
    vendor_name: str | None = None          # empty = made in-house
    quantity: float
    location_id: int | None = None
    take_from_free: bool = False
    source_reference: str | None = None
    remarks: str | None = None


class QualityFirstArticleDecisionPayload(BaseModel):
    approve: bool
    remarks: str | None = None


class QualityFirstArticleResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    fai_number: str
    item_id: int
    item_code: str | None = None
    item_name: str
    vendor_name: str | None = None
    drawing_ref: str | None = None
    trigger: str
    status: str
    source_type: str
    source_reference: str | None = None
    lot_id: int | None = None
    created_by_id: int | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_remarks: str | None = None
    remarks: str | None = None
    created_at: datetime | None = None

    lot_number: str | None = None
    lot_status: str | None = None
    lot_decision: str | None = None
    current_drawing_ref: str | None = None
    created_by_name: str | None = None
    decided_by_name: str | None = None
