"""Company & financial-year view, chart-of-accounts groups, ledger
determination, GST rates, opening balances and the balance rebuild."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action, ensure_can_delete
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.account_group import AccountGroup, SCHEDULE_III_HEADS
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.settings import AccountDetermination, GSTRate, LEDGER_ROLES
from app.modules.accounts.schemas.settings import (
    AccountGroupCreate, AccountGroupUpdate, AccountGroupResponse, LedgerSettingUpdate, LedgerSettingResponse,
    GSTRateCreate, GSTRateUpdate, GSTRateResponse, AccountsSetupResponse, FinancialYearInfo, CompanyGSTInfo,
)
from app.modules.accounts.schemas.journal_entry import OpeningBalancesCreate
from app.modules.accounts.services import fiscal, gst
from app.modules.accounts.services.balances import rebuild_gl_balances
from app.modules.accounts.services.opening import post_opening_balances
from app.modules.accounts.routes._common import write_audit, who, service_errors, require_finance_manager

router = APIRouter(prefix="/accounts", tags=["Accounts"])


# ── Company & financial year ────────────────────────────────────────────

# Shared lookup: pickers on many Finance tabs read this, so any Finance user
# may list it; writes are gated per tab below.
@router.get("/setup", response_model=AccountsSetupResponse)
async def get_setup(db: Session = Depends(get_db), _user: User = Depends(require_app_access("accounts"))):
    from app.modules.organization.models.company_financial_year import CompanyFinancialYear

    warnings = []
    years = [FinancialYearInfo(code=fiscal.fy_code(y.start_date, y.end_date), start_date=y.start_date, end_date=y.end_date,
                               status=(y.status or "open").lower(), lock_date=y.lock_date, is_defined=True)
             for y in db.query(CompanyFinancialYear).order_by(CompanyFinancialYear.start_date.desc()).all()]
    try:
        cur = fiscal.fiscal_year_for(db, date.today())
        current = FinancialYearInfo(code=cur.code, start_date=cur.start_date, end_date=cur.end_date, status=cur.status,
                                    lock_date=cur.lock_date, is_defined=cur.record_id is not None)
        if cur.record_id is None:
            warnings.append(f"No financial years are set up, so the statutory April–March year ({cur.code}) is assumed. Add them under Company Info > Financial Years.")
    except ValueError as e:
        current = None
        warnings.append(str(e))
    gstin, state = gst.company_gst_profile(db)
    if not state:
        warnings.append("The company GSTIN isn't set, so CGST/SGST vs IGST can't be worked out on invoices. Enter it under Company Info > Legal & Tax.")
    return AccountsSetupResponse(
        current_financial_year=current, financial_years=years,
        company_gst=CompanyGSTInfo(gstin=gstin, state_code=state, state_name=gst.GST_STATE_CODES.get(state) if state else None),
        state_codes=gst.GST_STATE_CODES, schedule_iii_heads=SCHEDULE_III_HEADS, warnings=warnings,
    )


# ── Account groups ──────────────────────────────────────────────────────

def _group_response(g: AccountGroup, groups: dict, counts: dict) -> AccountGroupResponse:
    parent = groups.get(g.parent_id)
    return AccountGroupResponse.model_validate(g).model_copy(update={
        "parent_name": parent.name if parent else None, "schedule_iii_label": SCHEDULE_III_HEADS.get(g.schedule_iii_head),
        "ledger_count": counts.get(g.id, 0),
    })


# Shared lookup: pickers on many Finance tabs read this, so any Finance user
# may list it; writes are gated per tab below.
@router.get("/account-groups", response_model=list[AccountGroupResponse])
async def list_account_groups(db: Session = Depends(get_db), _user: User = Depends(require_app_access("accounts"))):
    groups = {g.id: g for g in db.query(AccountGroup).order_by(AccountGroup.sequence.asc(), AccountGroup.name.asc()).all()}
    counts = dict(db.query(GLAccount.group_id, func.count(GLAccount.id)).group_by(GLAccount.group_id).all())
    return [_group_response(g, groups, counts) for g in groups.values()]


@router.post("/account-groups", response_model=AccountGroupResponse, status_code=201)
async def create_account_group(payload: AccountGroupCreate, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", "account_groups", "create"))):
    """A sub-group always inherits its parent's nature (asset/liability/...);
    its Schedule III head defaults to the parent's."""
    parent = db.query(AccountGroup).filter(AccountGroup.id == payload.parent_id).first()
    if not parent:
        raise HTTPException(status_code=400, detail="Parent group not found — every new group sits under an existing one.")
    if db.query(AccountGroup).filter(AccountGroup.code == payload.code.strip()).first():
        raise HTTPException(status_code=409, detail=f"Group code '{payload.code}' already exists.")
    head = payload.schedule_iii_head or parent.schedule_iii_head
    if head not in SCHEDULE_III_HEADS:
        raise HTTPException(status_code=400, detail=f"Unknown Schedule III head '{head}'.")
    group = AccountGroup(code=payload.code.strip(), name=payload.name.strip(), parent_id=parent.id, nature=parent.nature,
                         schedule_iii_head=head, affects_gross_profit=parent.affects_gross_profit if payload.affects_gross_profit is None else payload.affects_gross_profit,
                         sequence=payload.sequence, is_system=False)
    db.add(group)
    write_audit(db, "account_group", None, "created", user, f"{who(user)} created account group '{group.name}' under '{parent.name}'.")
    db.commit()
    groups = {g.id: g for g in db.query(AccountGroup).all()}
    return _group_response(group, groups, {})


@router.patch("/account-groups/{group_id}", response_model=AccountGroupResponse)
async def update_account_group(group_id: int, payload: AccountGroupUpdate, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", "account_groups", "edit"))):
    group = db.query(AccountGroup).filter(AccountGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Account group not found")
    data = payload.model_dump(exclude_unset=True)
    if "schedule_iii_head" in data:
        if data["schedule_iii_head"] not in SCHEDULE_III_HEADS:
            raise HTTPException(status_code=400, detail=f"Unknown Schedule III head '{data['schedule_iii_head']}'.")
        if group.is_system:
            raise HTTPException(status_code=400, detail="A standard group's Schedule III head is fixed — create a sub-group with its own head instead.")
    for k, v in data.items():
        setattr(group, k, v)
    write_audit(db, "account_group", group.id, "updated", user, f"{who(user)} updated account group '{group.name}'.")
    db.commit()
    groups = {g.id: g for g in db.query(AccountGroup).all()}
    counts = dict(db.query(GLAccount.group_id, func.count(GLAccount.id)).group_by(GLAccount.group_id).all())
    return _group_response(group, groups, counts)


@router.delete("/account-groups/{group_id}")
async def delete_account_group(group_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("accounts", "account_groups"))):
    group = db.query(AccountGroup).filter(AccountGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Account group not found")
    ensure_can_delete(user, group, "accounts", "account_groups", what="account group")
    if group.is_system:
        raise HTTPException(status_code=400, detail="Standard groups can't be deleted — reports depend on them.")
    if db.query(GLAccount).filter(GLAccount.group_id == group_id).first() or db.query(AccountGroup).filter(AccountGroup.parent_id == group_id).first():
        raise HTTPException(status_code=409, detail=f"'{group.name}' still has ledgers or sub-groups — move them first.")
    db.delete(group)
    write_audit(db, "account_group", group_id, "deleted", user, f"{who(user)} deleted account group '{group.name}'.")
    db.commit()
    return {"ok": True}


# ── Ledger settings (account determination) ─────────────────────────────

def _ledger_settings(db: Session) -> list[LedgerSettingResponse]:
    rows = {r.role: r for r in db.query(AccountDetermination).all()}
    by_code = {a.code: a for a in db.query(GLAccount).filter(GLAccount.code.in_([c for c, _ in LEDGER_ROLES.values()])).all()}
    ids = {r.gl_account_id for r in rows.values() if r.gl_account_id}
    by_id = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(ids)).all()} if ids else {}
    out = []
    for role, (code, label) in LEDGER_ROLES.items():
        chosen = by_id.get(rows[role].gl_account_id) if role in rows and rows[role].gl_account_id else None
        acc = chosen or by_code.get(code)
        out.append(LedgerSettingResponse(role=role, label=label, default_code=code, gl_account_id=acc.id if acc else None,
                                         gl_account_code=acc.code if acc else None, gl_account_name=acc.name if acc else None,
                                         is_default=chosen is None))
    return out


@router.get("/ledger-settings", response_model=list[LedgerSettingResponse])
async def get_ledger_settings(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "ledger_settings"))):
    return _ledger_settings(db)


@router.put("/ledger-settings", response_model=list[LedgerSettingResponse])
async def update_ledger_setting(payload: LedgerSettingUpdate, db: Session = Depends(get_db),
                                user: User = Depends(require_tab_action("accounts", "ledger_settings", "edit"))):
    require_finance_manager(user, "change which ledgers automatic postings use")
    if payload.role not in LEDGER_ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown ledger role '{payload.role}'.")
    if payload.gl_account_id:
        acc = db.query(GLAccount).filter(GLAccount.id == payload.gl_account_id).first()
        if not acc or acc.status != "active" or not acc.is_posting_account:
            raise HTTPException(status_code=400, detail="Pick an active posting ledger.")
    row = db.query(AccountDetermination).filter(AccountDetermination.role == payload.role).first()
    if not row:
        row = AccountDetermination(role=payload.role)
        db.add(row)
    row.gl_account_id = payload.gl_account_id
    write_audit(db, "ledger_setting", None, "updated", user, f"{who(user)} set ledger for '{LEDGER_ROLES[payload.role][1]}'.")
    db.commit()
    return _ledger_settings(db)


# ── GST rates ───────────────────────────────────────────────────────────

# Shared lookup: pickers on many Finance tabs read this, so any Finance user
# may list it; writes are gated per tab below.
@router.get("/gst-rates", response_model=list[GSTRateResponse])
async def list_gst_rates(db: Session = Depends(get_db), _user: User = Depends(require_app_access("accounts"))):
    return db.query(GSTRate).order_by(GSTRate.rate.asc()).all()


@router.post("/gst-rates", response_model=GSTRateResponse, status_code=201)
async def create_gst_rate(payload: GSTRateCreate, db: Session = Depends(get_db), user: User = Depends(require_tab_action("accounts", "gst_rates", "create"))):
    require_finance_manager(user, "maintain GST rates")
    if payload.rate < 0 or payload.rate > 100:
        raise HTTPException(status_code=400, detail="A GST rate must be between 0 and 100%.")
    if db.query(GSTRate).filter(GSTRate.rate == payload.rate).first():
        raise HTTPException(status_code=409, detail=f"GST rate {payload.rate:g}% already exists — re-activate it instead.")
    rate = GSTRate(**payload.model_dump())
    db.add(rate)
    write_audit(db, "gst_rate", None, "created", user, f"{who(user)} added GST rate {payload.rate:g}%.")
    db.commit()
    db.refresh(rate)
    return rate


@router.patch("/gst-rates/{rate_id}", response_model=GSTRateResponse)
async def update_gst_rate(rate_id: int, payload: GSTRateUpdate, db: Session = Depends(get_db), user: User = Depends(require_tab_action("accounts", "gst_rates", "edit"))):
    require_finance_manager(user, "maintain GST rates")
    rate = db.query(GSTRate).filter(GSTRate.id == rate_id).first()
    if not rate:
        raise HTTPException(status_code=404, detail="GST rate not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(rate, k, v)
    write_audit(db, "gst_rate", rate.id, "updated", user, f"{who(user)} updated GST rate {rate.rate:g}%.")
    db.commit()
    db.refresh(rate)
    return rate


# ── Opening balances & maintenance ──────────────────────────────────────

@router.post("/opening-balances")
async def post_opening_balances_route(payload: OpeningBalancesCreate, db: Session = Depends(get_db),
                                      user: User = Depends(require_tab_action("accounts", "opening_balances", "edit"))):
    require_finance_manager(user, "post opening balances")
    with service_errors(db):
        entry = post_opening_balances(
            db, as_of=payload.as_of, ledger_lines=[l.model_dump() for l in payload.ledger_lines],
            vendor_bills=[b.model_dump() for b in payload.vendor_bills], customer_bills=[b.model_dump() for b in payload.customer_bills],
            created_by_id=user.id, narration=payload.narration,
        )
    write_audit(db, "journal_entry", entry.id, "posted", user, f"{who(user)} posted opening balances {entry.entry_number} as of {payload.as_of}.")
    db.commit()
    return {"journal_entry_id": entry.id, "entry_number": entry.entry_number, "total": entry.total_debit}


@router.post("/maintenance/rebuild-balances")
async def rebuild_balances_route(db: Session = Depends(get_db), user: User = Depends(require_app_access("accounts"))):
    """Recomputes the monthly balance cache from journal lines. Admin only;
    reports don't depend on the cache, so this is a repair tool, not routine."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can rebuild ledger balances.")
    count = rebuild_gl_balances(db)
    write_audit(db, "gl_balance", None, "rebuilt", user, f"{who(user)} rebuilt {count} ledger balance rows from journal lines.")
    db.commit()
    return {"rows": count}
