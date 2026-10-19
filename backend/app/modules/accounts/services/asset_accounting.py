"""Integrated asset acquisition, settlement of capital orders, register-to-
ledger reconciliation and retirement (SAP ABZON / F-90, AIBU, ABAVN / ABAON).

Acquisition from a purchase invoice (ABZON / F-90 integrated):
  A posted purchase-invoice line that debited a fixed-asset ledger (group
  head 'Property, Plant and Equipment'), or that bought a Store item of type
  'asset', waits in the capitalisation queue until it is turned into one or
  more register entries. Cost comes from the line (never typed in), and the
  register cost for a line can never exceed its taxable value.
    - line already on a fixed-asset ledger: no journal (the bill debited it);
    - line on another ledger (an asset item booked to expense / CWIP):
      Dr asset ledger / Cr that ledger, so the GL and the register agree.

Capital internal order (AIBU, CWIP settlement):
  Spend booked to a 'capital' internal order is settled into an asset:
      Dr asset ledger      Cr each ledger the order was charged to (tagged
                           with the order, so the order's balance falls).

Reconciliation: per fixed-asset ledger, GL balance vs register cost, and per
accumulated-depreciation ledger, GL balance vs register depreciation.

Retirement (ABAVN scrap / ABAON sale), full or partial (by % or quantity):
  catch-up depreciation to the retirement date on the whole asset, then for
  the retired share
      Dr Accumulated Depreciation (share)   Dr Asset Sale Clearing (sale value)
        Cr Asset cost ledger (share)        and the balance to profit / loss.
  A sale also raises a draft GST tax invoice to the buyer whose revenue line
  is the clearing ledger: once that invoice is posted (maker-checker) the
  clearing ledger is back to zero and the customer owes the sale value + GST."""
from __future__ import annotations

from datetime import date, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounts.models.account_group import AccountGroup
from app.modules.accounts.models.asset_accounting import AssetRetirement, RETIREMENT_TYPES
from app.modules.accounts.models.fixed_asset import FixedAsset
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine, JE_LEDGER_STATUSES
from app.modules.accounts.models.vendor_invoice import VendorInvoice, VendorInvoiceLine
from app.modules.accounts.services import assets
from app.modules.accounts.services.balances import account_balance
from app.modules.accounts.services.ledgers import ledger_id_for

TOL = 0.01


def _r(x) -> float:
    return round(float(x or 0), 2)


def _role_id(db: Session, role: str) -> int | None:
    try:
        return ledger_id_for(db, role)
    except ValueError:
        return None


def accumulated_ledger_ids(db: Session) -> set[int]:
    ids = {i for (i,) in db.query(FixedAsset.accumulated_depreciation_gl_account_id).distinct().all() if i}
    default = _role_id(db, "accumulated_depreciation")
    return ids | ({default} if default else set())


def asset_cost_ledgers(db: Session) -> list[GLAccount]:
    """Posting ledgers under a 'Property, Plant and Equipment' group, other
    than accumulated depreciation and CWIP."""
    exclude = accumulated_ledger_ids(db) | ({c} if (c := _role_id(db, "cwip")) else set())
    rows = (db.query(GLAccount).join(AccountGroup, GLAccount.group_id == AccountGroup.id)
            .filter(AccountGroup.schedule_iii_head == "ppe", GLAccount.account_type == "asset",
                    GLAccount.is_posting_account == True)  # noqa: E712
            .order_by(GLAccount.code.asc()).all())
    return [a for a in rows if a.id not in exclude]


def _capitalised_by_line(db: Session, line_ids: list[int]) -> dict[int, float]:
    if not line_ids:
        return {}
    q = (db.query(FixedAsset.vendor_invoice_line_id, func.coalesce(func.sum(func.coalesce(FixedAsset.original_cost, FixedAsset.cost)), 0))
         .filter(FixedAsset.vendor_invoice_line_id.in_(line_ids)).group_by(FixedAsset.vendor_invoice_line_id))
    return {lid: _r(v) for lid, v in q.all()}


def _asset_item_ids(db: Session, item_ids: set[int]) -> set[int]:
    if not item_ids:
        return set()
    from app.modules.store.models.item import StoreItem
    return {i for (i,) in db.query(StoreItem.id).filter(StoreItem.id.in_(item_ids), func.lower(StoreItem.item_type) == "asset").all()}


def _capital_orders_open(db: Session, as_of: date | None = None) -> list[dict]:
    """Capital internal orders with spend not yet settled into an asset."""
    orders = db.query(InternalOrder).filter(InternalOrder.order_type == "capital").all()
    out = []
    for io in orders:
        bal = order_balance_by_ledger(db, io.id, as_of)
        total = _r(sum(bal.values()))
        if total > TOL:
            settled = _r(db.query(func.coalesce(func.sum(func.coalesce(FixedAsset.original_cost, FixedAsset.cost)), 0))
                         .filter(FixedAsset.internal_order_id == io.id).scalar())
            out.append({"source": "internal_order", "internal_order_id": io.id, "code": io.code, "name": io.name,
                        "status": io.status, "spend_to_settle": total, "already_settled": settled})
    return out


def capitalisation_queue(db: Session) -> dict:
    """Purchase lines waiting to become register entries (ABZON queue) and
    capital orders with unsettled spend."""
    ppe = {a.id: a for a in asset_cost_ledgers(db)}
    rows = (db.query(VendorInvoiceLine, VendorInvoice)
            .join(VendorInvoice, VendorInvoiceLine.vendor_invoice_id == VendorInvoice.id)
            .filter(VendorInvoice.status == "posted").all())
    asset_items = _asset_item_ids(db, {l.store_item_id for l, _ in rows if l.store_item_id})
    asset_po_items = _asset_po_item_ids(db, {l.po_item_id for l, _ in rows if l.po_item_id})
    candidates = [(l, inv) for l, inv in rows
                  if l.gl_account_id in ppe or l.store_item_id in asset_items or l.po_item_id in asset_po_items]
    done = _capitalised_by_line(db, [l.id for l, _ in candidates])
    from app.modules.accounts.models.vendor import Vendor
    vendors = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_({inv.vendor_id for _, inv in candidates})).all()} if candidates else {}
    gls = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_({l.gl_account_id for l, _ in candidates})).all()} if candidates else {}
    lines = []
    for l, inv in candidates:
        value = _r(l.taxable_amount)
        capitalised = done.get(l.id, 0.0)
        remaining = _r(value - capitalised)
        if remaining <= TOL:
            continue
        gl = gls.get(l.gl_account_id)
        lines.append({
            "source": "vendor_invoice_line", "vendor_invoice_line_id": l.id, "vendor_invoice_id": inv.id,
            "invoice_number": inv.invoice_number, "invoice_date": inv.invoice_date, "vendor_name": vendors.get(inv.vendor_id),
            "description": l.description, "quantity": float(l.quantity or 0), "store_item_id": l.store_item_id,
            "gl_account_id": l.gl_account_id, "gl_account_label": f"{gl.code} — {gl.name}" if gl else None,
            "on_asset_ledger": l.gl_account_id in ppe, "line_value": value, "capitalised": capitalised, "remaining": remaining,
            "cost_center_id": l.cost_center_id,
        })
    lines.sort(key=lambda r: (r["invoice_date"], r["vendor_invoice_line_id"]))
    return {"invoice_lines": lines, "capital_orders": _capital_orders_open(db),
            "received_not_invoiced": received_asset_lines_not_invoiced(db)}


def _asset_po_item_ids(db: Session, po_item_ids: set[int]) -> set[int]:
    """PO lines of item category 'asset' (ME21N item category A), stored or
    derived from the Item Master item type."""
    if not po_item_ids:
        return set()
    try:
        from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem
    except ImportError:
        return set()
    items = db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.id.in_(po_item_ids)).all()
    return {i.id for i in items if getattr(i, "category", None) == "asset"}


def received_asset_lines_not_invoiced(db: Session) -> list[dict]:
    """Asset-category PO lines accepted on a completed GRN whose vendor bill
    isn't posted yet. They become capitalisation candidates once the bill
    posts — the register cost is the bill's value (what the ledger holds),
    never the GRN's, since there is no GR/IR clearing ledger here."""
    try:
        from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
        from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
    except ImportError:
        return []
    from sqlalchemy.orm import selectinload

    grns = (db.query(P2PGoodsReceipt).options(selectinload(P2PGoodsReceipt.items))
            .filter(P2PGoodsReceipt.status == "completed").all())
    accepted: dict[int, float] = {}
    for g in grns:
        for it in g.items:
            if it.po_item_id:
                qty = max((it.accepted_quantity or 0) - (getattr(it, "returned_quantity", 0) or 0), 0.0)
                accepted[it.po_item_id] = accepted.get(it.po_item_id, 0.0) + qty
    asset_ids = _asset_po_item_ids(db, set(accepted))
    if not asset_ids:
        return []
    invoiced: dict[int, float] = {}
    for l, _inv in (db.query(VendorInvoiceLine, VendorInvoice)
                    .join(VendorInvoice, VendorInvoiceLine.vendor_invoice_id == VendorInvoice.id)
                    .filter(VendorInvoice.status == "posted", VendorInvoiceLine.po_item_id.in_(asset_ids)).all()):
        invoiced[l.po_item_id] = invoiced.get(l.po_item_id, 0.0) + float(l.quantity or 0)
    out = []
    for item in db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.id.in_(asset_ids)).all():
        open_qty = round(accepted.get(item.id, 0.0) - invoiced.get(item.id, 0.0), 4)
        if open_qty <= 1e-9:
            continue
        po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == item.purchase_order_id).first()
        out.append({"po_item_id": item.id, "purchase_order_id": item.purchase_order_id, "po_number": po.po_number if po else None,
                    "vendor_name": po.vendor_name if po else None, "description": getattr(item, "description", None) or getattr(item, "item_name", None),
                    "received_not_invoiced_qty": open_qty, "unit_price": item.unit_price,
                    "estimated_value": _r(open_qty * float(item.unit_price or 0))})
    return out


def create_asset_from_invoice_line(db: Session, *, vendor_invoice_line_id: int, data: dict, user_id: int) -> FixedAsset:
    """ABZON: a register entry whose cost comes from a posted purchase line."""
    from app.modules.accounts.service import post_journal_entry

    line = db.query(VendorInvoiceLine).filter(VendorInvoiceLine.id == vendor_invoice_line_id).with_for_update().first()
    if not line:
        raise ValueError("That purchase-invoice line was not found — reload the capitalisation queue.")
    inv = db.query(VendorInvoice).filter(VendorInvoice.id == line.vendor_invoice_id).first()
    if inv.status != "posted":
        raise ValueError(f"Invoice '{inv.invoice_number}' isn't posted yet — an asset is capitalised only from a posted bill.")
    ppe = {a.id for a in asset_cost_ledgers(db)}
    remaining = _r(_r(line.taxable_amount) - _capitalised_by_line(db, [line.id]).get(line.id, 0.0))
    cost = _r(data.get("cost") if data.get("cost") is not None else remaining)
    if cost <= 0:
        raise ValueError("Asset cost must be greater than zero.")
    if cost > remaining + TOL:
        raise ValueError(f"Line {line.line_number} of invoice '{inv.invoice_number}' has only {remaining:,.2f} left to capitalise "
                         f"(line value {_r(line.taxable_amount):,.2f}); can't register {cost:,.2f}.")
    on_asset_ledger = line.gl_account_id in ppe
    asset_gl = data.get("asset_gl_account_id") or (line.gl_account_id if on_asset_ledger else None)
    if not asset_gl:
        raise ValueError(f"Line {line.line_number} of invoice '{inv.invoice_number}' was booked to a non-asset ledger — pick the "
                         f"fixed-asset ledger to move it to (a reclassification journal is posted).")
    if on_asset_ledger and asset_gl != line.gl_account_id:
        raise ValueError("The bill already debited a fixed-asset ledger — the asset must sit on that same ledger, "
                         "or the register and the ledger won't agree. Reclassify with a journal first if it is wrong.")
    payload = {
        **{k: v for k, v in data.items() if k not in ("cost", "asset_gl_account_id")},
        "cost": cost, "asset_gl_account_id": asset_gl, "vendor_invoice_id": inv.id, "vendor_invoice_line_id": line.id,
        "purchase_date": data.get("purchase_date") or inv.invoice_date,
        "put_to_use_date": data.get("put_to_use_date") or data.get("purchase_date") or inv.invoice_date,
        "cost_center_id": data.get("cost_center_id") or line.cost_center_id,
    }
    asset = assets.create_asset(db, data=payload, created_by_id=user_id)
    if not on_asset_ledger:
        what = f"Capitalisation of {asset.asset_code} {asset.name} from invoice {inv.invoice_number} line {line.line_number}"
        entry = post_journal_entry(db, posting_date=max(inv.invoice_date, asset.purchase_date), posting_type="asset_capitalisation",
                                   voucher_type="journal", description=what, created_by_id=user_id,
                                   reference_document_type="asset_capitalisation", reference_document_id=asset.id, lines=[
                                       {"gl_account_id": asset_gl, "debit_amount": cost, "remarks": what},
                                       {"gl_account_id": line.gl_account_id, "credit_amount": cost, "cost_center_id": line.cost_center_id,
                                        "internal_order_id": line.internal_order_id, "remarks": what}])
        asset.capitalisation_journal_entry_id = entry.id
    db.flush()
    return asset


def order_balance_by_ledger(db: Session, internal_order_id: int, as_of: date | None = None) -> dict[int, float]:
    """Debit-minus-credit of every journal line tagged with the order, per ledger."""
    q = (db.query(JournalEntryLine.gl_account_id,
                  func.coalesce(func.sum(JournalEntryLine.debit_amount), 0), func.coalesce(func.sum(JournalEntryLine.credit_amount), 0))
         .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
         .filter(JournalEntryLine.internal_order_id == internal_order_id, JournalEntry.status.in_(JE_LEDGER_STATUSES)))
    if as_of is not None:
        q = q.filter(JournalEntry.posting_date <= as_of)
    out = {}
    for gl_id, d, c in q.group_by(JournalEntryLine.gl_account_id).all():
        bal = _r(float(d) - float(c))
        if abs(bal) > 0.001:
            out[gl_id] = bal
    return out


def settle_internal_order(db: Session, *, internal_order_id: int, settlement_date: date, data: dict,
                          amount: float | None, user_id: int) -> FixedAsset:
    """AIBU: settle (all or part of) a capital order's spend into a new asset."""
    from app.modules.accounts.service import post_journal_entry

    io = db.query(InternalOrder).filter(InternalOrder.id == internal_order_id).with_for_update().first()
    if not io:
        raise ValueError("Internal order not found.")
    if io.order_type != "capital":
        raise ValueError(f"Internal order {io.code} is a '{io.order_type}' order — only a capital order is settled into a fixed asset "
                         f"(maintenance / IT / training spend stays an expense).")
    bal = order_balance_by_ledger(db, io.id, settlement_date)
    asset_ledgers = {a.id for a in asset_cost_ledgers(db)}
    total = _r(sum(bal.values()))
    if total <= TOL:
        raise ValueError(f"Internal order {io.code} has no unsettled spend up to {settlement_date:%d-%b-%Y} — book the purchases "
                         f"against the order first (Purchase invoice line › Internal order).")
    amount = _r(amount if amount is not None else total)
    if amount <= 0 or amount > total + TOL:
        raise ValueError(f"Settle between 0.01 and {total:,.2f} (the order's spend still to settle).")
    asset_gl = data.get("asset_gl_account_id")
    if asset_gl not in asset_ledgers:
        raise ValueError("Pick the fixed-asset ledger the order is settled to (a ledger under Property, Plant and Equipment).")
    payload = {**{k: v for k, v in data.items() if k != "cost"}, "cost": amount, "internal_order_id": io.id,
               "purchase_date": data.get("purchase_date") or settlement_date,
               "put_to_use_date": data.get("put_to_use_date") or settlement_date,
               "cost_center_id": data.get("cost_center_id") or io.cost_center_id}
    asset = assets.create_asset(db, data=payload, created_by_id=user_id)
    what = f"Settlement of capital order {io.code} to asset {asset.asset_code} {asset.name}"
    share = amount / total
    lines = [{"gl_account_id": asset_gl, "debit_amount": amount, "remarks": what}]
    credits, credited = [], 0.0
    items = sorted(bal.items(), key=lambda kv: -kv[1])
    for i, (gl_id, b) in enumerate(items):
        part = _r(b * share) if i < len(items) - 1 else _r(amount - credited)
        credited = _r(credited + part)
        if abs(part) < 0.005:
            continue
        side = "credit_amount" if part > 0 else "debit_amount"
        credits.append({"gl_account_id": gl_id, side: abs(part), "internal_order_id": io.id,
                        "cost_center_id": io.cost_center_id, "remarks": what})
    lines += credits
    entry = post_journal_entry(db, posting_date=settlement_date, lines=lines, posting_type="asset_capitalisation",
                               voucher_type="journal", description=what, reference_document_type="asset_capitalisation",
                               reference_document_id=asset.id, created_by_id=user_id)
    asset.capitalisation_journal_entry_id = entry.id
    db.flush()
    return asset


def reconciliation(db: Session, *, as_of: date | None = None) -> dict:
    """Register vs ledger, per fixed-asset ledger (cost) and per accumulated-
    depreciation ledger. Register figures are the register's current values;
    run it as of today (or after the last posting) for an exact match."""
    as_of = as_of or date.today()
    active = db.query(FixedAsset).filter(FixedAsset.status == "active").all()
    queue = capitalisation_queue(db)["invoice_lines"]
    pending_by_gl: dict[int, float] = {}
    for q in queue:
        if q["on_asset_ledger"]:
            pending_by_gl[q["gl_account_id"]] = _r(pending_by_gl.get(q["gl_account_id"], 0) + q["remaining"])
    rows = []
    default_acc = _role_id(db, "accumulated_depreciation")
    cost_by_gl: dict[int, float] = {}
    acc_by_gl: dict[int, float] = {}
    for a in active:
        cost_by_gl[a.asset_gl_account_id] = _r(cost_by_gl.get(a.asset_gl_account_id, 0) + a.cost)
        acc_id = a.accumulated_depreciation_gl_account_id or default_acc
        if acc_id:
            acc_by_gl[acc_id] = _r(acc_by_gl.get(acc_id, 0) + a.accumulated_depreciation)
    ledgers = {a.id: a for a in asset_cost_ledgers(db)}
    for gl_id in set(cost_by_gl) - set(ledgers):
        g = db.query(GLAccount).filter(GLAccount.id == gl_id).first()
        if g:
            ledgers[gl_id] = g
    for gl_id, gl in sorted(ledgers.items(), key=lambda kv: kv[1].code):
        gl_bal = account_balance(db, gl_id, as_of)
        reg = cost_by_gl.get(gl_id, 0.0)
        if not gl_bal and not reg:
            continue
        diff = _r(gl_bal - reg)
        pending = pending_by_gl.get(gl_id, 0.0)
        rows.append({"kind": "cost", "gl_account_id": gl_id, "gl_account_label": f"{gl.code} — {gl.name}", "gl_balance": gl_bal,
                     "register": reg, "difference": diff, "awaiting_capitalisation": pending,
                     "unexplained": _r(diff - pending), "ok": abs(diff) < 0.5})
    acc_ids = set(acc_by_gl) | ({default_acc} if default_acc else set())
    for gl_id in sorted(acc_ids):
        gl = db.query(GLAccount).filter(GLAccount.id == gl_id).first()
        gl_bal = _r(-account_balance(db, gl_id, as_of))  # a credit balance, shown positive
        reg = acc_by_gl.get(gl_id, 0.0)
        if not gl_bal and not reg:
            continue
        diff = _r(gl_bal - reg)
        rows.append({"kind": "accumulated_depreciation", "gl_account_id": gl_id,
                     "gl_account_label": f"{gl.code} — {gl.name}" if gl else str(gl_id), "gl_balance": gl_bal,
                     "register": reg, "difference": diff, "awaiting_capitalisation": 0.0, "unexplained": diff,
                     "ok": abs(diff) < 0.5})
    return {"as_of": as_of, "rows": rows, "is_reconciled": all(r["ok"] for r in rows),
            "awaiting_capitalisation": queue, "capital_orders": _capital_orders_open(db, as_of)}


def retire_asset(db: Session, *, asset_id: int, retirement_date: date, retirement_type: str,
                 retire_percent: float | None = None, retire_quantity: float | None = None,
                 sale_value: float = 0, customer_id: int | None = None, gst_rate: float | None = None,
                 hsn_sac_code: str | None = None, reason: str | None = None, user_id: int) -> AssetRetirement:
    from app.modules.accounts.service import post_journal_entry, lock_row, create_ar_transaction

    if retirement_type not in RETIREMENT_TYPES:
        raise ValueError("Retirement type must be 'scrap' (written off, no buyer) or 'sale' (sold to a customer).")
    a = lock_row(db, FixedAsset, asset_id)
    if not a:
        raise ValueError("Asset not found.")
    if a.status != "active":
        raise ValueError(f"Asset '{a.asset_code}' is already {a.status}.")
    if retirement_date < a.put_to_use_date:
        raise ValueError("An asset can't be retired before it was put to use.")
    if a.depreciated_up_to and retirement_date <= a.depreciated_up_to:
        raise ValueError(f"Depreciation is already charged up to {a.depreciated_up_to:%d-%b-%Y} — retire after that date, "
                         f"or reverse the later depreciation run first.")
    held = float(a.quantity or 1)
    if retire_quantity is not None:
        q = float(retire_quantity)
        if q <= 0 or q > held + 1e-9:
            raise ValueError(f"Asset '{a.asset_code}' holds {held:g} unit(s) — retire between 1 and {held:g}.")
        share = q / held
        pct = round(share * 100, 3)
    else:
        pct = float(retire_percent if retire_percent is not None else 100)
        if not 0 < pct <= 100:
            raise ValueError("Retire a percentage between 0 and 100 of the asset (100 = the whole asset).")
        share = pct / 100
        q = None
    full = share >= 1 - 1e-9
    sale_value = _r(sale_value)
    if retirement_type == "sale":
        if not customer_id:
            raise ValueError("Pick the customer buying the asset — a sale of a used asset is a taxable supply and needs a tax invoice.")
        if sale_value <= 0:
            raise ValueError("Enter the sale value (before GST). If nothing is received, retire it as scrap.")
        if gst_rate is None:
            raise ValueError("Enter the GST rate on the sale (the rate of the goods, e.g. 18% for machinery).")
    elif sale_value:
        raise ValueError("Scrap has no sale value — if a scrap dealer pays for it, record it as a sale to that buyer.")
    if not reason or not reason.strip():
        raise ValueError("Give the reason for the retirement (e.g. obsolete, damaged beyond repair, sold) — it goes on the audit trail.")

    exp = a.depreciation_expense_gl_account_id or ledger_id_for(db, "depreciation_expense")
    acc = a.accumulated_depreciation_gl_account_id or ledger_id_for(db, "accumulated_depreciation")
    from_date = (a.depreciated_up_to + timedelta(days=1)) if a.depreciated_up_to else a.put_to_use_date
    catch_up, _ = assets.charge_for(a, from_date, retirement_date)
    accumulated = _r(float(a.accumulated_depreciation) + catch_up)
    retired_cost = _r(a.cost) if full else _r(float(a.cost) * share)
    retired_acc = accumulated if full else _r(accumulated * share)
    book = _r(retired_cost - retired_acc)
    gain = _r(sale_value - book)

    ret = AssetRetirement(fixed_asset_id=a.id, retirement_date=retirement_date, retirement_type=retirement_type,
                          retire_percent=pct, retire_quantity=q, catch_up_depreciation=catch_up, retired_cost=retired_cost,
                          retired_accumulated_depreciation=retired_acc, sale_value=sale_value, gain_loss=gain,
                          customer_id=customer_id if retirement_type == "sale" else None,
                          gst_rate=gst_rate if retirement_type == "sale" else None, hsn_sac_code=hsn_sac_code,
                          reason=reason.strip(), created_by_id=user_id)
    db.add(ret)
    db.flush()

    ref = f"{'Sale' if retirement_type == 'sale' else 'Scrapping'} of {'' if full else f'{pct:g}% of '}{a.asset_code} {a.name}"
    lines = []
    if catch_up > 0:
        lines += [{"gl_account_id": exp, "debit_amount": catch_up, "cost_center_id": a.cost_center_id, "remarks": f"Depreciation to retirement — {ref}"},
                  {"gl_account_id": acc, "credit_amount": catch_up, "remarks": f"Depreciation to retirement — {ref}"}]
    if retired_acc > 0:
        lines.append({"gl_account_id": acc, "debit_amount": retired_acc, "remarks": ref})
    if sale_value > 0:
        lines.append({"gl_account_id": ledger_id_for(db, "asset_sale_clearing"), "debit_amount": sale_value, "remarks": f"{ref} — sale value"})
    lines.append({"gl_account_id": a.asset_gl_account_id, "credit_amount": retired_cost, "remarks": ref})
    if gain > 0:
        lines.append({"gl_account_id": ledger_id_for(db, "asset_disposal_gain"), "credit_amount": gain, "remarks": ref})
    elif gain < 0:
        lines.append({"gl_account_id": ledger_id_for(db, "asset_disposal_loss"), "debit_amount": -gain, "remarks": ref})
    entry = post_journal_entry(db, posting_date=retirement_date, lines=lines, posting_type="asset_disposal",
                               description=f"{ref} — book value {book:,.2f}, sale value {sale_value:,.2f}",
                               reference_document_type="asset_retirement", reference_document_id=ret.id, created_by_id=user_id)
    ret.journal_entry_id = entry.id

    if retirement_type == "sale":
        qty = q if q else 1
        inv = create_ar_transaction(
            db, customer_id=customer_id, invoice_date=retirement_date, created_by_id=user_id,
            lines=[{"description": f"Sale of used asset {a.asset_code} — {a.name}"[:300], "hsn_sac_code": hsn_sac_code,
                    "quantity": qty, "rate": round(sale_value / qty, 4), "gst_rate": gst_rate,
                    "gl_account_id": ledger_id_for(db, "asset_sale_clearing")}],
            narration=f"Sale of fixed asset {a.asset_code} ({ref}). Revenue line clears Asset Sale Clearing.",
            reference_type="asset_retirement", reference_id=ret.id,
        )
        ret.ar_transaction_id = inv.id

    residual_left = 0.0 if full else _r(float(a.residual_value or 0) * (1 - share))
    a.accumulated_depreciation = _r(accumulated - retired_acc)
    a.cost = _r(float(a.cost) - retired_cost)
    a.residual_value = residual_left
    a.quantity = 0 if full else round(held - (q if q is not None else held * share), 4)
    a.depreciated_up_to = retirement_date
    if full:
        a.status = "disposed"
        a.disposal_date = retirement_date
        a.disposal_proceeds = sale_value
        a.disposal_journal_entry_id = entry.id
    db.flush()
    return ret
