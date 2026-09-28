from datetime import date, datetime
from pydantic import BaseModel

PLANT_STATUSES = ("active", "inactive", "under_maintenance", "under_construction", "closed")


class BranchCreate(BaseModel):
    name: str
    code: str
    company_id: int | None = None
    plant_type: str | None = None
    status: str = "active"
    industry_function: str | None = None
    description: str | None = None
    head_user_id: int | None = None
    manager_user_id: int | None = None
    established_date: date | None = None
    active_from: date | None = None
    default_warehouse_id: int | None = None
    default_cost_center_id: int | None = None
    default_profit_center: str | None = None
    working_calendar: str | None = None
    working_days: str | None = None
    working_hours: str | None = None
    timezone: str | None = None
    currency: str | None = None
    remarks: str | None = None


class BranchUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    company_id: int | None = None
    plant_type: str | None = None
    status: str | None = None
    industry_function: str | None = None
    description: str | None = None
    head_user_id: int | None = None
    manager_user_id: int | None = None
    established_date: date | None = None
    active_from: date | None = None
    default_warehouse_id: int | None = None
    default_cost_center_id: int | None = None
    default_profit_center: str | None = None
    working_calendar: str | None = None
    working_days: str | None = None
    working_hours: str | None = None
    timezone: str | None = None
    currency: str | None = None
    remarks: str | None = None
    is_active: bool | None = None


class BranchResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    code: str
    company_id: int | None = None
    company_name: str | None = None
    plant_type: str | None = None
    status: str
    industry_function: str | None = None
    description: str | None = None
    head_user_id: int | None = None
    head_user_name: str | None = None
    manager_user_id: int | None = None
    manager_user_name: str | None = None
    established_date: date | None = None
    active_from: date | None = None
    default_warehouse_id: int | None = None
    default_warehouse_name: str | None = None
    default_cost_center_id: int | None = None
    default_cost_center_name: str | None = None
    default_profit_center: str | None = None
    working_calendar: str | None = None
    working_days: str | None = None
    working_hours: str | None = None
    timezone: str | None = None
    currency: str | None = None
    remarks: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class BranchAddressCreate(BaseModel):
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


class BranchAddressUpdate(BaseModel):
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


class BranchAddressResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    branch_id: int
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


class BranchUserAssignmentCreate(BaseModel):
    user_id: int
    employee_id: str | None = None
    department_id: int | None = None
    designation: str | None = None
    role: str | None = None
    access_level: str | None = None
    is_primary_branch: bool = False
    additional_branch_access: list[int] | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    status: str = "active"


class BranchUserAssignmentUpdate(BaseModel):
    user_id: int | None = None
    employee_id: str | None = None
    department_id: int | None = None
    designation: str | None = None
    role: str | None = None
    access_level: str | None = None
    is_primary_branch: bool | None = None
    additional_branch_access: list[int] | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    status: str | None = None


class BranchUserAssignmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    branch_id: int
    user_id: int
    user_name: str | None = None
    employee_id: str | None
    department_id: int | None
    department_name: str | None = None
    designation: str | None
    role: str | None
    access_level: str | None
    is_primary_branch: bool
    additional_branch_access: list[int] | None
    effective_from: date | None
    effective_to: date | None
    status: str
    created_at: datetime
    updated_at: datetime


class BranchDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    branch_id: int
    document_type: str
    document_name: str
    document_number: str | None
    issue_date: date | None
    expiry_date: date | None
    issuing_authority: str | None
    version: str | None
    status: str | None
    filename: str
    content_type: str | None
    size: int | None
    sharepoint_url: str | None
    confidentiality: str | None
    tags: list[str] | None
    remarks: str | None
    created_by_id: int | None
    created_at: datetime
    updated_at: datetime
