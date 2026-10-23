"""Bank guarantee / LC / EMD / security deposit register (treasury-lite).

Issued instruments (PBG, ABG, EMD, SD, bid bond, warranty BG, LC) go
draft -> submitted -> approved (Finance approver, then a Partner — the bank
application is signed by the firm's authorised signatories) -> active once
the bank issues it -> released (returned / claim period over) or invoked.
Received instruments (a supplier's ABG / PBG) are recorded active.

Money postings — always through vouchers, so the bank side appears on the
bank book and can be matched on the bank statement:
  margin placed     expense voucher   Dr Margin money (or EMD deposit) / Cr Bank
  commission        expense voucher   Dr BG commission / Cr Bank
  release           other receipt     Dr Bank / Cr Margin money
  invoked (issued)  JV Dr BG invoked loss / Cr Margin (up to the margin) +
                    expense voucher Dr loss / Cr Bank for the rest; any
                    unused margin comes back by other receipt
  invoked (received) other receipt    Dr Bank / Cr chosen ledger (default
                    LD / penalties recovered from vendors)
These are posted at once (no payment approval): the bank has already moved
the money when Finance records it; the instrument itself was approved
before it was applied for. The ledgers are ledger roles (Finance > Masters
> Ledger Settings): margin_money, emd_security_deposit, bg_commission,
bg_invocation_loss.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import register_scoped
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.bank_guarantee import (
    BG_DIRECTIONS, BG_FORMS, BG_INSTRUMENT_TYPES, BankGuarantee, BankGuaranteeEvent,
)
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction

MODULE = "accounts"
ET_GUARANTEE = "accounts_bank_guarantee"
KEY_GUARANTEE = "accounts.bank_guarantee"
REMINDER_DAYS = (30, 15, 7, 1)
_EDITABLE_ALWAYS = ("instrument_number", "issuing_bank_name", "issuing_bank_branch", "counterparty_name", "purpose",
                    "remarks", "sales_order_id", "tender_id", "purchase_order_id", "commission_rate")
_EDITABLE_DRAFT = _EDITABLE_ALWAYS + ("instrument_type", "instrument_form", "bank_account_id", "customer_id", "vendor_id",
                                      "amount", "currency", "issue_date", "expiry_date", "claim_expiry_date",
                                      "margin_percent", "margin_amount", "margin_gl_account_id")

register_scoped(BankGuarantee, MODULE, entity_type=ET_GUARANTEE, owner=("created_by_id",), label="bank guarantee")


def _r(x) -> float:
    return round(float(x or 0), 2)


def _who(u: User | None) -> str:
    return (u.name or u.email) if u else "system"


def _event(db: Session, bg: BankGuarantee, kind: str, on: date, user_id: int | None, **kw) -> BankGuaranteeEvent:
    ev = BankGuaranteeEvent(guarantee_id=bg.id, event_type=kind, event_date=on, created_by_id=user_id, **kw)
    db.add(ev)
    db.flush()
    return ev


def get(db: Session, bg_id: int, *, lock: bool = False) -> BankGuarantee:
    q = db.query(BankGuarantee).filter(BankGuarantee.id == bg_id)
    if lock:
        q = q.with_for_update()
    bg = q.first()
    if not bg:
        raise ValueError(f"Bank guarantee #{bg_id} doesn't exist — it may have been removed. Refresh the register.")
    return bg


def label(bg: BankGuarantee) -> str:
    return f"{bg.bg_number} ({BG_INSTRUMENT_TYPES.get(bg.instrument_type, bg.instrument_type)}"\
           f"{f', {bg.instrument_number}' if bg.instrument_number else ''})"


def _bank(db: Session, bank_account_id: int | None) -> BankAccount:
    bank = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first() if bank_account_id else None
    if not bank:
        raise ValueError("Pick our bank account the instrument is issued from (margin, commission and refunds move through it).")
    if bank.account_kind != "bank":
        raise ValueError(f"'{bank.bank_name}' is a cash account — guarantees, LCs and deposits go through a bank account.")
    if bank.status != "active":
        raise ValueError(f"Bank account '{bank.bank_name}' is {bank.status} — pick an active one.")
    return bank


def _margin_gl(db: Session, bg: BankGuarantee) -> int:
    from app.modules.accounts.services.ledgers import ledger_id_for
    if bg.margin_gl_account_id:
        return bg.margin_gl_account_id
    return ledger_id_for(db, "emd_security_deposit" if bg.instrument_form == "deposit" else "margin_money")


def _validate(db: Session, bg: BankGuarantee) -> None:
    if bg.direction not in BG_DIRECTIONS:
        raise ValueError(f"Direction must be one of: {', '.join(BG_DIRECTIONS)}.")
    if bg.instrument_type not in BG_INSTRUMENT_TYPES:
        raise ValueError(f"Unknown instrument type '{bg.instrument_type}' — use one of: {', '.join(BG_INSTRUMENT_TYPES)}.")
    if bg.instrument_type == "lc":
        bg.instrument_form = "lc"
    if bg.instrument_form not in BG_FORMS:
        raise ValueError(f"Form must be one of: {', '.join(BG_FORMS)}.")
    if bg.instrument_form == "deposit" and bg.instrument_type not in ("emd", "security_deposit"):
        raise ValueError("Only an EMD or a security deposit can be paid as a cash deposit (DD / NEFT / pledged FDR); "
                         "a PBG, ABG, bid bond or warranty guarantee is a bank guarantee.")
    bg.amount = _r(bg.amount)
    if bg.amount <= 0:
        raise ValueError("The guarantee amount must be greater than zero.")
    if bg.issue_date and bg.expiry_date and bg.expiry_date < bg.issue_date:
        raise ValueError(f"The expiry date ({bg.expiry_date:%d-%b-%Y}) is before the issue date ({bg.issue_date:%d-%b-%Y}).")
    if bg.claim_expiry_date and bg.expiry_date and bg.claim_expiry_date < bg.expiry_date:
        raise ValueError(f"The claim period can't end ({bg.claim_expiry_date:%d-%b-%Y}) before the guarantee expires "
                         f"({bg.expiry_date:%d-%b-%Y}) — leave it blank if there is no separate claim period.")
    if bg.direction == "issued":
        _bank(db, bg.bank_account_id)
        if not bg.customer_id and not (bg.counterparty_name or "").strip():
            raise ValueError("Name the beneficiary — pick the customer, or type the beneficiary as printed on the instrument.")
        if bg.instrument_form == "deposit":
            bg.margin_percent, bg.margin_amount = 100, bg.amount
        elif bg.margin_percent is not None:
            if not 0 <= float(bg.margin_percent) <= 100:
                raise ValueError("Margin % must be between 0 and 100.")
            bg.margin_amount = _r(bg.amount * float(bg.margin_percent) / 100)
        bg.margin_amount = _r(bg.margin_amount)
        if bg.margin_amount < 0 or bg.margin_amount > bg.amount:
            raise ValueError(f"The margin ({bg.margin_amount:,.2f}) must be between 0 and the guarantee amount ({bg.amount:,.2f}).")
    else:
        if not bg.vendor_id and not bg.customer_id and not (bg.counterparty_name or "").strip():
            raise ValueError("Name who gave us this instrument — pick the vendor, or type the applicant's name.")
        if not (bg.issuing_bank_name or "").strip():
            raise ValueError("Enter the bank that issued the instrument (as printed on it).")
        bg.margin_percent, bg.margin_amount = None, 0
        if not bg.expiry_date:
            raise ValueError("Enter the expiry date printed on the instrument — it drives the expiry reminders.")


def create(db: Session, data: dict, user: User) -> BankGuarantee:
    from app.modules.accounts.services import fiscal

    bg = BankGuarantee(**{k: v for k, v in data.items() if hasattr(BankGuarantee, k) and k not in ("id", "status", "bg_number")})
    bg.direction = bg.direction or "issued"
    bg.instrument_form = bg.instrument_form or "bank_guarantee"
    bg.currency = bg.currency or "INR"
    _validate(db, bg)
    bg.status = "active" if bg.direction == "received" else "draft"
    bg.margin_status = "none"
    bg.bg_number = fiscal.next_number(db, "BG", bg.issue_date or date.today())
    bg.created_by_id = user.id
    db.add(bg)
    db.flush()
    _event(db, bg, "created", date.today(), user.id, amount=bg.amount, new_expiry_date=bg.expiry_date,
           new_claim_expiry_date=bg.claim_expiry_date,
           notes=f"{_who(user)} recorded {'a received' if bg.direction == 'received' else 'a draft'} "
                 f"{BG_INSTRUMENT_TYPES[bg.instrument_type]} for {bg.amount:,.2f}.")
    return bg


def update(db: Session, bg: BankGuarantee, data: dict, user: User) -> BankGuarantee:
    if bg.status in ("released", "invoked", "cancelled"):
        raise ValueError(f"{bg.bg_number} is {bg.status} — a closed instrument can't be edited.")
    allowed = _EDITABLE_DRAFT if (bg.status == "draft" or (bg.direction == "received" and bg.status == "active")) else _EDITABLE_ALWAYS
    blocked = [k for k in data if k not in allowed]
    if blocked:
        raise ValueError(f"{', '.join(blocked)} can't be changed once {bg.bg_number} is {bg.status} — amount and dates change "
                         f"only through an extension (Extend), and the bank / party are fixed after approval.")
    for k, v in data.items():
        setattr(bg, k, v)
    if bg.margin_status != "none" and "margin_amount" in data:
        raise ValueError("The margin has already been posted — release it first to change it.")
    _validate(db, bg)
    db.flush()
    return bg


# ── approval ─────────────────────────────────────────────────────────────

def submit(db: Session, bg: BankGuarantee, user: User) -> ApprovalRequest:
    from app.modules.accounts.access import submit_document
    if bg.direction != "issued" or bg.status != "draft":
        raise ValueError(f"Only a draft issued instrument is sent for approval — {bg.bg_number} is {bg.status}.")
    _validate(db, bg)
    bg.status = "submitted"
    db.flush()
    _event(db, bg, "submitted", date.today(), user.id, notes=f"{_who(user)} sent it for approval.")
    req = submit_document(db, KEY_GUARANTEE, entity_id=bg.id, requester=user, title=f"Bank guarantee {label(bg)}",
                          reference=bg.bg_number, amount=bg.amount,
                          context={"instrument_type": bg.instrument_type, "margin_amount": bg.margin_amount})
    db.refresh(bg)
    return req


def _decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    bg = db.get(BankGuarantee, req.entity_id)
    if bg is None or bg.status != "submitted":
        return
    if outcome == "approved":
        bg.status, bg.approved_by_id = "approved", actor.id
        _event(db, bg, "approved", date.today(), actor.id, notes=f"Approved by {_who(actor)} — apply to the bank now.")
    else:
        reason = next((s.comment for s in req.steps if s.status in ("rejected", "returned") and s.comment), None)
        bg.status = "draft"
        _event(db, bg, "rejected", date.today(), actor.id, notes=f"{outcome.title()} by {_who(actor)}: {reason or 'no reason given'}")
    db.add(AuditLog(entity_type="bank_guarantee", entity_id=bg.id, action=outcome, performed_by_id=actor.id, module_key=MODULE,
                    summary=f"{_who(actor)} {outcome} bank guarantee {bg.bg_number}."))
    # Role event (core/events/accounts_b.py) — the requester hears from the engine directly.
    from app.modules.accounts import role_events_b
    kind = BG_INSTRUMENT_TYPES.get(bg.instrument_type, bg.instrument_type)
    if outcome == "approved":
        role_events_b.fire(db, "guarantee_approved", title=f"{kind} {bg.bg_number} approved — apply to the bank",
                           message=f"{bg.bg_number} ({bg.amount:,.2f}) is approved by {_who(actor)}. Apply to the bank, then "
                                   "record it with Mark Issued by Bank in Finance › Bank & Cash › Guarantees & EMD.",
                           entity_type=ET_GUARANTEE, entity_id=bg.id, record=bg, actor=actor,
                           skip={req.requester_id, bg.created_by_id})
    else:
        role_events_b.fire(db, "guarantee_rejected", title=f"{kind} {bg.bg_number} {outcome}",
                           message=f"{_who(actor)} {outcome} {bg.bg_number}: {reason or 'no reason given'}. It is back in draft — "
                                   "correct it and send it for approval again, or cancel it.",
                           entity_type=ET_GUARANTEE, entity_id=bg.id, record=bg, actor=actor,
                           skip={req.requester_id, bg.created_by_id})


register_transaction(TransactionType(
    key=KEY_GUARANTEE, module_key=MODULE, subtab_key="guarantees", label="Bank guarantee / LC / EMD", entity_type=ET_GUARANTEE,
    url="/dashboard/finance/banking?tab=guarantees",
    description="A guarantee, LC or EMD the firm applies for (it blocks bank limits and margin money) is approved by a "
                "Finance approver and then a Partner before the application goes to the bank.",
    context_fields={"instrument_type": {"label": "Instrument type", "type": "choice", "choices": list(BG_INSTRUMENT_TYPES),
                                        "choice_labels": dict(BG_INSTRUMENT_TYPES)},
                    "margin_amount": {"label": "Margin money (₹)", "type": "number"}},
    default_stages=[StageDef("Finance approver", "permission", {"permission": f"{MODULE}:guarantees:approve"}, approval_mode="any"),
                    StageDef("Partner (final approval)", "partner")],
    on_decided=_decided, require_permission=True, allow_self_approval=False, distinct_approvers=False,
))


# ── lifecycle ────────────────────────────────────────────────────────────

def mark_issued(db: Session, bg: BankGuarantee, *, instrument_number: str, issue_date: date, expiry_date: date | None,
                claim_expiry_date: date | None, user: User) -> BankGuarantee:
    if bg.direction != "issued" or bg.status != "approved":
        raise ValueError(f"{bg.bg_number} is {bg.status} — only an approved instrument can be marked as issued by the bank"
                         f"{' (send the draft for approval first)' if bg.status == 'draft' else ''}.")
    if not (instrument_number or "").strip():
        raise ValueError("Enter the bank's BG / LC / DD number printed on the instrument.")
    bg.instrument_number = instrument_number.strip()
    bg.issue_date = issue_date
    bg.expiry_date = expiry_date or bg.expiry_date
    bg.claim_expiry_date = claim_expiry_date or bg.claim_expiry_date
    if not bg.expiry_date and bg.instrument_form != "deposit":
        raise ValueError("Enter the expiry date printed on the guarantee — it drives the expiry reminders.")
    _validate(db, bg)
    bg.status = "active"
    _event(db, bg, "issued", issue_date, user.id, new_expiry_date=bg.expiry_date, new_claim_expiry_date=bg.claim_expiry_date,
           notes=f"Issued by the bank as {bg.instrument_number}.")
    return bg


def _voucher(db: Session, bg: BankGuarantee, *, kind: str, amount: float, gl_id: int, on: date, user: User,
             payment_mode: str, reference_no: str | None, text: str):
    from app.modules.accounts.services.vouchers import create_voucher
    return create_voucher(
        db, payment_type=kind, bank_account_id=bg.bank_account_id, amount=amount, payment_mode=payment_mode or "neft",
        payment_date=on, created_by_id=user.id,
        lines=[{"gl_account_id": gl_id, "amount": amount, "remarks": text[:300]}],
        reference_no=reference_no, narration=text,
    )


def place_margin(db: Session, bg: BankGuarantee, *, posting_date: date, payment_mode: str, reference_no: str | None, user: User):
    if bg.direction != "issued" or bg.status not in ("approved", "active"):
        raise ValueError(f"Margin is placed for an approved or active issued instrument — {bg.bg_number} is {bg.status}.")
    if bg.margin_status != "none":
        raise ValueError(f"The margin for {bg.bg_number} is already {bg.margin_status}.")
    if bg.margin_amount <= 0:
        raise ValueError(f"{bg.bg_number} has no margin (0%) — set the margin % first if the bank blocked money for it.")
    what = "EMD / security deposit" if bg.instrument_form == "deposit" else "Margin money"
    v = _voucher(db, bg, kind="expense", amount=bg.margin_amount, gl_id=_margin_gl(db, bg), on=posting_date, user=user,
                 payment_mode=payment_mode, reference_no=reference_no, text=f"{what} for {label(bg)}")
    bg.margin_status = "placed"
    _event(db, bg, "margin_placed", posting_date, user.id, amount=bg.margin_amount, payment_transaction_id=v.id,
           notes=f"{what} {bg.margin_amount:,.2f} posted ({v.payment_number}).")
    return v


def book_commission(db: Session, bg: BankGuarantee, *, amount: float, posting_date: date, payment_mode: str,
                    reference_no: str | None, user: User):
    from app.modules.accounts.services.ledgers import ledger_id_for
    if bg.direction != "issued" or bg.status not in ("approved", "active"):
        raise ValueError(f"Commission is booked on an approved or active issued instrument — {bg.bg_number} is {bg.status}.")
    amount = _r(amount)
    if amount <= 0:
        raise ValueError("Commission amount must be greater than zero.")
    v = _voucher(db, bg, kind="expense", amount=amount, gl_id=ledger_id_for(db, "bg_commission"), on=posting_date, user=user,
                 payment_mode=payment_mode, reference_no=reference_no, text=f"Bank commission on {label(bg)}")
    bg.commission_total = _r(bg.commission_total + amount)
    _event(db, bg, "commission", posting_date, user.id, amount=amount, payment_transaction_id=v.id,
           notes=f"Commission {amount:,.2f} posted ({v.payment_number}).")
    return v


def extend(db: Session, bg: BankGuarantee, *, new_expiry_date: date, new_claim_expiry_date: date | None, reason: str,
           amendment_date: date, user: User) -> BankGuarantee:
    if bg.status != "active":
        raise ValueError(f"Only an active instrument can be extended — {bg.bg_number} is {bg.status}.")
    if not (reason or "").strip():
        raise ValueError("Give the reason for the extension (e.g. customer letter no. / delivery period extended).")
    if bg.expiry_date and new_expiry_date <= bg.expiry_date:
        raise ValueError(f"The new expiry ({new_expiry_date:%d-%b-%Y}) must be after the current one ({bg.expiry_date:%d-%b-%Y}).")
    if new_claim_expiry_date and new_claim_expiry_date < new_expiry_date:
        raise ValueError("The new claim period can't end before the new expiry date.")
    old_e, old_c = bg.expiry_date, bg.claim_expiry_date
    bg.expiry_date = new_expiry_date
    if new_claim_expiry_date:
        bg.claim_expiry_date = new_claim_expiry_date
    elif old_c and old_e:
        bg.claim_expiry_date = new_expiry_date + (old_c - old_e)  # keep the same claim period
    _event(db, bg, "extended", amendment_date, user.id, old_expiry_date=old_e, new_expiry_date=bg.expiry_date,
           old_claim_expiry_date=old_c, new_claim_expiry_date=bg.claim_expiry_date, notes=reason.strip())
    return bg


def _refund_margin(db: Session, bg: BankGuarantee, amount: float, on: date, user: User, payment_mode: str, ref: str | None, why: str):
    what = "EMD / security deposit refunded" if bg.instrument_form == "deposit" else "Margin money released"
    v = _voucher(db, bg, kind="other_receipt", amount=amount, gl_id=_margin_gl(db, bg), on=on, user=user,
                 payment_mode=payment_mode, reference_no=ref, text=f"{what} — {label(bg)}")
    _event(db, bg, "margin_released", on, user.id, amount=amount, payment_transaction_id=v.id,
           notes=f"{what}: {amount:,.2f} ({v.payment_number}). {why}")
    return v


def release(db: Session, bg: BankGuarantee, *, release_date: date, reason: str, payment_mode: str, reference_no: str | None,
            user: User) -> BankGuarantee:
    if bg.status != "active":
        raise ValueError(f"Only an active instrument can be released — {bg.bg_number} is {bg.status}.")
    if not (reason or "").strip():
        raise ValueError("Say why it is released (e.g. 'original BG returned by customer, letter no. ...', 'claim period over').")
    if bg.direction == "issued" and bg.margin_status == "placed":
        _refund_margin(db, bg, bg.margin_amount, release_date, user, payment_mode, reference_no, reason.strip())
        bg.margin_status = "released"
    bg.status, bg.closed_on, bg.closure_reason = "released", release_date, reason.strip()
    _event(db, bg, "released", release_date, user.id, notes=reason.strip())
    return bg


def invoke(db: Session, bg: BankGuarantee, *, invoke_date: date, amount: float, reason: str, gl_account_id: int | None,
           payment_mode: str, reference_no: str | None, user: User) -> BankGuarantee:
    from app.modules.accounts.service import post_journal_entry
    from app.modules.accounts.services.ledgers import ledger_id_for

    if bg.status != "active":
        raise ValueError(f"Only an active instrument can be invoked — {bg.bg_number} is {bg.status}.")
    amount = _r(amount)
    if amount <= 0 or amount > bg.amount + 0.001:
        raise ValueError(f"The invoked amount must be more than zero and at most the guarantee amount ({bg.amount:,.2f}).")
    if not (reason or "").strip():
        raise ValueError("Give the reason / the beneficiary's claim letter reference.")
    reason = reason.strip()
    if bg.direction == "received":
        if not bg.bank_account_id:
            raise ValueError("Pick our bank account the claim money was credited to (edit the instrument's bank account) before recording the invocation.")
        gl = gl_account_id or ledger_id_for(db, "ld_recovered_from_vendor")
        v = _voucher(db, bg, kind="other_receipt", amount=amount, gl_id=gl, on=invoke_date, user=user, payment_mode=payment_mode,
                     reference_no=reference_no, text=f"Claim received under {label(bg)}")
        _event(db, bg, "invoked", invoke_date, user.id, amount=amount, payment_transaction_id=v.id, notes=reason)
    else:
        loss = gl_account_id or ledger_id_for(db, "bg_invocation_loss")
        from_margin = min(amount, bg.margin_amount) if bg.margin_status == "placed" else 0.0
        je = None
        if from_margin > 0:
            je = post_journal_entry(db, posting_date=invoke_date, created_by_id=user.id, posting_type="adjustment",
                                    description=f"{label(bg)} invoked — margin adjusted", reference_document_type="bank_guarantee",
                                    reference_document_id=bg.id, lines=[
                                        {"gl_account_id": loss, "debit_amount": from_margin, "remarks": reason[:300]},
                                        {"gl_account_id": _margin_gl(db, bg), "credit_amount": from_margin, "remarks": reason[:300]}])
        rest = _r(amount - from_margin)
        v = None
        if rest > 0:
            v = _voucher(db, bg, kind="expense", amount=rest, gl_id=loss, on=invoke_date, user=user, payment_mode=payment_mode,
                         reference_no=reference_no, text=f"{label(bg)} invoked by the beneficiary")
        _event(db, bg, "invoked", invoke_date, user.id, amount=amount, journal_entry_id=je.id if je else None,
               payment_transaction_id=v.id if v else None,
               notes=f"{reason} (from margin {from_margin:,.2f}, from bank {rest:,.2f})")
        if bg.margin_status == "placed":
            left = _r(bg.margin_amount - from_margin)
            if left > 0:
                _refund_margin(db, bg, left, invoke_date, user, payment_mode, reference_no, "Unused margin after invocation.")
            bg.margin_status = "consumed"
    bg.status, bg.closed_on, bg.closure_reason, bg.invoked_amount = "invoked", invoke_date, reason, amount
    return bg


def cancel(db: Session, bg: BankGuarantee, *, reason: str, user: User) -> BankGuarantee:
    from app.modules.accounts.access import cancel_live
    if bg.status not in ("draft", "submitted", "approved") and not (bg.direction == "received" and bg.status == "active"):
        raise ValueError(f"{bg.bg_number} is {bg.status} — an issued instrument the bank has already given out is closed by Release, not cancelled.")
    if bg.margin_status != "none" or bg.commission_total > 0:
        raise ValueError(f"Money has already been posted for {bg.bg_number} (margin / commission) — release it instead so the margin comes back through a voucher.")
    if not (reason or "").strip():
        raise ValueError("Give the reason for cancelling.")
    if bg.status == "submitted":
        cancel_live(db, ET_GUARANTEE, bg.id, user, reason)
    bg.status, bg.closure_reason, bg.closed_on = "cancelled", reason.strip(), date.today()
    _event(db, bg, "cancelled", date.today(), user.id, notes=reason.strip())
    return bg


# ── reminders ────────────────────────────────────────────────────────────

def reminder_reasons(bg: BankGuarantee, today: date) -> list[str]:
    """Sentences for today's reminder, or [] — 30/15/7/1 days before expiry
    or claim expiry, and every 7 days once expired while still active."""
    out = []
    for when, what in ((bg.expiry_date, "expires"), (bg.claim_expiry_date, "claim period ends")):
        if not when:
            continue
        days = (when - today).days
        if days in REMINDER_DAYS:
            out.append(f"{what} on {when:%d-%b-%Y} ({days} day{'s' if days != 1 else ''} left)")
        elif days < 0 and (-days) % 7 == 1 and what == "expires" and (not bg.claim_expiry_date or bg.claim_expiry_date < today):
            out.append(f"expired on {when:%d-%b-%Y} and is still open — get the original back and release it, or extend it")
    return out


def due_for_reminder(db: Session, today: date) -> list[tuple[BankGuarantee, list[str]]]:
    rows = db.query(BankGuarantee).filter(BankGuarantee.status == "active").all()
    return [(bg, r) for bg in rows if (r := reminder_reasons(bg, today))]


def default_claim_expiry(expiry: date | None, claim_days: int | None) -> date | None:
    return expiry + timedelta(days=claim_days) if expiry and claim_days else None
