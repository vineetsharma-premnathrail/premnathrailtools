from datetime import date, datetime
from pydantic import BaseModel, field_validator
from app.core.validators import validate_email_format, validate_gst_format, validate_financial_year_format


class ProjectAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_path: str | None = None
    sharepoint_url: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


class ProjectCreate(BaseModel):
    serial_number: str
    machine_type: str | None = None
    model_name: str | None = None
    engine_number: str | None = None
    chassis_number: str | None = None
    application_type: str | None = None
    status: str = "active"

    po_number: str | None = None
    po_date: date | None = None
    delivery_date: date | None = None
    commissioning_date: date | None = None
    handover_date: date | None = None

    client_company: str | None = None
    client_name: str | None = None
    client_designation: str | None = None
    client_email: str | None = None
    client_phone: str | None = None
    client_phone_alt: str | None = None
    client_address: str | None = None
    client_gst: str | None = None

    site_name: str | None = None
    site_location: str | None = None
    site_state: str | None = None
    site_pincode: str | None = None
    site_country: str | None = "India"
    zone: str | None = None
    is_export: bool = False

    warranty_start_date: date | None = None
    warranty_end_date: date | None = None
    warranty_override: str | None = None
    extended_warranty: bool = False
    extended_warranty_end: date | None = None
    amc_status: str | None = None
    amc_end_date: date | None = None

    operator_name: str | None = None
    operator_phone: str | None = None
    operator_email: str | None = None
    operator_qualification: str | None = None

    specifications: str | None = None
    installed_options: str | None = None
    software_version: str | None = None
    year_of_manufacture: str | None = None

    notes: str | None = None
    tech_notes: str | None = None
    warranty_terms: str | None = None

    _validate_client_email = field_validator("client_email")(validate_email_format)
    _validate_operator_email = field_validator("operator_email")(validate_email_format)
    _validate_gst = field_validator("client_gst")(validate_gst_format)
    _validate_year = field_validator("year_of_manufacture")(validate_financial_year_format)


class ProjectUpdate(BaseModel):
    """Every field optional — only supplied fields are patched."""
    machine_type: str | None = None
    model_name: str | None = None
    serial_number: str | None = None
    engine_number: str | None = None
    chassis_number: str | None = None
    application_type: str | None = None
    status: str | None = None

    po_number: str | None = None
    po_date: date | None = None
    delivery_date: date | None = None
    commissioning_date: date | None = None
    handover_date: date | None = None

    client_company: str | None = None
    client_name: str | None = None
    client_designation: str | None = None
    client_email: str | None = None
    client_phone: str | None = None
    client_phone_alt: str | None = None
    client_address: str | None = None
    client_gst: str | None = None

    site_name: str | None = None
    site_location: str | None = None
    site_state: str | None = None
    site_pincode: str | None = None
    site_country: str | None = None
    zone: str | None = None
    is_export: bool | None = None

    warranty_start_date: date | None = None
    warranty_end_date: date | None = None
    warranty_override: str | None = None
    extended_warranty: bool | None = None
    extended_warranty_end: date | None = None
    amc_status: str | None = None
    amc_end_date: date | None = None

    operator_name: str | None = None
    operator_phone: str | None = None
    operator_email: str | None = None
    operator_qualification: str | None = None

    specifications: str | None = None
    installed_options: str | None = None
    software_version: str | None = None
    year_of_manufacture: str | None = None

    notes: str | None = None
    tech_notes: str | None = None
    warranty_terms: str | None = None

    _validate_client_email = field_validator("client_email")(validate_email_format)
    _validate_operator_email = field_validator("operator_email")(validate_email_format)
    _validate_gst = field_validator("client_gst")(validate_gst_format)
    _validate_year = field_validator("year_of_manufacture")(validate_financial_year_format)


class ProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    serial_number: str
    machine_type: str | None = None
    model_name: str | None = None
    engine_number: str | None = None
    chassis_number: str | None = None
    application_type: str | None = None
    status: str

    po_number: str | None = None
    po_date: date | None = None
    delivery_date: date | None = None
    commissioning_date: date | None = None
    handover_date: date | None = None

    client_company: str | None = None
    client_name: str | None = None
    client_designation: str | None = None
    client_email: str | None = None
    client_phone: str | None = None
    client_phone_alt: str | None = None
    client_address: str | None = None
    client_gst: str | None = None

    site_name: str | None = None
    site_location: str | None = None
    site_state: str | None = None
    site_pincode: str | None = None
    site_country: str | None = None
    zone: str | None = None
    is_export: bool

    warranty_start_date: date | None = None
    warranty_end_date: date | None = None
    warranty_override: str | None = None
    extended_warranty: bool
    extended_warranty_end: date | None = None
    amc_status: str | None = None
    amc_end_date: date | None = None

    operator_name: str | None = None
    operator_phone: str | None = None
    operator_email: str | None = None
    operator_qualification: str | None = None

    specifications: str | None = None
    installed_options: str | None = None
    software_version: str | None = None
    year_of_manufacture: str | None = None

    notes: str | None = None
    tech_notes: str | None = None
    warranty_terms: str | None = None

    created_at: datetime
    updated_at: datetime
