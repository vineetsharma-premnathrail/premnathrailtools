"""Accounts receivable / payable — party-wise outstanding, aging, statements.

Outstanding is bill-wise: every posted invoice keeps its own amount_due and
due_date, settled by allocations. Advances (vouchers not yet allocated) and
unadjusted notes are shown alongside so the party's net position always
equals its balance in the control account."""
from datetime import date, timedelta
from sqlalchemy.orm import Session

from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.models.payment_transaction import PaymentTransaction, PaymentAllocation
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine, JE_LEDGER_STATUSES
from app.modules.accounts.services.balances import party_balance

BUCKETS = ("not_due", "1_30", "31_60", "61_90", "over_90")


def aging_bucket(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "not_due"
    if days_overdue <= 30:
        return "1_30"
    if days_overdue <= 60:
        return "31_60"
    if days_overdue <= 90:
        return "61_90"
    return "over_90"


def _parties(db: Session, party_type: str, ids: set[int]) -> dict[int, object]:
    if not ids:
        return {}
    if party_type == "vendor":
        return {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_(ids)).all()}
    from app.modules.crm.models.organization import Organization
    return {o.id: o for o in db.query(Organization).filter(Organization.id.in_(ids)).all()}


def open_documents(db: Session, *, party_type: str, party_id: int | None = None, as_of: date | None = None) -> list[dict]:
    """Unsettled posted invoices, oldest due first. With a past `as_of` (key
    date) the bills and amounts are those open ON that date (services/key_date.py),
    not today's. Sales invoices carry `disputed` (open disputes, shown apart)."""
    today = as_of or date.today()
    if as_of is not None and as_of < date.today():
        from app.modules.accounts.services.key_date import documents_as_of
        rows = documents_as_of(db, party_type=party_type, party_id=party_id, as_of=as_of)
    elif party_type == "vendor":
        q = db.query(VendorInvoice).filter(VendorInvoice.status == "posted", VendorInvoice.amount_due > 0.005)
        if party_id:
            q = q.filter(VendorInvoice.vendor_id == party_id)
        docs = q.all()
        rows = [{"target_type": "vendor_invoice", "id": d.id, "party_id": d.vendor_id, "doc_number": d.invoice_number,
                 "doc_date": d.invoice_date, "due_date": d.due_date or d.invoice_date, "total": d.invoice_total,
                 "settled": d.amount_paid, "amount_due": d.amount_due} for d in docs]
    else:
        q = db.query(ARTransaction).filter(ARTransaction.status == "posted", ARTransaction.amount_due > 0.005)
        if party_id:
            q = q.filter(ARTransaction.customer_id == party_id)
        docs = q.all()
        rows = [{"target_type": "ar_transaction", "id": d.id, "party_id": d.customer_id, "doc_number": d.invoice_number,
                 "doc_date": d.invoice_date, "due_date": d.due_date, "total": d.total_amount,
                 "settled": d.amount_received, "amount_due": d.amount_due} for d in docs]
    disputed = {}
    if party_type != "vendor" and rows:
        from app.modules.accounts.services.disputes import disputed_by_invoice
        disputed = disputed_by_invoice(db, [r["id"] for r in rows], as_of=as_of if as_of is not None and as_of < date.today() else None)
    for r in rows:
        r["days_overdue"] = max((today - r["due_date"]).days, 0)
        r["bucket"] = aging_bucket((today - r["due_date"]).days)
        r["disputed"] = round(min(disputed.get(r["id"], 0.0), r["amount_due"]), 2)
    rows.sort(key=lambda r: (r["due_date"], r["doc_number"]))
    return rows


def open_credits(db: Session, *, party_type: str, party_id: int | None = None, as_of: date | None = None) -> list[dict]:
    """Advances and unadjusted notes waiting to be allocated (as they stood
    on a past `as_of` key date when given)."""
    if as_of is not None and as_of < date.today():
        from app.modules.accounts.services.key_date import credits_as_of
        return credits_as_of(db, party_type=party_type, party_id=party_id, as_of=as_of)
    rows = []
    q = db.query(PaymentTransaction).filter(PaymentTransaction.status == "posted", PaymentTransaction.unallocated_amount > 0.005,
                                            PaymentTransaction.payment_type == ("vendor" if party_type == "vendor" else "customer"))
    if party_id:
        q = q.filter((PaymentTransaction.vendor_id if party_type == "vendor" else PaymentTransaction.customer_id) == party_id)
    for p in q.all():
        rows.append({"source_type": "advance" if p.is_advance else "payment", "id": p.id,
                     "party_id": p.vendor_id if party_type == "vendor" else p.customer_id,
                     "doc_number": p.payment_number, "doc_date": p.payment_date, "amount": p.amount, "available": p.unallocated_amount,
                     "is_advance": bool(p.is_advance), "sales_order_id": p.sales_order_id, "purchase_order_id": p.purchase_order_id})
    q = db.query(PartyNote).filter(PartyNote.status == "posted", PartyNote.unadjusted_amount > 0.005,
                                   PartyNote.note_type == ("debit_note" if party_type == "vendor" else "credit_note"))
    if party_id:
        q = q.filter((PartyNote.vendor_id if party_type == "vendor" else PartyNote.customer_id) == party_id)
    for n in q.all():
        rows.append({"source_type": "party_note", "id": n.id, "party_id": n.vendor_id if party_type == "vendor" else n.customer_id,
                     "doc_number": n.note_number, "doc_date": n.note_date, "amount": n.total_amount, "available": n.unadjusted_amount})
    rows += _journal_credits(db, party_type=party_type, party_id=party_id)
    rows.sort(key=lambda r: (r["doc_date"], r["doc_number"]))
    return rows


def _journal_credits(db: Session, *, party_type: str, party_id: int | None) -> list[dict]:
    """Manual JV lines tagged to the party that reduce its balance (customer
    credit / vendor debit) and are not yet allocated to a bill — so a JV
    against a party can clear its open items (F-32 / F-44)."""
    from app.modules.accounts.models.journal_entry import JE_MANUAL_POSTING_TYPES

    col = JournalEntryLine.vendor_id if party_type == "vendor" else JournalEntryLine.customer_id
    amt_col = JournalEntryLine.debit_amount if party_type == "vendor" else JournalEntryLine.credit_amount
    q = (db.query(JournalEntryLine, JournalEntry).join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
         .filter(col.isnot(None), amt_col > 0, JournalEntry.status == "posted", JournalEntry.reverses_journal_entry_id.is_(None),
                 JournalEntry.reference_document_type.is_(None), JournalEntry.posting_type.in_(JE_MANUAL_POSTING_TYPES)))
    if party_id:
        q = q.filter(col == party_id)
    pairs = q.all()
    if not pairs:
        return []
    used: dict[int, float] = {}
    for a in db.query(PaymentAllocation).filter(PaymentAllocation.source_type == "journal",
                                                PaymentAllocation.source_id.in_([l.id for l, _ in pairs])).all():
        used[a.source_id] = used.get(a.source_id, 0) + a.amount
    rows = []
    for line, entry in pairs:
        amount = line.debit_amount if party_type == "vendor" else line.credit_amount
        available = round(amount - used.get(line.id, 0), 2)
        if available > 0.005:
            rows.append({"source_type": "journal", "id": line.id, "party_id": line.vendor_id if party_type == "vendor" else line.customer_id,
                         "doc_number": entry.entry_number, "doc_date": entry.posting_date, "amount": amount, "available": available,
                         "journal_entry_id": entry.id})
    return rows


def open_advances(db: Session, *, party_type: str | None = None, sales_order_id: int | None = None,
                  purchase_order_id: int | None = None) -> list[dict]:
    """Down payments (F-29 / F-48) not yet adjusted against an invoice, with
    the SO / PO they were taken against — what the advance ledgers hold."""
    q = db.query(PaymentTransaction).filter(PaymentTransaction.status == "posted", PaymentTransaction.is_advance.is_(True),
                                            PaymentTransaction.unallocated_amount > 0.005)
    if party_type:
        q = q.filter(PaymentTransaction.payment_type == party_type)
    if sales_order_id:
        q = q.filter(PaymentTransaction.sales_order_id == sales_order_id)
    if purchase_order_id:
        q = q.filter(PaymentTransaction.purchase_order_id == purchase_order_id)
    pays = q.order_by(PaymentTransaction.payment_date.asc()).all()
    vendors = _parties(db, "vendor", {p.vendor_id for p in pays if p.vendor_id})
    customers = _parties(db, "customer", {p.customer_id for p in pays if p.customer_id})
    so_numbers, po_numbers = {}, {}
    so_ids = {p.sales_order_id for p in pays if p.sales_order_id}
    po_ids = {p.purchase_order_id for p in pays if p.purchase_order_id}
    if so_ids:
        from app.modules.sales.models.order import SalesOrder
        so_numbers = {o.id: (o.so_number or f"Draft #{o.id}") for o in db.query(SalesOrder).filter(SalesOrder.id.in_(so_ids)).all()}
    if po_ids:
        from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
        po_numbers = {o.id: o.po_number for o in db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id.in_(po_ids)).all()}
    rows = []
    for p in pays:
        party = vendors.get(p.vendor_id) if p.payment_type == "vendor" else customers.get(p.customer_id)
        rows.append({"id": p.id, "payment_number": p.payment_number, "payment_date": p.payment_date, "party_type": p.payment_type,
                     "party_id": p.vendor_id or p.customer_id, "party_name": party.name if party else "—",
                     "amount": p.amount, "adjusted": round(p.amount - p.unallocated_amount, 2), "balance": p.unallocated_amount,
                     "sales_order_id": p.sales_order_id, "sales_order_number": so_numbers.get(p.sales_order_id),
                     "purchase_order_id": p.purchase_order_id, "purchase_order_number": po_numbers.get(p.purchase_order_id),
                     "advance_reason": p.advance_reason})
    return rows


def party_outstanding(db: Session, *, party_type: str, as_of: date | None = None) -> dict:
    if party_type not in ("vendor", "customer"):
        raise ValueError("party_type must be 'vendor' or 'customer'.")
    docs = open_documents(db, party_type=party_type, as_of=as_of)
    credits = open_credits(db, party_type=party_type, as_of=as_of)
    summary: dict[int, dict] = {}
    # Buckets and overdue age the undisputed part; open disputes sit in their
    # own 'disputed' column (buckets + disputed = outstanding).
    for d in docs:
        s = summary.setdefault(d["party_id"], {"party_id": d["party_id"], "open_bills": 0, "outstanding": 0.0, "overdue": 0.0,
                                               "advances": 0.0, "disputed": 0.0, **{b: 0.0 for b in BUCKETS}})
        undisputed = round(d["amount_due"] - d.get("disputed", 0.0), 2)
        s["open_bills"] += 1
        s["outstanding"] = round(s["outstanding"] + d["amount_due"], 2)
        s["disputed"] = round(s["disputed"] + d.get("disputed", 0.0), 2)
        s[d["bucket"]] = round(s[d["bucket"]] + undisputed, 2)
        if d["bucket"] != "not_due":
            s["overdue"] = round(s["overdue"] + undisputed, 2)
    for c in credits:
        s = summary.setdefault(c["party_id"], {"party_id": c["party_id"], "open_bills": 0, "outstanding": 0.0, "overdue": 0.0,
                                               "advances": 0.0, "disputed": 0.0, **{b: 0.0 for b in BUCKETS}})
        s["advances"] = round(s["advances"] + c["available"], 2)
    parties = _parties(db, party_type, set(summary))
    rows = []
    for pid, s in summary.items():
        p = parties.get(pid)
        s["party_name"] = p.name if p else "—"
        s["net"] = round(s["outstanding"] - s["advances"], 2)
        rows.append(s)
    rows.sort(key=lambda r: -r["outstanding"])
    totals = {k: round(sum(r[k] for r in rows), 2) for k in ("outstanding", "overdue", "advances", "net", "disputed", *BUCKETS)}
    return {"party_type": party_type, "as_of": as_of or date.today(), "rows": rows, "totals": totals}


def party_statement(db: Session, *, party_type: str, party_id: int, from_date: date, to_date: date) -> dict:
    """Ledger of one party from journal lines tagged with it, with running
    balance. Shown in the party's natural sign: what we owe a vendor /
    what a customer owes us is positive."""
    parties = _parties(db, party_type, {party_id})
    party = parties.get(party_id)
    if not party:
        raise ValueError(f"{party_type.title()} not found.")
    sign = -1 if party_type == "vendor" else 1
    kw = {"vendor_id": party_id} if party_type == "vendor" else {"customer_id": party_id}
    opening = round(sign * party_balance(db, as_of=from_date - timedelta(days=1), **kw), 2)
    col = JournalEntryLine.vendor_id if party_type == "vendor" else JournalEntryLine.customer_id
    q = (db.query(JournalEntryLine, JournalEntry).join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
         .filter(col == party_id, JournalEntry.status.in_(JE_LEDGER_STATUSES),
                 JournalEntry.posting_date >= from_date, JournalEntry.posting_date <= to_date)
         .order_by(JournalEntry.posting_date.asc(), JournalEntry.id.asc()))
    running = opening
    rows = []
    for line, entry in q.all():
        running = round(running + sign * (line.debit_amount - line.credit_amount), 2)
        rows.append({"posting_date": entry.posting_date, "voucher_number": entry.entry_number, "voucher_type": entry.voucher_type,
                     "description": line.remarks or entry.description, "debit": line.debit_amount, "credit": line.credit_amount,
                     "balance": running, "journal_entry_id": entry.id})
    return {"party_type": party_type, "party_id": party_id, "party_name": party.name, "from_date": from_date, "to_date": to_date,
            "opening_balance": opening, "closing_balance": running, "rows": rows,
            "balance_meaning": "amount we owe the vendor" if party_type == "vendor" else "amount the customer owes us"}


def allocation_history(db: Session, *, target_type: str, target_id: int) -> list[dict]:
    rows = []
    for a in db.query(PaymentAllocation).filter(PaymentAllocation.target_type == target_type, PaymentAllocation.target_id == target_id)\
            .order_by(PaymentAllocation.allocation_date.asc()).all():
        if a.source_type in ("payment", "advance"):
            src = db.query(PaymentTransaction).filter(PaymentTransaction.id == a.source_id).first()
            number = src.payment_number if src else "?"
        elif a.source_type == "adjustment":
            from app.modules.accounts.models.settlement_adjustment import SettlementAdjustment, ADJUSTMENT_REASONS
            adj = db.query(SettlementAdjustment).filter(SettlementAdjustment.id == a.source_id).first()
            voucher = db.query(PaymentTransaction).filter(PaymentTransaction.id == adj.payment_transaction_id).first()                 if adj and adj.payment_transaction_id else None
            number = f"{ADJUSTMENT_REASONS.get(adj.reason, adj.reason) if adj else 'Deduction'}" + (f" ({voucher.payment_number})" if voucher else "")
        elif a.source_type == "journal":
            line = db.query(JournalEntryLine).filter(JournalEntryLine.id == a.source_id).first()
            je = db.query(JournalEntry).filter(JournalEntry.id == line.journal_entry_id).first() if line else None
            number = je.entry_number if je else "?"
        else:
            src = db.query(PartyNote).filter(PartyNote.id == a.source_id).first()
            number = src.note_number if src else "?"
        rows.append({"id": a.id, "source_type": a.source_type, "source_id": a.source_id, "source_number": number,
                     "amount": a.amount, "allocation_date": a.allocation_date})
    return rows
