from datetime import date
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
    assigned_apps: list[str] = []
    erp_permissions: list[str] = []
    apps: list[str] = []
    is_azure_admin: bool = False
    reporting_manager_id: int | None = None
    reporting_manager_name: str | None = None
    date_of_joining: date | None = None
