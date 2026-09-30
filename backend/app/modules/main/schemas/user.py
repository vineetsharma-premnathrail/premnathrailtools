from datetime import date, datetime
from pydantic import BaseModel


class UserCreate(BaseModel):
    """Schema for creating a new user (POST request body)."""
    email: str
    name: str


class UserUpdate(BaseModel):
    """Schema for updating user details (PUT request body)."""
    name: str | None = None
    role: str | None = None
    assigned_apps: list[str] | None = None
    erp_permissions: list[str] | None = None
    is_department_head: bool | None = None
    is_design_manager: bool | None = None
    is_rnd_manager: bool | None = None
    is_production_manager: bool | None = None
    is_project_manager: bool | None = None
    is_store_manager: bool | None = None
    is_purchase_manager: bool | None = None
    is_project_head: bool | None = None
    is_plant_head: bool | None = None
    is_purchase_head: bool | None = None
    is_director: bool | None = None
    is_md: bool | None = None
    is_finance_manager: bool | None = None


class UserHRUpdate(BaseModel):
    """HR-owned profile fields — separate from UserUpdate since these are
    edited from the HR module, not the Users & Roles admin screen."""
    reporting_manager_id: int | None = None
    date_of_joining: date | None = None
    designation: str | None = None
    department: str | None = None


class UserResponse(BaseModel):
    """Schema for user API response (what the API returns)."""
    model_config = {"from_attributes": True}

    id: int
    email: str
    name: str
    role: str
    is_active: bool
    designation: str | None = None
    department: str | None = None
    phone: str | None = None
    office_location: str | None = None
    branch_id: int | None = None
    branch_name: str | None = None
    assigned_apps: list[str] = []
    erp_permissions: list[str] = []
    is_department_head: bool = False
    is_design_manager: bool = False
    is_rnd_manager: bool = False
    is_production_manager: bool = False
    is_project_manager: bool = False
    is_store_manager: bool = False
    is_purchase_manager: bool = False
    is_project_head: bool = False
    is_plant_head: bool = False
    is_purchase_head: bool = False
    is_director: bool = False
    is_md: bool = False
    is_finance_manager: bool = False
    apps: list[str] = []
    is_azure_admin: bool = False
    reporting_manager_id: int | None = None
    reporting_manager_name: str | None = None
    date_of_joining: date | None = None
    granular_permissions: list[str] = []
    data_access_scopes: dict[str, str] = {}


class UserPermissionsUpdate(BaseModel):
    granular_permissions: list[str]
    data_access_scopes: dict[str, str]


class UserSessionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime
    user_agent: str | None


class UserActivityResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    entity_type: str
    entity_id: int | None
    action: str
    summary: str | None
    performed_at: datetime


class UserDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
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
    confidentiality: str | None
    tags: list[str] | None
    remarks: str | None
    created_by_id: int | None
    created_at: datetime
    updated_at: datetime
