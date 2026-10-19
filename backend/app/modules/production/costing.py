"""Work-order actual cost, goods receipt at actual cost and period-end WIP.

SAP equivalents: CO line items of a production order (KOB1), GR 101 from the
order valued at the order's actual cost, and WIP determination (KKAX/KKS1).

Every material movement against an order writes one dated, valued
ProductionOrderCostPosting at the moment the stock moves:

  material_issue   + qty × the Store row's valued rate (or the item's
                     standard / moving-average cost while Store valuation is off)
  material_return  − qty × the order's own average issue rate (a return
                     credits the order at the price it was charged, not at
                     today's average)
  goods_receipt    − the cost moved out of the order into finished-goods
                     stock (see receipt_cost)

Labour is hours × rate from the shop-floor time logs (the rate is
snapshotted on the log when it's booked).

  order cost open (WIP) = material issued − returned + labour − relieved

Periodic inventory (Finance decision): nothing here posts to the GL. Finance's
closing-stock valuation adds wip_snapshot(period end) to the Store stock, so
closing stock = Store + WIP. Once an order delivers its last unit all of its
cost has been relieved into FG stock, so it drops out of the next period's
WIP by itself — the "reversal" is the closing-stock entry's own next-day
auto-reversal plus the order no longer being open."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.production.models.work_order import (
    ProductionOrderCostPosting, ProductionTimeLog, ProductionWorkOrder,
)
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.store.models.item import StoreItem

# Store ledger cost_source for an FG receipt valued at the order's actual cost.
PRODUCTION_ACTUAL_COST_SOURCE = "production_actual"
_EPS = 1e-9


def _item_rate(item: StoreItem | None) -> float:
    # Same definition as service.item_unit_cost (standard, else moving
    # average) — imported lazily there would be circular.
    if not item:
        return 0.0
    return float(item.standard_cost or item.moving_average_cost or 0.0)


# ---------------------------------------------------------------------------
# Writing cost postings (called from the work-order routes)
# ---------------------------------------------------------------------------

def record_material_issue(db: Session, wo: ProductionWorkOrder, txn, quantity: float, user_id: int | None) -> ProductionOrderCostPosting:
    """`txn` is the Store ledger row just posted for the issue."""
    if txn is not None and txn.value is not None and quantity > _EPS:
        rate, source = float(txn.value) / quantity, "ledger"
    else:
        rate, source = _item_rate(db.get(StoreItem, txn.item_id if txn is not None else None)), "item_cost"
    posting = ProductionOrderCostPosting(
        work_order_id=wo.id, posting_type="material_issue", posting_date=txn.transaction_date if txn is not None else date.today(),
        item_id=txn.item_id if txn is not None else None, quantity=quantity, unit_cost=round(rate, 4),
        amount=round(float(txn.value), 2) if source == "ledger" else round(quantity * rate, 2),
        cost_source=source, stock_transaction_id=txn.id if txn is not None else None, created_by_id=user_id,
    )
    db.add(posting)
    return posting


def order_issue_rate(db: Session, wo_id: int, item_id: int) -> float | None:
    """Average rate the order was charged for an item (Σ issue value ÷ Σ issue qty)."""
    qty, amount = db.query(
        func.coalesce(func.sum(ProductionOrderCostPosting.quantity), 0.0),
        func.coalesce(func.sum(ProductionOrderCostPosting.amount), 0.0),
    ).filter(
        ProductionOrderCostPosting.work_order_id == wo_id, ProductionOrderCostPosting.item_id == item_id,
        ProductionOrderCostPosting.posting_type == "material_issue",
    ).one()
    return float(amount) / float(qty) if qty and float(qty) > _EPS else None


def return_rate(db: Session, wo: ProductionWorkOrder, item_id: int) -> tuple[float, str]:
    rate = order_issue_rate(db, wo.id, item_id)
    if rate is not None:
        return round(rate, 4), "issue_rate"
    return round(_item_rate(db.get(StoreItem, item_id)), 4), "item_cost"


def record_material_return(db: Session, wo: ProductionWorkOrder, txn, quantity: float, rate: float, source: str,
                           user_id: int | None) -> ProductionOrderCostPosting:
    posting = ProductionOrderCostPosting(
        work_order_id=wo.id, posting_type="material_return", posting_date=txn.transaction_date, item_id=txn.item_id,
        quantity=quantity, unit_cost=rate, amount=round(quantity * rate, 2), cost_source=source,
        stock_transaction_id=txn.id, created_by_id=user_id,
    )
    db.add(posting)
    return posting


def record_goods_receipt(db: Session, wo: ProductionWorkOrder, txn, quantity: float, value: float,
                         user_id: int | None) -> ProductionOrderCostPosting:
    """Moves `value` out of the order (WIP) into FG stock. When Store valued
    the row, its own value is used so Store and the order agree to the paisa."""
    amount = round(float(txn.value), 2) if txn is not None and txn.value is not None else round(value, 2)
    posting = ProductionOrderCostPosting(
        work_order_id=wo.id, posting_type="goods_receipt", posting_date=txn.transaction_date if txn is not None else date.today(),
        item_id=wo.product_item_id, quantity=quantity, unit_cost=round(amount / quantity, 4) if quantity > _EPS else 0.0,
        amount=amount, cost_source="order_actual", stock_transaction_id=txn.id if txn is not None else None,
        created_by_id=user_id,
    )
    db.add(posting)
    wo.cost_relieved = round((wo.cost_relieved or 0.0) + amount, 2)
    return posting


# ---------------------------------------------------------------------------
# Reading order cost
# ---------------------------------------------------------------------------

def _log_rates(db: Session, logs: list[ProductionTimeLog], op_ws: dict[int, int | None]) -> dict[int, float]:
    ws_ids = {log.workstation_id or op_ws.get(log.operation_id) for log in logs if log.activity_rate is None}
    ws_ids.discard(None)
    current = {w.id: float(w.hourly_rate or 0.0) for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_(ws_ids)).all()} if ws_ids else {}
    return {
        log.id: float(log.activity_rate) if log.activity_rate is not None
        else current.get(log.workstation_id or op_ws.get(log.operation_id), 0.0)
        for log in logs
    }


def labour_cost(db: Session, wo: ProductionWorkOrder, as_of: date | None = None) -> tuple[float, float]:
    """(hours, cost) booked on the order, up to `as_of` when given."""
    query = db.query(ProductionTimeLog).filter(ProductionTimeLog.work_order_id == wo.id)
    if as_of is not None:
        query = query.filter(ProductionTimeLog.log_date <= as_of)
    logs = query.all()
    rates = _log_rates(db, logs, {op.id: op.workstation_id for op in wo.operations})
    return round(sum(log.hours for log in logs), 2), round(sum(log.hours * rates[log.id] for log in logs), 2)


def _posting_totals(db: Session, wo_ids: list[int], as_of: date | None) -> dict[int, dict[str, float]]:
    if not wo_ids:
        return {}
    query = db.query(
        ProductionOrderCostPosting.work_order_id, ProductionOrderCostPosting.posting_type,
        func.coalesce(func.sum(ProductionOrderCostPosting.amount), 0.0),
    ).filter(ProductionOrderCostPosting.work_order_id.in_(wo_ids))
    if as_of is not None:
        query = query.filter(ProductionOrderCostPosting.posting_date <= as_of)
    out: dict[int, dict[str, float]] = {}
    for wo_id, ptype, amount in query.group_by(ProductionOrderCostPosting.work_order_id, ProductionOrderCostPosting.posting_type).all():
        out.setdefault(wo_id, {})[ptype] = float(amount or 0.0)
    return out


def order_cost(db: Session, wo: ProductionWorkOrder, as_of: date | None = None) -> dict:
    totals = _posting_totals(db, [wo.id], as_of).get(wo.id, {})
    material = round(totals.get("material_issue", 0.0) - totals.get("material_return", 0.0), 2)
    hours, labour = labour_cost(db, wo, as_of)
    relieved = round(totals.get("goods_receipt", 0.0), 2)
    # Period-end costing-sheet overhead (accounts services/co_overhead.py).
    overhead = round(totals.get("overhead", 0.0) - totals.get("overhead_reversal", 0.0), 2)
    return {
        "material": material, "labour": labour, "hours": hours, "relieved": relieved, "overhead": overhead,
        "open": round(material + labour + overhead - relieved, 2),
    }


def material_actuals_by_item(db: Session, wo_id: int) -> dict[int, float]:
    """Net material cost per item from the order's cost postings."""
    out: dict[int, float] = {}
    for item_id, ptype, amount in db.query(
        ProductionOrderCostPosting.item_id, ProductionOrderCostPosting.posting_type,
        func.coalesce(func.sum(ProductionOrderCostPosting.amount), 0.0),
    ).filter(
        ProductionOrderCostPosting.work_order_id == wo_id,
        ProductionOrderCostPosting.posting_type.in_(("material_issue", "material_return")),
    ).group_by(ProductionOrderCostPosting.item_id, ProductionOrderCostPosting.posting_type).all():
        sign = 1 if ptype == "material_issue" else -1
        out[item_id] = out.get(item_id, 0.0) + sign * float(amount or 0.0)
    return out


def receipt_cost(db: Session, wo: ProductionWorkOrder, quantity: float) -> tuple[float, float]:
    """(unit_cost, value) for receiving `quantity` finished units now.

    The open order cost is shared over the units still to be received; the
    receipt that completes the order takes everything that is left, so a
    delivered order carries no WIP. Units built from material issued later
    pick that cost up on their own receipt."""
    open_cost = max(order_cost(db, wo)["open"], 0.0)
    remaining = round((wo.quantity_planned or 0) - (wo.quantity_completed or 0), 4)
    if quantity <= _EPS or open_cost <= 0:
        return 0.0, 0.0
    value = open_cost if quantity >= remaining - _EPS else open_cost * quantity / remaining
    value = round(value, 2)
    return round(value / quantity, 4), value


# ---------------------------------------------------------------------------
# Period-end WIP (KKAX)
# ---------------------------------------------------------------------------

def _delivered_by(wo: ProductionWorkOrder, as_of: date) -> bool:
    """Completed (all output received) or closed on or before `as_of`: any
    cost still on it is a variance of the order, not WIP."""
    for stamp in (wo.actual_end_at if wo.status in ("completed", "closed") else None, wo.closed_at):
        if stamp is not None and stamp.date() <= as_of:
            return True
    return False


def wip_snapshot(db: Session, as_of: date) -> list[dict]:
    """Work in progress at the end of `as_of`: for every work order (incl.
    the ones building an RRV) that has cost booked by then and wasn't
    cancelled or delivered by then, material issued − returned + labour −
    cost already received into stock. Orders with nothing open are left out."""
    from app.modules.production.models.rrv_build import ProductionRrvBuild

    posting_wo_ids = {i for (i,) in db.query(ProductionOrderCostPosting.work_order_id).filter(
        ProductionOrderCostPosting.posting_date <= as_of).distinct().all()}
    log_wo_ids = {i for (i,) in db.query(ProductionTimeLog.work_order_id).filter(
        ProductionTimeLog.log_date <= as_of).distinct().all()}
    ids = posting_wo_ids | log_wo_ids
    if not ids:
        return []
    orders = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.id.in_(ids), ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status != "cancelled",
    ).all()
    orders = [o for o in orders if not _delivered_by(o, as_of)]
    if not orders:
        return []
    totals = _posting_totals(db, [o.id for o in orders], as_of)
    products = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({o.product_item_id for o in orders})).all()}
    build_ids = {o.rrv_build_id for o in orders if o.rrv_build_id}
    builds = {b.id: b.build_number for b in db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id.in_(build_ids)).all()} if build_ids else {}

    rows = []
    for wo in orders:
        t = totals.get(wo.id, {})
        material = round(t.get("material_issue", 0.0) - t.get("material_return", 0.0), 2)
        _hours, labour = labour_cost(db, wo, as_of)
        relieved = round(t.get("goods_receipt", 0.0), 2)
        overhead = round(t.get("overhead", 0.0) - t.get("overhead_reversal", 0.0), 2)
        wip = round(material + labour + overhead - relieved, 2)
        if wip <= 0.005:
            continue
        product = products.get(wo.product_item_id)
        rows.append({
            "work_order_id": wo.id, "wo_number": wo.wo_number, "status": wo.status,
            "product_item_id": wo.product_item_id,
            "product_code": product.item_code if product else None,
            "product_name": product.item_name if product else None,
            "product_category": product.category if product else None,
            "rrv_build_id": wo.rrv_build_id, "rrv_build_number": builds.get(wo.rrv_build_id),
            "quantity_planned": wo.quantity_planned, "quantity_completed": wo.quantity_completed,
            "material_cost": material, "labour_cost": labour, "overhead_cost": overhead, "cost_relieved": relieved, "wip_value": wip,
        })
    rows.sort(key=lambda r: (r["rrv_build_number"] or "~", r["wo_number"]))
    return rows


def wip_valuation_lines(db: Session, as_of: date) -> list[dict]:
    """WIP as closing-stock lines for Finance (accounts/services/inventory.py):
    one line per open order, quantity 1 "order" at its WIP value, so a
    Finance override of the rate is an override of the order's value."""
    out = []
    for r in wip_snapshot(db, as_of):
        build = f" · RRV {r['rrv_build_number']}" if r["rrv_build_number"] else ""
        out.append({
            "store_item_id": r["product_item_id"], "item_code": r["product_code"],
            "item_name": f"WIP {r['wo_number']} — {r['product_name'] or 'product'}{build}"[:300],
            "category": "Work in Progress", "uom": "order", "quantity": 1.0, "rate": r["wip_value"],
            "value": r["wip_value"], "rate_source": "order_actual", "line_kind": "wip", "work_order_id": r["work_order_id"],
        })
    return out
