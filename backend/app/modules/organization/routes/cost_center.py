from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.users import require_admin
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.organization.models.cost_center import CostCenter
from app.modules.organization.schemas.cost_center import CostCenterCreate, CostCenterUpdate, CostCenterResponse
from app.modules.accounts.models.gl_account import GLAccount

router = APIRouter(prefix="/organization/cost-centers", tags=["Organization"])


def _to_response(cc: CostCenter, db: Session) -> CostCenterResponse:
    branch = db.query(Branch).filter(Branch.id == cc.branch_id).first() if cc.branch_id else None
    dept = db.query(Department).filter(Department.id == cc.department_id).first() if cc.department_id else None
    head = db.query(User).filter(User.id == cc.head_user_id).first() if cc.head_user_id else None
    parent = db.query(CostCenter).filter(CostCenter.id == cc.parent_cost_center_id).first() if cc.parent_cost_center_id else None
    gl_account = db.query(GLAccount).filter(GLAccount.id == cc.gl_account_id).first() if cc.gl_account_id else None
    return CostCenterResponse.model_validate(cc).model_copy(
        update={
            "branch_name": branch.name if branch else None,
            "department_name": dept.name if dept else None,
            "head_user_name": head.name if head else None,
            "parent_cost_center_name": parent.name if parent else None,
            "gl_account_code": gl_account.code if gl_account else None,
        }
    )


@router.get("", response_model=list[CostCenterResponse])
async def list_cost_centers(
    branch_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    query = db.query(CostCenter)
    if branch_id is not None:
        query = query.filter(CostCenter.branch_id == branch_id)
    cost_centers = query.order_by(CostCenter.name.asc()).all()
    return [_to_response(cc, db) for cc in cost_centers]


@router.post("", response_model=CostCenterResponse, status_code=201)
async def create_cost_center(
    payload: CostCenterCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    if db.query(CostCenter).filter(CostCenter.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Cost center code '{payload.code}' already exists")
    cost_center = CostCenter(**payload.model_dump())
    db.add(cost_center)
    db.commit()
    db.refresh(cost_center)
    return _to_response(cost_center, db)


@router.patch("/{cost_center_id}", response_model=CostCenterResponse)
async def update_cost_center(
    cost_center_id: int,
    payload: CostCenterUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    cost_center = db.query(CostCenter).filter(CostCenter.id == cost_center_id).first()
    if not cost_center:
        raise HTTPException(status_code=404, detail="Cost center not found")
    if payload.code and payload.code != cost_center.code:
        if db.query(CostCenter).filter(CostCenter.code == payload.code, CostCenter.id != cost_center_id).first():
            raise HTTPException(status_code=409, detail=f"Cost center code '{payload.code}' already exists")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cost_center, field, value)
    db.commit()
    db.refresh(cost_center)
    return _to_response(cost_center, db)


@router.delete("/{cost_center_id}")
async def delete_cost_center(
    cost_center_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    cost_center = db.query(CostCenter).filter(CostCenter.id == cost_center_id).first()
    if not cost_center:
        raise HTTPException(status_code=404, detail="Cost center not found")
    if db.query(Branch).filter(Branch.default_cost_center_id == cost_center_id).first():
        raise HTTPException(status_code=409, detail="Cannot delete — this cost center is set as a branch's default cost center.")
    if db.query(CostCenter).filter(CostCenter.parent_cost_center_id == cost_center_id).first():
        raise HTTPException(status_code=409, detail="Cannot delete — other cost centers reference this one as their parent.")
    db.delete(cost_center)
    db.commit()
    return {"ok": True}
