from datetime import date
from pydantic import BaseModel


class CompanyCreate(BaseModel):
    name: str
    gst_number: str | None = None
    pan_number: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_url: str | None = None
    default_currency: str | None = None
    country: str | None = None
    tax_id: str | None = None
    domain: str | None = None
    date_of_establishment: date | None = None
    gst_category: str | None = None
    reporting_currency: str | None = None
    registration_details: str | None = None


class CompanyUpdate(BaseModel):
    name: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_url: str | None = None
    letterhead_html: str | None = None
    is_active: bool | None = None
    default_currency: str | None = None
    country: str | None = None
    tax_id: str | None = None
    domain: str | None = None
    date_of_establishment: date | None = None
    gst_category: str | None = None
    reporting_currency: str | None = None
    registration_details: str | None = None


class CompanyResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    gst_number: str | None = None
    pan_number: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_url: str | None = None
    letterhead_html: str | None = None
    is_active: bool
    default_currency: str | None = None
    country: str | None = None
    tax_id: str | None = None
    domain: str | None = None
    date_of_establishment: date | None = None
    gst_category: str | None = None
    reporting_currency: str | None = None
    registration_details: str | None = None
