from datetime import datetime
from pydantic import BaseModel, Field, field_validator, model_validator
from app.core.validators import validate_email_format, validate_gst_format
from app.modules.crm.services.org_scope import (
    ORG_SCOPES, blank_to_none, check_foreign_id, domestic_country_message, wrong_scope_message,
)


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
    address_id: int | None = None

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
    address_id: int | None = None

    _validate_email = field_validator("email")(validate_email_format)
    _validate_additional_emails = field_validator("additional_emails")(_validate_email_list)
    _validate_additional_mobiles = field_validator("additional_mobiles")(_validate_phone_list)


class OrgContactResponse(BaseModel):
    # Not derived from OrgContactBase: its format validators are for input
    # only. Re-running them on read meant one legacy contact with a malformed
    # email (e.g. "developer@premnathrail") 500'd every contact list.
    model_config = {"from_attributes": True}

    name: str
    designation: str | None = None
    mobile: str | None = None
    email: str | None = None
    additional_mobiles: list[str] | None = None
    additional_emails: list[str] | None = None
    department: str | None = None
    address_id: int | None = None
    id: int
    org_id: int
    created_by_id: int | None = None
    created_at: datetime | None = None


def _check_scope_value(v: str | None) -> str | None:
    if v is None:
        return v
    value = str(v).strip().lower()
    if value not in ORG_SCOPES:
        raise ValueError(f"Organization Scope '{v}' isn't valid. Choose Domestic or International.")
    return value


def _blank_to_none(v):
    return blank_to_none(v)


def _check_tax_vat_id(v: str | None) -> str | None:
    return check_foreign_id(v, "Tax / VAT ID")


def _check_registration_no(v: str | None) -> str | None:
    return check_foreign_id(v, "Company Registration Number")


class OrganizationCreate(BaseModel):
    # Domestic / International is picked by the user first; Country never decides it.
    org_scope: str | None = Field(default=None, description="'domestic' or 'international' — required.")
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
    pan: str | None = None
    gst_state_code: str | None = None
    tax_vat_id: str | None = None
    company_registration_no: str | None = None
    official_phone: str | None = None
    official_email: str | None = None
    additional_phones: list[str] | None = None
    additional_emails: list[str] | None = None
    website: str | None = None
    credit_limit: float | None = Field(default=None, ge=0, description="Credit limit (INR) — 0 or more; leave empty for no limit.")
    credit_days: int | None = Field(default=None, ge=0, description="Credit days — 0 or more.")
    discount_percentage: float | None = Field(default=None, ge=0, le=100, description="Discount % — between 0 and 100.")
    gl_reconciliation_account_id: int | None = None

    _validate_email = field_validator("official_email")(validate_email_format)
    _validate_gst = field_validator("gst_number")(validate_gst_format)
    _validate_blank_tax = field_validator(
        "gst_number", "pan", "gst_state_code", "tax_vat_id", "company_registration_no", mode="before")(_blank_to_none)
    _validate_tax_vat_id = field_validator("tax_vat_id")(_check_tax_vat_id)
    _validate_registration_no = field_validator("company_registration_no")(_check_registration_no)
    _validate_additional_emails = field_validator("additional_emails")(_validate_email_list)
    _validate_additional_phones = field_validator("additional_phones")(_validate_phone_list)
    _validate_scope = field_validator("org_scope")(_check_scope_value)

    @field_validator("org_type")
    @classmethod
    def _validate_org_type(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Customer Organization Type is required.")
        return v

    @model_validator(mode="after")
    def _scope_rules(self):
        if not self.org_scope:
            raise ValueError("Organization Scope is required. Choose Domestic or International first.")
        msg = wrong_scope_message(
            self.org_scope, gst_number=self.gst_number, pan=self.pan, gst_state_code=self.gst_state_code,
            tax_vat_id=self.tax_vat_id, company_registration_no=self.company_registration_no)
        if msg:
            raise ValueError(msg)
        if self.org_scope == "domestic":
            country_msg = domestic_country_message(self.country)
            if country_msg:
                raise ValueError(country_msg)
            self.country = "India"
        return self


class OrganizationUpdate(BaseModel):
    org_scope: str | None = None
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
    pan: str | None = None
    gst_state_code: str | None = None
    tax_vat_id: str | None = None
    company_registration_no: str | None = None
    official_phone: str | None = None
    official_email: str | None = None
    additional_phones: list[str] | None = None
    additional_emails: list[str] | None = None
    website: str | None = None
    credit_limit: float | None = Field(default=None, ge=0, description="Credit limit (INR) — 0 or more; leave empty for no limit.")
    credit_days: int | None = Field(default=None, ge=0, description="Credit days — 0 or more.")
    discount_percentage: float | None = Field(default=None, ge=0, le=100, description="Discount % — between 0 and 100.")
    gl_reconciliation_account_id: int | None = None

    _validate_email = field_validator("official_email")(validate_email_format)
    _validate_gst = field_validator("gst_number")(validate_gst_format)
    _validate_blank_tax = field_validator(
        "gst_number", "pan", "gst_state_code", "tax_vat_id", "company_registration_no", mode="before")(_blank_to_none)
    _validate_tax_vat_id = field_validator("tax_vat_id")(_check_tax_vat_id)
    _validate_registration_no = field_validator("company_registration_no")(_check_registration_no)
    _validate_additional_emails = field_validator("additional_emails")(_validate_email_list)
    _validate_additional_phones = field_validator("additional_phones")(_validate_phone_list)
    _validate_scope = field_validator("org_scope")(_check_scope_value)


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
    pan: str | None = None
    gst_state_code: str | None = None
    org_scope: str = "domestic"
    tax_vat_id: str | None = None
    company_registration_no: str | None = None
    official_phone: str | None = None
    official_email: str | None = None
    additional_phones: list[str] | None = None
    additional_emails: list[str] | None = None
    website: str | None = None
    credit_limit: float | None = None
    credit_days: int | None = None
    discount_percentage: float | None = None
    gl_reconciliation_account_id: int | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    is_deleted: bool = False


class OrganizationDetailResponse(OrganizationResponse):
    contacts: list[OrgContactResponse] = []
    inquiry_count: int = 0
    tender_count: int = 0


# ---------- Ship-to / consignee / bill-to / payer addresses ----------

class OrgAddressCreate(BaseModel):
    address_type: str = "ship_to"
    name: str = Field(min_length=1, max_length=255, description="Address name — e.g. 'Electric Loco Shed, Ghaziabad'.")
    address: str = Field(min_length=1, description="Street address.")
    city: str | None = None
    state: str | None = None
    state_code: str | None = None
    pin_code: str | None = None
    gstin: str | None = None
    phone: str | None = None
    is_default: bool = False

    _validate_gst = field_validator("gstin")(validate_gst_format)


class OrgAddressUpdate(BaseModel):
    address_type: str | None = None
    name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    state_code: str | None = None
    pin_code: str | None = None
    gstin: str | None = None
    phone: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None

    _validate_gst = field_validator("gstin")(validate_gst_format)


class OrgAddressResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    org_id: int
    address_type: str
    name: str
    address: str
    city: str | None = None
    state: str | None = None
    state_code: str | None = None
    pin_code: str | None = None
    gstin: str | None = None
    phone: str | None = None
    is_default: bool = False
    is_active: bool = True
    created_at: datetime | None = None
    contacts: list[OrgContactResponse] = []
