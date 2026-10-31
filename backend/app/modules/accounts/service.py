"""The Ledger Engine — post_journal_entry() (and post_draft_journal(), which
finishes a draft through the same path) is the ONLY code anywhere in this
codebase allowed to put a journal entry into the books. Every business
posting — vendor/customer invoices, notes, payments, depreciation, closing
stock, year-end — builds its lines and calls it; nothing inserts
JournalEntry rows itself. See old_docs/product/ACCOUNTS_MODULE_ROADMAP.md
Phase 2 and docs/02-modules/finance/FINANCE_STANDARDS_PLAN.md.

This file holds the engine plus purchase/sales invoices, period close and
bank reconciliation. Vouchers (payments/receipts/contra, allocation) live in
services/vouchers.py, notes in services/notes.py, and the newer areas in the
rest of services/."""
import uuid
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.models.journal_entry import (
    JournalEntry, JournalEntryLine, VOUCHER_TYPES, JE_MANUAL_POSTING_TYPES,
)
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.vendor_invoice import VendorInvoice, VendorInvoiceLine
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.ar_transaction import ARTransaction, ARTransactionLine
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.accounts.models.bank_reconciliation import BankReconciliation
from app.modules.accounts.services import fiscal, gst
from app.modules.accounts.services import controlling
from app.modules.accounts.services.balances import apply_to_gl_balances, account_balance
from app.modules.accounts.services.ledgers import ledger_id_for

# Tolerance for the AP 3-way match — editable here later if the business
# needs different numbers; not exposed as user-facing config yet.
QTY_TOLERANCE_PCT = 2.0
AMOUNT_TOLERANCE_PCT = 1.0

_DEFAULT_VOUCHER_TYPE = {
    "payment": "payment", "receipt": "receipt", "contra": "contra", "debit_note": "debit_note",
    "credit_note": "credit_note", "opening": "opening",
}


def _draft_number() -> str:
    return f"DRAFT-{uuid.uuid4().hex[:12].upper()}"


def _is_draft_number(number: str | None) -> bool:
    return bool(number) and number.startswith("DRAFT-")


def lock_row(db: Session, model, row_id: int, *options):
    """SELECT ... FOR UPDATE on the document about to be posted/reversed.
    populate_existing() re-reads it even if this session loaded it earlier, so
    the second of two simultaneous requests waits here and then sees the
    first one's committed status instead of a stale 'pending'."""
    q = db.query(model).filter(model.id == row_id)
    if options:
        q = q.options(*options)
    return q.with_for_update().populate_existing().first()


def _is_unique_violation(e: IntegrityError) -> bool:
    orig = e.orig
    return getattr(orig, "sqlstate", None) == "23505" or getattr(orig, "pgcode", None) == "23505" \
        or str(orig).startswith("UNIQUE constraint failed")


def _duplicate_posting_reason(entry: JournalEntry) -> str:
    """The idempotency indexes (models/journal_entry.py) rejected this INSERT:
    someone else posted the same thing first, usually at the same moment."""
    if entry.reverses_journal_entry_id:
        return "This journal entry has already been reversed (someone else did it at the same moment) — reload the page to see the reversal."
    if entry.reference_document_type:
        what = entry.reference_document_type.replace("_", " ")
        return (f"This {what} has already been posted to the books (someone else posted it at the same moment) — "
                f"reload the page; nothing was posted twice.")
    if entry.posting_type == "year_end":
        return f"The financial year ending {entry.posting_date:%d-%b-%Y} has already been closed — reload the page."
    if entry.posting_type == "gst_setoff":
        return f"The GST set-off for {entry.accounting_period} is already posted — reload the page. Reverse it first to redo it."
    if entry.posting_type == "opening":
        return "Opening balances were already posted — reload the page. Reverse that voucher first if it has to be re-entered."
    return "This journal clashes with one already posted — reload the page."


# ─────────────────────────────────────────────────────────────────────────
# Ledger engine
# ─────────────────────────────────────────────────────────────────────────

def _validate_lines(db: Session, lines: list[dict], *, posting_type: str) -> tuple[dict, float, float]:
    """Checks every rule a set of journal lines must meet before it can
    exist, posted or draft. Returns (gl_accounts by id, total_debit, total_credit)."""
    if len(lines) < 2:
        raise ValueError("A journal entry needs at least two lines.")

    for i, line in enumerate(lines, start=1):
        debit = round(line.get("debit_amount") or 0, 2)
        credit = round(line.get("credit_amount") or 0, 2)
        line["debit_amount"], line["credit_amount"] = debit, credit
        if debit < 0 or credit < 0:
            raise ValueError(f"Line {i}: debit/credit amounts cannot be negative.")
        if (debit > 0) == (credit > 0):
            raise ValueError(f"Line {i}: each line must have exactly one of debit or credit amount — not both, not neither.")
        if not line.get("gl_account_id"):
            raise ValueError(f"Line {i}: pick a ledger.")

    gl_account_ids = {line["gl_account_id"] for line in lines}
    gl_accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(gl_account_ids)).all()}
    manual = posting_type in JE_MANUAL_POSTING_TYPES or posting_type == "opening"
    for i, line in enumerate(lines, start=1):
        account = gl_accounts.get(line["gl_account_id"])
        if not account:
            raise ValueError(f"Line {i}: GL account id {line['gl_account_id']} not found.")
        if account.status != "active":
            raise ValueError(f"Line {i}: GL account '{account.code} — {account.name}' is inactive and cannot be posted to.")
        if not account.is_posting_account:
            raise ValueError(f"Line {i}: GL account '{account.code} — {account.name}' is a group/header account — postings must go to a posting account.")
        if line.get("vendor_id") and line.get("customer_id"):
            raise ValueError(f"Line {i}: a line can name a vendor or a customer, not both.")
        # A control account's balance must always equal the sum of its party
        # balances — an untagged manual line would break that silently.
        if manual and account.is_control_account and not (line.get("vendor_id") or line.get("customer_id")):
            raise ValueError(
                f"Line {i}: '{account.code} — {account.name}' is a control account — name the vendor or customer "
                f"this line belongs to, or the party ledgers won't agree with it."
            )

    total_debit = round(sum(line["debit_amount"] for line in lines), 2)
    total_credit = round(sum(line["credit_amount"] for line in lines), 2)
    if total_debit != total_credit:
        raise ValueError(f"Journal entry is out of balance — total debit {total_debit:,.2f} does not equal total credit {total_credit:,.2f} (difference {total_debit - total_credit:+,.2f}).")
    return gl_accounts, total_debit, total_credit


def _check_period_open(db: Session, period: str, gl_accounts: dict) -> None:
    # Whole-period lock — catches accounts never yet posted to in the period.
    period_close = db.query(PeriodClose).filter(PeriodClose.accounting_period == period).first()
    if period_close and period_close.status == "closed":
        raise ValueError(f"Period {period} is closed — cannot post. Ask an admin to reopen it first if this posting is genuinely needed.")
    # Per-GLBalance lock — belt-and-suspenders once close_period() has run.
    locked = db.query(GLBalance).filter(
        GLBalance.gl_account_id.in_(list(gl_accounts)), GLBalance.accounting_period == period, GLBalance.is_locked == True,  # noqa: E712
    ).first()
    if locked:
        account = gl_accounts[locked.gl_account_id]
        raise ValueError(f"Period {period} is locked for GL account '{account.code} — {account.name}' — cannot post.")


def _add_lines(db: Session, entry: JournalEntry, lines: list[dict]) -> None:
    from app.modules.accounts.services import profit_centers  # KE5Z derivation
    pcs = profit_centers.derive_for_lines(db, entry, lines)
    for i, line in enumerate(lines, start=1):
        db.add(JournalEntryLine(
            journal_entry_id=entry.id, line_number=i, gl_account_id=line["gl_account_id"],
            cost_center_id=line.get("cost_center_id"), internal_order_id=line.get("internal_order_id"),
            profit_center_id=pcs[i - 1],
            vendor_id=line.get("vendor_id"), customer_id=line.get("customer_id"),
            debit_amount=line["debit_amount"], credit_amount=line["credit_amount"],
            due_date=line.get("due_date"), remarks=line.get("remarks"),
        ))


def _finalize_posting(db: Session, entry: JournalEntry, gl_accounts: dict, lines: list[dict],
                      *, entry_number: str | None, posted_by_id: int | None) -> None:
    """Shared tail of posting: FY + period checks, voucher number, balances,
    auto-reversal. `lines` are the plain dicts for the entry."""
    fy = fiscal.assert_postable(db, entry.posting_date)
    _check_period_open(db, entry.accounting_period, gl_accounts)
    if entry.auto_reverse_on is not None and entry.auto_reverse_on <= entry.posting_date:
        raise ValueError("The auto-reverse date must be after the posting date (an accrual reverses in the next period).")

    entry.financial_year = fy.code
    if entry_number:
        entry.entry_number = entry_number
    elif _is_draft_number(entry.entry_number) or not entry.entry_number:
        prefix = VOUCHER_TYPES.get(entry.voucher_type, "JV")
        entry.entry_number = fiscal.next_number(db, prefix, entry.posting_date)
    entry.status = "posted"
    entry.posted_by_id = posted_by_id

    per_account: dict[int, list[float]] = {}
    for line in lines:
        acc = per_account.setdefault(line["gl_account_id"], [0.0, 0.0])
        acc[0] += line["debit_amount"]
        acc[1] += line["credit_amount"]
    for gl_account_id, (debit, credit) in per_account.items():
        apply_to_gl_balances(db, gl_account_id, entry.accounting_period, round(debit, 2), round(credit, 2))
    db.flush()

    if entry.auto_reverse_on is not None:
        reverse_journal_entry(db, journal_entry_id=entry.id, reason="Auto-reversal", reversed_by_id=posted_by_id,
                              reversal_date=entry.auto_reverse_on)


def post_journal_entry(
    db: Session,
    *,
    posting_date: date,
    lines: list[dict],
    posting_type: str = "adjustment",
    voucher_type: str | None = None,
    description: str | None = None,
    accounting_period: str | None = None,
    reference_document_type: str | None = None,
    reference_document_id: int | None = None,
    created_by_id: int | None = None,
    entry_number: str | None = None,
    auto_reverse_on: date | None = None,
    reverses_journal_entry_id: int | None = None,
) -> JournalEntry:
    """Validates and posts a balanced double-entry journal entry, updating
    every touched ledger's balances in the same call. Raises ValueError with
    the real reason on any validation failure — nothing is written until
    every check passes (callers roll back on error).

    entry_number: pass the source document's own number when it is already
    a voucher number in its own series (sales invoice SI/…, notes, vouchers),
    so the document and its journal share one number.

    reverses_journal_entry_id: set by reverse_journal_entry() only. It must be
    on the row at INSERT — the one-posting-per-document index tells an
    original from its reversal by it."""
    lines = [dict(l) for l in lines]
    gl_accounts, total_debit, total_credit = _validate_lines(db, lines, posting_type=posting_type)
    if reverses_journal_entry_id is None:  # undoing a posting is always allowed
        controlling.apply_account_assignment(
            db, lines, posting_date=posting_date,
            enforce_required=controlling.requires_cost_object(posting_type, voucher_type or _DEFAULT_VOUCHER_TYPE.get(posting_type, "journal")))
    entry = JournalEntry(
        entry_number=_draft_number(),
        voucher_type=voucher_type or _DEFAULT_VOUCHER_TYPE.get(posting_type, "journal"),
        posting_date=posting_date,
        accounting_period=accounting_period or fiscal.period_of(posting_date),
        posting_type=posting_type,
        reference_document_type=reference_document_type,
        reference_document_id=reference_document_id,
        description=description,
        total_debit=total_debit,
        total_credit=total_credit,
        status="draft",
        created_by_id=created_by_id,
        auto_reverse_on=auto_reverse_on,
        reverses_journal_entry_id=reverses_journal_entry_id,
    )
    db.add(entry)
    try:
        db.flush()
    except IntegrityError as e:
        if not _is_unique_violation(e):
            raise
        # The transaction is now aborted — callers roll back on ValueError.
        raise ValueError(_duplicate_posting_reason(entry)) from None
    _add_lines(db, entry, lines)
    _finalize_posting(db, entry, gl_accounts, lines, entry_number=entry_number, posted_by_id=created_by_id)
    db.flush()
    return entry


def create_draft_journal(db: Session, *, posting_date: date, lines: list[dict], posting_type: str = "adjustment",
                         description: str | None = None, auto_reverse_on: date | None = None,
                         created_by_id: int | None = None) -> JournalEntry:
    """A manual journal waiting for a second person to post it (maker-
    checker). Validated now so the checker only ever sees a balanced entry."""
    if posting_type not in JE_MANUAL_POSTING_TYPES:
        raise ValueError(f"'{posting_type}' isn't a manual journal type — pick one of: {', '.join(JE_MANUAL_POSTING_TYPES)}.")
    lines = [dict(l) for l in lines]
    _, total_debit, total_credit = _validate_lines(db, lines, posting_type=posting_type)
    controlling.apply_account_assignment(db, lines, posting_date=posting_date, enforce_required=True)
    fiscal.fiscal_year_for(db, posting_date)  # fail early on a date outside every FY
    if auto_reverse_on is not None and auto_reverse_on <= posting_date:
        raise ValueError("The auto-reverse date must be after the posting date (an accrual reverses in the next period).")
    entry = JournalEntry(
        entry_number=_draft_number(), voucher_type="journal", posting_date=posting_date,
        accounting_period=fiscal.period_of(posting_date), posting_type=posting_type, description=description,
        total_debit=total_debit, total_credit=total_credit, status="draft", created_by_id=created_by_id,
        auto_reverse_on=auto_reverse_on,
    )
    db.add(entry)
    db.flush()
    _add_lines(db, entry, lines)
    db.flush()
    return entry


def _lines_as_dicts(entry: JournalEntry) -> list[dict]:
    return [{
        "gl_account_id": l.gl_account_id, "cost_center_id": l.cost_center_id, "internal_order_id": l.internal_order_id,
        "profit_center_id": l.profit_center_id, "vendor_id": l.vendor_id, "customer_id": l.customer_id, "debit_amount": l.debit_amount,
        "credit_amount": l.credit_amount, "due_date": l.due_date, "remarks": l.remarks,
    } for l in sorted(entry.lines, key=lambda x: x.line_number)]


def post_draft_journal(db: Session, *, journal_entry_id: int, posted_by_id: int) -> JournalEntry:
    entry = lock_row(db, JournalEntry, journal_entry_id, selectinload(JournalEntry.lines))
    if not entry:
        raise ValueError("Journal entry not found.")
    if entry.status != "draft":
        raise ValueError(f"Only a draft journal can be posted (current status: '{entry.status}').")
    _ensure_not_maker(entry.created_by_id, posted_by_id, "post", what="journal")
    lines = _lines_as_dicts(entry)
    gl_accounts, _, _ = _validate_lines(db, lines, posting_type=entry.posting_type)
    # Re-checked at posting: the order may have closed or the cost centre
    # lapsed since the draft was saved.
    controlling.apply_account_assignment(db, lines, posting_date=entry.posting_date, enforce_required=True)
    _finalize_posting(db, entry, gl_accounts, lines, entry_number=None, posted_by_id=posted_by_id)
    db.flush()
    return entry


def discard_draft_journal(db: Session, *, journal_entry_id: int, user_id: int) -> JournalEntry:
    entry = db.query(JournalEntry).filter(JournalEntry.id == journal_entry_id).first()
    if not entry:
        raise ValueError("Journal entry not found.")
    if entry.status != "draft":
        raise ValueError(f"Only a draft can be discarded — a posted entry is corrected by reversing it (current status: '{entry.status}').")
    entry.status = "cancelled"
    db.flush()
    return entry


def reverse_journal_entry(db: Session, *, journal_entry_id: int, reason: str, reversed_by_id: int | None,
                          reversal_date: date | None = None,
                          allow_reversal_of_reversal: bool = False) -> JournalEntry:
    """Never edits/deletes the original — posts a brand new entry with every
    line's debit/credit swapped, then marks the original as reversed. The
    original's lines still count in the books; the reversal cancels them.
    allow_reversal_of_reversal is only for system undo flows (e.g. cancelling a
    closing-stock valuation must undo its auto-reversal)."""
    original = lock_row(db, JournalEntry, journal_entry_id, selectinload(JournalEntry.lines))
    if not original:
        raise ValueError("Journal entry not found.")
    if original.status != "posted":
        raise ValueError(f"Only a posted journal entry can be reversed (current status: '{original.status}').")
    if original.reverses_journal_entry_id and not allow_reversal_of_reversal:
        raise ValueError(f"{original.entry_number} is itself a reversal and can't be reversed again — post a fresh journal instead.")
    if not reason or not reason.strip():
        raise ValueError("Give a reason for the reversal — it goes on the audit trail.")
    # A manual JV whose party line settles bills (allocation source 'journal')
    # can't be reversed while those settlements stand.
    from app.modules.accounts.models.payment_transaction import PaymentAllocation
    _line_ids = [l.id for l in original.lines]
    if _line_ids and db.query(PaymentAllocation.id).filter(
            PaymentAllocation.source_type == "journal", PaymentAllocation.source_id.in_(_line_ids)).first():
        raise ValueError(f"{original.entry_number} has been allocated against open bills — remove those allocations first "
                         f"(Finance > Outstanding > the bill's settlements), then reverse it.")
    on = reversal_date or date.today()
    if on < original.posting_date:
        raise ValueError(f"A reversal can't be dated before the original entry ({original.posting_date:%d-%b-%Y}).")

    reversal_lines = []
    for line in _lines_as_dicts(original):
        line["debit_amount"], line["credit_amount"] = line["credit_amount"], line["debit_amount"]
        reversal_lines.append(line)

    reversal = post_journal_entry(
        db, posting_date=on, lines=reversal_lines, posting_type=original.posting_type,
        voucher_type="journal", description=f"Reversal of {original.entry_number}: {reason}",
        reference_document_type=original.reference_document_type, reference_document_id=original.reference_document_id,
        created_by_id=reversed_by_id, reverses_journal_entry_id=original.id,
    )

    original.status = "reversed"
    original.reversal_date = on
    original.reversal_reason = reason
    original.reversed_by_id = reversed_by_id
    db.flush()
    return reversal


def _ensure_not_maker(maker_id: int | None, checker_id: int | None, action: str, what: str = "invoice") -> None:
    """Maker-checker: whoever recorded a document can't also approve, post or
    pay it — otherwise one person can create and pay a liability alone.
    Applies to admins too."""
    if maker_id is not None and checker_id is not None and maker_id == checker_id:
        raise PermissionError(f"You recorded this {what}, so you can't {action} it yourself — another finance user must do that.")


def _grouped_ledger_lines(doc_lines, *, side: str, remarks: str, party: dict | None = None) -> list[dict]:
    """One journal line per (ledger, cost centre, internal order) — so a
    40-line bill doesn't become a 40-line journal, but cost-centre and
    internal-order reporting still work."""
    grouped: dict[tuple, float] = {}
    for l in doc_lines:
        key = (l.gl_account_id, l.cost_center_id, getattr(l, "internal_order_id", None))
        grouped[key] = grouped.get(key, 0.0) + float(l.taxable_amount or 0)
    out = []
    for (gl_id, cc_id, io_id), amount in grouped.items():
        amount = round(amount, 2)
        if amount <= 0:
            continue
        out.append({"gl_account_id": gl_id, "cost_center_id": cc_id, "internal_order_id": io_id,
                    f"{side}_amount": amount, "remarks": remarks, **(party or {})})
    return out


def tax_journal_lines(db: Session, *, kind: str, side: str, cgst: float, sgst: float, igst: float, remarks: str) -> list[dict]:
    """GST ledger lines. kind = 'input' | 'output'; side = 'debit' | 'credit'."""
    out = []
    for tax, amount in (("cgst", cgst), ("sgst", sgst), ("igst", igst)):
        if amount and round(amount, 2) > 0:
            out.append({"gl_account_id": ledger_id_for(db, f"{tax}_{kind}"), f"{side}_amount": round(amount, 2), "remarks": f"{tax.upper()} — {remarks}"})
    return out


def round_off_line(db: Session, round_off: float, *, party_side: str, remarks: str) -> list[dict]:
    """party_side is the side the party's total sits on. A positive round-off
    increases that total, so the round-off ledger takes the opposite side."""
    r = round(round_off or 0, 2)
    if not r:
        return []
    opposite = "credit" if party_side == "debit" else "debit"
    side = opposite if r > 0 else party_side
    return [{"gl_account_id": ledger_id_for(db, "round_off"), f"{side}_amount": abs(r), "remarks": f"Round off — {remarks}"}]


def _validate_doc_ledgers(db: Session, gl_ids: set[int], *, purpose: str) -> None:
    accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(gl_ids)).all()} if gl_ids else {}
    for gl_id in gl_ids:
        a = accounts.get(gl_id)
        if not a:
            raise ValueError(f"Ledger id {gl_id} not found.")
        if a.status != "active" or not a.is_posting_account:
            raise ValueError(f"Ledger '{a.code} — {a.name}' can't take {purpose} — it's inactive or a group account.")
        if a.is_control_account:
            raise ValueError(f"Ledger '{a.code} — {a.name}' is a party control account — pick the {purpose} ledger itself.")


# ─────────────────────────────────────────────────────────────────────────
# Accounts Payable — purchase invoices
# ─────────────────────────────────────────────────────────────────────────

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


def _po_grn_rollup(db: Session, purchase_order_id: int) -> tuple[float, float, float | None]:
    """(qty_po, qty_gr, received_value). received_value is the pre-tax value
    of what was actually accepted — sum of each completed GRN line's accepted
    quantity x its PO line's approved unit price — or None if any accepted
    line has no unit price (a legacy PO approved without one)."""
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt

    po_items = db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.purchase_order_id == purchase_order_id).all()
    qty_po = sum(i.quantity for i in po_items)
    unit_price_by_item = {i.id: i.unit_price for i in po_items}

    qty_gr = 0.0
    received_value: float | None = 0.0
    completed_grns = (
        db.query(P2PGoodsReceipt)
        .filter(P2PGoodsReceipt.purchase_order_id == purchase_order_id, P2PGoodsReceipt.status == "completed")
        .options(selectinload(P2PGoodsReceipt.items))
        .all()
    )
    for g in completed_grns:
        for it in g.items:
            # Net of goods returned to the vendor (Return to Vendor).
            accepted = max((it.accepted_quantity or 0) - (getattr(it, "returned_quantity", 0) or 0), 0.0)
            qty_gr += accepted
            if accepted <= 0 or received_value is None:
                continue
            unit_price = unit_price_by_item.get(it.po_item_id)
            received_value = None if unit_price is None else received_value + accepted * unit_price
    # Service lines are received by accepted service entries (no GRN).
    from app.modules.p2p.service import accepted_service_qty_by_po_item
    for po_item_id, accepted in accepted_service_qty_by_po_item(db, purchase_order_id).items():
        qty_gr += accepted
        if accepted <= 0 or received_value is None:
            continue
        unit_price = unit_price_by_item.get(po_item_id)
        received_value = None if unit_price is None else received_value + accepted * unit_price
    return qty_po, qty_gr, (round(received_value, 2) if received_value is not None else None)


# PR statuses at which the PO has cleared Purchase Head -> Director -> Partner.
_PO_APPROVED_PR_STATUSES = ("po_approved", "partially_received", "received", "closed")


def check_three_way_match(db: Session, *, purchase_order_id: int, invoice_qty: float, invoice_amount: float,
                          lines: list[dict] | None = None, exclude_invoice_id: int | None = None) -> dict:
    """Read-only — matches an incoming vendor invoice against the approved PO
    and what was actually received. Used both as a pre-submit preview and to
    stamp a new VendorInvoice's matching_status.

    Hard stops (ValueError — no approval can override these):
      - the PO never completed its Purchase Head / Director / Partner approval
        (or has no parent PR, so it never went through one);
      - nothing has been accepted on a GRN yet (no invoice before receipt);
      - this invoice would take the total invoiced past the approved PO value.

    Variance (a Finance Manager other than the invoice's creator must
    approve): quantity or amount outside tolerance of what was received but
    not yet invoiced, or a legacy PO with no line prices to match against.

    The invoice amount is compared pre-GST, against accepted qty x PO unit
    price, net of every earlier invoice on the same PO — so the same receipt
    can't be invoiced twice and an unpriced PO no longer "matches" anything.

    With `lines` (each naming its po_item_id) the variance is decided PER PO
    LINE (services/po_match.py: received vs invoiced qty in the PO unit, PO
    rate vs invoice rate, Procurement › Settings tolerances) instead of on
    header totals summed across lines; the header totals stay for display."""
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    from app.modules.p2p.models.p2p_request import P2PRequest

    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == purchase_order_id).first()
    if not po:
        raise ValueError("Purchase order not found.")
    if invoice_qty <= 0 or invoice_amount <= 0:
        raise ValueError("Invoice quantity and amount must both be greater than zero.")

    pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first() if po.p2p_request_id else None
    if not pr:
        raise ValueError(f"PO '{po.po_number}' isn't linked to a purchase requisition, so it never went through PO approval — an invoice can't be booked against it.")
    # Per PO, not per requisition: an approved PO can be invoiced while a sibling PO of the same
    # requisition is still in approval (po_split.po_is_released reads this PO's own approval request,
    # or the old Purchase Head / Director / Partner stamps for POs approved before the engine).
    from app.modules.p2p.po_split import po_is_released
    if not po_is_released(db, po):
        raise ValueError(f"PO '{po.po_number}' hasn't completed its own approval yet (Purchase Head / Director / Partner) — an invoice can't be booked against it until it has. Other POs of the same requisition don't matter; wait for this PO's approval to finish.")

    qty_po, qty_gr, received_value = _po_grn_rollup(db, purchase_order_id)
    if qty_gr <= 0:
        raise ValueError(f"No goods have been accepted against PO '{po.po_number}' yet — record and inspect the GRN before booking the vendor's invoice.")

    prior = db.query(VendorInvoice).filter(
        VendorInvoice.purchase_order_id == purchase_order_id, VendorInvoice.status != "cancelled",
    ).all()
    prior_qty = sum(i.qty_invoice or 0 for i in prior)
    prior_amount = round(sum(i.invoice_amount or 0 for i in prior), 2)

    po_is_priced = bool(po.items) and all(i.unit_price is not None for i in po.items)
    po_value_pre_tax = round(sum(i.quantity * i.unit_price for i in po.items), 2) if po_is_priced else None
    if po_value_pre_tax is not None and prior_amount + invoice_amount > po_value_pre_tax * (1 + AMOUNT_TOLERANCE_PCT / 100) + 1e-9:
        raise ValueError(
            f"This invoice would take the total invoiced on PO '{po.po_number}' to {prior_amount + invoice_amount:,.2f}, "
            f"above the approved PO value of {po_value_pre_tax:,.2f} (before GST). "
            f"Already invoiced: {prior_amount:,.2f}. The PO must be amended and re-approved to pay more."
        )

    reasons: list[str] = []
    open_qty = qty_gr - prior_qty
    if open_qty <= 1e-9:
        qty_variance_pct = 100.0
        reasons.append(f"all {qty_gr:g} accepted units have already been invoiced")
    else:
        qty_variance_pct = abs(invoice_qty - open_qty) / open_qty * 100
        if qty_variance_pct > QTY_TOLERANCE_PCT:
            reasons.append(f"invoice quantity {invoice_qty:g} vs {open_qty:g} received and not yet invoiced")

    open_value = round(received_value - prior_amount, 2) if received_value is not None else None
    if open_value is None:
        amount_variance_pct = 100.0
        reasons.append("the PO has lines with no unit price, so there is no approved value to match against")
    elif open_value <= 1e-9:
        amount_variance_pct = 100.0
        reasons.append("the value of everything received has already been invoiced")
    else:
        amount_variance_pct = abs(invoice_amount - open_value) / open_value * 100
        if amount_variance_pct > AMOUNT_TOLERANCE_PCT:
            reasons.append(f"invoice amount {invoice_amount:,.2f} vs {open_value:,.2f} value received and not yet invoiced (before GST)")

    line_match = None
    if lines:
        from app.modules.accounts.services.po_match import match_lines
        line_match = match_lines(db, po, lines, exclude_invoice_id=exclude_invoice_id)
        reasons = line_match["reasons"]

    return {
        "lines": line_match["lines"] if line_match else [],
        "line_results": line_match["line_results"] if line_match else [],
        "tolerances": line_match["tolerances"] if line_match else None,
        "qty_po": qty_po,
        "qty_gr": qty_gr,
        "qty_variance_pct": round(qty_variance_pct, 2),
        "amount_variance_pct": round(amount_variance_pct, 2),
        "matching_status": "variance" if reasons else "matched",
        "po_value": po_value_pre_tax,
        "received_value": received_value,
        "already_invoiced_qty": prior_qty,
        "already_invoiced_amount": prior_amount,
        "variance_reasons": reasons,
    }


def _legacy_single_line(*, description: str, qty: float, taxable: float, tax: float, interstate: bool, gl_account_id: int) -> tuple[dict, dict]:
    """Old one-amount payloads (invoice_amount + invoice_gst + one ledger) as a
    single line, so they post through the same path as line-item documents."""
    qty = qty if qty and qty > 0 else 1
    taxable, tax = round(taxable, 2), round(tax, 2)
    if interstate:
        cgst = sgst = 0.0
        igst = tax
    else:
        cgst = round(tax / 2, 2)
        sgst = round(tax - cgst, 2)
        igst = 0.0
    rate_pct = round(tax / taxable * 100, 3) if taxable else 0
    line = {"description": description, "quantity": qty, "rate": round(taxable / qty, 4), "discount_amount": 0,
            "taxable_amount": taxable, "gst_rate": rate_pct, "cgst_amount": cgst, "sgst_amount": sgst,
            "igst_amount": igst, "gl_account_id": gl_account_id}
    totals = {"taxable": taxable, "cgst": cgst, "sgst": sgst, "igst": igst, "tax": round(cgst + sgst + igst, 2)}
    return line, totals


def create_vendor_invoice(
    db: Session, *, invoice_number: str, invoice_date: date, created_by_id: int | None,
    purchase_order_id: int | None = None, vendor_id: int | None = None, lines: list[dict] | None = None,
    is_reverse_charge: bool = False, round_off: float = 0, place_of_supply_state_code: str | None = None,
    due_date: date | None = None, narration: str | None = None,
    # Legacy single-amount payload:
    invoice_amount: float | None = None, invoice_gst: float | None = None,
    expense_gl_account_id: int | None = None, invoice_qty: float | None = None,
    # Foreign-currency bill (import): line rates are in `currency`.
    currency: str | None = None, exchange_rate: float | None = None,
) -> VendorInvoice:
    """Records a purchase invoice (pending — posting is a separate step by
    another user). PO invoices are 3-way matched on the lines' total
    quantity and pre-GST value; direct invoices skip the match."""
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

    invoice_number = (invoice_number or "").strip()
    if not invoice_number:
        raise ValueError("Enter the vendor's invoice number exactly as printed on their bill.")

    po = None
    if purchase_order_id:
        # Lock the PO row so two invoices booked at the same moment can't both
        # pass the cumulative "already invoiced" cap in check_three_way_match.
        po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == purchase_order_id).with_for_update().first()
        if not po:
            raise ValueError("Purchase order not found.")
        vendor = _match_vendor(db, po.vendor_name or "", vendor_id=po.vendor_id)
        if not vendor:
            raise ValueError(f"No vendor master found matching PO vendor name '{po.vendor_name}' — add it under Finance > Masters > Vendors first.")
    else:
        if not vendor_id:
            raise ValueError("Pick the vendor — a direct (non-PO) invoice must name one.")
        vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
        if not vendor:
            raise ValueError("Vendor not found.")
    if vendor.status == "blocked":
        raise ValueError(f"Vendor '{vendor.name}' is blocked — unblock it under Finance > Masters > Vendors before booking its bills.")

    duplicate = db.query(VendorInvoice).filter(
        VendorInvoice.vendor_id == vendor.id, func.lower(VendorInvoice.invoice_number) == invoice_number.lower(),
    ).first()
    if duplicate:
        raise ValueError(
            f"Invoice '{invoice_number}' from vendor '{vendor.name}' has already been recorded (status: {duplicate.status}) — "
            f"the same bill can't be booked twice."
        )

    fiscal.fiscal_year_for(db, invoice_date)

    # Place of supply for an inward supply is where it's delivered — us.
    company_state = gst.require_company_state(db)
    pos = (place_of_supply_state_code or company_state).zfill(2)
    if pos not in gst.GST_STATE_CODES:
        raise ValueError(f"'{place_of_supply_state_code}' is not a GST state code.")
    vendor_state = gst.party_state_code(vendor.gstin, vendor.state)
    if not vendor_state:
        raise ValueError(f"Vendor '{vendor.name}' has no GSTIN or state, so CGST/SGST vs IGST can't be decided — complete it under Finance > Masters > Vendors.")
    interstate = vendor_state != pos
    registration = (vendor.gst_registration_type or "regular").lower()

    from app.modules.accounts.services import fx as _fx
    fx_doc = _fx.document_currency(db, lines, currency=currency, exchange_rate=exchange_rate, on=invoice_date)
    lines = fx_doc.lines
    if lines:
        default_ledger = vendor.default_expense_gl_account_id or ledger_id_for(db, "purchase_default")
        lines = [dict(l) for l in lines]
        po_items = {i.id: i for i in po.items} if po is not None else {}
        for i, l in enumerate(lines, start=1):
            l["gl_account_id"] = l.get("gl_account_id") or default_ledger
            l["description"] = (l.get("description") or "").strip() or "Purchase"
            # A line that names a PO line must be on this PO, and carries that
            # PO line's Item Master item — never a different one.
            if l.get("po_item_id"):
                po_item = po_items.get(l["po_item_id"])
                if po_item is None:
                    where = f"PO '{po.po_number}'" if po is not None else "a direct (non-PO) invoice"
                    raise ValueError(f"Line {i}: PO line #{l['po_item_id']} is not on {where} — pick the line from this invoice's own PO.")
                if l.get("store_item_id") and po_item.store_item_id and l["store_item_id"] != po_item.store_item_id:
                    raise ValueError(f"Line {i}: the item doesn't match PO line #{po_item.id} — invoice the item that was ordered on that line.")
                l["store_item_id"] = l.get("store_item_id") or po_item.store_item_id
        totals = gst.compute_lines(lines, interstate=interstate, allowed_rates=gst.active_rates(db))
        qty_total = round(sum(float(l["quantity"]) for l in lines), 4)
    else:
        if invoice_amount is None or not expense_gl_account_id:
            raise ValueError("Add at least one invoice line (ledger, quantity, rate, GST rate).")
        line, totals = _legacy_single_line(
            description=f"Against PO {po.po_number}" if po else "Purchase", qty=invoice_qty or 1,
            taxable=invoice_amount, tax=invoice_gst or 0, interstate=interstate, gl_account_id=expense_gl_account_id,
        )
        lines = [line]
        qty_total = invoice_qty or 1

    if totals["taxable"] <= 0:
        raise ValueError("Invoice value must be greater than zero.")
    _validate_doc_ledgers(db, {l["gl_account_id"] for l in lines}, purpose="the purchase")
    # Cost centre / internal order: PO's order → PR department's cost centre
    # → ledger default; checked now so the poster never meets the error.
    controlling.default_purchase_assignment(db, lines, po)
    controlling.apply_account_assignment(db, lines, posting_date=invoice_date, enforce_required=True)
    if totals["tax"] > 0 and registration in ("composition", "unregistered") and not is_reverse_charge:
        raise ValueError(
            f"Vendor '{vendor.name}' is {registration} under GST, so its bill can't carry GST input credit. "
            f"Set the GST rate to 0 on every line, or mark the bill as reverse charge if RCM applies."
        )
    round_off = gst.check_round_off(round_off)

    if po is not None:
        from app.modules.accounts.services.po_match import assign_po_lines
        assign_po_lines(po, lines)
        match = check_three_way_match(db, purchase_order_id=po.id, invoice_qty=qty_total, invoice_amount=totals["taxable"], lines=lines)
    else:
        match = {"qty_po": None, "qty_gr": None, "matching_status": "not_applicable"}

    vendor_owed = totals["taxable"] + (0 if is_reverse_charge else totals["tax"])
    invoice_total = round(vendor_owed + round_off, 2)
    invoice = VendorInvoice(
        invoice_type="po" if po is not None else "direct",
        purchase_order_id=po.id if po is not None else None,
        vendor_id=vendor.id,
        invoice_number=invoice_number,
        invoice_date=invoice_date,
        due_date=due_date or invoice_date + timedelta(days=vendor.payment_days or 0),
        vendor_gstin=(vendor.gstin or "").strip().upper() or None,
        place_of_supply_state_code=pos,
        is_interstate=interstate,
        is_reverse_charge=is_reverse_charge,
        cgst_amount=totals["cgst"], sgst_amount=totals["sgst"], igst_amount=totals["igst"],
        invoice_amount=totals["taxable"],
        invoice_gst=totals["tax"],
        round_off=round_off,
        invoice_total=invoice_total,
        expense_gl_account_id=expense_gl_account_id if not lines or len({l["gl_account_id"] for l in lines}) == 1 and expense_gl_account_id else None,
        narration=narration,
        qty_po=match["qty_po"],
        qty_gr=match["qty_gr"],
        qty_invoice=qty_total,
        matching_status=match["matching_status"],
        amount_due=invoice_total,
        created_by_id=created_by_id,
    )
    fx_doc.stamp(invoice, exclude_tax=is_reverse_charge)
    db.add(invoice)
    db.flush()
    for i, l in enumerate(lines, start=1):
        db.add(VendorInvoiceLine(
            vendor_invoice_id=invoice.id, line_number=i, description=l["description"], store_item_id=l.get("store_item_id"),
            hsn_sac_code=l.get("hsn_sac_code"), quantity=l["quantity"], uom=l.get("uom"), rate=l["rate"],
            discount_amount=l.get("discount_amount") or 0, taxable_amount=l["taxable_amount"], gst_rate=l.get("gst_rate") or 0,
            cgst_amount=l["cgst_amount"], sgst_amount=l["sgst_amount"], igst_amount=l["igst_amount"],
            gl_account_id=l["gl_account_id"], cost_center_id=l.get("cost_center_id"), po_item_id=l.get("po_item_id"),
            internal_order_id=l.get("internal_order_id"),
            **((match.get("line_results") or [{}] * len(lines))[i - 1] or {}),
        ))
    db.flush()
    return invoice


def approve_variance(db: Session, *, vendor_invoice_id: int, approved_by_id: int, note: str | None) -> VendorInvoice:
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == vendor_invoice_id).first()
    if not invoice:
        raise ValueError("Vendor invoice not found.")
    if invoice.matching_status != "variance":
        raise ValueError(f"This invoice isn't awaiting variance approval (current matching status: '{invoice.matching_status}').")
    _ensure_not_maker(invoice.created_by_id, approved_by_id, "approve the variance on")
    invoice.matching_status = "approved_variance"
    invoice.variance_approved_by_id = approved_by_id
    invoice.variance_approved_at = datetime.now(timezone.utc)
    invoice.variance_note = note
    db.flush()
    return invoice


def post_vendor_invoice(db: Session, *, vendor_invoice_id: int, created_by_id: int) -> JournalEntry:
    """Dr purchase/expense ledgers (taxable value, per line ledger)
       Dr CGST/SGST/IGST Input
         Cr Vendor (Sundry Creditors, tagged with the vendor)
         Cr GST RCM Payable (reverse charge only — the tax is owed to the
            Government, not the vendor)
       ± Round Off"""
    invoice = lock_row(db, VendorInvoice, vendor_invoice_id, selectinload(VendorInvoice.lines))
    if not invoice:
        raise ValueError("Vendor invoice not found.")
    if invoice.status != "pending":
        raise ValueError(f"Only a pending invoice can be posted (current status: '{invoice.status}').")
    if invoice.matching_status == "variance":
        raise ValueError("This invoice is outside 3-way-match tolerance and needs variance approval before it can be posted.")
    _ensure_not_maker(invoice.created_by_id, created_by_id, "post")

    vendor = db.query(Vendor).filter(Vendor.id == invoice.vendor_id).first()
    ap_account_id = vendor.gl_reconciliation_account_id or ledger_id_for(db, "ap_control")
    ref = f"Invoice {invoice.invoice_number}"

    lines = _grouped_ledger_lines(invoice.lines, side="debit", remarks=ref)
    lines += tax_journal_lines(db, kind="input", side="debit", cgst=invoice.cgst_amount, sgst=invoice.sgst_amount,
                               igst=invoice.igst_amount, remarks=ref)
    lines.append({"gl_account_id": ap_account_id, "credit_amount": invoice.invoice_total, "vendor_id": vendor.id,
                  "due_date": invoice.due_date, "remarks": ref})
    if invoice.is_reverse_charge and invoice.invoice_gst > 0:
        lines.append({"gl_account_id": ledger_id_for(db, "rcm_payable"), "credit_amount": invoice.invoice_gst, "remarks": f"RCM — {ref}"})
    lines += round_off_line(db, invoice.round_off, party_side="credit", remarks=ref)

    entry = post_journal_entry(
        db, posting_date=invoice.invoice_date, lines=lines, posting_type="invoice", voucher_type="purchase",
        description=f"Purchase invoice {invoice.invoice_number} — {vendor.name}",
        reference_document_type="vendor_invoice", reference_document_id=invoice.id,
        created_by_id=created_by_id,
    )
    invoice.journal_entry_id = entry.id
    invoice.status = "posted"
    db.flush()
    return entry


def cancel_vendor_invoice(db: Session, *, vendor_invoice_id: int, reason: str, user_id: int) -> VendorInvoice:
    invoice = lock_row(db, VendorInvoice, vendor_invoice_id)
    if not invoice:
        raise ValueError("Vendor invoice not found.")
    if invoice.status != "pending":
        raise ValueError(
            "Only a pending (unposted) invoice can be cancelled. A posted invoice is corrected with a debit note "
            "(Finance > Purchase > Debit Notes), so the books keep both the bill and its correction."
        )
    if not reason or not reason.strip():
        raise ValueError("Give a reason for cancelling the invoice.")
    invoice.status = "cancelled"
    invoice.cancelled_reason = reason
    db.flush()
    return invoice


def compute_early_payment_discount(vendor: Vendor, invoice_amount: float) -> float:
    """Flat suggested discount amount from the vendor's
    early_payment_discount_pct — see Phase 3 plan for why this isn't a full
    day-based 2/10-NET30 eligibility check (Vendor has no discount-window
    field yet)."""
    return round(invoice_amount * (vendor.early_payment_discount_pct or 0) / 100, 2)


def post_payment(db: Session, *, vendor_invoice_id: int, bank_account_id: int, amount: float, payment_mode: str,
                 payment_date: date, cheque_number: str | None = None, cheque_date: date | None = None,
                 created_by_id: int) -> tuple[PaymentTransaction, JournalEntry]:
    """Pay one vendor invoice — a payment voucher allocated entirely to it."""
    from app.modules.accounts.services.vouchers import create_voucher

    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == vendor_invoice_id).first()
    if not invoice:
        raise ValueError("Vendor invoice not found.")
    if invoice.status != "posted":
        raise ValueError(f"Only a posted invoice can be paid (current status: '{invoice.status}').")
    _ensure_not_maker(invoice.created_by_id, created_by_id, "pay")
    if amount > invoice.amount_due + 1e-9:
        raise ValueError(f"Payment amount ({amount:,.2f}) exceeds the amount due ({invoice.amount_due:,.2f}).")
    payment = create_voucher(
        db, payment_type="vendor", bank_account_id=bank_account_id, amount=amount, payment_mode=payment_mode,
        payment_date=payment_date, vendor_id=invoice.vendor_id, cheque_number=cheque_number, cheque_date=cheque_date,
        allocations=[{"target_type": "vendor_invoice", "target_id": invoice.id, "amount": amount}],
        created_by_id=created_by_id,
    )
    entry = db.query(JournalEntry).filter(JournalEntry.id == payment.journal_entry_id).first()
    return payment, entry


# ─────────────────────────────────────────────────────────────────────────
# Accounts Receivable — sales invoices
# ─────────────────────────────────────────────────────────────────────────

def create_ar_transaction(
    db: Session, *, customer_id: int, invoice_date: date, created_by_id: int | None,
    lines: list[dict] | None = None, round_off: float = 0, place_of_supply_state_code: str | None = None,
    billing_address: str | None = None, shipping_address: str | None = None,
    customer_po_number: str | None = None, customer_po_date: date | None = None, narration: str | None = None,
    irn: str | None = None, ack_no: str | None = None, ack_date: date | None = None,
    eway_bill_no: str | None = None, eway_bill_date: date | None = None, vehicle_no: str | None = None,
    reference_type: str | None = None, reference_id: int | None = None,
    # Legacy single-amount payload:
    invoice_amount: float | None = None, gst_amount: float = 0, discount_amount: float = 0,
    revenue_gl_account_id: int | None = None,
    # Foreign-currency invoice (export): line rates are in `currency`.
    currency: str | None = None, exchange_rate: float | None = None,
) -> ARTransaction:
    """Records a sales invoice as a draft. The tax-invoice number
    (SI/<FY>/<NNNN>) is issued only when it is posted, so a draft that is
    discarded never leaves a gap in the consecutive series GST requires
    (CGST Rule 46)."""
    from app.modules.crm.models.organization import Organization

    customer = db.query(Organization).filter(Organization.id == customer_id).first()
    if not customer:
        raise ValueError("Customer not found.")
    fiscal.fiscal_year_for(db, invoice_date)

    try:
        customer_gstin = gst.validate_gstin(customer.gst_number)
    except ValueError as e:
        raise ValueError(f"Customer '{customer.name}': {e} Fix it under CRM > Organizations before invoicing.")
    company_state = gst.require_company_state(db)
    pos = place_of_supply_state_code or gst.party_state_code(customer_gstin, customer.state)
    if not pos:
        raise ValueError(
            f"Customer '{customer.name}' has no GSTIN or state, so the place of supply (and CGST/SGST vs IGST) "
            f"can't be decided. Add it under CRM > Organizations, or enter the place of supply on the invoice."
        )
    pos = pos.zfill(2)
    if pos not in gst.GST_STATE_CODES:
        raise ValueError(f"'{pos}' is not a GST state code.")
    interstate = pos != company_state

    from app.modules.accounts.services import fx as _fx
    fx_doc = _fx.document_currency(db, lines, currency=currency, exchange_rate=exchange_rate, on=invoice_date)
    lines = fx_doc.lines
    if lines:
        default_ledger = ledger_id_for(db, "sales_default")
        lines = [dict(l) for l in lines]
        for l in lines:
            l["gl_account_id"] = l.get("gl_account_id") or default_ledger
            l["description"] = (l.get("description") or "").strip() or "Sale"
        totals = gst.compute_lines(lines, interstate=interstate, allowed_rates=gst.active_rates(db))
    else:
        if invoice_amount is None or not revenue_gl_account_id:
            raise ValueError("Add at least one invoice line (item/description, quantity, rate, GST rate).")
        line, totals = _legacy_single_line(
            description="Sale", qty=1, taxable=round(invoice_amount - (discount_amount or 0), 2),
            tax=gst_amount or 0, interstate=interstate, gl_account_id=revenue_gl_account_id,
        )
        lines = [line]
    if totals["taxable"] <= 0:
        raise ValueError("Invoice value must be greater than zero.")
    _validate_doc_ledgers(db, {l["gl_account_id"] for l in lines}, purpose="the sale")
    round_off = gst.check_round_off(round_off)

    credit_days = customer.credit_days if customer.credit_days is not None else 30
    total_amount = round(totals["taxable"] + totals["tax"] + round_off, 2)
    transaction = ARTransaction(
        invoice_number=_draft_number(),
        customer_id=customer_id,
        invoice_date=invoice_date,
        due_date=invoice_date + timedelta(days=credit_days),
        customer_gstin=customer_gstin,
        place_of_supply_state_code=pos,
        is_interstate=interstate,
        cgst_amount=totals["cgst"], sgst_amount=totals["sgst"], igst_amount=totals["igst"],
        invoice_amount=totals["taxable"],
        gst_amount=totals["tax"],
        discount_amount=0,
        round_off=round_off,
        total_amount=total_amount,
        revenue_gl_account_id=revenue_gl_account_id,
        billing_address=billing_address or customer.address,
        shipping_address=shipping_address,
        customer_po_number=customer_po_number, customer_po_date=customer_po_date, narration=narration,
        irn=irn, ack_no=ack_no, ack_date=ack_date, eway_bill_no=eway_bill_no, eway_bill_date=eway_bill_date,
        vehicle_no=vehicle_no,
        reference_type=reference_type,
        reference_id=reference_id,
        amount_due=total_amount,
        created_by_id=created_by_id,
    )
    fx_doc.stamp(transaction)
    db.add(transaction)
    db.flush()
    for i, l in enumerate(lines, start=1):
        db.add(ARTransactionLine(
            ar_transaction_id=transaction.id, line_number=i, description=l["description"], store_item_id=l.get("store_item_id"),
            hsn_sac_code=l.get("hsn_sac_code"), quantity=l["quantity"], uom=l.get("uom"), rate=l["rate"],
            discount_amount=l.get("discount_amount") or 0, taxable_amount=l["taxable_amount"], gst_rate=l.get("gst_rate") or 0,
            cgst_amount=l["cgst_amount"], sgst_amount=l["sgst_amount"], igst_amount=l["igst_amount"],
            gl_account_id=l["gl_account_id"], cost_center_id=l.get("cost_center_id"),
            internal_order_id=l.get("internal_order_id"),
        ))
    db.flush()
    return transaction


def post_customer_invoice(db: Session, *, ar_transaction_id: int, created_by_id: int) -> JournalEntry:
    """Issues the SI/<FY>/<NNNN> number and posts:
       Dr Customer (Sundry Debtors, tagged with the customer)
         Cr sales ledgers (taxable value, per line ledger)
         Cr CGST/SGST/IGST Output
       ± Round Off"""
    from app.modules.crm.models.organization import Organization

    transaction = lock_row(db, ARTransaction, ar_transaction_id, selectinload(ARTransaction.lines))
    if not transaction:
        raise ValueError("AR transaction not found.")
    if transaction.status != "pending":
        raise ValueError(f"Only a pending invoice can be posted (current status: '{transaction.status}').")
    _ensure_not_maker(transaction.created_by_id, created_by_id, "post")

    customer = db.query(Organization).filter(Organization.id == transaction.customer_id).first()
    ar_account_id = customer.gl_reconciliation_account_id or ledger_id_for(db, "ar_control")
    fiscal.assert_postable(db, transaction.invoice_date)
    if _is_draft_number(transaction.invoice_number):
        transaction.invoice_number = fiscal.next_number(db, VOUCHER_TYPES["sales"], transaction.invoice_date)
    ref = f"Invoice {transaction.invoice_number}"

    lines = [{
        "gl_account_id": ar_account_id, "debit_amount": transaction.total_amount,
        "customer_id": customer.id, "due_date": transaction.due_date, "remarks": ref,
    }]
    lines += _grouped_ledger_lines(transaction.lines, side="credit", remarks=ref)
    lines += tax_journal_lines(db, kind="output", side="credit", cgst=transaction.cgst_amount,
                               sgst=transaction.sgst_amount, igst=transaction.igst_amount, remarks=ref)
    lines += round_off_line(db, transaction.round_off, party_side="debit", remarks=ref)

    entry = post_journal_entry(
        db, posting_date=transaction.invoice_date, lines=lines, posting_type="invoice", voucher_type="sales",
        description=f"Sales invoice {transaction.invoice_number} — {customer.name}",
        reference_document_type="ar_transaction", reference_document_id=transaction.id,
        created_by_id=created_by_id, entry_number=transaction.invoice_number,
    )
    transaction.journal_entry_id = entry.id
    transaction.status = "posted"
    db.flush()
    from app.modules.accounts.services.billing import on_ar_changed  # SO billed qty / milestone (VF01)
    on_ar_changed(db, transaction.id)
    return entry


def cancel_ar_transaction(db: Session, *, ar_transaction_id: int, reason: str, user_id: int) -> ARTransaction:
    transaction = lock_row(db, ARTransaction, ar_transaction_id)
    if not transaction:
        raise ValueError("AR transaction not found.")
    if transaction.status != "pending":
        raise ValueError(
            "Only a draft invoice can be cancelled. A posted tax invoice is corrected with a credit note "
            "(Finance > Sales > Credit Notes) — GST law doesn't allow deleting an issued invoice."
        )
    if not reason or not reason.strip():
        raise ValueError("Give a reason for cancelling the invoice.")
    transaction.status = "cancelled"
    transaction.cancelled_reason = reason
    db.flush()
    from app.modules.accounts.services.billing import on_ar_changed  # releases the SO milestone it reserved
    on_ar_changed(db, transaction.id)
    return transaction


def post_collection(db: Session, *, ar_transaction_id: int, bank_account_id: int, amount: float, payment_mode: str,
                    payment_date: date, created_by_id: int) -> tuple[PaymentTransaction, JournalEntry]:
    """Collect against one invoice — a receipt voucher allocated entirely to it."""
    from app.modules.accounts.services.vouchers import create_voucher

    transaction = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
    if not transaction:
        raise ValueError("AR transaction not found.")
    if transaction.status != "posted":
        raise ValueError(f"Only a posted invoice can be collected against (current status: '{transaction.status}').")
    if amount > transaction.amount_due + 1e-9:
        raise ValueError(f"Collection amount ({amount:,.2f}) exceeds the amount due ({transaction.amount_due:,.2f}).")
    payment = create_voucher(
        db, payment_type="customer", bank_account_id=bank_account_id, amount=amount, payment_mode=payment_mode,
        payment_date=payment_date, customer_id=transaction.customer_id,
        allocations=[{"target_type": "ar_transaction", "target_id": transaction.id, "amount": amount}],
        created_by_id=created_by_id,
    )
    entry = db.query(JournalEntry).filter(JournalEntry.id == payment.journal_entry_id).first()
    return payment, entry


def compute_days_outstanding(ar_transaction: ARTransaction) -> int:
    """Read-time only — never stored, per the design doc's rule."""
    return (date.today() - ar_transaction.invoice_date).days


# ─────────────────────────────────────────────────────────────────────────
# Period Closing — Phase 5
# ─────────────────────────────────────────────────────────────────────────

def close_period(db: Session, *, accounting_period: str, closed_by_id: int, notes: str | None) -> PeriodClose:
    """Refuses while anything dated in the period is still unposted — a
    closed month must contain every document that belongs to it."""
    from app.modules.accounts.models.party_note import PartyNote

    from app.modules.accounts.models.inventory_valuation import InventoryValuation

    start, end = fiscal.period_bounds(accounting_period)
    if end >= date.today():
        raise ValueError(f"{accounting_period} hasn't ended yet (it runs to {end:%d-%b-%Y}) — close a month only after its last day, once every document for it is in.")
    draft_valuation = db.query(InventoryValuation).filter(
        InventoryValuation.accounting_period == accounting_period, InventoryValuation.status == "draft",
    ).first()
    if draft_valuation:
        raise ValueError(f"Cannot close {accounting_period} — its closing-stock valuation is still a draft. Post it (Finance > Inventory) or cancel it first.")
    pending_invoice = db.query(VendorInvoice).filter(
        VendorInvoice.status == "pending", VendorInvoice.invoice_date >= start, VendorInvoice.invoice_date <= end,
    ).first()
    if pending_invoice:
        raise ValueError(f"Cannot close {accounting_period} — vendor invoice '{pending_invoice.invoice_number}' is still pending (not posted). Post or cancel it first.")
    pending_ar = db.query(ARTransaction).filter(
        ARTransaction.status == "pending", ARTransaction.invoice_date >= start, ARTransaction.invoice_date <= end,
    ).first()
    if pending_ar:
        customer_ref = f"dated {pending_ar.invoice_date:%d-%b-%Y} for {pending_ar.total_amount:,.2f}"
        raise ValueError(f"Cannot close {accounting_period} — a draft sales invoice {customer_ref} is still unposted. Post or cancel it first.")
    pending_note = db.query(PartyNote).filter(
        PartyNote.status == "pending", PartyNote.note_date >= start, PartyNote.note_date <= end,
    ).first()
    if pending_note:
        raise ValueError(f"Cannot close {accounting_period} — a {pending_note.note_type.replace('_', ' ')} dated {pending_note.note_date:%d-%b-%Y} is still unposted. Post or cancel it first.")
    held_payment = db.query(PaymentTransaction).filter(
        PaymentTransaction.status == "pending_approval", PaymentTransaction.payment_date >= start, PaymentTransaction.payment_date <= end,
    ).first()
    if held_payment:
        raise ValueError(f"Cannot close {accounting_period} — a payment voucher dated {held_payment.payment_date:%d-%b-%Y} for "
                         f"{held_payment.amount:,.2f} is still waiting for approval. Get it approved or rejected first (My Approvals).")
    draft_je = db.query(JournalEntry).filter(
        JournalEntry.status == "draft", JournalEntry.posting_date >= start, JournalEntry.posting_date <= end,
    ).first()
    if draft_je:
        raise ValueError(f"Cannot close {accounting_period} — a draft journal dated {draft_je.posting_date:%d-%b-%Y} is waiting to be posted. Post or discard it first.")

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
# Cash Management — bank reconciliation
# ─────────────────────────────────────────────────────────────────────────

_OUTFLOW_TYPES = ("vendor", "expense", "contra", "employee")


def bank_book_balance(db: Session, bank_account: BankAccount, as_of: date | None = None) -> float:
    """The bank/cash account's balance per our books = its GL ledger."""
    if not bank_account.gl_account_id:
        return 0.0
    return account_balance(db, bank_account.gl_account_id, as_of or date.today())


def voucher_sides(db: Session, bank_account_id: int, *, as_of: date, include_cleared: bool = False) -> list[dict]:
    """Every voucher side that touches this bank account up to `as_of`:
    [{payment, direction: 'out'|'in', side: 'main'|'counter', cleared_date}]."""
    from sqlalchemy import or_

    q = db.query(PaymentTransaction).filter(
        PaymentTransaction.status == "posted", PaymentTransaction.payment_date <= as_of,
        or_(PaymentTransaction.bank_account_id == bank_account_id, PaymentTransaction.counter_bank_account_id == bank_account_id),
    ).order_by(PaymentTransaction.payment_date.asc(), PaymentTransaction.id.asc())
    out = []
    for p in q.all():
        if p.bank_account_id == bank_account_id:
            row = {"payment": p, "direction": "out" if p.payment_type in _OUTFLOW_TYPES else "in", "side": "main",
                   "cleared_date": p.cleared_date, "status": p.reconciliation_status}
            if include_cleared or p.reconciliation_status == "pending":
                out.append(row)
        if p.counter_bank_account_id == bank_account_id:
            row = {"payment": p, "direction": "in", "side": "counter",
                   "cleared_date": p.counter_cleared_date, "status": p.counter_reconciliation_status}
            if include_cleared or p.counter_reconciliation_status == "pending":
                out.append(row)
    return out


def compute_reconciliation_summary(db: Session, bank_reconciliation_id: int) -> dict:
    """Read-only. outstanding_cheques/deposits_in_transit are always derived
    from vouchers not yet cleared by the bank, never separately entered."""
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == bank_reconciliation_id).first()
    if not recon:
        raise ValueError("Bank reconciliation not found.")

    # A voucher side is outstanding at this statement if the bank hadn't
    # cleared it by the statement date — still pending, or cleared later (by
    # a later statement). Judging by the clearing date, not today's status,
    # keeps a completed reconciliation's figures fixed once the next month
    # clears its outstanding cheques.
    sides = voucher_sides(db, recon.bank_account_id, as_of=recon.statement_date, include_cleared=True)
    sides = [s for s in sides if s["status"] == "pending" or s["cleared_date"] is None
             or s["cleared_date"] > recon.statement_date]
    outstanding_cheques = sum(s["payment"].amount for s in sides if s["direction"] == "out")
    deposits_in_transit = sum(s["payment"].amount for s in sides if s["direction"] == "in")
    # While in progress the book side is read live, so a bank charge or
    # interest voucher booked (back-dated to the statement) to clear the
    # difference is counted; completing it freezes the snapshot.
    book_balance = recon.book_balance
    if recon.status == "in_progress":
        bank_account = db.query(BankAccount).filter(BankAccount.id == recon.bank_account_id).first()
        if bank_account:
            book_balance = round(bank_book_balance(db, bank_account, recon.statement_date), 2)
    # Outstanding cheques: our books already show the money gone, the bank
    # hasn't paid it yet — so the bank's balance is HIGHER than ours by this.
    # Deposits in transit: the mirror case — the bank's balance is LOWER.
    # Expected bank statement balance = book + outstanding - in-transit.
    reconciled_balance = round(book_balance + outstanding_cheques - deposits_in_transit, 2)
    difference = round(recon.statement_balance - reconciled_balance, 2)

    return {
        "book_balance": book_balance,
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
    if bank_account.account_kind == "cash":
        raise ValueError("Cash accounts aren't reconciled against a bank statement — count the cash and compare it with the cash book instead.")
    if not bank_account.gl_account_id:
        raise ValueError(f"Bank account '{bank_account.bank_name}' has no GL ledger linked — set one under Finance > Masters > Bank Accounts first.")
    open_recon = db.query(BankReconciliation).filter(
        BankReconciliation.bank_account_id == bank_account_id, BankReconciliation.status == "in_progress",
    ).first()
    if open_recon:
        raise ValueError(f"A reconciliation for statement date {open_recon.statement_date:%d-%b-%Y} is still in progress on this account — complete it first.")

    recon = BankReconciliation(
        bank_account_id=bank_account_id, statement_date=statement_date, statement_balance=round(statement_balance, 2),
        # Snapshot of the GL balance at the statement date — never recomputed,
        # so this record stays a faithful point-in-time comparison.
        book_balance=bank_book_balance(db, bank_account, statement_date), created_by_id=created_by_id,
    )
    db.add(recon)
    db.flush()
    return recon


def mark_payments_reconciled(db: Session, *, bank_reconciliation_id: int, payment_transaction_ids: list[int],
                             cleared_date: date | None = None) -> None:
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == bank_reconciliation_id).first()
    if not recon:
        raise ValueError("Bank reconciliation not found.")
    if recon.status != "in_progress":
        raise ValueError(f"This reconciliation is '{recon.status}' — only an in-progress reconciliation can have payments matched.")
    if not payment_transaction_ids:
        raise ValueError("No payments selected.")
    bank_date = cleared_date or recon.statement_date
    if bank_date > recon.statement_date:
        raise ValueError("The bank (clearing) date can't be after the statement date — it would not be on this statement.")

    payments = db.query(PaymentTransaction).filter(PaymentTransaction.id.in_(payment_transaction_ids)).all()
    found_ids = {p.id for p in payments}
    missing = set(payment_transaction_ids) - found_ids
    if missing:
        raise ValueError(f"Payment(s) not found: {sorted(missing)}")
    for p in payments:
        if p.status != "posted":
            raise ValueError(f"Voucher '{p.payment_number}' is {p.status} — a cancelled voucher never reached the bank and can't be ticked as cleared.")
        if p.payment_date > recon.statement_date:
            raise ValueError(f"Voucher '{p.payment_number}' is dated {p.payment_date:%d-%b-%Y}, after this statement ({recon.statement_date:%d-%b-%Y}) — match it on the next statement.")
        if bank_date < p.payment_date:
            raise ValueError(f"Voucher '{p.payment_number}' is dated {p.payment_date:%d-%b-%Y} — the bank can't clear it before that.")
        if p.bank_account_id == recon.bank_account_id:
            if p.reconciliation_status != "pending":
                raise ValueError(f"Payment '{p.payment_number}' is already reconciled.")
            p.reconciliation_status = "reconciled"
            p.bank_reconciliation_id = recon.id
            p.cleared_date = bank_date
        elif p.counter_bank_account_id == recon.bank_account_id:
            if p.counter_reconciliation_status != "pending":
                raise ValueError(f"Payment '{p.payment_number}' is already reconciled.")
            p.counter_reconciliation_status = "reconciled"
            p.counter_bank_reconciliation_id = recon.id
            p.counter_cleared_date = bank_date
        else:
            raise ValueError(f"Payment '{p.payment_number}' belongs to a different bank account than this reconciliation.")

    db.flush()


def complete_bank_reconciliation(db: Session, *, bank_reconciliation_id: int, completed_by_id: int) -> BankReconciliation:
    recon = lock_row(db, BankReconciliation, bank_reconciliation_id)
    if not recon:
        raise ValueError("Bank reconciliation not found.")
    if recon.status == "completed":
        raise ValueError("This reconciliation is already completed.")
    # Imported bank statement (services/bank_statements.py): every line must
    # be explained — matched to a voucher or booked as one.
    from app.modules.accounts.services.bank_statements import open_line_count
    open_lines = open_line_count(db, bank_reconciliation_id)
    if open_lines:
        raise ValueError(
            f"Cannot complete — {open_lines} imported bank statement line(s) are still unmatched. Match each to its voucher, "
            f"or book it (bank charges, interest) from the Statement Lines panel first.")

    summary = compute_reconciliation_summary(db, bank_reconciliation_id)
    if abs(summary["difference"]) >= 0.01:
        raise ValueError(
            f"Cannot complete — reconciliation is off by {summary['difference']:,.2f}. Tick the vouchers the bank has cleared, "
            f"and book anything on the statement that isn't in the books yet (bank charges, interest) as a voucher first."
        )

    recon.book_balance = summary["book_balance"]
    recon.status = "completed"
    recon.completed_by_id = completed_by_id
    recon.completed_at = datetime.now(timezone.utc)
    db.flush()
    return recon


def get_liquidity_forecast(db: Session) -> dict:
    """Read-only projection, no stored table — see Phase 6 plan for why.
    Current cash is the GL balance of every active bank/cash account."""
    today = date.today()

    current_cash = sum(
        bank_book_balance(db, a, today) for a in db.query(BankAccount).filter(BankAccount.status == "active").all()
    )

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

    for txn in db.query(ARTransaction).filter(ARTransaction.status == "posted", ARTransaction.amount_due > 0).all():
        buckets[_bucket_for(txn.due_date)]["inflows"] += txn.amount_due

    ap_open = db.query(VendorInvoice).filter(VendorInvoice.status == "posted", VendorInvoice.amount_due > 0).all()
    vendor_ids = {i.vendor_id for i in ap_open}
    vendors = {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()} if vendor_ids else {}
    for inv in ap_open:
        due = inv.due_date
        if due is None:
            vendor = vendors.get(inv.vendor_id)
            due = inv.invoice_date + timedelta(days=(vendor.payment_days or 0) if vendor else 0)
        buckets[_bucket_for(due)]["outflows"] += inv.amount_due

    order = ["overdue", "due_0_30", "due_31_60", "due_61_plus"]
    running_balance = round(current_cash, 2)
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
