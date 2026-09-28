from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.users import require_admin
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.organization.schemas.department import (
    DepartmentCreate, DepartmentUpdate, DepartmentResponse, DepartmentMemberResponse, DepartmentAddMemberPayload,
)
from app.modules.organization.services.provisioning import unique_code

router = APIRouter(prefix="/organization/departments", tags=["Organization"])


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
    _user: User = Depends(require_admin),
):
    query = db.query(Department)
    if branch_id is not None:
        query = query.filter(Department.branch_id == branch_id)
    departments = query.order_by(Department.name.asc()).all()
    return [_to_response(d, db) for d in departments]


@router.post("", response_model=DepartmentResponse)
async def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    # Department code is just its full name — not a separate abbreviation —
    # deduplicated with a numeric suffix since `code` is globally unique but
    # the same department name can legitimately repeat across branches.
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
    _user: User = Depends(require_admin),
):
    """Users belonging to this department for the tree view — matched by
    the free-text `User.department` string (case-insensitive) scoped to the
    same branch, since a department name can repeat across branches (see
    Department.code docstring/unique_code). The head(s) are always included
    even if they don't match that filter — a manager's own `department`/
    `branch_id` commonly differs from the team they head (e.g. a Unit 1
    manager heading a Unit 2 department), so head_user_id/
    secondary_head_user_id is the source of truth for who the head is."""
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    head_ids = set(_all_head_ids(department))
    members = (
        db.query(User)
        .filter(User.branch_id == department.branch_id, User.department.ilike(department.name))
        .order_by(User.name.asc())
        .all()
    )
    member_ids = {u.id for u in members}
    for head_id in head_ids - member_ids:
        head_user = db.query(User).filter(User.id == head_id).first()
        if head_user:
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
    _user: User = Depends(require_admin),
):
    """Membership is derived from User.department/branch_id (see
    list_department_members docstring), so "adding" a member here means
    reassigning that user onto this department/branch — the same field HR
    edits from its own module, just also editable by an org admin here."""
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.department = department.name
    if department.branch_id:
        user.branch_id = department.branch_id
    db.commit()
    db.refresh(user)
    head_ids = set(_all_head_ids(department))
    return DepartmentMemberResponse(id=user.id, name=user.name, email=user.email, designation=user.designation, is_head=user.id in head_ids)


@router.delete("/{department_id}/members/{user_id}", status_code=204)
async def remove_department_member(
    department_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Removes membership by clearing the user's department field — does not
    touch head_user_id/secondary_head_user_id/additional_head_user_ids, so a
    head stays a head even if pulled off the plain member list this way."""
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    user = db.query(User).filter(User.id == user_id, User.department.ilike(department.name)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User is not a member of this department")
    user.department = None
    db.commit()


@router.patch("/{department_id}", response_model=DepartmentResponse)
async def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(department, field, val)
    db.commit()
    db.refresh(department)
    return _to_response(department, db)


@router.delete("/{department_id}", status_code=204)
async def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    head_ids = set(_all_head_ids(department))
    member_count = db.query(User).filter(
        User.branch_id == department.branch_id, User.department.ilike(department.name)
    ).count()
    if member_count or head_ids:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete department — {member_count} member(s) or head(s) are still assigned to it.",
        )
    db.delete(department)
    db.commit()
