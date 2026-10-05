"""A department's head(s) must belong to the same unit (branch) as the
department — a Unit 1 department is headed by a Unit 1 person, never by
someone posted in Unit 2. Enforced on every write path that sets a head:
the Organization > Department API, Azure-sync auto-provisioning and the HR
lifecycle handover. A department with no branch has no unit to match, so
any head is accepted there."""
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department


def is_same_unit(db: Session, department: Department, user_id: int | None) -> bool:
    if not user_id:
        return False
    if not department.branch_id:
        return True
    user = db.get(User, user_id)
    return bool(user and user.branch_id == department.branch_id)


def cross_unit_head_error(db: Session, branch_id: int | None, head_ids: list[int]) -> str | None:
    """Human-readable reason the given heads can't head a department in
    `branch_id`, or None when they all belong to that unit."""
    if not branch_id or not head_ids:
        return None
    branch = db.get(Branch, branch_id)
    unit = branch.name if branch else f"branch #{branch_id}"
    users = db.query(User).filter(User.id.in_(head_ids)).all()
    wrong = []
    for u in users:
        if u.branch_id == branch_id:
            continue
        other = db.get(Branch, u.branch_id) if u.branch_id else None
        wrong.append(f"{u.name or u.email} ({other.name if other else 'no unit set'})")
    if not wrong:
        return None
    return (
        f"Department head must belong to {unit}. Not in {unit}: {', '.join(wrong)}. "
        f"Pick a head posted in {unit}, or change that person's unit first (HR / Users)."
    )
