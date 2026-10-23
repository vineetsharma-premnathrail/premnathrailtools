from fastapi import Depends, HTTPException

from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.core.permission_registry import MODULES, can_perform, can_view_tab, is_admin_user
from app.core.permission_words import action_word, module_word

class PermissionDenied(HTTPException):
    """403 that carries the permission id it was about, so the refused-request
    trace (basis_log) records it — the message itself stays in plain words."""

    def __init__(self, detail: str, permission_key: str | None = None):
        super().__init__(status_code=403, detail=detail)
        self.permission_key = permission_key


GRANT_HINT = "Ask an admin to add it to one of your roles (Organization › Role & Permissions — the Permission Matrix)."


def _module_label(module_key: str) -> str:
    return module_word(module_key)


def _tab_label(module_key: str, subtab_key: str) -> str:
    return (MODULES.get(module_key, {}).get("subtabs") or {}).get(subtab_key, subtab_key)


def require_app_access(app_name: str):
    """Dependency factory: only let through users whose `get_apps()` includes
    `app_name` — i.e. they can view at least one of its tabs (admins always
    pass, since they get every module)."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if app_name not in user.get_apps():
            raise PermissionDenied(
                f"You can't open the {_module_label(app_name)} module — none of your roles lets you view any of its tabs. "
                f"{GRANT_HINT}", f"{app_name}:*:view")
        return user

    return _dependency


def require_any_app_access(*app_names: str):
    """Dependency factory: let through users whose `get_apps()` includes
    any one of `app_names` (admins always pass)."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not any(app_name in user.get_apps() for app_name in app_names):
            labels = " or ".join(_module_label(a) for a in app_names)
            raise HTTPException(
                status_code=403,
                detail=f"You need access to {labels} for this. {GRANT_HINT}",
            )
        return user

    return _dependency


def require_tab_access(module_key: str, subtab_key: str):
    """Dependency factory: 403s a user without `view` on `subtab_key` in the
    Permission Matrix (deny by default; admins pass)."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not can_view_tab(user, module_key, subtab_key):
            raise PermissionDenied(
                f"You don't have 'View' permission on {_module_label(module_key)} › "
                f"{_tab_label(module_key, subtab_key)}. {GRANT_HINT}", f"{module_key}:{subtab_key}:view")
        return user

    return _dependency


def require_tab_action(module_key: str, subtab_key: str, action: str):
    """Dependency factory: 403s a user without `action` on `subtab_key` in the
    Permission Matrix (deny by default; admins pass)."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        ensure_tab_action(user, module_key, subtab_key, action)
        return user

    return _dependency


def ensure_tab_action(user: User, module_key: str, subtab_key: str, action: str) -> None:
    """Inline form of require_tab_action, for checks that depend on the
    record (e.g. which tab a document belongs to)."""
    if not can_perform(user, module_key, subtab_key, action):
        raise PermissionDenied(
            f"You don't have '{action_word(action)}' permission on {_module_label(module_key)} › "
            f"{_tab_label(module_key, subtab_key)}. {GRANT_HINT}", f"{module_key}:{subtab_key}:{action}")


def _feature_label(module_key: str, tab_key: str, feature_key: str) -> str:
    from app.core.permission_registry import MODULES
    f = MODULES.get(module_key, {}).get("features", {}).get(tab_key, {}).get(feature_key)
    return f["label"] if f else feature_key


def require_feature_action(module_key: str, tab_key: str, feature_key: str, action: str):
    """Dependency factory for a feature inside a tab (Inquiry › Quotations ›
    Create): 403s a user without that feature grant (deny by default; admins
    pass; uncustomised roles inherit it from the tab — permission_registry)."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        ensure_feature_action(user, module_key, tab_key, feature_key, action)
        return user

    return _dependency


def ensure_feature_action(user: User, module_key: str, tab_key: str, feature_key: str, action: str) -> None:
    """Inline form of require_feature_action."""
    from app.core.permission_registry import can_feature
    if not can_feature(user, module_key, tab_key, feature_key, action):
        raise PermissionDenied(
            f"You don't have '{action_word(action)}' permission on {_module_label(module_key)} › "
            f"{_tab_label(module_key, tab_key)} › {_feature_label(module_key, tab_key, feature_key)}. {GRANT_HINT}",
            f"{module_key}:{tab_key}.{feature_key}:{action}")


_OWNER_FIELDS = (
    "created_by_id", "created_by", "raised_by_id", "requested_by_id", "requester_id",
    "submitted_by_id", "owner_id", "uploaded_by_id", "user_id",
)


def record_owner_id(record) -> int | None:
    """The id of whoever created `record`, read from the first creator-style
    column it has (created_by_id, raised_by_id, …); None when it has none."""
    for field in _OWNER_FIELDS:
        value = getattr(record, field, None)
        if isinstance(value, int):
            return value
        if value is not None and isinstance(getattr(value, "id", None), int):
            return value.id
    return None


def ensure_can_delete(user: User, record, module_key: str, subtab_key: str, what: str = "record") -> None:
    """The company-wide delete rule: you need 'Delete' on the tab AND you can
    only delete what you created yourself. Admins can delete anything. A
    record with no creator column is deletable by anyone holding 'Delete'."""
    ensure_tab_action(user, module_key, subtab_key, "delete")
    if is_admin_user(user):
        return
    owner_id = record_owner_id(record)
    if owner_id is not None and owner_id != user.id:
        raise HTTPException(
            status_code=403,
            detail=f"You can only delete {'an' if what[:1].lower() in 'aeiou' else 'a'} {what} you created yourself — "
                   "this one was created by someone else. "
                   "Ask its creator or an admin to delete it.",
        )


# Legacy ERP ids (stored in User.erp_permissions before roles) -> the
# Permission Matrix grant that now decides them.
_ERP_LEGACY = {"project": "projects", "sr": "service_requests"}


def has_erp_permission(user: User, permission: str) -> bool:
    """True if `user` may do a legacy ERP action id ("project_edit",
    "sr_delete" …) — now answered by the Permission Matrix:
    `project_*` -> erp:projects:*, `sr_*` -> erp:service_requests:*."""
    prefix, _, action = permission.partition("_")
    tab = _ERP_LEGACY.get(prefix)
    if not tab:
        return is_admin_user(user)
    return can_perform(user, "erp", tab, action)
