"""Opening balances — how figures from the previous system enter the books.

Posted as one Opening Balance voucher (OB/<FY>/<NNNN>) dated the first day
the books start, so they are dated, balanced and auditable like everything
else. Debits must equal credits: if the old trial balance didn't agree,
that difference has to be found before go-live, not parked in a suspense ledger.

Party balances are entered bill-wise (each unpaid vendor bill / customer
invoice separately, with its own date and due date), so aging and
bill-wise settlement work from day one."""
from datetime import date, timedelta
from sqlalchemy.orm import Session

from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.services.ledgers import ledger_id_for


def post_opening_balances(db: Session, *, as_of: date, ledger_lines: list[dict], vendor_bills: list[dict],
                          customer_bills: list[dict], created_by_id: int, narration: str | None = None) -> JournalEntry:
    """ledger_lines: [{gl_account_id, debit_amount, credit_amount}] for non-party ledgers.
    vendor_bills: [{vendor_id, bill_number, bill_date, due_date?, amount}] — amounts we owe.
    customer_bills: [{customer_id, invoice_number, invoice_date, due_date?, amount}] — amounts owed to us."""
    from app.modules.accounts.service import post_journal_entry
    from app.modules.crm.models.organization import Organization

    # A reversal keeps posting_type 'opening' but isn't an opening — only a
    # live original blocks a fresh one (same rule as index uq_je_one_opening).
    existing = db.query(JournalEntry).filter(
        JournalEntry.posting_type == "opening", JournalEntry.status == "posted",
        JournalEntry.reverses_journal_entry_id.is_(None),
    ).first()
    if existing:
        raise ValueError(
            f"Opening balances were already posted ({existing.entry_number} on {existing.posting_date:%d-%b-%Y}). "
            f"Reverse that voucher first if it has to be re-entered — two openings would double every balance."
        )

    lines: list[dict] = []
    for i, l in enumerate(ledger_lines or [], start=1):
        gl = db.query(GLAccount).filter(GLAccount.id == l.get("gl_account_id")).first()
        if not gl:
            raise ValueError(f"Ledger line {i}: pick a ledger.")
        if gl.is_control_account:
            raise ValueError(f"Ledger line {i}: '{gl.name}' is a party control account — enter its balance bill-wise under vendor/customer bills instead.")
        if gl.account_type in ("revenue", "expense"):
            raise ValueError(f"Ledger line {i}: '{gl.name}' is an income/expense ledger — those start every year at zero; carry last year's profit through Retained Earnings instead.")
        lines.append({"gl_account_id": gl.id, "debit_amount": l.get("debit_amount") or 0,
                      "credit_amount": l.get("credit_amount") or 0, "remarks": "Opening balance"})

    ap_default = ledger_id_for(db, "ap_control") if vendor_bills else None
    ar_default = ledger_id_for(db, "ar_control") if customer_bills else None
    vendor_docs, customer_docs = [], []
    for i, b in enumerate(vendor_bills or [], start=1):
        vendor = db.query(Vendor).filter(Vendor.id == b.get("vendor_id")).first()
        amount = round(float(b.get("amount") or 0), 2)
        if not vendor or amount <= 0 or not (b.get("bill_number") or "").strip():
            raise ValueError(f"Vendor bill {i}: needs a vendor, the bill number and an amount above zero.")
        bill_date = b.get("bill_date") or as_of
        if bill_date > as_of:
            raise ValueError(f"Vendor bill {i}: an opening bill can't be dated after the opening date.")
        due = b.get("due_date") or bill_date + timedelta(days=vendor.payment_days or 0)
        lines.append({"gl_account_id": vendor.gl_reconciliation_account_id or ap_default, "credit_amount": amount,
                      "vendor_id": vendor.id, "due_date": due, "remarks": f"Opening bill {b['bill_number']}"})
        vendor_docs.append((vendor, b["bill_number"].strip(), bill_date, due, amount))
    for i, b in enumerate(customer_bills or [], start=1):
        customer = db.query(Organization).filter(Organization.id == b.get("customer_id")).first()
        amount = round(float(b.get("amount") or 0), 2)
        if not customer or amount <= 0 or not (b.get("invoice_number") or "").strip():
            raise ValueError(f"Customer bill {i}: needs a customer, the invoice number and an amount above zero.")
        inv_date = b.get("invoice_date") or as_of
        if inv_date > as_of:
            raise ValueError(f"Customer bill {i}: an opening invoice can't be dated after the opening date.")
        due = b.get("due_date") or inv_date + timedelta(days=customer.credit_days if customer.credit_days is not None else 30)
        lines.append({"gl_account_id": customer.gl_reconciliation_account_id or ar_default, "debit_amount": amount,
                      "customer_id": customer.id, "due_date": due, "remarks": f"Opening invoice {b['invoice_number']}"})
        customer_docs.append((customer, b["invoice_number"].strip(), inv_date, due, amount))

    entry = post_journal_entry(
        db, posting_date=as_of, lines=lines, posting_type="opening", voucher_type="opening",
        description=narration or "Opening balances", created_by_id=created_by_id,
    )

    for vendor, number, bill_date, due, amount in vendor_docs:
        if db.query(VendorInvoice).filter(VendorInvoice.vendor_id == vendor.id, VendorInvoice.invoice_number == number).first():
            raise ValueError(f"Bill '{number}' from '{vendor.name}' already exists — opening bills must be ones not yet in the system.")
        db.add(VendorInvoice(
            invoice_type="opening", vendor_id=vendor.id, invoice_number=number, invoice_date=bill_date, due_date=due,
            invoice_amount=amount, invoice_gst=0, invoice_total=amount, matching_status="not_applicable",
            amount_due=amount, journal_entry_id=entry.id, status="posted", created_by_id=created_by_id,
            narration="Opening balance bill",
        ))
    for customer, number, inv_date, due, amount in customer_docs:
        doc_number = f"OB-{number}"[:50]
        if db.query(ARTransaction).filter(ARTransaction.invoice_number == doc_number).first():
            raise ValueError(f"Opening invoice '{number}' has already been entered.")
        db.add(ARTransaction(
            invoice_number=doc_number, customer_id=customer.id, invoice_date=inv_date, due_date=due,
            invoice_amount=amount, gst_amount=0, total_amount=amount, amount_due=amount,
            journal_entry_id=entry.id, status="posted", reference_type="opening", created_by_id=created_by_id,
            narration="Opening balance invoice",
        ))
    db.flush()
    return entry


def release_opening_documents(db: Session, *, journal_entry_id: int, reason: str) -> int:
    """Called when an Opening Balance voucher is reversed: its bill-wise open
    items (the opening vendor bills / customer invoices it created) must go
    too, or the party ledgers keep showing dues the GL no longer has.

    Refuses if any of them has already been settled — remove those
    allocations first. Each released bill is cancelled and its number is
    suffixed so the same bill numbers can be entered again in a corrected
    opening voucher (the original number stays in cancelled_reason)."""
    vendor_docs = db.query(VendorInvoice).filter(
        VendorInvoice.journal_entry_id == journal_entry_id, VendorInvoice.invoice_type == "opening",
        VendorInvoice.status == "posted",
    ).all()
    customer_docs = db.query(ARTransaction).filter(
        ARTransaction.journal_entry_id == journal_entry_id, ARTransaction.reference_type == "opening",
        ARTransaction.status == "posted",
    ).all()
    for d in vendor_docs:
        if (d.amount_paid or 0) > 0:
            raise ValueError(
                f"Opening bill '{d.invoice_number}' has already been settled ({d.amount_paid:,.2f}) — remove that "
                f"allocation under Finance > Payments first, then reverse the opening voucher."
            )
    for d in customer_docs:
        if (d.amount_received or 0) > 0:
            raise ValueError(
                f"Opening invoice '{d.invoice_number}' has already been settled ({d.amount_received:,.2f}) — remove that "
                f"allocation under Finance > Payments first, then reverse the opening voucher."
            )
    for d in vendor_docs + customer_docs:
        original = d.invoice_number
        limit = 100 if isinstance(d, VendorInvoice) else 50
        suffix = f"~REV{journal_entry_id}"
        d.invoice_number = original[: limit - len(suffix)] + suffix
        d.status = "cancelled"
        d.amount_due = 0
        d.cancelled_reason = f"Opening voucher reversed ({original}): {reason}"
    db.flush()
    return len(vendor_docs) + len(customer_docs)
