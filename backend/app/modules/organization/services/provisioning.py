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
    it has no head at all; once any head exists, sync never adds or swaps
    heads, so admin edits made via the Organization > Department screen
    stick.
  - A Department's `code` is just its full name (not an abbreviation) per
    product decision; since `code` is globally unique but two branches can
    have same-named departments, a numeric suffix is appended on collision.
  - A BranchUserAssignment row is auto-created the first time a user is
    linked to a branch this way, so Organization > Users > Assignments isn't
    empty for everyone by default. Only created once per (user, branch) —
    never touched again after that, so admin edits on the Assignments tab
    (employee ID, role, access level, etc.) stick.
"""
from datetime import date

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
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
        # Only seed a head into a department that has none at all. Once any
        # head is on record the admin owns the list (Organization > Department)
        # — sync must never add, swap or re-add heads, otherwise whichever
        # user syncs last decides the secondary head and admin removals
        # come back on the next sync.
        has_head = department.head_user_id or department.secondary_head_user_id or department.additional_head_user_ids
        if head_user_id and not has_head:
            department.head_user_id = head_user_id
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


def _ensure_branch_assignment(db: Session, user: User, branch_id: int, department_id: int | None) -> None:
    exists = db.query(BranchUserAssignment).filter(
        BranchUserAssignment.user_id == user.id, BranchUserAssignment.branch_id == branch_id,
    ).first()
    if exists:
        return
    is_primary = not db.query(BranchUserAssignment).filter(
        BranchUserAssignment.user_id == user.id, BranchUserAssignment.is_primary_branch == True,  # noqa: E712
    ).first()
    db.add(BranchUserAssignment(
        branch_id=branch_id,
        user_id=user.id,
        department_id=department_id,
        designation=user.designation,
        is_primary_branch=is_primary,
        effective_from=date.today(),
        status="active",
    ))


def _user_branch_id(db: Session, user_id: int | None) -> int | None:
    """The unit a user is posted in, as this sync will leave it: HR-locked
    users keep their branch_id; everyone else is (re)linked from their Azure
    office location, which may not be applied to their row yet during a bulk
    sync."""
    from app.modules.hr.services.employee_sync import is_org_locked
    if not user_id:
        return None
    other = db.get(User, user_id)
    if not other:
        return None
    if is_org_locked(db, other.id) or not other.office_location:
        return other.branch_id
    branch = db.query(Branch).filter(Branch.name.ilike(other.office_location.strip())).first()
    return branch.id if branch else other.branch_id


def sync_user_org_links(db: Session, user: User) -> None:
    """Best-effort: link `user` to a Branch (from office_location) and a
    Department (from department)."""
    # An HR employee profile with org_fields_locked owns the user's plant and
    # department — Azure's office location must not re-link them.
    from app.modules.hr.services.employee_sync import is_org_locked
    if is_org_locked(db, user.id):
        return
    branch = None
    if user.office_location:
        branch = _get_or_create_branch(db, user.office_location)
        user.branch_id = branch.id

    department = None
    if user.department and branch:
        # The Azure manager only seeds the head when posted in the same unit
        # (services/department_heads.py) — a Unit 1 reportee of a Unit 2
        # manager must not make that manager head of a Unit 1 department.
        head_id = user.reporting_manager_id if _user_branch_id(db, user.reporting_manager_id) == branch.id else None
        department = _get_or_create_department(db, branch.id, user.department, head_id)

    if branch:
        _ensure_branch_assignment(db, user, branch.id, department.id if department else None)
