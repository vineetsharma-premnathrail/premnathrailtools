"""Which department a user belongs to.

`User.department_id` (FK to departments) is the link; `User.department` is
the department's name kept alongside for display and for the modules that
still print it. Set both through `set_user_department` so they never drift.

Users who could not be matched to a Department yet (Azure text with no
department row, or a name shared by several plants) keep only the text, so
every reader falls back to a case-insensitive name match for them.
"""
from __future__ import annotations

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.department import Department


def set_user_department(user: User, department: Department | None) -> None:
    """Point `user` at `department` (None clears it). Does not commit."""
    user.department_id = department.id if department else None
    user.department = department.name if department else None


def match_department(db: Session, name: str | None, branch_id: int | None) -> Department | None:
    """The Department a free-text name means: same name at the user's plant,
    else the only department with that name anywhere."""
    name = (name or "").strip()
    if not name:
        return None
    rows = db.query(Department).filter(func.lower(Department.name) == name.lower()).all()
    same_plant = [d for d in rows if branch_id and d.branch_id == branch_id]
    if same_plant:
        return same_plant[0]
    return rows[0] if len(rows) == 1 else None


def user_department(db: Session, user: User | None) -> Department | None:
    """The user's Department: by id, else by name (preferring their plant)."""
    if user is None:
        return None
    if getattr(user, "department_id", None):
        dept = db.get(Department, user.department_id)
        if dept:
            return dept
    return match_department(db, user.department, user.branch_id)


def members_condition(department: Department):
    """SQL condition on User rows: members of `department` — linked by id, or
    not linked yet and carrying its name at its plant."""
    by_name = and_(User.department_id.is_(None), func.lower(func.trim(User.department)) == department.name.strip().lower())
    if department.branch_id:
        by_name = and_(by_name, User.branch_id == department.branch_id)
    return or_(User.department_id == department.id, by_name)


def peers_condition(db: Session, user: User):
    """SQL condition on User rows: people in the same department as `user`
    (same plant for the name fallback). None when the user has no department."""
    dept = user_department(db, user)
    if dept is not None:
        return members_condition(dept)
    name = (user.department or "").strip()
    if not name:
        return None
    cond = func.lower(func.trim(User.department)) == name.lower()
    return and_(cond, User.branch_id == user.branch_id) if user.branch_id else cond


def rename_members(db: Session, department: Department) -> None:
    """Keep members' department text in step after a rename. Does not commit."""
    db.query(User).filter(User.department_id == department.id).update(
        {User.department: department.name}, synchronize_session=False)
