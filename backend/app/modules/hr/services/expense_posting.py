"""Expense claim posting to Finance (SAP PR05 → FI, PRRW equivalent).

On approval:   JV  Dr expense ledger per category (cost center of the claim)
                   Cr Employee reimbursements payable
On payment:    PV  Dr Employee reimbursements payable
                   Cr Bank / Cash          (Finance › payment voucher)

Ledgers come from Finance › Masters › Ledger Settings (ledger roles in
accounts/models/settings.py). Numbers come from the FY voucher series
(JV/2026-27/…, PV/2026-27/…); a closed FY / period blocks the posting with
Finance's own message.

Approval never fails because Finance isn't set up: when the journal can't be
posted, the claim stays approved and `posting_error` says why; Finance
retries with "Post to accounts" once the ledger / period is fixed.
"""
from __future__ import annotations

from collections import OrderedDict
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.expense import HrExpenseClaim
from app.modules.hr.services.calendar import today_ist
from app.modules.main.models.user import User

ENTITY = "hr_expense_claim"
CATEGORY_ROLE = {
    "travel": "staff_travel_expense", "lodging": "staff_travel_expense",
    "local_conveyance": "staff_conveyance_expense", "fuel": "staff_conveyance_expense",
    "food": "staff_meals_expense", "phone": "staff_telephone_expense", "other": "staff_other_expense",
}
PAYABLE_ROLE = "employee_reimbursement_payable"


def default_cost_center(db: Session, claim: HrExpenseClaim) -> int | None:
    if claim.cost_center_id:
        return claim.cost_center_id
    prof = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == claim.user_id).first()
    return prof.cost_center_id if prof else None


def journal_lines(db: Session, claim: HrExpenseClaim) -> list[dict]:
    from app.modules.accounts.services.ledgers import ledger_id_for

    cc = default_cost_center(db, claim)
    by_role: "OrderedDict[str, float]" = OrderedDict()
    for it in claim.items:
        role = CATEGORY_ROLE.get(it.category, "staff_other_expense")
        by_role[role] = round(by_role.get(role, 0.0) + float(it.amount or 0), 2)
    total = round(sum(by_role.values()), 2)
    if total <= 0:
        raise ValueError(f"{claim.claim_no} has no amount to post.")
    lines = [{"gl_account_id": ledger_id_for(db, role), "debit_amount": amt, "credit_amount": 0, "cost_center_id": cc,
              "remarks": f"{claim.claim_no} {role.replace('staff_', '').replace('_expense', '').replace('_', ' ')}"}
             for role, amt in by_role.items() if amt > 0]
    lines.append({"gl_account_id": ledger_id_for(db, PAYABLE_ROLE), "debit_amount": 0, "credit_amount": total,
                  "remarks": f"{claim.claim_no} payable to employee"})
    return lines


def post_liability(db: Session, claim: HrExpenseClaim, actor: User, posting_date: date | None = None):
    """Post the approval journal. Raises ValueError with Finance's reason."""
    from app.modules.accounts.service import post_journal_entry

    if claim.posted_je_id:
        return None
    if claim.status not in ("approved", "paid"):
        raise ValueError(f"{claim.claim_no} is {claim.status}; only approved claims are posted to accounts.")
    employee = db.get(User, claim.user_id)
    lines = journal_lines(db, claim)
    claim.cost_center_id = default_cost_center(db, claim)
    je = post_journal_entry(
        db, posting_date=posting_date or today_ist(), lines=lines, posting_type="adjustment", voucher_type="journal",
        description=f"Expense claim {claim.claim_no} — {employee.name if employee else 'employee'}: {claim.title}",
        reference_document_type=ENTITY, reference_document_id=claim.id, created_by_id=actor.id,
    )
    claim.posted_je_id = je.id
    claim.posting_error = None
    return je


def post_on_approval(db: Session, claim: HrExpenseClaim, actor: User) -> None:
    """Fail-soft wrapper used by the approval path."""
    try:
        with db.begin_nested():
            post_liability(db, claim, actor)
    except (ValueError, HTTPException) as e:
        claim.posting_error = (str(e.detail) if isinstance(e, HTTPException) else str(e))[:2000]


def pay(db: Session, claim: HrExpenseClaim, actor: User, *, bank_account_id: int, payment_mode: str, paid_on: date,
        reference: str | None):
    """Payment voucher clearing the payable. Raises ValueError (real reason)."""
    from app.modules.accounts.services.ledgers import ledger_id_for
    from app.modules.accounts.services.vouchers import create_voucher

    if claim.status != "approved":
        raise ValueError(f"{claim.claim_no} is {claim.status}; only approved claims can be paid.")
    if claim.user_id == actor.id:
        raise ValueError("You can't pay your own expense claim. Another Finance user has to record the payment.")
    if claim.submitted_at and paid_on < claim.submitted_at.date():
        raise ValueError(f"Payment date {paid_on:%d-%m-%Y} is before the claim was submitted ({claim.submitted_at:%d-%m-%Y}). Enter the actual payment date.")
    if not claim.posted_je_id:
        post_liability(db, claim, actor, posting_date=paid_on)
    employee = db.get(User, claim.user_id)
    amount = round(float(claim.total_amount or 0), 2)
    pv = create_voucher(
        db, payment_type="expense", bank_account_id=bank_account_id, amount=amount, payment_mode=payment_mode,
        payment_date=paid_on, created_by_id=actor.id, reference_no=(reference or claim.claim_no)[:100],
        narration=f"Reimbursement {claim.claim_no} to {employee.name if employee else 'employee'}",
        lines=[{"gl_account_id": ledger_id_for(db, PAYABLE_ROLE), "amount": amount, "remarks": f"{claim.claim_no} reimbursement"}],
    )
    claim.payment_voucher_id = pv.id
    claim.status = "paid"
    claim.paid_on = paid_on
    claim.payment_reference = (reference or pv.payment_number)[:100]
    claim.paid_by_id = actor.id
    return pv
