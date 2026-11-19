"""Who may head a department.

Organization > Department (the admin, by hand): ANY active user may be made a
head, from any unit (owner, 2026-11-19: "yaha se kisi ko bhi head banana") -
e.g. a group BD head posted in Unit 2 heading Business Development of Unit 1.
The approval engine finds heads from the department record, not from the
head's own unit, so such a head still gets the department's approvals.

The automatic paths (Azure-sync auto-provisioning, the HR lifecycle handover)
still only pick a head posted in the department's own unit (is_same_unit):
they guess, the admin decides."""
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.department import Department


def is_same_unit(db: Session, department: Department, user_id: int | None) -> bool:
    if not user_id:
        return False
    if not department.branch_id:
        return True
    user = db.get(User, user_id)
    return bool(user and user.branch_id == department.branch_id)


def head_users_error(db: Session, head_ids: list[int]) -> str | None:
    """Why the given people can't be made heads, or None. Every head must be an
    existing, active user; their unit does not matter."""
    if not head_ids:
        return None
    if len(set(head_ids)) != len(head_ids):
        return "The same person is picked as head twice. Remove the repeat and save again."
    users = {u.id: u for u in db.query(User).filter(User.id.in_(head_ids)).all()}
    missing = sorted(set(head_ids) - set(users))
    if missing:
        return (
            f"Department head user id(s) {', '.join(str(i) for i in missing)} do not exist. "
            "Pick the head from the user list again — the user may have been removed or never synced from Azure."
        )
    inactive = [u.name or u.email for u in users.values() if not u.is_active]
    if inactive:
        return (f"{', '.join(inactive)} {'is' if len(inactive) == 1 else 'are'} not an active user any more, so can't head "
                "a department. Pick someone else, or re-activate them in Organization › Users first.")
    return None
