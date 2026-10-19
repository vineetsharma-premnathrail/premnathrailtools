"""F110-style payment runs: proposal -> approval -> execution -> bank file.

    build_proposal()   due vendor bills (not blocked, vendor not blocked, not
                       already in a live run or a held payment), netting open
                       debit notes / supplier advances, early-payment discount
    update_line()      exclude a bill (with reason) or pay part of it (draft only)
    execute_proposal() after approval: set off the credits, then one payment
                       voucher per vendor (allocated bill-wise, discount posted
                       as a 'cash_discount' deduction) — all in one transaction
    bank_file_rows()   the bulk NEFT/RTGS upload rows (beneficiary, account,
                       IFSC, amount) for the executed vouchers
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.models.payment_proposal import PaymentProposal, PaymentProposalLine
from app.modules.accounts.models.payment_transaction import PaymentTransaction, PAYMENT_MODES
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.services import fiscal

LIVE_PROPOSAL_STATUSES = ("draft", "submitted", "approved")


def _r(x) -> float:
    return round(float(x or 0), 2)


def load(db: Session, proposal_id: int) -> PaymentProposal | None:
    return (db.query(PaymentProposal).options(selectinload(PaymentProposal.lines))
            .filter(PaymentProposal.id == proposal_id).first())


def _invoices_in_live_runs(db: Session, exclude_proposal_id: int | None = None) -> set[int]:
    q = (db.query(PaymentProposalLine.vendor_invoice_id)
         .join(PaymentProposal, PaymentProposalLine.proposal_id == PaymentProposal.id)
         .filter(PaymentProposal.status.in_(LIVE_PROPOSAL_STATUSES), PaymentProposalLine.excluded.is_(False)))
    if exclude_proposal_id:
        q = q.filter(PaymentProposal.id != exclude_proposal_id)
    return {r[0] for r in q.all()}


def _invoices_in_held_payments(db: Session) -> set[int]:
    ids: set[int] = set()
    for p in db.query(PaymentTransaction).filter(PaymentTransaction.status == "pending_approval",
                                                 PaymentTransaction.payment_type == "vendor").all():
        for a in p.pending_allocations or []:
            if a.get("target_type") == "vendor_invoice":
                ids.add(a.get("target_id"))
    return ids


def _vendor_credits(db: Session, vendor_id: int) -> list[tuple[str, object, float]]:
    """Open debit notes and supplier advances, oldest first: (source_type, row, available)."""
    out: list[tuple[str, object, float]] = []
    for n in db.query(PartyNote).filter(PartyNote.vendor_id == vendor_id, PartyNote.note_type == "debit_note",
                                        PartyNote.status == "posted", PartyNote.unadjusted_amount > 0.005)\
            .order_by(PartyNote.note_date.asc(), PartyNote.id.asc()).all():
        out.append(("party_note", n, _r(n.unadjusted_amount)))
    for p in db.query(PaymentTransaction).filter(PaymentTransaction.vendor_id == vendor_id, PaymentTransaction.payment_type == "vendor",
                                                 PaymentTransaction.status == "posted", PaymentTransaction.unallocated_amount > 0.005)\
            .order_by(PaymentTransaction.payment_date.asc(), PaymentTransaction.id.asc()).all():
        out.append(("advance" if p.is_advance else "payment", p, _r(p.unallocated_amount)))
    return out


def build_proposal(db: Session, *, pay_by_date: date, bank_account_id: int, payment_mode: str, created_by_id: int,
                   vendor_ids: list[int] | None = None, run_date: date | None = None, notes: str | None = None,
                   apply_credits: bool = True, take_discounts: bool = True) -> PaymentProposal:
    from app.modules.accounts.service import compute_early_payment_discount
    from app.modules.accounts.services.vouchers import _bank

    run_date = run_date or date.today()
    if payment_mode not in PAYMENT_MODES or payment_mode == "cash":
        raise ValueError(f"Pick how the run pays — one of: {', '.join(m for m in PAYMENT_MODES if m != 'cash')}. A payment run "
                         f"goes through the bank, not the cash box.")
    bank = _bank(db, bank_account_id, "paying")
    if bank.account_kind == "cash":
        raise ValueError(f"'{bank.bank_name}' is a cash account — a payment run pays from a bank account.")
    fiscal.assert_postable(db, run_date)

    q = db.query(VendorInvoice).filter(VendorInvoice.status == "posted", VendorInvoice.amount_due > 0.005)
    if vendor_ids:
        q = q.filter(VendorInvoice.vendor_id.in_(vendor_ids))
    invoices = [i for i in q.all() if (i.due_date or i.invoice_date) <= pay_by_date]
    busy = _invoices_in_live_runs(db) | _invoices_in_held_payments(db)
    vendors = {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_({i.vendor_id for i in invoices} or {0})).all()}

    pp = PaymentProposal(proposal_number=fiscal.next_number(db, "PP", run_date), run_date=run_date, pay_by_date=pay_by_date,
                         bank_account_id=bank.id, payment_mode=payment_mode, status="draft", notes=notes,
                         created_by_id=created_by_id)
    db.add(pp)
    db.flush()

    credits_left: dict[int, float] = {}
    for inv in sorted(invoices, key=lambda i: (i.vendor_id, i.due_date or i.invoice_date, i.id)):
        vendor = vendors.get(inv.vendor_id)
        excluded, why = False, None
        if inv.id in busy:
            continue  # already being paid — never propose a bill twice
        if inv.payment_block:
            excluded, why = True, f"Payment block: {inv.payment_block_reason or 'blocked on the invoice'}"
        elif vendor is None or vendor.status == "blocked":
            excluded, why = True, "Vendor is blocked"
        elif not (vendor.bank_account_no and vendor.ifsc_code):
            excluded, why = True, "Vendor bank account / IFSC missing — add it under Finance > Masters > Vendors"
        due = _r(inv.amount_due)
        credit = 0.0
        if apply_credits and not excluded:
            if inv.vendor_id not in credits_left:
                credits_left[inv.vendor_id] = _r(sum(c[2] for c in _vendor_credits(db, inv.vendor_id)))
            credit = _r(min(credits_left[inv.vendor_id], due))
            credits_left[inv.vendor_id] = _r(credits_left[inv.vendor_id] - credit)
        discount = 0.0
        if take_discounts and not excluded and vendor and (vendor.early_payment_discount_pct or 0) > 0 \
                and inv.amount_paid <= 0.005 and run_date <= (inv.due_date or inv.invoice_date):
            discount = _r(min(compute_early_payment_discount(vendor, inv.invoice_amount), due - credit))
        db.add(PaymentProposalLine(proposal_id=pp.id, vendor_id=inv.vendor_id, vendor_invoice_id=inv.id,
                                   due_date=inv.due_date or inv.invoice_date, amount_due=due, credit_amount=credit,
                                   discount_amount=discount, amount=_r(due - credit - discount), excluded=excluded,
                                   exclusion_reason=why))
    db.flush()
    db.refresh(pp)
    recompute_total(pp)
    return pp


def recompute_total(pp: PaymentProposal) -> None:
    pp.total_amount = _r(sum(l.amount for l in pp.lines if not l.excluded))


def update_line(db: Session, *, proposal_id: int, line_id: int, excluded: bool | None = None,
                exclusion_reason: str | None = None, amount: float | None = None) -> PaymentProposal:
    pp = load(db, proposal_id)
    if not pp:
        raise ValueError("Payment run not found.")
    if pp.status not in ("draft", "rejected"):
        raise ValueError(f"Payment run {pp.proposal_number} is {pp.status} — only a draft (or a rejected run being reworked) can be changed.")
    line = next((l for l in pp.lines if l.id == line_id), None)
    if not line:
        raise ValueError("That bill is not in this payment run.")
    if excluded is not None:
        if excluded and not (exclusion_reason or "").strip():
            raise ValueError("Give the reason the bill is left out of the run (e.g. 'quality complaint open', 'hold per Partner').")
        if not excluded and line.excluded:
            inv = db.get(VendorInvoice, line.vendor_invoice_id)
            vendor = db.get(Vendor, line.vendor_id)
            if inv and inv.payment_block:
                raise ValueError(f"Invoice '{inv.invoice_number}' is blocked for payment — release the block on the invoice first.")
            if vendor and vendor.status == "blocked":
                raise ValueError(f"Vendor '{vendor.name}' is blocked — unblock it under Finance > Masters > Vendors first.")
        line.excluded = bool(excluded)
        line.exclusion_reason = ((exclusion_reason or "").strip() or None) if excluded else None
    if amount is not None:
        cap = _r(line.amount_due - line.credit_amount - line.discount_amount)
        amount = _r(amount)
        if amount < 0 or amount > cap + 1e-9:
            raise ValueError(f"Pay between 0 and {cap:,.2f} on this bill (amount due less credits and discount).")
        line.amount = amount
    if pp.status == "rejected":
        pp.status = "draft"
    recompute_total(pp)
    db.flush()
    return pp


def execute_proposal(db: Session, *, proposal_id: int, user_id: int, payment_date: date | None = None) -> PaymentProposal:
    from app.modules.accounts.service import lock_row, _ensure_not_maker
    from app.modules.accounts.services.vouchers import create_voucher, allocate, write_off

    pp = lock_row(db, PaymentProposal, proposal_id)
    if not pp:
        raise ValueError("Payment run not found.")
    if pp.status != "approved":
        raise ValueError(f"Payment run {pp.proposal_number} is {pp.status} — only an approved run can be executed.")
    on = payment_date or date.today()
    lines = [l for l in db.query(PaymentProposalLine).filter(PaymentProposalLine.proposal_id == pp.id).all() if not l.excluded]
    if not lines:
        raise ValueError("Every bill in this run is excluded — there is nothing to pay.")
    by_vendor: dict[int, list[PaymentProposalLine]] = {}
    for l in lines:
        by_vendor.setdefault(l.vendor_id, []).append(l)

    for vendor_id, vlines in by_vendor.items():
        vendor = db.get(Vendor, vendor_id)
        invs = {l.id: db.get(VendorInvoice, l.vendor_invoice_id) for l in vlines}
        for l in vlines:
            inv = invs[l.id]
            _ensure_not_maker(inv.created_by_id, user_id, "pay")
            if inv.status != "posted":
                raise ValueError(f"Invoice '{inv.invoice_number}' is no longer posted — take it out of the run.")
            if inv.payment_block:
                raise ValueError(f"Invoice '{inv.invoice_number}' was blocked for payment after the run was approved — exclude it "
                                 f"(a changed run needs approval again) or release the block.")
            if l.amount + l.credit_amount + l.discount_amount > inv.amount_due + 1e-9:
                raise ValueError(f"Invoice '{inv.invoice_number}' now has only {inv.amount_due:,.2f} due (it was settled elsewhere "
                                 f"after the run was built) — cancel this run and build a new one.")
        # 1. Set off debit notes / supplier advances first.
        credits = _vendor_credits(db, vendor_id)
        for l in vlines:
            need = l.credit_amount
            for i, (stype, src, avail) in enumerate(credits):
                if need <= 0.005:
                    break
                take = _r(min(avail, need))
                if take <= 0:
                    continue
                allocate(db, source_type=stype, source_id=src.id, target_type="vendor_invoice", target_id=l.vendor_invoice_id,
                         amount=take, allocation_date=on, created_by_id=user_id)
                credits[i] = (stype, src, _r(avail - take))
                need = _r(need - take)
            if need > 0.005:
                raise ValueError(f"{vendor.name}'s debit notes / advances were used elsewhere after the run was built — "
                                 f"{need:,.2f} of the planned set-off is no longer available. Cancel the run and build a new one.")
        # 2. One payment voucher per vendor.
        cash = _r(sum(l.amount for l in vlines))
        allocations = [{"target_type": "vendor_invoice", "target_id": l.vendor_invoice_id, "amount": l.amount}
                       for l in vlines if l.amount > 0.005]
        deductions = [{"target_type": "vendor_invoice", "target_id": l.vendor_invoice_id, "reason": "cash_discount",
                       "amount": l.discount_amount, "remarks": f"Early-payment discount ({pp.proposal_number})"}
                      for l in vlines if l.discount_amount > 0.005]
        if cash > 0.005:
            v = create_voucher(db, payment_type="vendor", bank_account_id=pp.bank_account_id, amount=cash,
                               payment_mode=pp.payment_mode, payment_date=on, vendor_id=vendor_id, allocations=allocations,
                               deductions=deductions, narration=f"Payment run {pp.proposal_number}", created_by_id=user_id,
                               payment_proposal_id=pp.id)
            v.approved_by_id = pp.approved_by_id
            for l in vlines:
                l.payment_transaction_id = v.id
        else:
            for d in deductions:
                write_off(db, target_type="vendor_invoice", target_id=d["target_id"], amount=d["amount"], reason="cash_discount",
                          write_off_date=on, created_by_id=user_id, remarks=d["remarks"])
    pp.status = "executed"
    pp.executed_by_id = user_id
    pp.executed_at = datetime.now(timezone.utc)
    db.flush()
    return pp


def bank_file_rows(db: Session, pp: PaymentProposal) -> list[dict]:
    if pp.status != "executed":
        raise ValueError(f"Payment run {pp.proposal_number} hasn't been executed yet — the bank file lists the posted payments.")
    bank = db.get(BankAccount, pp.bank_account_id)
    rows = []
    for v in db.query(PaymentTransaction).filter(PaymentTransaction.payment_proposal_id == pp.id,
                                                 PaymentTransaction.status == "posted").order_by(PaymentTransaction.id).all():
        vendor = db.get(Vendor, v.vendor_id)
        rows.append({
            "payment_number": v.payment_number, "payment_date": v.payment_date.isoformat(), "mode": v.payment_mode.upper(),
            "debit_account": bank.account_no if bank else "", "beneficiary_name": (vendor.account_holder_name or vendor.name) if vendor else "",
            "beneficiary_account": vendor.bank_account_no if vendor else "", "ifsc": vendor.ifsc_code if vendor else "",
            "beneficiary_bank": vendor.bank_name if vendor else "", "amount": f"{v.amount:.2f}",
            "email": vendor.contact_email if vendor else "", "remarks": f"{pp.proposal_number} {v.payment_number}"[:60], "utr": "",
        })
    return rows
