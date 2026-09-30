"""Access helpers shared by every HR route file.

- HR-management endpoints: `Depends(require_hr)` (same as
  require_app_access("hr"); admins pass automatically via User.get_apps()).
- Self-service endpoints (my profile / leave / attendance / travel / claims /
  assets, approvals-for-me, holidays, org chart): `Depends(get_current_user)`.
- Approvals (leave, attendance regularization, travel, expense claims): the
  approver is captured at submission as the requester's
  User.reporting_manager_id. `can_decide` is the one rule for who may act.
"""
from fastapi import Depends, HTTPException

from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

HR_APP = "hr"

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


def is_hr(user: User | None) -> bool:
    """True if `user` has the hr app (admins always do)."""
    return bool(user) and HR_APP in user.get_apps()


def can_decide(user: User, approver_id: int | None, requester_id: int) -> bool:
    """Whether `user` may approve/reject a request raised by `requester_id`.

    Nobody decides their own request — not even HR or an admin. Otherwise
    the captured approver can decide, and HR can always decide (which also
    covers requests with no approver, i.e. requester had no manager)."""
    if user is None or user.id == requester_id:
        return False
    if approver_id is not None and user.id == approver_id:
        return True
    return is_hr(user)


def ensure_can_decide(user: User, approver_id: int | None, requester_id: int, what: str = "request") -> None:
    """Raise a 403 explaining why `user` can't decide this `what`."""
    if user.id == requester_id:
        raise HTTPException(
            status_code=403,
            detail=f"You cannot approve or reject your own {what}. It has to be decided by your reporting manager or HR.",
        )
    if not can_decide(user, approver_id, requester_id):
        raise HTTPException(
            status_code=403,
            detail=(
                f"Only the requester's reporting manager or an HR user can decide this {what}. "
                "Ask HR to reassign it if the approver is wrong."
            ),
        )
