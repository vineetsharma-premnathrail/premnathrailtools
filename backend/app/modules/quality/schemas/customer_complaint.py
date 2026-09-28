from datetime import date, datetime
from pydantic import BaseModel


class QualityCustomerComplaintCreate(BaseModel):
    customer_name: str
    customer_org_id: int | None = None
    item_name: str | None = None
    item_code: str | None = None
    description: str
    severity: str = "minor"
    complaint_date: date
    resolution_notes: str | None = None
    remarks: str | None = None


class QualityCustomerComplaintUpdate(BaseModel):
    customer_name: str | None = None
    customer_org_id: int | None = None
    item_name: str | None = None
    item_code: str | None = None
    description: str | None = None
    severity: str | None = None
    complaint_date: date | None = None
    resolution_notes: str | None = None
    remarks: str | None = None
    status: str | None = None


class QualityCustomerComplaintResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    complaint_number: str
    customer_name: str
    customer_org_id: int | None = None
    item_name: str | None = None
    item_code: str | None = None
    description: str
    severity: str
    status: str
    complaint_date: date
    received_by_id: int | None = None
    resolution_notes: str | None = None
    closed_at: datetime | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    received_by_name: str | None = None
