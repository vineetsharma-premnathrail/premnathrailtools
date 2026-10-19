from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action, ensure_can_delete
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.bank_account import BankAccount, BANK_ACCOUNT_KINDS
from app.modules.accounts.schemas.bank_account import BankAccountCreate, BankAccountUpdate, BankAccountResponse
from app.modules.accounts.service import bank_book_balance

router = APIRouter(prefix="/accounts/bank-accounts", tags=["Accounts"])


def _to_response(ba: BankAccount, db: Session) -> BankAccountResponse:
    gl = db.query(GLAccount).filter(GLAccount.id == ba.gl_account_id).first() if ba.gl_account_id else None
    balance = bank_book_balance(db, ba, date.today())
    return BankAccountResponse.model_validate(ba).model_copy(update={
        "gl_account_code": gl.code if gl else None, "book_balance": balance, "current_balance": balance,
    })


def _validate(db: Session, data: dict, bank_account_id: int | None = None) -> dict:
    kind = data.get("account_kind") or "bank"
    if kind not in BANK_ACCOUNT_KINDS:
        raise HTTPException(status_code=400, detail="Account kind must be 'bank' or 'cash'.")
    if kind == "bank" and "account_no" in data and not (data.get("account_no") or "").strip():
        raise HTTPException(status_code=400, detail="A bank account needs its account number.")
    if data.get("account_no"):
        data["account_no"] = data["account_no"].strip()
        dup = db.query(BankAccount).filter(BankAccount.account_no == data["account_no"])
        if bank_account_id:
            dup = dup.filter(BankAccount.id != bank_account_id)
        if dup.first():
            raise HTTPException(status_code=409, detail=f"Account no. '{data['account_no']}' already exists")
    elif "account_no" in data:
        data["account_no"] = None
    if data.get("gl_account_id"):
        gl = db.query(GLAccount).filter(GLAccount.id == data["gl_account_id"]).first()
        if not gl or gl.account_type != "asset" or not gl.is_posting_account:
            raise HTTPException(status_code=400, detail="Link an asset posting ledger (under Bank Accounts or Cash-in-Hand).")
        other = db.query(BankAccount).filter(BankAccount.gl_account_id == gl.id)
        if bank_account_id:
            other = other.filter(BankAccount.id != bank_account_id)
        if other.first():
            raise HTTPException(status_code=409, detail=f"Ledger '{gl.code} — {gl.name}' is already linked to another bank/cash account — each account needs its own ledger, or the two balances merge.")
    return data


# Shared lookup: pickers on many Finance tabs read this, so any Finance user
# may list it; writes are gated per tab below.
@router.get("", response_model=list[BankAccountResponse])
async def list_bank_accounts(
    status: str | None = Query(None),
    account_kind: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(BankAccount)
    if status is not None:
        query = query.filter(BankAccount.status == status)
    if account_kind is not None:
        query = query.filter(BankAccount.account_kind == account_kind)
    accounts = query.order_by(BankAccount.account_kind.asc(), BankAccount.bank_name.asc()).all()
    return [_to_response(a, db) for a in accounts]


@router.post("", response_model=BankAccountResponse, status_code=201)
async def create_bank_account(
    payload: BankAccountCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("accounts", "bank_cash_accounts", "create")),
):
    data = _validate(db, payload.model_dump())
    if not data.get("gl_account_id"):
        raise HTTPException(status_code=400, detail="Link the GL ledger this account posts to — its balance in the books is that ledger's balance.")
    bank_account = BankAccount(**data, current_balance=0)
    db.add(bank_account)
    db.commit()
    db.refresh(bank_account)
    return _to_response(bank_account, db)


@router.patch("/{bank_account_id}", response_model=BankAccountResponse)
async def update_bank_account(
    bank_account_id: int,
    payload: BankAccountUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("accounts", "bank_cash_accounts", "edit")),
):
    bank_account = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not bank_account:
        raise HTTPException(status_code=404, detail="Bank account not found")
    data = payload.model_dump(exclude_unset=True)
    data.setdefault("account_kind", bank_account.account_kind)
    data = _validate(db, data, bank_account_id)
    if "gl_account_id" in data and data["gl_account_id"] != bank_account.gl_account_id:
        from app.modules.accounts.models.payment_transaction import PaymentTransaction
        if db.query(PaymentTransaction).filter((PaymentTransaction.bank_account_id == bank_account_id) | (PaymentTransaction.counter_bank_account_id == bank_account_id)).first():
            raise HTTPException(status_code=409, detail="This account already has vouchers, so its ledger can't change — past entries would stay on the old ledger.")
    for field, value in data.items():
        setattr(bank_account, field, value)
    db.commit()
    db.refresh(bank_account)
    return _to_response(bank_account, db)


@router.delete("/{bank_account_id}")
async def delete_bank_account(
    bank_account_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "bank_cash_accounts")),
):
    bank_account = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not bank_account:
        raise HTTPException(status_code=404, detail="Bank account not found")
    ensure_can_delete(user, bank_account, "accounts", "bank_cash_accounts", what="bank/cash account")
    from app.modules.accounts.models.payment_transaction import PaymentTransaction
    if db.query(PaymentTransaction).filter((PaymentTransaction.bank_account_id == bank_account_id) | (PaymentTransaction.counter_bank_account_id == bank_account_id)).first():
        raise HTTPException(status_code=409, detail=f"'{bank_account.bank_name}' has vouchers, so it can't be deleted — set its status to closed instead.")
    db.delete(bank_account)
    db.commit()
    return {"ok": True}
