"""The Ledger Engine — post_journal_entry() is the ONLY function anywhere in
this codebase (now or in any future Accounts phase) that is allowed to create
a JournalEntry row. Every future post_vendor_invoice()/post_customer_invoice()/
post_payroll()/post_payment() etc. calls this, it never inserts JournalEntry
rows itself. See old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 2."""
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import func, text
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.accounts.models.bank_reconciliation import BankReconciliation

# Tolerance for the AP 3-way match — editable here later if the business
# needs different numbers; not exposed as user-facing config yet.
QTY_TOLERANCE_PCT = 2.0
AMOUNT_TOLERANCE_PCT = 1.0

# Seeded chart-of-accounts codes this module falls back to when a vendor has
# no gl_reconciliation_account_id of its own — see
# f2a3b4c5d6e7_seed_standard_chart_of_accounts.py.
DEFAULT_AP_CONTROL_ACCOUNT_CODE = "2010"  # Accounts Payable
GST_INPUT_ACCOUNT_CODE = "1150"  # GST Input Credit
DEFAULT_AR_CONTROL_ACCOUNT_CODE = "1130"  # Accounts Receivable
GST_OUTPUT_ACCOUNT_CODE = "2020"  # GST Output Payable


def _lock_number_series(db: Session, prefix: str) -> None:
    """See app/modules/p2p/service.py's identical helper for why this is
    needed — serializes concurrent number generation for this prefix."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def generate_je_number(db: Session) -> str:
    """JE-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"JE-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(JournalEntry.entry_number)).filter(
        JournalEntry.entry_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def _get_or_create_gl_balance(db: Session, gl_account_id: int, accounting_period: str) -> GLBalance:
    balance = db.query(GLBalance).filter(
        GLBalance.gl_account_id == gl_account_id, GLBalance.accounting_period == accounting_period
    ).with_for_update().first()
    if balance:
        return balance
    balance = GLBalance(gl_account_id=gl_account_id, accounting_period=accounting_period)
    db.add(balance)
    db.flush()
    return balance


def post_journal_entry(
    db: Session,
    *,
    posting_date: date,
    lines: list[dict],
    posting_type: str = "adjustment",
    description: str | None = None,
    accounting_period: str | None = None,
    reference_document_type: str | None = None,
    reference_document_id: int | None = None,
    created_by_id: int | None = None,
) -> JournalEntry:
    """Validates and posts a balanced double-entry journal entry, updating
    every touched (gl_account, accounting_period)'s GLBalance in the same
    call. Raises ValueError with the real reason on any validation failure —
    nothing is inserted until every check passes."""
    if len(lines) < 2:
        raise ValueError("A journal entry needs at least two lines.")

    for line in lines:
        debit = line.get("debit_amount") or 0
        credit = line.get("credit_amount") or 0
        if debit < 0 or credit < 0:
            raise ValueError("Debit/credit amounts cannot be negative.")
        if (debit > 0) == (credit > 0):
            raise ValueError("Each line must have exactly one of debit or credit amount — not both, not neither.")

    gl_account_ids = {line["gl_account_id"] for line in lines}
    gl_accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(gl_account_ids)).all()}
    for line in lines:
        account = gl_accounts.get(line["gl_account_id"])
        if not account:
            raise ValueError(f"GL account id {line['gl_account_id']} not found.")
        if account.status != "active":
            raise ValueError(f"GL account '{account.code} — {account.name}' is inactive and cannot be posted to.")
        if not account.is_posting_account:
            raise ValueError(f"GL account '{account.code} — {account.name}' is a group/header account — postings must go to a posting account.")

    total_debit = round(sum(line.get("debit_amount") or 0 for line in lines), 2)
    total_credit = round(sum(line.get("credit_amount") or 0 for line in lines), 2)
    if total_debit != total_credit:
        raise ValueError(f"Journal entry is out of balance — total debit {total_debit} does not equal total credit {total_credit}.")

    period = accounting_period or posting_date.strftime("%Y-%m")

    # Period-lock check, two layers (Phase 5):
    # 1. Whole-period lock — catches an account that's never been posted to
    #    in this period yet (so has no GLBalance row for it at all), which
    #    the per-balance check below would otherwise miss entirely.
    period_close = db.query(PeriodClose).filter(PeriodClose.accounting_period == period).first()
    if period_close and period_close.status == "closed":
        raise ValueError(f"Period {period} is closed — cannot post. Ask an admin to reopen it first if this posting is genuinely needed.")
    # 2. Per-GLBalance lock — belt-and-suspenders once close_period() has run
    #    and set is_locked=True on existing balance rows for the period.
    locked = db.query(GLBalance).filter(
        GLBalance.gl_account_id.in_(gl_account_ids), GLBalance.accounting_period == period, GLBalance.is_locked == True,  # noqa: E712
    ).first()
    if locked:
        account = gl_accounts[locked.gl_account_id]
        raise ValueError(f"Period {period} is locked for GL account '{account.code} — {account.name}' — cannot post.")

    entry = JournalEntry(
        entry_number=generate_je_number(db),
        posting_date=posting_date,
        accounting_period=period,
        posting_type=posting_type,
        reference_document_type=reference_document_type,
        reference_document_id=reference_document_id,
        description=description,
        total_debit=total_debit,
        total_credit=total_credit,
        status="posted",
        created_by_id=created_by_id,
        posted_by_id=created_by_id,
    )
    db.add(entry)
    db.flush()

    for i, line in enumerate(lines, start=1):
        db.add(JournalEntryLine(
            journal_entry_id=entry.id,
            line_number=i,
            gl_account_id=line["gl_account_id"],
            cost_center_id=line.get("cost_center_id"),
            internal_order_id=line.get("internal_order_id"),
            vendor_id=line.get("vendor_id"),
            customer_id=line.get("customer_id"),
            debit_amount=line.get("debit_amount") or 0,
            credit_amount=line.get("credit_amount") or 0,
            due_date=line.get("due_date"),
            remarks=line.get("remarks"),
        ))

    for gl_account_id in gl_account_ids:
        debit_sum = sum(line.get("debit_amount") or 0 for line in lines if line["gl_account_id"] == gl_account_id)
        credit_sum = sum(line.get("credit_amount") or 0 for line in lines if line["gl_account_id"] == gl_account_id)
        balance = _get_or_create_gl_balance(db, gl_account_id, period)
        balance.total_debits += debit_sum
        balance.total_credits += credit_sum
        balance.closing_balance = balance.opening_balance + balance.total_debits - balance.total_credits

    db.flush()
    return entry


def reverse_journal_entry(db: Session, *, journal_entry_id: int, reason: str, reversed_by_id: int) -> JournalEntry:
    """Never edits/deletes the original — posts a brand new entry with every
    line's debit/credit swapped, then marks the original as reversed."""
    original = db.query(JournalEntry).filter(JournalEntry.id == journal_entry_id).first()
    if not original:
        raise ValueError("Journal entry not found.")
    if original.status != "posted":
        raise ValueError(f"Only a posted journal entry can be reversed (current status: '{original.status}').")

    reversal_lines = [
        {
            "gl_account_id": line.gl_account_id,
            "cost_center_id": line.cost_center_id,
            "internal_order_id": line.internal_order_id,
            "vendor_id": line.vendor_id,
            "customer_id": line.customer_id,
            "debit_amount": line.credit_amount,
            "credit_amount": line.debit_amount,
            "due_date": line.due_date,
            "remarks": line.remarks,
        }
        for line in original.lines
    ]

    reversal = post_journal_entry(
        db,
        posting_date=date.today(),
        lines=reversal_lines,
        posting_type=original.posting_type,
        description=f"Reversal of {original.entry_number}: {reason}",
        created_by_id=reversed_by_id,
    )
    reversal.reverses_journal_entry_id = original.id

    original.status = "reversed"
    original.reversal_date = date.today()
    original.reversal_reason = reason
    original.reversed_by_id = reversed_by_id

    db.flush()
    return reversal


# ─────────────────────────────────────────────────────────────────────────
# Accounts Payable — Phase 3
# ─────────────────────────────────────────────────────────────────────────

def generate_payment_number(db: Session) -> str:
    """PAY-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"PAY-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(PaymentTransaction.payment_number)).filter(
        PaymentTransaction.payment_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def _match_vendor(db: Session, vendor_name: str, *, vendor_id: int | None = None) -> Vendor | None:
    """P2P's PurchaseOrder.vendor_id has no real FK to accounts.Vendor, so it
    isn't trustworthy as an identifier on its own — but when it happens to
    resolve to a real Vendor row, prefer it over the name match below, since
    two vendors sharing a name would otherwise get conflated here. Falls
    back to a case-insensitive name match (see Phase 3 plan) when vendor_id
    is absent or doesn't resolve. Same precedent as _match_store_item in
    p2p/routes/p2p_requests.py."""
    if vendor_id is not None:
        vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
        if vendor:
            return vendor
    if not vendor_name:
        return None
    return db.query(Vendor).filter(Vendor.name.ilike(vendor_name.strip())).first()


def _resolve_gl_account_by_code(db: Session, code: str) -> GLAccount:
    account = db.query(GLAccount).filter(GLAccount.code == code).first()
    if not account:
        raise ValueError(f"Expected GL account code '{code}' not found — check the chart of accounts.")
    return account


def _po_and_grn_quantities(db: Session, purchase_order_id: int) -> tuple[float, float]:
    """Returns (qty_po, qty_gr) — qty_po is the PO's total ordered quantity
    across all its items, qty_gr is the cumulative accepted quantity from
    every completed GRN against this PO. Same rollup as
    goods_receipts.py's _sync_po_and_pr_status, read-only here."""
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt

    po_items = db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.purchase_order_id == purchase_order_id).all()
    qty_po = sum(i.quantity for i in po_items)

    qty_gr = 0.0
    completed_grns = (
        db.query(P2PGoodsReceipt)
        .filter(P2PGoodsReceipt.purchase_order_id == purchase_order_id, P2PGoodsReceipt.status == "completed")
        .options(selectinload(P2PGoodsReceipt.items))
        .all()
    )
    for g in completed_grns:
        for it in g.items:
            qty_gr += it.accepted_quantity or 0
    return qty_po, qty_gr


def check_three_way_match(db: Session, *, purchase_order_id: int, invoice_qty: float, invoice_amount: float) -> dict:
    """Read-only — computes qty_po/qty_gr and whether invoice_qty/invoice_amount
    fall within tolerance of them. Used both as a pre-submit preview and to
    stamp a new VendorInvoice's matching_status."""
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == purchase_order_id).first()
    if not po:
        raise ValueError("Purchase order not found.")

    qty_po, qty_gr = _po_and_grn_quantities(db, purchase_order_id)
    po_amount = po.total_value or 0

    qty_reference = qty_gr if qty_gr > 0 else qty_po
    qty_variance_pct = abs(invoice_qty - qty_reference) / qty_reference * 100 if qty_reference else 0
    amount_variance_pct = abs(invoice_amount - po_amount) / po_amount * 100 if po_amount else 0

    within_tolerance = qty_variance_pct <= QTY_TOLERANCE_PCT and amount_variance_pct <= AMOUNT_TOLERANCE_PCT
    return {
        "qty_po": qty_po,
        "qty_gr": qty_gr,
        "qty_variance_pct": round(qty_variance_pct, 2),
        "amount_variance_pct": round(amount_variance_pct, 2),
        "matching_status": "matched" if within_tolerance else "variance",
    }


def create_vendor_invoice(db: Session, *, purchase_order_id: int, invoice_number: str, invoice_date: date,
                           invoice_amount: float, invoice_gst: float, expense_gl_account_id: int,
                           invoice_qty: float, created_by_id: int | None) -> VendorInvoice:
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == purchase_order_id).first()
    if not po:
        raise ValueError("Purchase order not found.")
    vendor = _match_vendor(db, po.vendor_name or "", vendor_id=po.vendor_id)
    if not vendor:
        raise ValueError(f"No vendor master found matching PO vendor name '{po.vendor_name}' — add it under Finance > Masters > Vendors first.")

    if db.query(VendorInvoice).filter(VendorInvoice.vendor_id == vendor.id, VendorInvoice.invoice_number == invoice_number).first():
        raise ValueError(f"Invoice '{invoice_number}' from vendor '{vendor.name}' has already been recorded.")

    match = check_three_way_match(db, purchase_order_id=purchase_order_id, invoice_qty=invoice_qty, invoice_amount=invoice_amount)
    invoice_total = round(invoice_amount + invoice_gst, 2)

    invoice = VendorInvoice(
        purchase_order_id=purchase_order_id,
        vendor_id=vendor.id,
        invoice_number=invoice_number,
        invoice_date=invoice_date,
        invoice_amount=invoice_amount,
        invoice_gst=invoice_gst,
        invoice_total=invoice_total,
        expense_gl_account_id=expense_gl_account_id,
        qty_po=match["qty_po"],
        qty_gr=match["qty_gr"],
        qty_invoice=invoice_qty,
        matching_status=match["matching_status"],
        amount_due=invoice_total,
        created_by_id=created_by_id,
    )
    db.add(invoice)
    db.flush()
    return invoice


def approve_variance(db: Session, *, vendor_invoice_id: int, approved_by_id: int, note: str | None) -> VendorInvoice:
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == vendor_invoice_id).first()
    if not invoice:
        raise ValueError("Vendor invoice not found.")
    if invoice.matching_status != "variance":
        raise ValueError(f"This invoice isn't awaiting variance approval (current matching status: '{invoice.matching_status}').")
    invoice.matching_status = "approved_variance"
    invoice.variance_approved_by_id = approved_by_id
    invoice.variance_approved_at = datetime.now(timezone.utc)
    invoice.variance_note = note
    db.flush()
    return invoice


def post_vendor_invoice(db: Session, *, vendor_invoice_id: int, created_by_id: int) -> JournalEntry:
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == vendor_invoice_id).first()
    if not invoice:
        raise ValueError("Vendor invoice not found.")
    if invoice.status != "pending":
        raise ValueError(f"Only a pending invoice can be posted (current status: '{invoice.status}').")
    if invoice.matching_status == "variance":
        raise ValueError("This invoice is outside 3-way-match tolerance and needs variance approval before it can be posted.")

    vendor = db.query(Vendor).filter(Vendor.id == invoice.vendor_id).first()
    ap_account_id = vendor.gl_reconciliation_account_id or _resolve_gl_account_by_code(db, DEFAULT_AP_CONTROL_ACCOUNT_CODE).id

    lines = [{"gl_account_id": invoice.expense_gl_account_id, "debit_amount": invoice.invoice_amount, "remarks": f"Invoice {invoice.invoice_number}"}]
    if invoice.invoice_gst > 0:
        gst_account = _resolve_gl_account_by_code(db, GST_INPUT_ACCOUNT_CODE)
        lines.append({"gl_account_id": gst_account.id, "debit_amount": invoice.invoice_gst, "remarks": "GST input credit"})
    due_date = invoice.invoice_date + timedelta(days=vendor.payment_days or 0)
    lines.append({
        "gl_account_id": ap_account_id, "credit_amount": invoice.invoice_total,
        "vendor_id": vendor.id, "due_date": due_date, "remarks": f"Invoice {invoice.invoice_number}",
    })

    entry = post_journal_entry(
        db, posting_date=invoice.invoice_date, lines=lines, posting_type="invoice",
        description=f"Vendor invoice {invoice.invoice_number} — {vendor.name}",
        reference_document_type="vendor_invoice", reference_document_id=invoice.id,
        created_by_id=created_by_id,
    )
    invoice.journal_entry_id = entry.id
    invoice.status = "posted"
    db.flush()
    return entry


def compute_early_payment_discount(vendor: Vendor, invoice_amount: float) -> float:
    """Flat suggested discount amount from the vendor's
    early_payment_discount_pct — see Phase 3 plan for why this isn't a full
    day-based 2/10-NET30 eligibility check (Vendor has no discount-window
    field yet)."""
    return round(invoice_amount * (vendor.early_payment_discount_pct or 0) / 100, 2)


def post_payment(db: Session, *, vendor_invoice_id: int, bank_account_id: int, amount: float, payment_mode: str,
                  payment_date: date, cheque_number: str | None = None, cheque_date: date | None = None,
                  created_by_id: int) -> tuple[PaymentTransaction, JournalEntry]:
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == vendor_invoice_id).first()
    if not invoice:
        raise ValueError("Vendor invoice not found.")
    if invoice.status != "posted":
        raise ValueError(f"Only a posted invoice can be paid (current status: '{invoice.status}').")
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")
    if amount > invoice.amount_due + 1e-9:
        raise ValueError(f"Payment amount ({amount}) exceeds the amount due ({invoice.amount_due}).")

    bank_account = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not bank_account:
        raise ValueError("Bank account not found.")
    if not bank_account.gl_account_id:
        raise ValueError(f"Bank account '{bank_account.bank_name} — {bank_account.account_no}' has no GL account linked — set one under Finance > Masters > Bank Accounts first.")

    vendor = db.query(Vendor).filter(Vendor.id == invoice.vendor_id).first()
    ap_account_id = vendor.gl_reconciliation_account_id or _resolve_gl_account_by_code(db, DEFAULT_AP_CONTROL_ACCOUNT_CODE).id

    entry = post_journal_entry(
        db, posting_date=payment_date,
        lines=[
            {"gl_account_id": ap_account_id, "debit_amount": amount, "vendor_id": vendor.id, "remarks": f"Payment against {invoice.invoice_number}"},
            {"gl_account_id": bank_account.gl_account_id, "credit_amount": amount, "remarks": f"Payment against {invoice.invoice_number}"},
        ],
        posting_type="payment",
        description=f"Payment to {vendor.name} against invoice {invoice.invoice_number}",
        reference_document_type="vendor_invoice", reference_document_id=invoice.id,
        created_by_id=created_by_id,
    )

    bank_account.current_balance -= amount

    payment = PaymentTransaction(
        payment_number=generate_payment_number(db), payment_type="vendor", payment_mode=payment_mode,
        payment_date=payment_date, amount=amount, bank_account_id=bank_account_id, vendor_id=vendor.id,
        vendor_invoice_id=invoice.id, cheque_number=cheque_number, cheque_date=cheque_date,
        journal_entry_id=entry.id, created_by_id=created_by_id,
    )
    db.add(payment)

    invoice.amount_paid = round(invoice.amount_paid + amount, 2)
    invoice.amount_due = round(invoice.amount_due - amount, 2)
    invoice.payment_status = "paid" if invoice.amount_due <= 1e-9 else "partial"

    db.flush()
    return payment, entry


# ─────────────────────────────────────────────────────────────────────────
# Accounts Receivable — Phase 4
# ─────────────────────────────────────────────────────────────────────────

def generate_ar_invoice_number(db: Session) -> str:
    """ARINV-[YEAR]-[NUMBER], sequence scoped per year — ours to the
    customer, unlike AP's vendor-supplied invoice_number."""
    year = date.today().year
    prefix = f"ARINV-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(ARTransaction.invoice_number)).filter(
        ARTransaction.invoice_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def create_ar_transaction(db: Session, *, customer_id: int, invoice_date: date, invoice_amount: float,
                           gst_amount: float, discount_amount: float, revenue_gl_account_id: int,
                           reference_type: str | None, reference_id: int | None,
                           created_by_id: int | None) -> ARTransaction:
    from app.modules.crm.models.organization import Organization

    customer = db.query(Organization).filter(Organization.id == customer_id).first()
    if not customer:
        raise ValueError("Customer not found.")

    credit_days = customer.credit_days if customer.credit_days is not None else 30
    due_date = invoice_date + timedelta(days=credit_days)
    total_amount = round(invoice_amount + gst_amount - discount_amount, 2)

    transaction = ARTransaction(
        invoice_number=generate_ar_invoice_number(db),
        customer_id=customer_id,
        invoice_date=invoice_date,
        due_date=due_date,
        invoice_amount=invoice_amount,
        gst_amount=gst_amount,
        discount_amount=discount_amount,
        total_amount=total_amount,
        revenue_gl_account_id=revenue_gl_account_id,
        reference_type=reference_type,
        reference_id=reference_id,
        amount_due=total_amount,
        created_by_id=created_by_id,
    )
    db.add(transaction)
    db.flush()
    return transaction


def post_customer_invoice(db: Session, *, ar_transaction_id: int, created_by_id: int) -> JournalEntry:
    from app.modules.crm.models.organization import Organization

    transaction = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
    if not transaction:
        raise ValueError("AR transaction not found.")
    if transaction.status != "pending":
        raise ValueError(f"Only a pending invoice can be posted (current status: '{transaction.status}').")

    customer = db.query(Organization).filter(Organization.id == transaction.customer_id).first()
    ar_account_id = customer.gl_reconciliation_account_id or _resolve_gl_account_by_code(db, DEFAULT_AR_CONTROL_ACCOUNT_CODE).id

    lines = [{
        "gl_account_id": ar_account_id, "debit_amount": transaction.total_amount,
        "customer_id": customer.id, "due_date": transaction.due_date, "remarks": f"Invoice {transaction.invoice_number}",
    }, {
        "gl_account_id": transaction.revenue_gl_account_id, "credit_amount": transaction.invoice_amount,
        "remarks": f"Invoice {transaction.invoice_number}",
    }]
    if transaction.gst_amount > 0:
        gst_account = _resolve_gl_account_by_code(db, GST_OUTPUT_ACCOUNT_CODE)
        lines.append({"gl_account_id": gst_account.id, "credit_amount": transaction.gst_amount, "remarks": "GST output payable"})

    entry = post_journal_entry(
        db, posting_date=transaction.invoice_date, lines=lines, posting_type="invoice",
        description=f"Customer invoice {transaction.invoice_number} — {customer.name}",
        reference_document_type="ar_transaction", reference_document_id=transaction.id,
        created_by_id=created_by_id,
    )
    transaction.journal_entry_id = entry.id
    transaction.status = "posted"
    db.flush()
    return entry


def post_collection(db: Session, *, ar_transaction_id: int, bank_account_id: int, amount: float, payment_mode: str,
                     payment_date: date, created_by_id: int) -> tuple[PaymentTransaction, JournalEntry]:
    from app.modules.crm.models.organization import Organization

    transaction = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
    if not transaction:
        raise ValueError("AR transaction not found.")
    if transaction.status != "posted":
        raise ValueError(f"Only a posted invoice can be collected against (current status: '{transaction.status}').")
    if amount <= 0:
        raise ValueError("Collection amount must be greater than zero.")
    if amount > transaction.amount_due + 1e-9:
        raise ValueError(f"Collection amount ({amount}) exceeds the amount due ({transaction.amount_due}).")

    bank_account = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not bank_account:
        raise ValueError("Bank account not found.")
    if not bank_account.gl_account_id:
        raise ValueError(f"Bank account '{bank_account.bank_name} — {bank_account.account_no}' has no GL account linked — set one under Finance > Masters > Bank Accounts first.")

    customer = db.query(Organization).filter(Organization.id == transaction.customer_id).first()
    ar_account_id = customer.gl_reconciliation_account_id or _resolve_gl_account_by_code(db, DEFAULT_AR_CONTROL_ACCOUNT_CODE).id

    entry = post_journal_entry(
        db, posting_date=payment_date,
        lines=[
            {"gl_account_id": bank_account.gl_account_id, "debit_amount": amount, "remarks": f"Collection against {transaction.invoice_number}"},
            {"gl_account_id": ar_account_id, "credit_amount": amount, "customer_id": customer.id, "remarks": f"Collection against {transaction.invoice_number}"},
        ],
        posting_type="payment",
        description=f"Collection from {customer.name} against invoice {transaction.invoice_number}",
        reference_document_type="ar_transaction", reference_document_id=transaction.id,
        created_by_id=created_by_id,
    )

    # Opposite direction from AP's post_payment, which decrements this.
    bank_account.current_balance += amount

    payment = PaymentTransaction(
        payment_number=generate_payment_number(db), payment_type="customer", payment_mode=payment_mode,
        payment_date=payment_date, amount=amount, bank_account_id=bank_account_id,
        ar_transaction_id=transaction.id, journal_entry_id=entry.id, created_by_id=created_by_id,
    )
    db.add(payment)

    transaction.amount_received = round(transaction.amount_received + amount, 2)
    transaction.amount_due = round(transaction.amount_due - amount, 2)
    transaction.collection_status = "collected" if transaction.amount_due <= 1e-9 else "partial"

    db.flush()
    return payment, entry


def compute_days_outstanding(ar_transaction: ARTransaction) -> int:
    """Read-time only — never stored, per the design doc's rule."""
    return (date.today() - ar_transaction.invoice_date).days


# ─────────────────────────────────────────────────────────────────────────
# Period Closing — Phase 5
# ─────────────────────────────────────────────────────────────────────────

def close_period(db: Session, *, accounting_period: str, closed_by_id: int, notes: str | None) -> PeriodClose:
    pending_invoice = db.query(VendorInvoice).filter(
        VendorInvoice.status == "pending", func.to_char(VendorInvoice.invoice_date, "YYYY-MM") == accounting_period,
    ).first()
    if pending_invoice:
        raise ValueError(f"Cannot close {accounting_period} — vendor invoice '{pending_invoice.invoice_number}' is still pending (not posted). Post or cancel it first.")
    pending_ar = db.query(ARTransaction).filter(
        ARTransaction.status == "pending", func.to_char(ARTransaction.invoice_date, "YYYY-MM") == accounting_period,
    ).first()
    if pending_ar:
        raise ValueError(f"Cannot close {accounting_period} — customer invoice '{pending_ar.invoice_number}' is still pending (not posted). Post or cancel it first.")

    period_close = db.query(PeriodClose).filter(PeriodClose.accounting_period == accounting_period).first()
    if period_close and period_close.status == "closed":
        raise ValueError(f"Period {accounting_period} is already closed.")
    if not period_close:
        period_close = PeriodClose(accounting_period=accounting_period)
        db.add(period_close)

    period_close.status = "closed"
    period_close.closed_by_id = closed_by_id
    period_close.closed_at = datetime.now(timezone.utc)
    period_close.close_notes = notes

    db.query(GLBalance).filter(GLBalance.accounting_period == accounting_period).update({"is_locked": True}, synchronize_session=False)

    db.flush()
    return period_close


def reopen_period(db: Session, *, accounting_period: str, reopened_by_id: int, reason: str) -> PeriodClose:
    period_close = db.query(PeriodClose).filter(PeriodClose.accounting_period == accounting_period).first()
    if not period_close or period_close.status != "closed":
        raise ValueError(f"Period {accounting_period} is not currently closed.")
    if not reason or not reason.strip():
        raise ValueError("A reason is required to reopen a closed period.")

    period_close.status = "open"
    period_close.reopened_by_id = reopened_by_id
    period_close.reopened_at = datetime.now(timezone.utc)
    period_close.reopen_reason = reason

    db.query(GLBalance).filter(GLBalance.accounting_period == accounting_period).update({"is_locked": False}, synchronize_session=False)

    db.flush()
    return period_close


# ─────────────────────────────────────────────────────────────────────────
# Cash Management — Phase 6
# ─────────────────────────────────────────────────────────────────────────

def compute_reconciliation_summary(db: Session, bank_reconciliation_id: int) -> dict:
    """Read-only. outstanding_cheques/deposits_in_transit are always derived
    from unreconciled PaymentTransaction rows, never separately entered."""
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == bank_reconciliation_id).first()
    if not recon:
        raise ValueError("Bank reconciliation not found.")

    unreconciled = db.query(PaymentTransaction).filter(
        PaymentTransaction.bank_account_id == recon.bank_account_id,
        PaymentTransaction.reconciliation_status == "pending",
        PaymentTransaction.payment_date <= recon.statement_date,
    ).all()
    outstanding_cheques = sum(p.amount for p in unreconciled if p.payment_type == "vendor")
    deposits_in_transit = sum(p.amount for p in unreconciled if p.payment_type == "customer")
    # Outstanding cheques: book balance already reflects these payments going
    # out, but the bank hasn't cleared them yet, so the bank's own balance is
    # still HIGHER than book by this amount. Deposits in transit: the mirror
    # case — book already reflects money coming in, bank hasn't credited it
    # yet, so the bank's balance is LOWER than book by this amount. The
    # expected bank statement balance is therefore book + outstanding - in-transit.
    reconciled_balance = round(recon.book_balance + outstanding_cheques - deposits_in_transit, 2)
    difference = round(recon.statement_balance - reconciled_balance, 2)

    return {
        "outstanding_cheques": round(outstanding_cheques, 2),
        "deposits_in_transit": round(deposits_in_transit, 2),
        "reconciled_balance": reconciled_balance,
        "difference": difference,
    }


def create_bank_reconciliation(db: Session, *, bank_account_id: int, statement_date: date, statement_balance: float,
                                created_by_id: int) -> BankReconciliation:
    bank_account = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not bank_account:
        raise ValueError("Bank account not found.")

    recon = BankReconciliation(
        bank_account_id=bank_account_id, statement_date=statement_date, statement_balance=statement_balance,
        book_balance=bank_account.current_balance, created_by_id=created_by_id,
    )
    db.add(recon)
    db.flush()
    return recon


def mark_payments_reconciled(db: Session, *, bank_reconciliation_id: int, payment_transaction_ids: list[int]) -> None:
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == bank_reconciliation_id).first()
    if not recon:
        raise ValueError("Bank reconciliation not found.")
    if recon.status != "in_progress":
        raise ValueError(f"This reconciliation is '{recon.status}' — only an in-progress reconciliation can have payments matched.")
    if not payment_transaction_ids:
        raise ValueError("No payments selected.")

    payments = db.query(PaymentTransaction).filter(PaymentTransaction.id.in_(payment_transaction_ids)).all()
    found_ids = {p.id for p in payments}
    missing = set(payment_transaction_ids) - found_ids
    if missing:
        raise ValueError(f"Payment(s) not found: {sorted(missing)}")
    for p in payments:
        if p.bank_account_id != recon.bank_account_id:
            raise ValueError(f"Payment '{p.payment_number}' belongs to a different bank account than this reconciliation.")
        if p.reconciliation_status != "pending":
            raise ValueError(f"Payment '{p.payment_number}' is already reconciled.")
        p.reconciliation_status = "reconciled"
        p.bank_reconciliation_id = recon.id

    db.flush()


def complete_bank_reconciliation(db: Session, *, bank_reconciliation_id: int, completed_by_id: int) -> BankReconciliation:
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == bank_reconciliation_id).first()
    if not recon:
        raise ValueError("Bank reconciliation not found.")
    if recon.status == "completed":
        raise ValueError("This reconciliation is already completed.")

    summary = compute_reconciliation_summary(db, bank_reconciliation_id)
    if abs(summary["difference"]) >= 0.01:
        raise ValueError(f"Cannot complete — reconciliation is off by {summary['difference']}. Match or investigate the remaining outstanding items first.")

    recon.status = "completed"
    recon.completed_by_id = completed_by_id
    recon.completed_at = datetime.now(timezone.utc)
    db.flush()
    return recon


def get_liquidity_forecast(db: Session) -> dict:
    """Read-only projection, no stored table — see Phase 6 plan for why."""
    today = date.today()

    current_cash = db.query(func.coalesce(func.sum(BankAccount.current_balance), 0)).filter(BankAccount.status == "active").scalar() or 0

    def _bucket_for(due_date: date) -> str:
        days = (due_date - today).days
        if days < 0:
            return "overdue"
        if days <= 30:
            return "due_0_30"
        if days <= 60:
            return "due_31_60"
        return "due_61_plus"

    buckets = {k: {"inflows": 0.0, "outflows": 0.0} for k in ("overdue", "due_0_30", "due_31_60", "due_61_plus")}

    ar_open = db.query(ARTransaction).filter(ARTransaction.status == "posted", ARTransaction.amount_due > 0).all()
    for txn in ar_open:
        buckets[_bucket_for(txn.due_date)]["inflows"] += txn.amount_due

    ap_open = db.query(VendorInvoice).filter(VendorInvoice.status == "posted", VendorInvoice.amount_due > 0).all()
    for inv in ap_open:
        vendor = db.query(Vendor).filter(Vendor.id == inv.vendor_id).first()
        payment_days = vendor.payment_days if vendor and vendor.payment_days is not None else 0
        due = inv.invoice_date + timedelta(days=payment_days)
        buckets[_bucket_for(due)]["outflows"] += inv.amount_due

    order = ["overdue", "due_0_30", "due_31_60", "due_61_plus"]
    running_balance = current_cash
    forecast_buckets = []
    for key in order:
        b = buckets[key]
        net = round(b["inflows"] - b["outflows"], 2)
        running_balance = round(running_balance + net, 2)
        forecast_buckets.append({
            "bucket": key, "inflows": round(b["inflows"], 2), "outflows": round(b["outflows"], 2),
            "net": net, "projected_balance": running_balance,
        })

    return {"current_cash": round(current_cash, 2), "buckets": forecast_buckets}
