"""Access helpers shared by every HR route file.

- Every HR route sits behind `require_hr_module` (router-level, main.py):
  no HR app assigned = no access to any part of the module.
- HR-management endpoints: `Depends(require_hr)` (same as
  require_app_access("hr"); admins pass automatically via User.get_apps()),
  narrowed per tab by the HR Permission Matrix: each route file aliases
  `require_hr = require_hr_tab("<tab>")`.
- Action gates (RBAC, deny by default): HR-team writes need the tab's action
  — `require_hr_tab("<tab>", "create"|"edit"|"approve"|…)`; deletes load the
  record and call `ensure_can_delete(user, record, "hr", tab, what=…)` (the
  company rule: 'delete' on the tab AND you created it; admins excepted).
- Self-service endpoints (my profile / leave / attendance / travel / claims /
  assets / visitors, approvals-for-me, holidays, org chart) are gated by the
  "My HR" tab only: `require_me_view` / `require_me_create` / `require_me_edit`
  (hr:me:view|create|edit). Applying your own leave needs hr:me:create, NOT
  hr:leave:create; cancelling/withdrawing your own request is hr:me:edit, not a
  delete. `ensure_self_or_hr` picks the right grant when one endpoint serves
  both the owner and HR.
- Approvals (leave, attendance regularization, travel, expense claims) now
  route through the central approval engine (services/approvals.py,
  Organization › Approval Workflows; default stage = reporting manager plus
  hr:approvals:approve holders). The rule below (`can_decide`) only decides
  requests submitted before that cut-over (no engine request). Legacy rule: the
  approver is captured at submission as the requester's
  User.reporting_manager_id. `can_decide` is the one rule for who may act:
  being the captured approver IS the authority (routing) — a reporting manager
  approving a reportee's request needs no HR approve grant (they only need the
  hr app, i.e. hr:me:view, to reach the endpoint). Anyone else deciding (HR
  acting on someone else's queue, or on a request with no approver) is an
  HR-admin decision and needs hr:approvals:approve / :reject — or the request's
  own tab action where the registry declares one (leave, travel).
"""
from fastapi import Depends, HTTPException

from app.core.permission_registry import MODULES, can_perform, can_view_tab
from app.core.permissions import ensure_tab_action, require_tab_action
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

HR_APP = "hr"
HR_MODULE = MODULES.get(HR_APP, {})

# user_documents.confidentiality value that hides a document (and any mention
# of it, e.g. expiry reminders) from the employee it belongs to.
HR_ONLY_CONFIDENTIALITY = "HR Only"


def require_hr(user: User = Depends(get_current_user)) -> User:
    """FastAPI dependency: `user: User = Depends(require_hr)`.

    Same gate as require_app_access("hr") (admins pass via User.get_apps()),
    but the 403 says why and what to do instead."""
    if HR_APP not in user.get_apps():
        raise HTTPException(
            status_code=403,
            detail=(
                "This is an HR-team screen and your account doesn't have the 'HR & Administration' app. "
                "Use My HR for your own profile, leave, attendance, travel and claims, "
                "or ask an admin to grant the HR app in Users & Roles if you work in HR."
            ),
        )
    return user


def require_hr_module(user: User = Depends(get_current_user)) -> User:
    """Router-level gate on every HR route (wired in main.py): only users who
    were given the HR & Administration app can use any part of the module,
    self-service included."""
    if HR_APP not in user.get_apps():
        raise HTTPException(
            status_code=403,
            detail=(
                "The HR & Administration module isn't assigned to your account. "
                "Ask an admin to grant the 'HR & Administration' app in Users & Roles."
            ),
        )
    return user


def _tabs(subtab: str | tuple[str, ...]) -> tuple[str, ...]:
    return (subtab,) if isinstance(subtab, str) else tuple(subtab)


def require_hr_tab(subtab: str | tuple[str, ...], action: str | None = None):
    """Dependency factory for HR-team endpoints: `require_hr` plus the HR
    Permission Matrix (Users › Permission Matrix › HR & Administration).

    The matrix is opt-in: a user with no HR grants at all keeps full HR-team
    access (admins always pass). A user who was given only some HR tabs (e.g.
    reception with only Visitors) is limited to those tabs here too, not just
    in the HrNav menu. Route files alias it once:
    `require_hr = require_hr_tab("employees")`.

    `subtab` may be a tuple of tabs: access to ANY of them passes (e.g. an
    employee's leave balances are read by both the Leave tab and the
    Employees tab's profile)."""
    tabs = _tabs(subtab)

    def _dependency(user: User = Depends(require_hr)) -> User:
        labels = " or ".join(f"HR & Administration › {(HR_MODULE.get('subtabs') or {}).get(t, t)}" for t in tabs)
        allowed = [t for t in tabs if can_view_tab(user, HR_APP, t)]
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"You don't have access to {labels}. "
                    "Ask an admin to grant 'view' on it in Users › Permission Matrix."
                ),
            )
        if action and not any(can_perform(user, HR_APP, t, action) for t in allowed):
            ids = " or ".join(f"{HR_APP}:{t}:{action}" for t in tabs)
            raise HTTPException(
                status_code=403,
                detail=(
                    f"You don't have '{action.capitalize()}' permission on {labels} ({ids}). "
                    "Ask an admin to add it to one of your roles in Organization › Role & Permissions."
                ),
            )
        return user

    return _dependency


def is_hr(user: User | None) -> bool:
    """True if `user` has the hr app (admins always do)."""
    return bool(user) and HR_APP in user.get_apps()


def is_hr_for(user: User | None, subtab: str | tuple[str, ...]) -> bool:
    """`is_hr` narrowed by the HR Permission Matrix for one tab, or any of a
    tuple of tabs (opt-in, see require_hr_tab).

    Every HR route already requires the hr app (require_hr_module), so plain
    `is_hr` is True for every caller; use this for "acts as HR" checks."""
    return is_hr(user) and any(can_view_tab(user, HR_APP, t) for t in _tabs(subtab))


# Self-service ("My HR") gates — every employee holding hr:me:* can use these.
require_me_view = require_tab_action(HR_APP, "me", "view")
require_me_create = require_tab_action(HR_APP, "me", "create")
require_me_edit = require_tab_action(HR_APP, "me", "edit")


def ensure_self_or_hr(user: User, owner_id: int | None, me_action: str, hr_tab: str, hr_action: str) -> None:
    """One endpoint serving both the record's owner (self-service, needs
    hr:me:<me_action>) and HR acting on someone else's record (needs
    hr:<hr_tab>:<hr_action>)."""
    if owner_id is not None and user.id == owner_id:
        ensure_tab_action(user, HR_APP, "me", me_action)
    else:
        ensure_tab_action(user, HR_APP, hr_tab, hr_action)


def can_hr(user: User | None, tab: str, action: str) -> bool:
    """User may do `action` on HR › `tab` (deny by default; admins pass)."""
    return bool(user) and can_perform(user, HR_APP, tab, action)


def _decision_tabs(tabs: tuple[str, ...], action: str) -> tuple[str, ...]:
    return tuple(t for t in ("approvals", *tabs) if action in (HR_MODULE.get("actions") or {}).get(t, []))


def can_decide(user: User, approver_id: int | None, requester_id: int, action: str = "approve",
               tabs: tuple[str, ...] = ()) -> bool:
    """Whether `user` may approve/reject a request raised by `requester_id`.

    Nobody decides their own request — not even HR or an admin. The captured
    approver (the requester's reporting manager at submission) may always
    decide: that is routing, not an HR permission, so managers don't need
    hr:approvals:approve to clear their reportees' requests. Anyone else is
    deciding as HR and needs `action` ("approve"/"reject") on HR › Approvals
    or on one of `tabs` (the request's own tab, e.g. "leave"/"travel", when
    the registry declares that action there). Admins pass."""
    if user is None or user.id == requester_id:
        return False
    if approver_id is not None and user.id == approver_id:
        return True
    return any(can_perform(user, HR_APP, t, action) for t in _decision_tabs(tabs, action))


def ensure_can_decide(user: User, approver_id: int | None, requester_id: int, what: str = "request",
                      action: str = "approve", tabs: tuple[str, ...] = ()) -> None:
    """Raise a 403 explaining why `user` can't decide this `what`."""
    if user.id == requester_id:
        raise HTTPException(
            status_code=403,
            detail=f"You cannot approve or reject your own {what}. It has to be decided by your reporting manager or HR.",
        )
    if not can_decide(user, approver_id, requester_id, action, tabs):
        labels = " or ".join(f"HR & Administration › {(HR_MODULE.get('subtabs') or {}).get(t, t)}"
                             for t in _decision_tabs(tabs, action))
        raise HTTPException(
            status_code=403,
            detail=(
                f"Only the requester's reporting manager, or an HR user with '{action.capitalize()}' permission on "
                f"{labels}, can {action} this {what}. Ask an admin to add that permission to one of your roles in "
                "Organization › Role & Permissions, or ask HR to reassign the approver if it is wrong."
            ),
        )
