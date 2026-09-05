from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.users import require_admin
from app.modules.organization.models.branch import Branch
from app.modules.organization.schemas.branch import BranchCreate, BranchUpdate, BranchResponse

router = APIRouter(prefix="/organization/branches", tags=["Organization"])


def _to_response(branch: Branch, db: Session) -> BranchResponse:
    return BranchResponse.model_validate(branch)


@router.get("", response_model=list[BranchResponse])
async def list_branches(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    branches = db.query(Branch).order_by(Branch.name.asc()).all()
    return [_to_response(b, db) for b in branches]


@router.post("", response_model=BranchResponse)
async def create_branch(
    payload: BranchCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    if db.query(Branch).filter(Branch.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Branch code '{payload.code}' already exists")
    branch = Branch(**payload.model_dump())
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return _to_response(branch, db)


@router.patch("/{branch_id}", response_model=BranchResponse)
async def update_branch(
    branch_id: int,
    payload: BranchUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(branch, field, val)
    db.commit()
    db.refresh(branch)
    return _to_response(branch, db)


@router.delete("/{branch_id}", status_code=204)
async def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    db.delete(branch)
    db.commit()
