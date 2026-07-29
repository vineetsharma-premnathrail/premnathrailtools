from datetime import datetime
from pydantic import BaseModel, field_validator
from app.core.validators import validate_email_format, validate_gst_format


class OrgContactBase(BaseModel):
    name: str
    designation: str | None = None
    mobile: str | None = None
    email: str | None = None
    department: str | None = None

    _validate_email = field_validator("email")(validate_email_format)


class OrgContactCreate(OrgContactBase):
    pass


class OrgContactUpdate(BaseModel):
    name: str | None = None
    designation: str | None = None
    mobile: str | None = None
    email: str | None = None
    department: str | None = None

    _validate_email = field_validator("email")(validate_email_format)


class OrgContactResponse(OrgContactBase):
    model_config = {"from_attributes": True}

    id: int
    org_id: int
    created_by_id: int | None = None
    created_at: datetime | None = None


class OrganizationCreate(BaseModel):
    name: str
    org_type: str | None = None
    parent_org: str | None = None
    railway_zone: str | None = None
    division_workshop: str | None = None
    address: str | None = None
    country: str | None = "India"
    state: str | None = None
    city: str | None = None
    pin_code: str | None = None
    gst_number: str | None = None
    official_phone: str | None = None
    official_email: str | None = None
    website: str | None = None

    _validate_email = field_validator("official_email")(validate_email_format)
    _validate_gst = field_validator("gst_number")(validate_gst_format)


class OrganizationUpdate(BaseModel):
    name: str | None = None
    org_type: str | None = None
    parent_org: str | None = None
    railway_zone: str | None = None
    division_workshop: str | None = None
    address: str | None = None
    country: str | None = None
    state: str | None = None
    city: str | None = None
    pin_code: str | None = None
    gst_number: str | None = None
    official_phone: str | None = None
    official_email: str | None = None
    website: str | None = None

    _validate_email = field_validator("official_email")(validate_email_format)
    _validate_gst = field_validator("gst_number")(validate_gst_format)


class OrganizationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    org_type: str | None = None
    parent_org: str | None = None
    railway_zone: str | None = None
    division_workshop: str | None = None
    address: str | None = None
    country: str | None = None
    state: str | None = None
    city: str | None = None
    pin_code: str | None = None
    gst_number: str | None = None
    official_phone: str | None = None
    official_email: str | None = None
    website: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    is_deleted: bool = False


class OrganizationDetailResponse(OrganizationResponse):
    contacts: list[OrgContactResponse] = []
    inquiry_count: int = 0
    tender_count: int = 0
