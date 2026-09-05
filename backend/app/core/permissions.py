from fastapi import Depends, HTTPException

from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user


def require_app_access(app_name: str):
    """Dependency factory: only let through users whose `get_apps()` includes
    `app_name` (admins always pass, since they get every module)."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if app_name not in user.get_apps():
            raise HTTPException(
                status_code=403, detail=f"Access to '{app_name}' module required"
            )
        return user

    return _dependency


def require_any_app_access(*app_names: str):
    """Dependency factory: let through users whose `get_apps()` includes
    any one of `app_names` (admins always pass)."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not any(app_name in user.get_apps() for app_name in app_names):
            raise HTTPException(
                status_code=403, detail=f"Access to one of {list(app_names)} required"
            )
        return user

    return _dependency


def has_erp_permission(user: User, permission: str) -> bool:
    """True if `user` is admin (implicit access to every ERP action)
    or holds the given granular ERP sub-permission (e.g. "project_edit",
    "sr_delete") in their `erp_permissions` list."""
    if user.role == "admin":
        return True
    return permission in (user.erp_permissions or [])
