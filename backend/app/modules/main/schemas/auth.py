from pydantic import BaseModel


class TokenResponse(BaseModel):
    """Response after successful login."""
    access_token: str
    token_type: str = "bearer"


class CurrentUserResponse(BaseModel):
    """Current logged-in user info."""
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
    is_department_head: bool = False
    is_project_head: bool = False
    is_plant_head: bool = False
    is_purchase_head: bool = False
    is_director: bool = False
    is_md: bool = False
