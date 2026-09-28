from datetime import datetime
from pydantic import BaseModel


class QualitySupplierScorecardCreate(BaseModel):
    vendor_id: int | None = None
    vendor_name: str
    period: str
    quality_score: float | None = None
    on_time_delivery_score: float | None = None
    rejection_count: int = 0
    ncr_count: int = 0
    status: str = "draft"
    notes: str | None = None


class QualitySupplierScorecardUpdate(BaseModel):
    vendor_id: int | None = None
    vendor_name: str | None = None
    period: str | None = None
    quality_score: float | None = None
    on_time_delivery_score: float | None = None
    rejection_count: int | None = None
    ncr_count: int | None = None
    status: str | None = None
    notes: str | None = None


class QualitySupplierScorecardResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    vendor_id: int | None = None
    vendor_name: str
    period: str
    quality_score: float | None = None
    on_time_delivery_score: float | None = None
    rejection_count: int
    ncr_count: int
    status: str
    notes: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display field, filled in by the route.
    created_by_name: str | None = None
