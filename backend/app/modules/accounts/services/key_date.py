"""Key-date open items (SAP S_ALR_87012078 / 87012168 run for a past key date).

A bill counts as open on the key date when its posting (the invoice's GL
journal) is dated on or before it and it was not yet cancelled by then; what
was open is its total less only the allocations made on or before the key
date. Credits (receipts / payments on account, advances, unadjusted notes,
JV credits) are rebuilt the same way, so for every party

    sum(open bills as of D) - sum(open credits as of D) == party_balance(D)

Known limit: an allocation released after the key date (a cancelled voucher,
an un-allocated set-off) leaves no trace — its row is deleted. A voucher
cancelled after the key date is therefore shown as an unapplied credit on
the key date (its GL entry was live then), so the party net still ties to
the ledger, while the bill it had settled shows as open.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine, JE_MANUAL_POSTING_TYPES
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.models.payment_transaction import PaymentAllocation, PaymentTransaction
from app.modules.accounts.models.vendor_invoice import VendorInvoice


def _posting_dates(db: Session, je_ids: set[int]) -> dict[int, date]:
    je_ids = {i for i in je_ids if i}
    if not je_ids:
        return {}
    return {j: d for j, d in db.query(JournalEntry.id, JournalEntry.posting_date).filter(JournalEntry.id.in_(je_ids)).all()}


def _reversal_dates(db: Session, je_ids: set[int]) -> dict[int, date]:
    """original journal id -> posting date of the journal that reversed it."""
    je_ids = {i for i in je_ids if i}
    if not je_ids:
        return {}
    return {orig: d for orig, d in db.query(JournalEntry.reverses_journal_entry_id, JournalEntry.posting_date)
            .filter(JournalEntry.reverses_journal_entry_id.in_(je_ids)).all()}


def _live_on(status: str, je_id: int | None, posted: dict, reversed_: dict, fallback: date, as_of: date) -> bool:
    if not je_id:
        return False
    if (posted.get(je_id) or fallback) > as_of:
        return False
    if status == "posted":
        return True
    # cancelled later: live on the key date only if the reversal came after it
    rev = reversed_.get(je_id)
    return rev is not None and rev > as_of


def _settled_by_target(db: Session, target_type: str, ids: list[int], as_of: date) -> dict[int, float]:
    out: dict[int, float] = {}
    if not ids:
        return out
    for tid, amount in db.query(PaymentAllocation.target_id, PaymentAllocation.amount).filter(
            PaymentAllocation.target_type == target_type, PaymentAllocation.target_id.in_(ids),
            PaymentAllocation.allocation_date <= as_of).all():
        out[tid] = out.get(tid, 0.0) + float(amount or 0)
    return out


def _used_by_source(db: Session, source_types: tuple[str, ...], ids: list[int], as_of: date) -> dict[int, float]:
    out: dict[int, float] = {}
    if not ids:
        return out
    for sid, amount in db.query(PaymentAllocation.source_id, PaymentAllocation.amount).filter(
            PaymentAllocation.source_type.in_(source_types), PaymentAllocation.source_id.in_(ids),
            PaymentAllocation.allocation_date <= as_of).all():
        out[sid] = out.get(sid, 0.0) + float(amount or 0)
    return out


def documents_as_of(db: Session, *, party_type: str, party_id: int | None, as_of: date) -> list[dict]:
    """Bills open on the key date, with the amount that was due then (no
    days/bucket — the caller ages them against the key date)."""
    if party_type == "vendor":
        q = db.query(VendorInvoice).filter(VendorInvoice.status.in_(("posted", "cancelled")),
                                           VendorInvoice.journal_entry_id.isnot(None), VendorInvoice.invoice_date <= as_of)
        if party_id:
            q = q.filter(VendorInvoice.vendor_id == party_id)
        target_type = "vendor_invoice"
    else:
        q = db.query(ARTransaction).filter(ARTransaction.status.in_(("posted", "cancelled")),
                                           ARTransaction.journal_entry_id.isnot(None), ARTransaction.invoice_date <= as_of)
        if party_id:
            q = q.filter(ARTransaction.customer_id == party_id)
        target_type = "ar_transaction"
    docs = q.all()
    je_ids = {d.journal_entry_id for d in docs}
    posted, reversed_ = _posting_dates(db, je_ids), _reversal_dates(db, je_ids)
    docs = [d for d in docs if _live_on(d.status, d.journal_entry_id, posted, reversed_, d.invoice_date, as_of)]
    settled = _settled_by_target(db, target_type, [d.id for d in docs], as_of)
    rows = []
    for d in docs:
        if party_type == "vendor":
            total, pid, due = float(d.invoice_total or 0), d.vendor_id, d.due_date or d.invoice_date
        else:
            total, pid, due = float(d.total_amount or 0), d.customer_id, d.due_date
        s = round(settled.get(d.id, 0.0), 2)
        amount_due = round(total - s, 2)
        if amount_due > 0.005:
            rows.append({"target_type": target_type, "id": d.id, "party_id": pid, "doc_number": d.invoice_number,
                         "doc_date": d.invoice_date, "due_date": due, "total": total, "settled": s, "amount_due": amount_due})
    return rows


def credits_as_of(db: Session, *, party_type: str, party_id: int | None, as_of: date) -> list[dict]:
    """Receipts / payments on account, advances, unadjusted notes and JV
    credits as they stood on the key date."""
    rows: list[dict] = []
    vendor = party_type == "vendor"
    q = db.query(PaymentTransaction).filter(PaymentTransaction.status.in_(("posted", "cancelled")),
                                            PaymentTransaction.journal_entry_id.isnot(None),
                                            PaymentTransaction.payment_date <= as_of,
                                            PaymentTransaction.payment_type == ("vendor" if vendor else "customer"))
    if party_id:
        q = q.filter((PaymentTransaction.vendor_id if vendor else PaymentTransaction.customer_id) == party_id)
    pays = q.all()
    je_ids = {p.journal_entry_id for p in pays}
    posted, reversed_ = _posting_dates(db, je_ids), _reversal_dates(db, je_ids)
    pays = [p for p in pays if _live_on(p.status, p.journal_entry_id, posted, reversed_, p.payment_date, as_of)]
    used = _used_by_source(db, ("payment", "advance"), [p.id for p in pays], as_of)
    for p in pays:
        available = round(float(p.amount or 0) - used.get(p.id, 0.0), 2)
        if available > 0.005:
            rows.append({"source_type": "advance" if p.is_advance else "payment", "id": p.id,
                         "party_id": p.vendor_id if vendor else p.customer_id, "doc_number": p.payment_number,
                         "doc_date": p.payment_date, "amount": p.amount, "available": available,
                         "is_advance": bool(p.is_advance), "sales_order_id": p.sales_order_id,
                         "purchase_order_id": p.purchase_order_id})

    q = db.query(PartyNote).filter(PartyNote.status.in_(("posted", "cancelled")), PartyNote.journal_entry_id.isnot(None),
                                   PartyNote.note_date <= as_of,
                                   PartyNote.note_type == ("debit_note" if vendor else "credit_note"))
    if party_id:
        q = q.filter((PartyNote.vendor_id if vendor else PartyNote.customer_id) == party_id)
    notes = q.all()
    je_ids = {n.journal_entry_id for n in notes}
    posted, reversed_ = _posting_dates(db, je_ids), _reversal_dates(db, je_ids)
    notes = [n for n in notes if _live_on(n.status, n.journal_entry_id, posted, reversed_, n.note_date, as_of)]
    used = _used_by_source(db, ("party_note",), [n.id for n in notes], as_of)
    for n in notes:
        available = round(float(n.total_amount or 0) - used.get(n.id, 0.0), 2)
        if available > 0.005:
            rows.append({"source_type": "party_note", "id": n.id, "party_id": n.vendor_id if vendor else n.customer_id,
                         "doc_number": n.note_number, "doc_date": n.note_date, "amount": n.total_amount, "available": available})

    col = JournalEntryLine.vendor_id if vendor else JournalEntryLine.customer_id
    amt_col = JournalEntryLine.debit_amount if vendor else JournalEntryLine.credit_amount
    q = (db.query(JournalEntryLine, JournalEntry).join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
         .filter(col.isnot(None), amt_col > 0, JournalEntry.status.in_(("posted", "reversed")),
                 JournalEntry.reverses_journal_entry_id.is_(None), JournalEntry.reference_document_type.is_(None),
                 JournalEntry.posting_type.in_(JE_MANUAL_POSTING_TYPES), JournalEntry.posting_date <= as_of))
    if party_id:
        q = q.filter(col == party_id)
    pairs = q.all()
    reversed_ = _reversal_dates(db, {e.id for _, e in pairs})
    pairs = [(l, e) for l, e in pairs if e.id not in reversed_ or reversed_[e.id] > as_of]
    used = _used_by_source(db, ("journal",), [l.id for l, _ in pairs], as_of)
    for line, entry in pairs:
        amount = line.debit_amount if vendor else line.credit_amount
        available = round(float(amount or 0) - used.get(line.id, 0.0), 2)
        if available > 0.005:
            rows.append({"source_type": "journal", "id": line.id, "party_id": line.vendor_id if vendor else line.customer_id,
                         "doc_number": entry.entry_number, "doc_date": entry.posting_date, "amount": amount,
                         "available": available, "journal_entry_id": entry.id})
    rows.sort(key=lambda r: (r["doc_date"], r["doc_number"]))
    return rows
