from fastapi import Depends, HTTPException

from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.core.permission_registry import MODULES, can_perform, can_view_tab


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


def require_tab_access(module_key: str, subtab_key: str):
    """Dependency factory: 403s a user who has active Permission Matrix
    grants somewhere in `module_key` but wasn't given `view` on
    `subtab_key` specifically. A user the matrix has never touched for
    that module passes through unrestricted (see can_view_tab) — apply
    this alongside require_app_access, not instead of it."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not can_view_tab(user, module_key, subtab_key):
            raise HTTPException(status_code=403, detail=f"Access to '{module_key}:{subtab_key}' not granted")
        return user

    return _dependency



def require_tab_action(module_key: str, subtab_key: str, action: str):
    """Dependency factory: 403s a user whose Permission Matrix grants for
    `module_key` don't include `action` on `subtab_key` (see can_perform —
    unconfigured users pass). Apply alongside require_app_access."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not can_perform(user, module_key, subtab_key, action):
            module = MODULES.get(module_key, {})
            tab = module.get("subtabs", {}).get(subtab_key, subtab_key)
            raise HTTPException(
                status_code=403,
                detail=f"You don't have '{action}' permission on {module.get('label', module_key)} › {tab}. "
                       "Ask an admin to grant it in Users › Permission Matrix.",
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
