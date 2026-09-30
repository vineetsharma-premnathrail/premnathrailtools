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
    is_finance_manager: bool = False
    is_design_manager: bool = False
    is_rnd_manager: bool = False
    is_production_manager: bool = False
    is_project_manager: bool = False
    is_store_manager: bool = False
    is_purchase_manager: bool = False
    # Approval-queue visibility (P2PNav): named as a PR approver on >= 1 PR /
    # holds any PO-approval role flag. Admins get both.
    is_pr_approver: bool = False
    is_po_approver: bool = False
    notifications_enabled: bool = True
    tab_access: dict[str, list[str]] = {}
