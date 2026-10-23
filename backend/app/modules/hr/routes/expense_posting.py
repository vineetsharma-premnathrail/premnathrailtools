"""Finance side of HR expense claims (PR05 posting).

- GET  /accounts/hr-claims?status=approved|paid      claims with their posting state
- POST /accounts/hr-claims/{id}/post                  (re)post the approval journal   accounts:journal_vouchers:create
- POST /accounts/hr-claims/{id}/pay                   payment voucher clearing the payable  accounts:payments:create

Registered without the HR module gate: these are Finance screens.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.permissions import require_tab_action
from app.db.session import get_db
from app.modules.hr.models.expense import HrExpenseClaim
from app.modules.hr.services import expense_posting as svc
from app.modules.hr.services.calendar import today_ist
from app.modules.main.models.user import User
from app.utils.notifications import notify_user

router = APIRouter(prefix="/accounts/hr-claims", tags=["Accounts"])
require_view = require_tab_action("accounts", "payments", "view")
require_post = require_tab_action("accounts", "journal_vouchers", "create")
require_pay = require_tab_action("accounts", "payments", "create")


class HrClaimPayPayload(BaseModel):
    bank_account_id: int
    payment_mode: str = "neft"
    paid_on: date | None = None
    payment_reference: str | None = Field(default=None, max_length=100)


def _out(db: Session, c: HrExpenseClaim) -> dict:
    from app.modules.accounts.models.journal_entry import JournalEntry
    from app.modules.accounts.models.payment_transaction import PaymentTransaction

    u = db.get(User, c.user_id)
    je = db.get(JournalEntry, c.posted_je_id) if c.posted_je_id else None
    pv = db.get(PaymentTransaction, c.payment_voucher_id) if c.payment_voucher_id else None
    return {"id": c.id, "claim_no": c.claim_no, "title": c.title, "user_id": c.user_id, "employee_name": u.name if u else None,
            "total_amount": float(c.total_amount or 0), "status": c.status, "cost_center_id": c.cost_center_id,
            "posted_je_id": c.posted_je_id, "posted_je_number": je.entry_number if je else None,
            "payment_voucher_id": c.payment_voucher_id, "payment_voucher_number": pv.payment_number if pv else None,
            "posting_error": c.posting_error, "paid_on": c.paid_on, "payment_reference": c.payment_reference}


def _get(db: Session, claim_id: int) -> HrExpenseClaim:
    c = db.query(HrExpenseClaim).filter(HrExpenseClaim.id == claim_id).with_for_update().first()
    if c is None:
        raise HTTPException(status_code=404, detail=f"Expense claim #{claim_id} doesn't exist. Reload the list.")
    return c


@router.get("")
async def list_claims(status: str = Query("approved"), db: Session = Depends(get_db), _user: User = Depends(require_view)):
    if status not in ("approved", "paid"):
        raise HTTPException(status_code=400, detail="Status must be 'approved' (to pay) or 'paid'.")
    rows = db.query(HrExpenseClaim).filter(HrExpenseClaim.status == status).order_by(HrExpenseClaim.claim_date.desc()).limit(500).all()
    return [_out(db, c) for c in rows]


@router.get("/{claim_id}")
async def get_claim(claim_id: int, db: Session = Depends(get_db), _user: User = Depends(require_view)):
    c = db.get(HrExpenseClaim, claim_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"Expense claim #{claim_id} doesn't exist.")
    return _out(db, c)


@router.post("/{claim_id}/post")
async def post_claim(claim_id: int, db: Session = Depends(get_db), user: User = Depends(require_post)):
    c = _get(db, claim_id)
    if c.posted_je_id:
        raise HTTPException(status_code=409, detail=f"{c.claim_no} is already posted to accounts. Nothing to do.")
    try:
        svc.post_liability(db, c, user)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"{c.claim_no} couldn't be posted: {e}")
    record_audit(db, entity_type="hr_expense_claim", entity_id=c.id, action="posted", module_key="accounts",
                 summary=f"Expense claim {c.claim_no} posted to accounts", user_id=user.id)
    db.commit()
    return _out(db, c)


@router.post("/{claim_id}/pay")
async def pay_claim(claim_id: int, payload: HrClaimPayPayload, db: Session = Depends(get_db), user: User = Depends(require_pay),
                    background_tasks: BackgroundTasks = None):
    c = _get(db, claim_id)
    try:
        pv = svc.pay(db, c, user, bank_account_id=payload.bank_account_id, payment_mode=payload.payment_mode,
                     paid_on=payload.paid_on or today_ist(), reference=payload.payment_reference)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"{c.claim_no} couldn't be paid: {e}")
    record_audit(db, entity_type="hr_expense_claim", entity_id=c.id, action="paid", module_key="accounts",
                 summary=f"Expense claim {c.claim_no} paid by voucher {pv.payment_number}", user_id=user.id)
    notify_user(db, c.user_id, "Expense claim paid",
                f"{c.claim_no} for ₹{float(c.total_amount or 0):,.2f} was paid on {c.paid_on:%d-%m-%Y} (voucher {pv.payment_number}).",
                "hr_expense_paid", entity_type="hr_expense_claim", entity_id=c.id)
    from app.modules.hr.services import role_events
    claimant = db.get(User, c.user_id)
    role_events.fire(
        db, background_tasks, "claim_paid", title=f"Expense claim paid — {c.claim_no}",
        message=(f"{claimant.name if claimant else 'An employee'}'s claim {c.claim_no} for ₹{float(c.total_amount or 0):,.2f} "
                 f"was paid by Finance on {c.paid_on:%d-%m-%Y} (voucher {pv.payment_number})."),
        entity_type="hr_expense_claim", entity_id=c.id, actor=user,
        can_open=role_events.employee_opener(db, claimant), skip={c.user_id},
    )
    db.commit()
    return _out(db, c)
