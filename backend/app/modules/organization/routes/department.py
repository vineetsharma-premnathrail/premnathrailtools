from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.db.session import get_db
from app.modules.main.models.user import User
from app.core.permissions import ensure_can_delete, require_tab_action
from app.core.permission_registry import can_view_tab
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.organization.services.department_membership import (
    members_condition, rename_members, set_user_department,
)
from app.modules.organization.schemas.department import (
    DepartmentCreate, DepartmentUpdate, DepartmentResponse, DepartmentMemberResponse, DepartmentAddMemberPayload,
)
from app.modules.organization.services.department_heads import cross_unit_head_error
from app.modules.organization.services.provisioning import unique_code

router = APIRouter(prefix="/organization/departments", tags=["Organization"])


def _department_reader(user: User = Depends(get_current_user)) -> User:
    """Reading the department list: Organization › Department or Branches
    viewers (the Plant pages list a plant's departments), Users viewers (a
    user's plant assignment picks a department), plus Store users —
    the material-return form uses it as a picker (cross-module lookup)."""
    if (can_view_tab(user, "organization", "department") or can_view_tab(user, "organization", "branches")
            or can_view_tab(user, "organization", "users") or "store" in user.get_apps()):
        return user
    raise HTTPException(
        status_code=403,
        detail="You don't have 'View' permission on Organization › Department. "
               "Ask an admin to add it to one of your roles in Organization › Role & Permissions.",
    )


def _all_head_ids(dept: Department) -> list[int]:
    ids = [dept.head_user_id, dept.secondary_head_user_id, *(dept.additional_head_user_ids or [])]
    return [i for i in ids if i]


def _to_response(dept: Department, db: Session) -> DepartmentResponse:
    branch = db.query(Branch).filter(Branch.id == dept.branch_id).first() if dept.branch_id else None
    head_ids = _all_head_ids(dept)
    heads = db.query(User).filter(User.id.in_(head_ids)).all() if head_ids else []
    heads_by_id = {h.id: h for h in heads}
    head_names = [heads_by_id[i].name for i in head_ids if i in heads_by_id]
    return DepartmentResponse.model_validate(dept).model_copy(
        update={
            "branch_name": branch.name if branch else None,
            "head_user_name": " / ".join(head_names) if head_names else None,
        }
    )


@router.get("", response_model=list[DepartmentResponse])
async def list_departments(
    branch_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(_department_reader),
):
    query = db.query(Department)
    if branch_id is not None:
        query = query.filter(Department.branch_id == branch_id)
    departments = query.order_by(Department.name.asc()).all()
    return [_to_response(d, db) for d in departments]


def _sync_hr_profile(db: Session, user: User, department: Department | None) -> None:
    """Keep the HR employee profile (the owner of department / plant once it
    exists) on the same department as the User row. Without this the next HR
    profile save mirrors the OLD department back onto the user
    (hr/services/employee_sync.apply_org_fields), silently undoing this change."""
    from app.modules.hr.models.employee_profile import HrEmployeeProfile

    profile = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == user.id).first()
    if profile is None:
        return
    profile.department_id = department.id if department else None
    if department is not None and department.branch_id:
        profile.branch_id = department.branch_id


@router.post("", response_model=DepartmentResponse)
async def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "department", "create")),
):
    # Department code is just its full name — not a separate abbreviation —
    # deduplicated with a numeric suffix since `code` is globally unique but
    # the same department name can legitimately repeat across branches.
    head_ids = [i for i in [payload.head_user_id, payload.secondary_head_user_id, *(payload.additional_head_user_ids or [])] if i]
    error = cross_unit_head_error(db, payload.branch_id, head_ids)
    if error:
        raise HTTPException(status_code=400, detail=error)
    code = unique_code(db, Department, payload.name.strip())
    department = Department(**payload.model_dump(), code=code)
    db.add(department)
    db.commit()
    db.refresh(department)
    return _to_response(department, db)


@router.get("/{department_id}/members", response_model=list[DepartmentMemberResponse])
async def list_department_members(
    department_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "department", "view")),
):
    """Users belonging to this department for the tree view — linked by
    User.department_id, or (not linked yet) by the department's name at its
    plant (services/department_membership.py). Heads of the same unit are
    included even if their own `department` string differs (e.g. a plant
    manager heading Stores); heads from another unit are never shown — a
    department is only headed from its own unit (services/department_heads.py)."""
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    head_ids = set(_all_head_ids(department))
    members = db.query(User).filter(members_condition(department)).order_by(User.name.asc()).all()
    member_ids = {u.id for u in members}
    for head_id in head_ids - member_ids:
        head_user = db.query(User).filter(User.id == head_id).first()
        if head_user and (not department.branch_id or head_user.branch_id == department.branch_id):
            members.append(head_user)
    return [
        DepartmentMemberResponse(id=u.id, name=u.name, email=u.email, designation=u.designation, is_head=u.id in head_ids)
        for u in members
    ]


@router.post("/{department_id}/members", response_model=DepartmentMemberResponse, status_code=201)
async def add_department_member(
    department_id: int,
    payload: DepartmentAddMemberPayload,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "department", "edit")),
):
    """Membership is User.department_id (see list_department_members
    docstring), so "adding" a member here means reassigning that user onto
    this department/branch — the same field HR
    edits from its own module, just also editable by an org admin here."""
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    before = {"department": user.department, "branch_id": user.branch_id}
    set_user_department(user, department)
    if department.branch_id:
        user.branch_id = department.branch_id
    _sync_hr_profile(db, user, department)
    # Department/Branch edits are audited automatically (app/core/audit.py),
    # but membership lives on the users table, so log it explicitly.
    record_audit(
        db, entity_type="department", entity_id=department.id, action="member_added", module_key="organization",
        summary=f"{user.name or user.email} added to department '{department.name}' (was: {before['department'] or '—'}).",
        old_value=before, new_value={"user_id": user.id, "department": user.department, "branch_id": user.branch_id},
    )
    db.commit()
    db.refresh(user)
    head_ids = set(_all_head_ids(department))
    return DepartmentMemberResponse(id=user.id, name=user.name, email=user.email, designation=user.designation, is_head=user.id in head_ids)


@router.delete("/{department_id}/members/{user_id}", status_code=204)
async def remove_department_member(
    department_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "department", "edit")),
):
    """Removes membership by clearing the user's department field — does not
    touch head_user_id/secondary_head_user_id/additional_head_user_ids, so a
    head stays a head even if pulled off the plain member list this way."""
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    user = db.query(User).filter(User.id == user_id, members_condition(department)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User is not a member of this department")
    set_user_department(user, None)
    _sync_hr_profile(db, user, None)
    record_audit(
        db, entity_type="department", entity_id=department.id, action="member_removed", module_key="organization",
        summary=f"{user.name or user.email} removed from department '{department.name}'.",
        old_value={"user_id": user.id, "department": department.name}, new_value={"user_id": user.id, "department": None},
    )
    db.commit()


@router.patch("/{department_id}", response_model=DepartmentResponse)
async def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "department", "edit")),
):
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    changes = payload.model_dump(exclude_unset=True)
    for field, val in changes.items():
        setattr(department, field, val)
    if "name" in changes:
        rename_members(db, department)
    if changes.keys() & {"branch_id", "head_user_id", "secondary_head_user_id", "additional_head_user_ids"}:
        error = cross_unit_head_error(db, department.branch_id, _all_head_ids(department))
        if error:
            db.rollback()
            raise HTTPException(status_code=400, detail=error)
    db.commit()
    db.refresh(department)
    return _to_response(department, db)


@router.delete("/{department_id}", status_code=204)
async def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    ensure_can_delete(_user, department, "organization", "department", what="department")
    member_count = db.query(User).filter(members_condition(department)).count()
    problems = []
    if member_count:
        problems.append(
            f"{member_count} member(s) still belong to it — move them to another department in "
            "Organization > Department > Members"
        )
    head_ids = _all_head_ids(department)
    if head_ids:
        heads = db.query(User).filter(User.id.in_(head_ids)).all()
        names = ", ".join(h.name for h in heads) or f"{len(head_ids)} user(s)"
        problems.append(
            f"{names} {'is' if len(head_ids) == 1 else 'are'} set as head — clear the head fields first"
        )
    if problems:
        raise HTTPException(
            status_code=409,
            detail=f"Can't delete department '{department.name}': {'; '.join(problems)}.",
        )
    in_use = _department_usage(db, department_id)
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Can't delete department '{department.name}' — it is used by {', '.join(in_use)}. "
                "Departments that have been used are kept for history; remove them from those records "
                "or leave the department in place."
            ),
        )
    db.delete(department)
    db.commit()


# Friendly labels for tables that reference departments.id. Any table not
# listed (e.g. a module added later) is still counted, labelled by its name.
_DEPARTMENT_USE_LABELS = {
    "cost_centers": "cost center(s)",
    "branch_user_assignments": "plant user assignment(s)",
    "hr_employee_profiles": "employee profile(s)",
    "hr_designations": "HR designation(s)",
    "hr_lifecycle_events": "employee transfer/lifecycle event(s)",
    "design_documents": "design document(s)",
    "maintenance_assets": "maintenance asset(s)",
    "production_workstations": "production workstation(s)",
    "pm_project_milestones": "project WBS element(s)",
    "store_material_issues": "material issue(s)",
    "store_material_returns": "material return(s)",
}


def _department_usage(db: Session, department_id: int) -> list[str]:
    """'<n> <label>' for every table with rows pointing at this department —
    discovered from the FK metadata so no other module's code is touched."""
    from sqlalchemy import func, inspect as sa_inspect, or_
    from app.db.base import Base

    existing_tables = set(sa_inspect(db.get_bind()).get_table_names())
    cols_by_table: dict[str, list] = {}
    for table in Base.metadata.tables.values():
        if table.name not in existing_tables:
            continue
        for fk in table.foreign_keys:
            if fk.target_fullname == "departments.id":
                cols_by_table.setdefault(table.name, []).append(fk.parent)
    usage = []
    for name in sorted(cols_by_table, key=lambda n: (n not in _DEPARTMENT_USE_LABELS, n)):
        cols = cols_by_table[name]
        n = db.query(func.count()).select_from(cols[0].table).filter(or_(*[c == department_id for c in cols])).scalar()
        if n:
            usage.append(f"{n} {_DEPARTMENT_USE_LABELS.get(name, name.replace('_', ' ') + ' record(s)')}")
    return usage
