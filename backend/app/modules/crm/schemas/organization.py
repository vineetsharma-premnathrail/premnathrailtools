from datetime import datetime
from pydantic import BaseModel, field_validator
from app.core.validators import validate_email_format, validate_gst_format


def _validate_email_list(v: list[str] | None) -> list[str] | None:
    if not v:
        return v
    cleaned = []
    seen: set[str] = set()
    for email in v:
        formatted = validate_email_format(email)
        key = (formatted or "").strip().lower()
        if key in seen:
            raise ValueError(f"Duplicate email entered: {formatted}")
        seen.add(key)
        cleaned.append(formatted)
    return cleaned


def _validate_phone_list(v: list[str] | None) -> list[str] | None:
    if not v:
        return v
    cleaned = []
    seen: set[str] = set()
    for phone in v:
        value = (phone or "").strip()
        key = value.lower()
        if key in seen:
            raise ValueError(f"Duplicate phone number entered: {value}")
        seen.add(key)
        cleaned.append(value)
    return cleaned


class OrgContactBase(BaseModel):
    name: str
    designation: str | None = None
    mobile: str | None = None
    email: str | None = None
    additional_mobiles: list[str] | None = None
    additional_emails: list[str] | None = None
    department: str | None = None

    _validate_email = field_validator("email")(validate_email_format)
    _validate_additional_emails = field_validator("additional_emails")(_validate_email_list)
    _validate_additional_mobiles = field_validator("additional_mobiles")(_validate_phone_list)


class OrgContactCreate(OrgContactBase):
    pass


class OrgContactUpdate(BaseModel):
    name: str | None = None
    designation: str | None = None
    mobile: str | None = None
    email: str | None = None
    additional_mobiles: list[str] | None = None
    additional_emails: list[str] | None = None
    department: str | None = None

    _validate_email = field_validator("email")(validate_email_format)
    _validate_additional_emails = field_validator("additional_emails")(_validate_email_list)
    _validate_additional_mobiles = field_validator("additional_mobiles")(_validate_phone_list)


class OrgContactResponse(OrgContactBase):
    model_config = {"from_attributes": True}

    id: int
    org_id: int
    created_by_id: int | None = None
    created_at: datetime | None = None


class OrganizationCreate(BaseModel):
    name: str
    org_type: str
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
    additional_phones: list[str] | None = None
    additional_emails: list[str] | None = None
    website: str | None = None

    _validate_email = field_validator("official_email")(validate_email_format)
    _validate_gst = field_validator("gst_number")(validate_gst_format)
    _validate_additional_emails = field_validator("additional_emails")(_validate_email_list)
    _validate_additional_phones = field_validator("additional_phones")(_validate_phone_list)

    @field_validator("org_type")
    @classmethod
    def _validate_org_type(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Organization Type is required.")
        return v


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
    additional_phones: list[str] | None = None
    additional_emails: list[str] | None = None
    website: str | None = None

    _validate_email = field_validator("official_email")(validate_email_format)
    _validate_gst = field_validator("gst_number")(validate_gst_format)
    _validate_additional_emails = field_validator("additional_emails")(_validate_email_list)
    _validate_additional_phones = field_validator("additional_phones")(_validate_phone_list)


class OrganizationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    org_code: str | None = None
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
    additional_phones: list[str] | None = None
    additional_emails: list[str] | None = None
    website: str | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    is_deleted: bool = False


class OrganizationDetailResponse(OrganizationResponse):
    contacts: list[OrgContactResponse] = []
    inquiry_count: int = 0
    tender_count: int = 0
