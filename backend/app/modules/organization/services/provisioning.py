"""Auto-provisioning of Branch/Department master rows from Azure AD sync.

Triggered from both the Microsoft SSO login callback and the admin's "Sync
Azure Users" bulk action (see app/modules/main/routes/auth.py and
app/modules/main/routes/users.py) right after a user's `office_location`,
`department`, and `reporting_manager_id` fields are set from Graph data:

  - `office_location` -> matched/created as a Branch, and linked onto the
    user via `User.branch_id`.
  - `department` (free-text) -> matched/created as a Department under that
    branch. A newly-created Department's `head_user_id` is seeded from the
    user's `reporting_manager_id` (their Azure manager becomes the
    department head) — an existing Department's head is only backfilled if
    it doesn't have one yet, never overwritten, so admin edits made via the
    Organization > Department screen stick.
  - A Department's `code` is just its full name (not an abbreviation) per
    product decision; since `code` is globally unique but two branches can
    have same-named departments, a numeric suffix is appended on collision.
"""
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department


def _get_or_create_branch(db: Session, office_location: str) -> Branch:
    name = office_location.strip()
    branch = db.query(Branch).filter(Branch.name.ilike(name)).first()
    if branch:
        return branch
    code = unique_code(db, Branch, name)
    branch = Branch(name=name, code=code)
    db.add(branch)
    db.flush()
    return branch


def _get_or_create_department(db: Session, branch_id: int, department_name: str, head_user_id: int | None) -> Department:
    name = department_name.strip()
    department = (
        db.query(Department)
        .filter(Department.branch_id == branch_id, Department.name.ilike(name))
        .first()
    )
    if department:
        if not head_user_id:
            return department
        if not department.head_user_id:
            department.head_user_id = head_user_id
        elif department.head_user_id != head_user_id and department.secondary_head_user_id != head_user_id:
            # Same department, but this person's Azure manager differs from
            # the head already on record — keep both rather than silently
            # dropping one (see Department.secondary_head_user_id docstring).
            department.secondary_head_user_id = head_user_id
        return department
    code = unique_code(db, Department, name)
    department = Department(branch_id=branch_id, name=name, code=code, head_user_id=head_user_id)
    db.add(department)
    db.flush()
    return department


def unique_code(db: Session, model, base_name: str) -> str:
    """Department/Branch `code` is globally unique but derived from a name
    that can repeat across branches — append `-2`, `-3`, ... on collision
    rather than silently reusing an unrelated row's code."""
    code = base_name
    suffix = 2
    while db.query(model).filter(model.code == code).first():
        code = f"{base_name}-{suffix}"
        suffix += 1
    return code


def sync_user_org_links(db: Session, user: User) -> None:
    """Best-effort: link `user` to a Branch (from office_location) and a
    Department (from department)."""
    branch = None
    if user.office_location:
        branch = _get_or_create_branch(db, user.office_location)
        user.branch_id = branch.id

    if user.department and branch:
        _get_or_create_department(db, branch.id, user.department, user.reporting_manager_id)
