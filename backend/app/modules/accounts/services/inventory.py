"""Inventory accounting — periodic method (see FINANCE_STANDARDS_PLAN.md).

During a period, purchases are expensed to Purchase Accounts and nothing
posts on store receipt/issue. At period end the closing stock is valued from
Store (AS-2: lower of cost and NRV; cost here = weighted moving average,
standard cost as fallback) and posted:

    Dr Stock-in-Hand (BS)    Cr Changes in Inventories (P&L)    on the valuation date
    Dr Changes in Inv. (P&L) Cr Stock-in-Hand (BS)              auto-reversed next day

So each period's P&L carries  Opening stock + Purchases - Closing stock
= cost of materials consumed, and the Balance Sheet shows the closing stock."""
from datetime import date, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.inventory_valuation import InventoryValuation, InventoryValuationLine
from app.modules.accounts.models.vendor_invoice import VendorInvoice, VendorInvoiceLine
from app.modules.accounts.models.ar_transaction import ARTransaction, ARTransactionLine
from app.modules.accounts.services import fiscal
from app.modules.accounts.services.ledgers import ledger_id_for


def store_stock_snapshot(db: Session) -> list[dict]:
    """Current on-hand quantity (incl. quarantine — it's still our stock) per
    item across all locations, with its valuation rate."""
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.stock_balance import StoreStockBalance

    qty_rows = (
        db.query(StoreStockBalance.item_id,
                 func.coalesce(func.sum(StoreStockBalance.on_hand_qty), 0),
                 func.coalesce(func.sum(StoreStockBalance.quarantine_qty), 0),
                 func.coalesce(func.sum(StoreStockBalance.quality_qty), 0),
                 func.coalesce(func.sum(StoreStockBalance.vendor_qty), 0))
        .group_by(StoreStockBalance.item_id).all()
    )
    # Quality (awaiting inspection) and job-work-vendor stock are ours too — they count for value.
    qty_by_item = {item_id: float(on_hand) + float(quarantine) + float(quality) + float(vendor)
                   for item_id, on_hand, quarantine, quality, vendor in qty_rows}
    item_ids = [i for i, q in qty_by_item.items() if q > 0]
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}

    out = []
    for item_id in item_ids:
        item = items.get(item_id)
        if not item:
            continue
        qty = round(qty_by_item[item_id], 4)
        if item.moving_average_cost:
            rate, source = float(item.moving_average_cost), "moving_average"
        elif item.standard_cost:
            rate, source = float(item.standard_cost), "standard"
        else:
            rate, source = 0.0, "none"
        out.append({
            "store_item_id": item.id, "item_code": item.item_code, "item_name": item.item_name,
            "category": item.category, "uom": item.uom, "quantity": qty, "rate": round(rate, 4),
            "value": round(qty * rate, 2), "rate_source": source,
        })
    out.sort(key=lambda r: ((r["category"] or "~"), r["item_code"] or ""))
    return out


def stock_value_summary(db: Session) -> dict:
    rows = store_stock_snapshot(db)
    by_category: dict[str, dict] = {}
    for r in rows:
        c = by_category.setdefault(r["category"] or "Uncategorised", {"category": r["category"] or "Uncategorised", "items": 0, "value": 0.0})
        c["items"] += 1
        c["value"] = round(c["value"] + r["value"], 2)
    unvalued = [r for r in rows if r["rate_source"] == "none"]
    return {
        "as_of": date.today(), "total_value": round(sum(r["value"] for r in rows), 2),
        "categories": sorted(by_category.values(), key=lambda c: -c["value"]), "rows": rows,
        "unvalued_items": len(unvalued),
        "note": (f"{len(unvalued)} item(s) in stock have no moving-average or standard cost, so they are valued at zero — "
                 f"set a standard cost in Store > Items or receive them through a priced GRN.") if unvalued else None,
    }


def create_valuation(db: Session, *, accounting_period: str, created_by_id: int, notes: str | None = None) -> InventoryValuation:
    _, period_end = fiscal.period_bounds(accounting_period)
    existing = db.query(InventoryValuation).filter(
        InventoryValuation.accounting_period == accounting_period, InventoryValuation.status != "cancelled",
    ).first()
    if existing:
        raise ValueError(f"A closing-stock valuation for {accounting_period} already exists ({existing.status}). Open it instead of creating another.")
    fiscal.fiscal_year_for(db, period_end)
    # MB5B: closing stock as it stood at period end, rebuilt from the Store
    # ledger (Free + Quality + Blocked, at the average on that date) — never
    # today's balances, which later movements have already changed.
    from app.modules.store.services.stock_asof import closing_stock_rows, unvalued_items_in_range
    period_start, _ = fiscal.period_bounds(accounting_period)
    unvalued = unvalued_items_in_range(db, period_start, period_end)
    if unvalued:
        shown = ", ".join(unvalued[:10]) + (f" and {len(unvalued) - 10} more" if len(unvalued) > 10 else "")
        raise ValueError(
            f"Closing stock for {accounting_period} can't be valued: stock movements of {shown} in that period carry no "
            f"valuation, so their value at period end can't be rebuilt. Ask the Store admin to run the valuation back-fill "
            f"(Store valuation cut-over) for those items, then create the valuation again."
        )
    val = InventoryValuation(accounting_period=accounting_period, valuation_date=period_end, notes=notes, created_by_id=created_by_id)
    db.add(val)
    db.flush()
    total = 0.0
    for r in closing_stock_rows(db, period_end):
        db.add(InventoryValuationLine(inventory_valuation_id=val.id, **r))
        total += r["value"]
    # WIP (KKAX): cost sitting in open Production work orders / RRV builds at
    # period end — material issued out of Store is otherwise expensed and
    # drops out of the Balance Sheet. Closing stock = Store + WIP.
    from app.modules.production.costing import wip_valuation_lines
    for r in wip_valuation_lines(db, period_end):
        db.add(InventoryValuationLine(inventory_valuation_id=val.id, **r))
        total += r["value"]
    val.total_value = round(total, 2)
    db.flush()
    return val


def update_valuation_line(db: Session, *, line_id: int, quantity: float | None, rate: float | None) -> InventoryValuationLine:
    """Physical-count correction on a draft."""
    line = db.query(InventoryValuationLine).filter(InventoryValuationLine.id == line_id).first()
    if not line:
        raise ValueError("Valuation line not found.")
    val = db.query(InventoryValuation).filter(InventoryValuation.id == line.inventory_valuation_id).first()
    if val.status != "draft":
        raise ValueError("Only a draft valuation can be edited — a posted one is cancelled and re-created.")
    if quantity is not None:
        if quantity < 0:
            raise ValueError("Quantity can't be negative.")
        line.quantity = quantity
    if rate is not None:
        if rate < 0:
            raise ValueError("Rate can't be negative.")
        line.rate = rate
        line.rate_source = "manual"
    line.value = round(float(line.quantity) * float(line.rate), 2)
    db.flush()
    val.total_value = round(sum(l.value for l in db.query(InventoryValuationLine).filter(
        InventoryValuationLine.inventory_valuation_id == val.id).all()), 2)
    db.flush()
    return line


CANCEL_REFERENCE = "inventory_valuation_cancel"


def post_valuation(db: Session, *, valuation_id: int, posted_by_id: int) -> InventoryValuation:
    from app.modules.accounts.service import post_journal_entry, lock_row

    val = lock_row(db, InventoryValuation, valuation_id)
    if not val:
        raise ValueError("Valuation not found.")
    if val.status != "draft":
        raise ValueError(f"Only a draft valuation can be posted (current status: '{val.status}').")
    if val.total_value <= 0:
        raise ValueError("Closing stock is zero — nothing to post. Check Store quantities and item costs first.")
    stock, change = ledger_id_for(db, "stock_in_hand"), ledger_id_for(db, "stock_change")
    ref = f"Closing stock {val.accounting_period}"
    # WIP lines go to their own Balance Sheet ledger (Work-in-Progress).
    wip_value = round(sum(float(l.value or 0) for l in db.query(InventoryValuationLine).filter(
        InventoryValuationLine.inventory_valuation_id == val.id, InventoryValuationLine.line_kind == "wip").all()), 2)
    stock_value = round(float(val.total_value) - wip_value, 2)
    debit_lines = []
    if stock_value:
        debit_lines.append({"gl_account_id": stock, "debit_amount": stock_value, "remarks": ref})
    if wip_value:
        debit_lines.append({"gl_account_id": ledger_id_for(db, "wip_in_hand"), "debit_amount": wip_value,
                            "remarks": f"Work-in-progress {val.accounting_period}"})
    entry = post_journal_entry(
        db, posting_date=val.valuation_date, posting_type="closing_stock", voucher_type="journal",
        lines=debit_lines + [{"gl_account_id": change, "credit_amount": val.total_value, "remarks": ref}],
        description=f"{ref} — valued at {val.total_value:,.2f}; reverses on {val.valuation_date + timedelta(days=1):%d-%b-%Y} as next period's opening stock",
        reference_document_type="inventory_valuation", reference_document_id=val.id, created_by_id=posted_by_id,
        auto_reverse_on=val.valuation_date + timedelta(days=1),
    )
    val.journal_entry_id = entry.id
    val.status = "posted"
    val.posted_by_id = posted_by_id
    db.flush()
    return val


def cancel_valuation(db: Session, *, valuation_id: int, user_id: int, reason: str) -> InventoryValuation:
    """Undoing a posted valuation needs two entries, because the original (on
    the valuation date) already has its auto-reversal (next day): reverse the
    auto-reversal on its own date, and post the opposite of the original on
    the valuation date. Both dates then net to zero.

    The second entry carries its own reference type (CANCEL_REFERENCE): the
    original's auto-reversal already holds the one reversal slot, and a
    document has exactly one original posting (models/journal_entry.py)."""
    from app.modules.accounts.service import reverse_journal_entry, post_journal_entry, lock_row
    from app.modules.accounts.models.journal_entry import JournalEntry

    val = lock_row(db, InventoryValuation, valuation_id)
    if not val:
        raise ValueError("Valuation not found.")
    if val.status == "cancelled":
        raise ValueError("This valuation is already cancelled.")
    if val.status == "posted" and val.journal_entry_id:
        auto_rev = db.query(JournalEntry).filter(JournalEntry.reverses_journal_entry_id == val.journal_entry_id).first()
        if auto_rev and auto_rev.status == "posted":
            reverse_journal_entry(db, journal_entry_id=auto_rev.id, reason=f"Valuation cancelled: {reason}", reversed_by_id=user_id,
                                  reversal_date=auto_rev.posting_date, allow_reversal_of_reversal=True)
        original = db.query(JournalEntry).filter(JournalEntry.id == val.journal_entry_id).first()
        lines = [{"gl_account_id": l.gl_account_id, "debit_amount": l.credit_amount, "credit_amount": l.debit_amount,
                  "remarks": f"Cancel closing stock {val.accounting_period}"} for l in original.lines]
        post_journal_entry(db, posting_date=val.valuation_date, lines=lines, posting_type="closing_stock",
                           description=f"Cancellation of closing stock {val.accounting_period}: {reason}",
                           reference_document_type=CANCEL_REFERENCE, reference_document_id=val.id, created_by_id=user_id)
    val.status = "cancelled"
    val.notes = ((val.notes or "") + f" [Cancelled: {reason}]").strip()
    db.flush()
    return val


def load_valuation(db: Session, valuation_id: int) -> InventoryValuation | None:
    return db.query(InventoryValuation).options(selectinload(InventoryValuation.lines)).filter(InventoryValuation.id == valuation_id).first()


def purchase_sales_impact(db: Session, *, from_date: date, to_date: date) -> dict:
    """Per item: quantity and value bought (posted purchase invoices) and sold
    (posted sales invoices) in the range — how trading moved stock value."""
    purchases = (
        db.query(VendorInvoiceLine.store_item_id, VendorInvoiceLine.description,
                 func.sum(VendorInvoiceLine.quantity), func.sum(VendorInvoiceLine.taxable_amount))
        .join(VendorInvoice, VendorInvoiceLine.vendor_invoice_id == VendorInvoice.id)
        .filter(VendorInvoice.status == "posted", VendorInvoice.invoice_date >= from_date, VendorInvoice.invoice_date <= to_date)
        .group_by(VendorInvoiceLine.store_item_id, VendorInvoiceLine.description).all()
    )
    sales = (
        db.query(ARTransactionLine.store_item_id, ARTransactionLine.description,
                 func.sum(ARTransactionLine.quantity), func.sum(ARTransactionLine.taxable_amount))
        .join(ARTransaction, ARTransactionLine.ar_transaction_id == ARTransaction.id)
        .filter(ARTransaction.status == "posted", ARTransaction.invoice_date >= from_date, ARTransaction.invoice_date <= to_date)
        .group_by(ARTransactionLine.store_item_id, ARTransactionLine.description).all()
    )
    rows: dict[tuple, dict] = {}

    def _key(item_id, desc):
        return ("item", item_id) if item_id else ("desc", (desc or "").strip().lower())

    for item_id, desc, qty, value in purchases:
        r = rows.setdefault(_key(item_id, desc), {"store_item_id": item_id, "description": desc, "purchase_qty": 0.0,
                                                  "purchase_value": 0.0, "sales_qty": 0.0, "sales_value": 0.0})
        r["purchase_qty"] += float(qty or 0)
        r["purchase_value"] = round(r["purchase_value"] + float(value or 0), 2)
    for item_id, desc, qty, value in sales:
        r = rows.setdefault(_key(item_id, desc), {"store_item_id": item_id, "description": desc, "purchase_qty": 0.0,
                                                  "purchase_value": 0.0, "sales_qty": 0.0, "sales_value": 0.0})
        r["sales_qty"] += float(qty or 0)
        r["sales_value"] = round(r["sales_value"] + float(value or 0), 2)
    out = sorted(rows.values(), key=lambda r: -(r["purchase_value"] + r["sales_value"]))
    return {
        "from_date": from_date, "to_date": to_date, "rows": out,
        "total_purchases": round(sum(r["purchase_value"] for r in out), 2),
        "total_sales": round(sum(r["sales_value"] for r in out), 2),
    }
