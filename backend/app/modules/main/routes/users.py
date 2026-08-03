from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User, AVAILABLE_APPS
from app.modules.main.schemas.user import UserResponse, UserUpdate
from app.modules.main.routes.auth import get_current_user
from app.auth.microsoft import list_azure_org_users, get_azure_admin_ids

router = APIRouter(prefix="/users", tags=["Users & Roles"])

VALID_ROLES = {"user", "admin"}

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


def to_response(user: User) -> UserResponse:
    """Serialize a User row, computing `apps` from role + assigned_apps
    (admins implicitly get every module regardless of what's assigned)."""
    return UserResponse.model_validate(user).model_copy(update={"apps": user.get_apps()})


@router.get("", response_model=list[UserResponse])
async def list_users(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all users (admin only)."""
    users = db.query(User).order_by(User.name).offset(skip).limit(limit).all()
    return [to_response(u) for u in users]


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
