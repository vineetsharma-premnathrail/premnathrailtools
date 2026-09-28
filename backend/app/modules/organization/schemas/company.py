from pydantic import BaseModel
from datetime import date, datetime


class CompanyUpdate(BaseModel):
    # Basic Information
    name: str | None = None
    legal_name: str | None = None
    code: str | None = None
    short_name: str | None = None
    company_type: str | None = None
    industry: str | None = None
    business_nature: str | None = None
    website: str | None = None
    description: str | None = None
    date_of_incorporation: date | None = None
    country: str | None = None
    currency: str | None = None
    default_language: str | None = None
    timezone: str | None = None

    # Legal & Registration
    legal_entity_type: str | None = None
    legal_status: str | None = None
    cin: str | None = None
    pan: str | None = None
    tan: str | None = None
    gstin: str | None = None
    udyam_registration_no: str | None = None
    iec: str | None = None
    msme_registration_no: str | None = None
    pf_registration_no: str | None = None
    esic_registration_no: str | None = None
    other_registration_type: str | None = None
    other_registration_number: str | None = None
    other_registration_date: date | None = None
    issuing_authority: str | None = None
    expiry_date: date | None = None
    authorized_capital: float | None = None
    paid_up_capital: float | None = None
    legal_representative: str | None = None

    # Tax Configuration
    gst_registration_type: str | None = None
    tds_applicable: bool | None = None
    tcs_applicable: bool | None = None
    default_tax_region: str | None = None
    tax_deductibility: str | None = None
    tax_registration_status: str | None = None
    tax_effective_date: date | None = None

    # Branding
    logo_url: str | None = None
    primary_brand_color: str | None = None
    secondary_brand_color: str | None = None
    accent_color: str | None = None
    company_header: str | None = None
    company_footer: str | None = None
    watermark: str | None = None
    email_signature: str | None = None

    # Company Defaults & Controls
    default_tax: str | None = None
    default_plant_id: int | None = None
    default_warehouse_id: int | None = None
    default_cost_center: str | None = None
    default_profit_center: str | None = None

    is_active: bool | None = None


class CompanyResponse(BaseModel):
    id: int
    name: str
    legal_name: str | None
    code: str
    short_name: str | None
    company_type: str | None
    industry: str | None
    business_nature: str | None
    website: str | None
    description: str | None
    date_of_incorporation: date | None
    country: str | None
    currency: str | None
    default_language: str | None
    timezone: str | None

    legal_entity_type: str | None
    legal_status: str | None
    cin: str | None
    pan: str | None
    tan: str | None
    gstin: str | None
    udyam_registration_no: str | None
    iec: str | None
    msme_registration_no: str | None
    pf_registration_no: str | None
    esic_registration_no: str | None
    other_registration_type: str | None
    other_registration_number: str | None
    other_registration_date: date | None
    issuing_authority: str | None
    expiry_date: date | None
    authorized_capital: float | None
    paid_up_capital: float | None
    legal_representative: str | None

    gst_registration_type: str | None
    tds_applicable: bool
    tcs_applicable: bool
    default_tax_region: str | None
    tax_deductibility: str | None
    tax_registration_status: str | None
    tax_effective_date: date | None

    logo_path: str | None
    logo_url: str | None
    primary_brand_color: str | None
    secondary_brand_color: str | None
    accent_color: str | None
    company_header: str | None
    company_footer: str | None
    watermark: str | None
    email_signature: str | None

    default_tax: str | None
    default_plant_id: int | None
    default_warehouse_id: int | None
    default_cost_center: str | None
    default_profit_center: str | None

    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CompanyAddressCreate(BaseModel):
    address_type: str | None = None
    address_line1: str
    address_line2: str | None = None
    landmark: str | None = None
    country: str | None = None
    state: str | None = None
    city: str | None = None
    district: str | None = None
    pincode: str | None = None
    is_primary: bool = False
    is_active: bool = True


class CompanyAddressUpdate(BaseModel):
    address_type: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    landmark: str | None = None
    country: str | None = None
    state: str | None = None
    city: str | None = None
    district: str | None = None
    pincode: str | None = None
    is_primary: bool | None = None
    is_active: bool | None = None


class CompanyAddressResponse(BaseModel):
    id: int
    company_id: int
    address_type: str | None
    address_line1: str
    address_line2: str | None
    landmark: str | None
    country: str | None
    state: str | None
    city: str | None
    district: str | None
    pincode: str | None
    is_primary: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CompanyContactCreate(BaseModel):
    contact_type: str | None = None
    contact_person: str
    designation: str | None = None
    department: str | None = None
    mobile: str | None = None
    phone: str | None = None
    email: str | None = None
    alternate_email: str | None = None
    communication_preference: str | None = None
    is_primary: bool = False
    is_active: bool = True


class CompanyContactUpdate(BaseModel):
    contact_type: str | None = None
    contact_person: str | None = None
    designation: str | None = None
    department: str | None = None
    mobile: str | None = None
    phone: str | None = None
    email: str | None = None
    alternate_email: str | None = None
    communication_preference: str | None = None
    is_primary: bool | None = None
    is_active: bool | None = None


class CompanyContactResponse(BaseModel):
    id: int
    company_id: int
    contact_type: str | None
    contact_person: str
    designation: str | None
    department: str | None
    mobile: str | None
    phone: str | None
    email: str | None
    alternate_email: str | None
    communication_preference: str | None
    is_primary: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CompanyFinancialYearCreate(BaseModel):
    name: str
    start_date: date
    end_date: date
    fiscal_year_code: str | None = None
    status: str = "open"
    lock_date: date | None = None
    period_closing_rule: str | None = None
    number_series_reset: bool = False


class CompanyFinancialYearUpdate(BaseModel):
    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    fiscal_year_code: str | None = None
    status: str | None = None
    lock_date: date | None = None
    period_closing_rule: str | None = None
    number_series_reset: bool | None = None


class CompanyFinancialYearResponse(BaseModel):
    id: int
    company_id: int
    name: str
    start_date: date
    end_date: date
    fiscal_year_code: str | None
    status: str
    lock_date: date | None
    period_closing_rule: str | None
    number_series_reset: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CompanyDocumentResponse(BaseModel):
    id: int
    company_id: int
    document_type: str
    document_name: str
    document_number: str | None
    issue_date: date | None
    expiry_date: date | None
    issuing_authority: str | None
    filename: str
    content_type: str | None
    size: int | None
    sharepoint_url: str | None
    description: str | None
    confidentiality: str | None
    tags: list[str] | None
    remarks: str | None
    created_by_id: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
