"""Expense-claim rules shared by the claim routes.

Reimbursement itself is paid outside the portal (ADP / accounts); the portal
only records the claim, its approval and the payment reference."""
from decimal import Decimal

from fastapi import HTTPException

from app.modules.hr.models.expense import HrExpenseClaim, HrExpenseClaimItem

# Line items above this amount (INR) must carry a receipt before submitting.
RECEIPT_REQUIRED_ABOVE = Decimal("500")

# Owner can change the claim (header, items, receipts) only in these states.
EDITABLE_STATUSES = ("draft", "rejected")


def receipt_required(item: HrExpenseClaimItem) -> bool:
    return Decimal(item.amount or 0) > RECEIPT_REQUIRED_ABOVE


def recompute_total(claim: HrExpenseClaim) -> None:
    claim.total_amount = sum((Decimal(i.amount or 0) for i in claim.items), Decimal("0")).quantize(Decimal("0.01"))


def fmt_inr(amount: Decimal | int | float) -> str:
    """₹1,23,456.00 — Indian digit grouping."""
    value = Decimal(amount or 0).quantize(Decimal("0.01"))
    sign = "-" if value < 0 else ""
    whole, frac = f"{abs(value):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}₹{whole}.{frac}"


def ensure_owner_can_edit(claim: HrExpenseClaim, user_id: int) -> None:
    if claim.user_id != user_id:
        raise HTTPException(status_code=403, detail="Only the employee who created this expense claim can change it.")
    if claim.status not in EDITABLE_STATUSES:
        hint = {
            "submitted": " Ask your approver to reject it if something needs correcting, then edit and resubmit.",
            "approved": " Approved claims are locked; raise a new claim for anything missed.",
            "paid": " It has already been paid.",
            "cancelled": " Create a new claim instead.",
        }.get(claim.status, "")
        raise HTTPException(
            status_code=409,
            detail=f"{claim.claim_no} is {claim.status}, so it can no longer be edited.{hint}",
        )


def validate_for_submit(claim: HrExpenseClaim) -> None:
    if not claim.items:
        raise HTTPException(
            status_code=400,
            detail=f"{claim.claim_no} has no expense lines. Add at least one line item (date, category, amount) before submitting.",
        )
    missing = [i for i in claim.items if receipt_required(i) and not i.receipt_path]
    if missing:
        lines = "; ".join(
            f"{i.expense_date:%d-%m-%Y} {i.category.replace('_', ' ')} {fmt_inr(i.amount)}" for i in missing[:5]
        )
        more = f" and {len(missing) - 5} more" if len(missing) > 5 else ""
        raise HTTPException(
            status_code=400,
            detail=(
                f"Receipts are required for every line above {fmt_inr(RECEIPT_REQUIRED_ABOVE)}. "
                f"Missing for {len(missing)} line(s): {lines}{more}. Upload a receipt on each of these lines, then submit again."
            ),
        )
