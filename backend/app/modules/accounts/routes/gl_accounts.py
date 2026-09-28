from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount, GL_ACCOUNT_TYPES
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.schemas.gl_account import GLAccountCreate, GLAccountUpdate, GLAccountResponse
from app.modules.accounts.schemas.journal_entry import GLAccountBalanceResponse

router = APIRouter(prefix="/accounts/gl-accounts", tags=["Accounts"])


@router.get("", response_model=list[GLAccountResponse])
async def list_gl_accounts(
    account_type: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(GLAccount)
    if account_type is not None:
        query = query.filter(GLAccount.account_type == account_type)
    if status is not None:
        query = query.filter(GLAccount.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter((GLAccount.code.ilike(like)) | (GLAccount.name.ilike(like)))
    return query.order_by(GLAccount.code.asc()).all()


@router.get("/{gl_account_id}/balance", response_model=GLAccountBalanceResponse)
async def get_gl_account_balance(
    gl_account_id: int,
    period: str | None = Query(None, description="YYYY-MM, defaults to the current month"),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    if not db.query(GLAccount).filter(GLAccount.id == gl_account_id).first():
        raise HTTPException(status_code=404, detail="GL account not found")
    period = period or date.today().strftime("%Y-%m")
    balance = db.query(GLBalance).filter(GLBalance.gl_account_id == gl_account_id, GLBalance.accounting_period == period).first()
    if not balance:
        return GLAccountBalanceResponse(
            gl_account_id=gl_account_id, accounting_period=period,
            opening_balance=0, total_debits=0, total_credits=0, closing_balance=0, is_locked=False,
        )
    return GLAccountBalanceResponse.model_validate(balance)


@router.post("", response_model=GLAccountResponse, status_code=201)
async def create_gl_account(
    payload: GLAccountCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    if payload.account_type not in GL_ACCOUNT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid account_type '{payload.account_type}'")
    if db.query(GLAccount).filter(GLAccount.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"GL account code '{payload.code}' already exists")
    gl_account = GLAccount(**payload.model_dump())
    db.add(gl_account)
    db.commit()
    db.refresh(gl_account)
    return gl_account


@router.patch("/{gl_account_id}", response_model=GLAccountResponse)
async def update_gl_account(
    gl_account_id: int,
    payload: GLAccountUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    gl_account = db.query(GLAccount).filter(GLAccount.id == gl_account_id).first()
    if not gl_account:
        raise HTTPException(status_code=404, detail="GL account not found")
    if payload.account_type is not None and payload.account_type not in GL_ACCOUNT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid account_type '{payload.account_type}'")
    if payload.code and payload.code != gl_account.code:
        if db.query(GLAccount).filter(GLAccount.code == payload.code, GLAccount.id != gl_account_id).first():
            raise HTTPException(status_code=409, detail=f"GL account code '{payload.code}' already exists")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(gl_account, field, value)
    db.commit()
    db.refresh(gl_account)
    return gl_account


@router.delete("/{gl_account_id}")
async def delete_gl_account(
    gl_account_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    gl_account = db.query(GLAccount).filter(GLAccount.id == gl_account_id).first()
    if not gl_account:
        raise HTTPException(status_code=404, detail="GL account not found")
    from app.modules.accounts.models.bank_account import BankAccount
    from app.modules.accounts.models.vendor import Vendor
    from app.modules.accounts.models.internal_order import InternalOrder
    from app.modules.organization.models.cost_center import CostCenter
    from app.modules.crm.models.organization import Organization
    referencing = (
        db.query(BankAccount).filter(BankAccount.gl_account_id == gl_account_id).first()
        or db.query(Vendor).filter(Vendor.gl_reconciliation_account_id == gl_account_id).first()
        or db.query(InternalOrder).filter(InternalOrder.gl_account_id == gl_account_id).first()
        or db.query(CostCenter).filter(CostCenter.gl_account_id == gl_account_id).first()
        or db.query(Organization).filter(Organization.gl_reconciliation_account_id == gl_account_id).first()
    )
    if referencing:
        raise HTTPException(status_code=409, detail="Cannot delete — this GL account is referenced elsewhere. Set it to inactive instead.")
    db.delete(gl_account)
    db.commit()
    return {"ok": True}
