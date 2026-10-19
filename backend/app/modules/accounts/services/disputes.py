"""FSCM Dispute Management (UDM_DISPUTE) — a disputed amount on a posted
sales invoice (quality / quantity / price / LD / documentation claims).

Rules
  * Only a posted sales invoice can carry a dispute; open disputes on one
    invoice together can't exceed what is still due on it.
  * While open (open / under review) the disputed part is shown apart in
    aging, left out of the dunning run and the collections worklist, and
    does not count as "overdue" for the credit block (it still counts in
    credit exposure — the money is still owed until resolved).
  * Resolution, with a written note:
      credit_note — a credit note against the same invoice (pending or
                    posted) gives the claim; GST is reversed by the note
      write_off   — the disputed amount (up to what is due) is written off
                    through the standard write-off (Dr deduction ledger /
                    Cr Debtors); above Finance › Settings small-difference
                    tolerance only a Finance Manager may do it
      paid        — the claim was withdrawn; the customer pays in full
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.collections import (
    AccountsDispute, DISPUTE_OPEN_STATUSES, DISPUTE_REASONS, DISPUTE_STATUSES,
)
from app.modules.accounts.models.party_note import PartyNote

RESOLUTIONS = {"credit_note": "resolved_credit_note", "write_off": "written_off", "paid": "resolved_paid"}
# Write-off ledger reason for each dispute reason (settlement_adjustment ADJUSTMENT_REASONS).
_WRITE_OFF_REASON = {"ld": "ld_deduction", "quality": "penalty"}


def disputed_by_invoice(db: Session, invoice_ids, as_of: date | None = None) -> dict[int, float]:
    """Open disputed amount per sales invoice (on the key date when given)."""
    ids = [i for i in set(invoice_ids or []) if i]
    if not ids:
        return {}
    q = db.query(AccountsDispute).filter(AccountsDispute.ar_transaction_id.in_(ids))
    out: dict[int, float] = {}
    for d in q.all():
        if as_of is None:
            live = d.status in DISPUTE_OPEN_STATUSES
        else:
            live = d.raised_on <= as_of and (d.status in DISPUTE_OPEN_STATUSES or (d.resolved_on and d.resolved_on > as_of))
        if live:
            out[d.ar_transaction_id] = round(out.get(d.ar_transaction_id, 0.0) + float(d.disputed_amount or 0), 2)
    return out


def _next_number(db: Session, on: date) -> str:
    prefix = f"DSP-{on.year}-"
    last = db.query(AccountsDispute.dispute_number).filter(AccountsDispute.dispute_number.like(f"{prefix}%")) \
        .order_by(AccountsDispute.dispute_number.desc()).first()
    seq = int(last[0].rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def _invoice(db: Session, ar_transaction_id: int) -> ARTransaction:
    inv = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
    if not inv:
        raise ValueError(f"Sales invoice #{ar_transaction_id} not found — refresh the page and pick the invoice again.")
    return inv


def _check_amount(db: Session, inv: ARTransaction, amount: float, exclude_id: int | None = None) -> float:
    amount = round(float(amount or 0), 2)
    if amount <= 0:
        raise ValueError("Disputed amount must be greater than zero.")
    q = db.query(AccountsDispute).filter(AccountsDispute.ar_transaction_id == inv.id,
                                         AccountsDispute.status.in_(DISPUTE_OPEN_STATUSES))
    if exclude_id:
        q = q.filter(AccountsDispute.id != exclude_id)
    other = round(sum(float(d.disputed_amount or 0) for d in q.all()), 2)
    room = round(float(inv.amount_due or 0) - other, 2)
    if amount > room + 0.005:
        raise ValueError(f"Invoice {inv.invoice_number} has only {room:,.2f} due that isn't already under dispute "
                         f"(due {float(inv.amount_due or 0):,.2f}, already disputed {other:,.2f}) — lower the disputed amount.")
    return amount


def create_dispute(db: Session, *, ar_transaction_id: int, disputed_amount: float, reason: str, description: str,
                   owner_user_id: int | None, created_by_id: int | None, raised_on: date | None = None,
                   customer_complaint_id: int | None = None) -> AccountsDispute:
    if reason not in DISPUTE_REASONS:
        raise ValueError(f"Reason must be one of: {', '.join(DISPUTE_REASONS)}.")
    if not (description or "").strip():
        raise ValueError("Describe what the customer disputes (e.g. 'LD deducted for 3 weeks, delay was due to late drawing approval').")
    inv = _invoice(db, ar_transaction_id)
    if inv.status != "posted":
        raise ValueError(f"Invoice {inv.invoice_number} isn't issued (status {inv.status}) — only a posted sales invoice can be disputed.")
    amount = _check_amount(db, inv, disputed_amount)
    raised_on = raised_on or date.today()
    if raised_on > date.today():
        raise ValueError("The dispute date can't be in the future.")
    d = AccountsDispute(dispute_number=_next_number(db, raised_on), customer_id=inv.customer_id, ar_transaction_id=inv.id,
                        disputed_amount=amount, reason=reason, description=description.strip(), status="open",
                        raised_on=raised_on, owner_user_id=owner_user_id or created_by_id,
                        customer_complaint_id=customer_complaint_id, created_by_id=created_by_id)
    db.add(d)
    db.flush()
    return d


def get_dispute(db: Session, dispute_id: int) -> AccountsDispute:
    d = db.query(AccountsDispute).filter(AccountsDispute.id == dispute_id).first()
    if not d:
        raise LookupError(f"Dispute #{dispute_id} not found — it may have been removed. Refresh the page.")
    return d


def _ensure_open(d: AccountsDispute, action: str) -> None:
    if d.status not in DISPUTE_OPEN_STATUSES:
        raise ValueError(f"Dispute {d.dispute_number} is already {DISPUTE_STATUSES.get(d.status, d.status).lower()} — "
                         f"it can't {action} any more.")


def update_dispute(db: Session, d: AccountsDispute, *, disputed_amount: float | None = None, reason: str | None = None,
                   description: str | None = None, owner_user_id: int | None = None, status: str | None = None) -> AccountsDispute:
    _ensure_open(d, "be changed")
    if disputed_amount is not None:
        d.disputed_amount = _check_amount(db, _invoice(db, d.ar_transaction_id), disputed_amount, exclude_id=d.id)
    if reason is not None:
        if reason not in DISPUTE_REASONS:
            raise ValueError(f"Reason must be one of: {', '.join(DISPUTE_REASONS)}.")
        d.reason = reason
    if description is not None:
        if not description.strip():
            raise ValueError("The description can't be empty.")
        d.description = description.strip()
    if owner_user_id is not None:
        d.owner_user_id = owner_user_id
    if status is not None:
        if status not in DISPUTE_OPEN_STATUSES:
            raise ValueError("Use Resolve to close a dispute; here the status can only be 'open' or 'under_review'.")
        d.status = status
    db.flush()
    return d


def resolve_dispute(db: Session, d: AccountsDispute, *, resolution: str, note: str, user, party_note_id: int | None = None,
                    write_off_reason: str | None = None, resolved_on: date | None = None) -> AccountsDispute:
    from app.modules.accounts.services.vouchers import write_off

    _ensure_open(d, "be resolved")
    if resolution not in RESOLUTIONS:
        raise ValueError("Resolution must be 'credit_note', 'write_off' or 'paid'.")
    if not (note or "").strip():
        raise ValueError("Write how the dispute was settled (resolution note) — it stays on the record for audit.")
    resolved_on = resolved_on or date.today()
    inv = _invoice(db, d.ar_transaction_id)
    if resolution == "credit_note":
        if not party_note_id:
            raise ValueError("Pick the credit note that settles the claim. Raise it first in Finance › Sales › Credit Notes "
                             f"against invoice {inv.invoice_number}.")
        cn = db.query(PartyNote).filter(PartyNote.id == party_note_id).first()
        if not cn or cn.note_type != "credit_note" or cn.ar_transaction_id != inv.id:
            raise ValueError(f"That credit note isn't against invoice {inv.invoice_number} — pick one raised on this invoice.")
        if cn.status not in ("pending", "posted"):
            raise ValueError(f"Credit note {cn.note_number} is {cn.status} — pick a pending or posted one.")
        d.party_note_id = cn.id
    elif resolution == "write_off":
        from app.modules.accounts.settings import get_setting
        amount = round(min(float(d.disputed_amount or 0), float(inv.amount_due or 0)), 2)
        if amount <= 0.005:
            raise ValueError(f"Invoice {inv.invoice_number} has nothing left due — resolve the dispute as 'paid' or by credit note instead.")
        tolerance = float(get_setting(db, "small_difference_tolerance") or 0)
        if amount > tolerance + 1e-9 and not (getattr(user, "is_finance_manager", False) or getattr(user, "role", None) == "admin"):
            raise PermissionError(f"Writing off {amount:,.2f} is above the small-difference tolerance ({tolerance:,.2f}, "
                                  "Finance › Settings) — only a Finance Manager can do it. Ask one to resolve this dispute.")
        adj = write_off(db, target_type="ar_transaction", target_id=inv.id, amount=amount,
                        reason=write_off_reason or _WRITE_OFF_REASON.get(d.reason, "short_payment"),
                        write_off_date=resolved_on, created_by_id=user.id,
                        remarks=f"Dispute {d.dispute_number}: {note.strip()}"[:300])
        d.settlement_adjustment_id = adj.id
    d.status = RESOLUTIONS[resolution]
    d.resolution_note = note.strip()
    d.resolved_on = resolved_on
    d.resolved_by_id = user.id
    db.flush()
    return d
