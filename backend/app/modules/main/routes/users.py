from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.modules.main.models.user import User, AVAILABLE_APPS
from app.modules.main.schemas.user import UserResponse, UserUpdate
from app.modules.main.routes.auth import get_current_user
from app.auth.microsoft import list_azure_org_users, get_azure_admin_ids

router = APIRouter(prefix="/users", tags=["Users & Roles"])

VALID_ROLES = {"user", "admin"}

# Generic/shared inboxes that exist as directory objects but aren't real
# people — never pull these into the local users table from an Azure sync.
_EXCLUDED_MAILBOX_LOCAL_PARTS = {"accounts", "corporate", "info", "prpl", "pew.research", "service"}


def _is_syncable_azure_user(email: str) -> bool:
    """False for accounts outside our own tenant domain (guests/partners) or
    known shared/generic mailboxes — both get excluded from Azure AD syncs so
    the org directory only ever contains real internal employees."""
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return False
    local_part, _, domain = email.partition("@")
    if settings.DOMAIN_EMAIL and domain != settings.DOMAIN_EMAIL.strip().lstrip("@").lower():
        return False
    if local_part in _EXCLUDED_MAILBOX_LOCAL_PARTS:
        return False
    return True

# Granular ERP permission ids the "ERP Permissions" section of the Module
# Access modal can grant. R&D Tools and CRM don't have a sub-permission
# breakdown — just the top-level module toggle in assigned_apps.
VALID_ERP_PERMISSIONS = {
    "project_view", "project_create", "project_edit", "project_delete",
    "sr_view", "sr_create", "sr_edit", "sr_delete",
}


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Dependency: only allow admin roles through."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def to_response(user: User, db: Session | None = None) -> UserResponse:
    """Serialize a User row, computing `apps` from role + assigned_apps
    (admins implicitly get every module regardless of what's assigned)."""
    updates = {"apps": user.get_apps()}
    if user.reporting_manager_id and db is not None:
        manager = db.query(User).filter(User.id == user.reporting_manager_id).first()
        updates["reporting_manager_name"] = manager.name if manager else None
    return UserResponse.model_validate(user).model_copy(update=updates)


@router.get("", response_model=list[UserResponse])
async def list_users(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all users (admin only) — excludes shared mailboxes / external-domain
    accounts that shouldn't be managed as people (see _is_syncable_azure_user)."""
    users = db.query(User).order_by(User.name).offset(skip).limit(limit).all()
    users = [u for u in users if _is_syncable_azure_user(u.email)]
    return [to_response(u) for u in users]


@router.get("/directory", response_model=list[dict])
async def list_user_directory(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Minimal active-user list (id/name/email) any signed-in user can read —
    used for pickers like "share this document with" where the full
    admin-only user-management payload (roles, permissions) isn't needed."""
    users = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [
        {
            "id": u.id, "name": u.name, "email": u.email, "department": u.department, "designation": u.designation,
            "is_department_head": u.is_department_head, "is_project_head": u.is_project_head, "is_plant_head": u.is_plant_head,
        }
        for u in users
    ]


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Update a user's role, module access, or name (admin only)."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.role is not None:
        if payload.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        if target.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="Cannot change your own admin role")
        target.role = payload.role

    if payload.assigned_apps is not None:
        invalid = set(payload.assigned_apps) - AVAILABLE_APPS
        if invalid:
            raise HTTPException(status_code=400, detail=f"Invalid app(s): {', '.join(sorted(invalid))}")
        target.assigned_apps = payload.assigned_apps

    if payload.erp_permissions is not None:
        invalid = set(payload.erp_permissions) - VALID_ERP_PERMISSIONS
        if invalid:
            raise HTTPException(status_code=400, detail=f"Invalid permission(s): {', '.join(sorted(invalid))}")
        target.erp_permissions = payload.erp_permissions

    if payload.is_department_head is not None:
        target.is_department_head = payload.is_department_head

    if payload.is_project_head is not None:
        target.is_project_head = payload.is_project_head

    if payload.is_plant_head is not None:
        target.is_plant_head = payload.is_plant_head

    if payload.name is not None:
        target.name = payload.name

    db.commit()
    db.refresh(target)
    return to_response(target)


@router.patch("/{user_id}/deactivate", response_model=UserResponse)
async def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Deactivate a user account (admin only)."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_active = False
    db.commit()
    db.refresh(target)
    return to_response(target)


@router.patch("/{user_id}/activate", response_model=UserResponse)
async def activate_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Reactivate a user account (admin only)."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_active = True
    db.commit()
    db.refresh(target)
    return to_response(target)


@router.post("/sync-azure", response_model=list[UserResponse])
async def sync_azure_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Pull every member from the Azure AD tenant into the local users table,
    so the Users & Roles page shows the full org directory, not just people
    who have already logged in once (admin only)."""
    try:
        azure_users = await list_azure_org_users()
        admin_ids = await get_azure_admin_ids()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Azure sync failed: {e}")

    azure_users = [
        au for au in azure_users
        if _is_syncable_azure_user(au.get("mail") or au.get("userPrincipalName") or "")
    ]

    # Anyone already synced in previously (e.g. an external guest or shared
    # mailbox pulled in before this filter existed) who no longer passes the
    # filter is treated the same as someone removed from the tenant: they
    # fall out of active_azure_ids below and get deactivated, not deleted.
    active_azure_ids = {au.get("id") for au in azure_users if au.get("id")}

    for au in azure_users:
        email = au.get("mail") or au.get("userPrincipalName", "")
        if not email:
            continue
        azure_id = au.get("id")
        is_az_admin = azure_id in admin_ids

        target = db.query(User).filter(User.email == email).first()
        if target:
            target.azure_id = azure_id or target.azure_id
            target.name = au.get("displayName") or target.name
            target.department = au.get("department") or target.department
            target.designation = au.get("jobTitle") or target.designation
            target.phone = au.get("mobilePhone") or target.phone
            target.is_active = True
            target.is_azure_admin = is_az_admin
            if is_az_admin and target.role == "user":
                target.role = "admin"
        else:
            db.add(
                User(
                    email=email,
                    name=au.get("displayName") or email.split("@")[0],
                    azure_id=azure_id,
                    department=au.get("department"),
                    designation=au.get("jobTitle"),
                    phone=au.get("mobilePhone"),
                    role="admin" if is_az_admin else "user",
                    is_active=True,
                    is_azure_admin=is_az_admin,
                    assigned_apps=[],
                )
            )

    # Deactivate any azure-linked local users no longer in the active tenant list
    for u in db.query(User).filter(User.azure_id.isnot(None)).all():
        if u.azure_id not in active_azure_ids:
            u.is_active = False

    db.commit()
    users = db.query(User).order_by(User.name).all()
    return [to_response(u) for u in users]
