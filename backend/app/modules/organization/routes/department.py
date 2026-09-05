from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.users import require_admin
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.organization.schemas.department import DepartmentCreate, DepartmentUpdate, DepartmentResponse, DepartmentMemberResponse
from app.modules.organization.services.provisioning import unique_code

router = APIRouter(prefix="/organization/departments", tags=["Organization"])


def _to_response(dept: Department, db: Session) -> DepartmentResponse:
    branch = db.query(Branch).filter(Branch.id == dept.branch_id).first() if dept.branch_id else None
    head = db.query(User).filter(User.id == dept.head_user_id).first() if dept.head_user_id else None
    secondary_head = db.query(User).filter(User.id == dept.secondary_head_user_id).first() if dept.secondary_head_user_id else None
    head_names = [h.name for h in (head, secondary_head) if h]
    return DepartmentResponse.model_validate(dept).model_copy(
        update={
            "branch_name": branch.name if branch else None,
            "head_user_name": " / ".join(head_names) if head_names else None,
        }
    )


@router.get("", response_model=list[DepartmentResponse])
async def list_departments(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    departments = db.query(Department).order_by(Department.name.asc()).all()
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
    head_ids = {department.head_user_id, department.secondary_head_user_id} - {None}
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
    db.delete(department)
    db.commit()
