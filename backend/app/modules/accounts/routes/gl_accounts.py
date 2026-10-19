from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action, ensure_can_delete
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount, GL_ACCOUNT_TYPES
from app.modules.accounts.models.account_group import AccountGroup
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.schemas.gl_account import GLAccountCreate, GLAccountUpdate, GLAccountResponse
from app.modules.accounts.schemas.journal_entry import GLAccountBalanceResponse

router = APIRouter(prefix="/accounts/gl-accounts", tags=["Accounts"])


def _to_response(a: GLAccount, groups: dict) -> GLAccountResponse:
    g = groups.get(a.group_id)
    return GLAccountResponse.model_validate(a).model_copy(update={"group_name": g.name if g else None})


def _groups(db: Session) -> dict:
    return {g.id: g for g in db.query(AccountGroup).all()}


def _apply_group(db: Session, data: dict) -> dict:
    """The group decides the account type — a ledger under Sundry Debtors is
    an asset, full stop — so the two can never disagree."""
    if data.get("group_id"):
        group = db.query(AccountGroup).filter(AccountGroup.id == data["group_id"]).first()
        if not group:
            raise HTTPException(status_code=400, detail="Account group not found.")
        data["account_type"] = group.nature
    elif "group_id" in data and data["group_id"] is None:
        raise HTTPException(status_code=400, detail="Pick the account group this ledger belongs to — it decides where the ledger shows in the Balance Sheet / P&L.")
    if data.get("account_type") is not None and data["account_type"] not in GL_ACCOUNT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid account_type '{data['account_type']}'")
    return data


_COST_OBJECT_HEADS = ("other_expenses", "employee_benefits")


def _apply_cost_object(db: Session, data: dict, existing: GLAccount | None = None) -> dict:
    """Controlling settings on a ledger (services/controlling.py). A new
    overhead ledger (Other Expenses / Employee Benefits, posting, not a
    control account) needs a cost object unless the form says otherwise."""
    from app.modules.organization.models.cost_center import CostCenter

    account_type = data.get("account_type") or (existing.account_type if existing else None)
    if "cost_object_required" in data and data["cost_object_required"] is None:
        if existing is not None:
            data.pop("cost_object_required")
        else:
            group = db.query(AccountGroup).filter(AccountGroup.id == data.get("group_id")).first() if data.get("group_id") else None
            data["cost_object_required"] = bool(
                account_type == "expense" and group is not None and group.schedule_iii_head in _COST_OBJECT_HEADS
                and data.get("is_posting_account", True) and not data.get("is_control_account"))
    if data.get("cost_object_required") and account_type not in ("expense", "revenue"):
        raise HTTPException(status_code=400, detail="Only a P&L ledger (income or expense) can require a cost centre — untick 'Cost object required' for a balance-sheet ledger.")
    if data.get("default_cost_center_id"):
        cc = db.query(CostCenter).filter(CostCenter.id == data["default_cost_center_id"]).first()
        if not cc:
            raise HTTPException(status_code=400, detail="The default cost centre doesn't exist — pick it again from the list.")
        if cc.status != "active":
            raise HTTPException(status_code=400, detail=f"Cost centre '{cc.code} — {cc.name}' is {cc.status} — pick an active one as the ledger's default.")
        if account_type not in ("expense", "revenue"):
            raise HTTPException(status_code=400, detail="Only a P&L ledger (income or expense) can have a default cost centre.")
    return data


# Shared lookup: pickers on many Finance tabs read this, so any Finance user
# may list it; writes are gated per tab below.
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
    groups = _groups(db)
    return [_to_response(a, groups) for a in query.order_by(GLAccount.code.asc()).all()]


# Shared lookup: pickers on many Finance tabs read this, so any Finance user
# may list it; writes are gated per tab below.
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
    _user: User = Depends(require_tab_action("accounts", "ledgers", "create")),
):
    data = _apply_group(db, payload.model_dump())
    if not data.get("group_id"):
        raise HTTPException(status_code=400, detail="Pick the account group this ledger belongs to — it decides where the ledger shows in the Balance Sheet / P&L.")
    if db.query(GLAccount).filter(GLAccount.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"GL account code '{payload.code}' already exists")
    data = _apply_cost_object(db, data)
    gl_account = GLAccount(**data)
    db.add(gl_account)
    db.commit()
    db.refresh(gl_account)
    return _to_response(gl_account, _groups(db))


@router.patch("/{gl_account_id}", response_model=GLAccountResponse)
async def update_gl_account(
    gl_account_id: int,
    payload: GLAccountUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("accounts", "ledgers", "edit")),
):
    gl_account = db.query(GLAccount).filter(GLAccount.id == gl_account_id).first()
    if not gl_account:
        raise HTTPException(status_code=404, detail="GL account not found")
    data = _apply_cost_object(db, _apply_group(db, payload.model_dump(exclude_unset=True)), gl_account)
    from app.modules.accounts.models.journal_entry import JournalEntryLine
    if ("account_type" in data and data["account_type"] != gl_account.account_type
            and db.query(JournalEntryLine).filter(JournalEntryLine.gl_account_id == gl_account_id).first()):
        raise HTTPException(status_code=409, detail=f"'{gl_account.name}' already has postings, so it can't move from {gl_account.account_type} to {data['account_type']} — that would silently restate past statements. Create a new ledger and transfer the balance with a journal.")
    for flag, label in (("is_posting_account", "posting/group"), ("is_control_account", "party control")):
        if (flag in data and data[flag] is not None and bool(data[flag]) != bool(getattr(gl_account, flag))
                and db.query(JournalEntryLine).filter(JournalEntryLine.gl_account_id == gl_account_id).first()):
            raise HTTPException(status_code=409, detail=(
                f"'{gl_account.code} — {gl_account.name}' already has postings, so its {label} setting can't change — "
                f"a group ledger can't hold a balance, and a control ledger's balance must equal its party ledgers. "
                f"Create a new ledger with the setting you need and move the balance across with a journal."
            ))
    if payload.code and payload.code != gl_account.code:
        if db.query(GLAccount).filter(GLAccount.code == payload.code, GLAccount.id != gl_account_id).first():
            raise HTTPException(status_code=409, detail=f"GL account code '{payload.code}' already exists")
    for field, value in data.items():
        setattr(gl_account, field, value)
    db.commit()
    db.refresh(gl_account)
    return _to_response(gl_account, _groups(db))


@router.delete("/{gl_account_id}")
async def delete_gl_account(
    gl_account_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "ledgers")),
):
    gl_account = db.query(GLAccount).filter(GLAccount.id == gl_account_id).first()
    if not gl_account:
        raise HTTPException(status_code=404, detail="GL account not found")
    ensure_can_delete(user, gl_account, "accounts", "ledgers", what="ledger")
    from app.modules.accounts.models.bank_account import BankAccount
    from app.modules.accounts.models.vendor import Vendor
    from app.modules.accounts.models.internal_order import InternalOrder
    from app.modules.organization.models.cost_center import CostCenter
    from app.modules.crm.models.organization import Organization
    from app.modules.accounts.models.journal_entry import JournalEntryLine
    from app.modules.accounts.models.settings import AccountDetermination
    if db.query(JournalEntryLine).filter(JournalEntryLine.gl_account_id == gl_account_id).first():
        raise HTTPException(status_code=409, detail=f"'{gl_account.name}' has postings, so it can't be deleted — set it to inactive instead.")
    referencing = (
        db.query(AccountDetermination).filter(AccountDetermination.gl_account_id == gl_account_id).first()
        or db.query(BankAccount).filter(BankAccount.gl_account_id == gl_account_id).first()
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
