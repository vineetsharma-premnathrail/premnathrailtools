from datetime import date, datetime
from pydantic import BaseModel


class VendorCreate(BaseModel):
    name: str
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    gstin: str | None = None
    category: str = "materials"
    payment_terms: str | None = None
    bank_details: str | None = None


class VendorUpdate(BaseModel):
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    gstin: str | None = None
    category: str | None = None
    payment_terms: str | None = None
    bank_details: str | None = None
    status: str | None = None
    qualification_status: str | None = None
    is_avl: bool | None = None
    last_audit_date: date | None = None
    last_audit_score: float | None = None
    remarks: str | None = None


class VendorResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    gstin: str | None = None
    category: str
    payment_terms: str | None = None
    bank_details: str | None = None
    status: str
    qualification_status: str
    is_avl: bool
    last_audit_date: date | None = None
    last_audit_score: float | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
