from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.schemas.bank_account import BankAccountCreate, BankAccountUpdate, BankAccountResponse

router = APIRouter(prefix="/accounts/bank-accounts", tags=["Accounts"])


def _to_response(ba: BankAccount, db: Session) -> BankAccountResponse:
    gl = db.query(GLAccount).filter(GLAccount.id == ba.gl_account_id).first() if ba.gl_account_id else None
    return BankAccountResponse.model_validate(ba).model_copy(update={"gl_account_code": gl.code if gl else None})


@router.get("", response_model=list[BankAccountResponse])
async def list_bank_accounts(
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(BankAccount)
    if status is not None:
        query = query.filter(BankAccount.status == status)
    accounts = query.order_by(BankAccount.bank_name.asc()).all()
    return [_to_response(a, db) for a in accounts]


@router.post("", response_model=BankAccountResponse, status_code=201)
async def create_bank_account(
    payload: BankAccountCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    if db.query(BankAccount).filter(BankAccount.account_no == payload.account_no).first():
        raise HTTPException(status_code=409, detail=f"Bank account no. '{payload.account_no}' already exists")
    bank_account = BankAccount(**payload.model_dump(), current_balance=payload.opening_balance)
    db.add(bank_account)
    db.commit()
    db.refresh(bank_account)
    return _to_response(bank_account, db)


@router.patch("/{bank_account_id}", response_model=BankAccountResponse)
async def update_bank_account(
    bank_account_id: int,
    payload: BankAccountUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    bank_account = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not bank_account:
        raise HTTPException(status_code=404, detail="Bank account not found")
    if payload.account_no and payload.account_no != bank_account.account_no:
        if db.query(BankAccount).filter(BankAccount.account_no == payload.account_no, BankAccount.id != bank_account_id).first():
            raise HTTPException(status_code=409, detail=f"Bank account no. '{payload.account_no}' already exists")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(bank_account, field, value)
    db.commit()
    db.refresh(bank_account)
    return _to_response(bank_account, db)


@router.delete("/{bank_account_id}")
async def delete_bank_account(
    bank_account_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    bank_account = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not bank_account:
        raise HTTPException(status_code=404, detail="Bank account not found")
    db.delete(bank_account)
    db.commit()
    return {"ok": True}
