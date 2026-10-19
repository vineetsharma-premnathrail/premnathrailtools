"""Stock on a posting date (SAP MB5B) — rebuilt from the stock ledger.

StoreStockBalance is only "now". Anything that must be true for a past date —
Finance's closing stock for a period, the stock-on-date report — is rebuilt
from the append-only StoreStockTransaction ledger instead:

  quantity per (item, store) on date D = signed sum of every ledger row dated
  on or before D, split into the Free / Quality / Blocked buckets by
  STORE_STOCK_TYPE_EFFECT (all three are our own stock and count for value);

  rate per item on date D = the company-wide weighted average after the last
  valued ledger row dated on or before D (valuation_value_after /
  valuation_qty_after) — the item's average as it stood then, not today's.
  Items with no valued row by then fall back to today's average / standard
  cost, and the row says so (rate_source)."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transaction import STORE_STOCK_TYPE_EFFECT, StoreStockTransaction

_BUCKETS = ("free", "quality", "blocked", "vendor")  # vendor = with a job-work vendor, still ours
_EPS = 1e-9


def external_sign(transaction_type: str) -> int:
    """+1 for a row that brings stock into the company's stores, -1 for one
    that takes it out, 0 for a move between stock types (Quality → Free ...)."""
    src, dst = STORE_STOCK_TYPE_EFFECT.get(transaction_type, (None, None))
    if src is None and dst is not None:
        return 1
    if src is not None and dst is None:
        return -1
    return 0


def check_not_future(as_of: date) -> None:
    if as_of > date.today():
        raise ValueError(f"{as_of:%d-%b-%Y} is in the future — stock on a date can only be shown for today or earlier.")


def _ledger_query(db: Session, location_ids: set[int] | None, item_id: int | None):
    q = db.query(StoreStockTransaction.item_id, StoreStockTransaction.location_id, StoreStockTransaction.transaction_type,
                 func.coalesce(func.sum(StoreStockTransaction.quantity), 0))
    if location_ids is not None:
        q = q.filter(StoreStockTransaction.location_id.in_(location_ids or {-1}))
    if item_id is not None:
        q = q.filter(StoreStockTransaction.item_id == item_id)
    return q


def quantities_as_of(db: Session, as_of: date, *, location_ids: set[int] | None = None,
                     item_id: int | None = None) -> dict[tuple[int, int], dict[str, float]]:
    """{(item_id, location_id): {"free", "quality", "blocked", "vendor", "total"}} as on
    `as_of` (end of day)."""
    rows = (_ledger_query(db, location_ids, item_id)
            .filter(StoreStockTransaction.transaction_date <= as_of)
            .group_by(StoreStockTransaction.item_id, StoreStockTransaction.location_id, StoreStockTransaction.transaction_type)
            .all())
    out: dict[tuple[int, int], dict[str, float]] = {}
    for item, loc, ttype, qty in rows:
        src, dst = STORE_STOCK_TYPE_EFFECT.get(ttype, (None, None))
        b = out.setdefault((item, loc), {k: 0.0 for k in _BUCKETS})
        if src:
            b[src] -= float(qty)
        if dst:
            b[dst] += float(qty)
    for b in out.values():
        for k in _BUCKETS:
            b[k] = round(b[k], 4)
        b["total"] = round(sum(b[k] for k in _BUCKETS), 4)
    return out


def movements_between(db: Session, from_date: date, to_date: date, *, location_ids: set[int] | None = None,
                      item_id: int | None = None) -> dict[tuple[int, int], dict[str, float]]:
    """{(item, store): {"receipts", "issues"}} — quantity that came into /
    went out of the store between the two dates (inclusive). Moves between
    stock types are not receipts or issues."""
    rows = (_ledger_query(db, location_ids, item_id)
            .filter(StoreStockTransaction.transaction_date >= from_date, StoreStockTransaction.transaction_date <= to_date)
            .group_by(StoreStockTransaction.item_id, StoreStockTransaction.location_id, StoreStockTransaction.transaction_type)
            .all())
    out: dict[tuple[int, int], dict[str, float]] = {}
    for item, loc, ttype, qty in rows:
        sign = external_sign(ttype)
        if not sign:
            continue
        m = out.setdefault((item, loc), {"receipts": 0.0, "issues": 0.0})
        m["receipts" if sign > 0 else "issues"] += float(qty)
    return out


def rates_as_of(db: Session, item_ids: set[int], as_of: date) -> dict[int, tuple[float, str]]:
    """{item_id: (rate, rate_source)} — the weighted average after the last
    valued ledger row on or before `as_of`; else today's average / standard."""
    if not item_ids:
        return {}
    T = StoreStockTransaction
    valued = and_(T.valuation_value_after.isnot(None), T.valuation_qty_after.isnot(None), T.transaction_date <= as_of,
                  T.item_id.in_(item_ids))
    last_date = db.query(T.item_id.label("item_id"), func.max(T.transaction_date).label("d")).filter(valued).group_by(T.item_id).subquery()
    last_id = (db.query(func.max(T.id)).join(last_date, and_(T.item_id == last_date.c.item_id, T.transaction_date == last_date.c.d))
               .filter(valued).group_by(T.item_id).all())
    out: dict[int, tuple[float, str]] = {}
    ids = [i for (i,) in last_id]
    if ids:
        for row in db.query(T).filter(T.id.in_(ids)).all():
            qty, value = float(row.valuation_qty_after or 0), float(row.valuation_value_after or 0)
            if qty > _EPS:
                out[row.item_id] = (round(value / qty, 4), "average_on_date")
            elif row.unit_cost is not None:
                out[row.item_id] = (round(float(row.unit_cost), 4), "average_on_date")
    missing = item_ids - set(out)
    if missing:
        for item in db.query(StoreItem).filter(StoreItem.id.in_(missing)).all():
            if item.moving_average_cost:
                out[item.id] = (round(float(item.moving_average_cost), 4), "current_average")
            elif item.standard_cost:
                out[item.id] = (round(float(item.standard_cost), 4), "standard")
            else:
                out[item.id] = (0.0, "none")
    return out


def unvalued_items_in_range(db: Session, from_date: date, to_date: date) -> list[str]:
    """Items with a stock movement in the range that carries no valuation
    while weighted-average valuation is on — their value on a date can't be
    rebuilt. Empty when valuation is off (quantities only, no values)."""
    from app.modules.store.services.valuation import valuation_enabled

    if not valuation_enabled(db):
        return []
    external = [t for t in STORE_STOCK_TYPE_EFFECT if external_sign(t)]
    T = StoreStockTransaction
    rows = (db.query(StoreItem.item_code, StoreItem.item_name).join(T, T.item_id == StoreItem.id)
            .filter(T.transaction_date >= from_date, T.transaction_date <= to_date, T.valuation_value_after.is_(None),
                    T.transaction_type.in_(external))
            .distinct().order_by(StoreItem.item_name.asc()).all())
    return [f"{code} — {name}" if code else name for code, name in rows]


def closing_stock_rows(db: Session, as_of: date) -> list[dict]:
    """Per item, all stores and every stock type (Free + Quality + Blocked +
    With job-work vendor — all owned stock), quantity and value on `as_of`. Shape matches
    accounts InventoryValuationLine."""
    qty_by_item: dict[int, float] = {}
    for (item_id, _loc), b in quantities_as_of(db, as_of).items():
        qty_by_item[item_id] = qty_by_item.get(item_id, 0.0) + b["total"]
    item_ids = {i for i, q in qty_by_item.items() if q > _EPS}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    rates = rates_as_of(db, item_ids, as_of)
    out = []
    for item_id in item_ids:
        item = items.get(item_id)
        if not item:
            continue
        qty = round(qty_by_item[item_id], 4)
        rate, source = rates.get(item_id, (0.0, "none"))
        out.append({
            "store_item_id": item.id, "item_code": item.item_code, "item_name": item.item_name,
            "category": item.category, "uom": item.uom, "quantity": qty, "rate": round(rate, 4),
            "value": round(qty * rate, 2), "rate_source": source,
        })
    out.sort(key=lambda r: ((r["category"] or "~"), r["item_code"] or ""))
    return out


def stock_on_date_report(db: Session, *, from_date: date, to_date: date, location_ids: set[int] | None = None,
                         location_id: int | None = None, item_id: int | None = None) -> dict:
    """MB5B: per item and store — opening (end of the day before from_date),
    receipts, issues and closing (end of to_date) quantity, closing split by
    stock type, and the closing value at the item's average on to_date."""
    check_not_future(to_date)
    if from_date > to_date:
        raise ValueError(f"'From' date {from_date:%d-%b-%Y} is after 'to' date {to_date:%d-%b-%Y} — swap them.")
    if location_id is not None:
        if location_ids is not None and location_id not in location_ids:
            raise PermissionError("That store is outside the plants you can see stock for.")
        location_ids = {location_id}
    opening = quantities_as_of(db, from_date - timedelta(days=1), location_ids=location_ids, item_id=item_id)
    closing = quantities_as_of(db, to_date, location_ids=location_ids, item_id=item_id)
    moves = movements_between(db, from_date, to_date, location_ids=location_ids, item_id=item_id)
    keys = {k for k in set(opening) | set(closing) | set(moves)
            if abs(opening.get(k, {}).get("total", 0)) > _EPS or abs(closing.get(k, {}).get("total", 0)) > _EPS
            or k in moves}
    item_ids = {k[0] for k in keys}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    locs = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_({k[1] for k in keys})).all()} if keys else {}
    open_rates = rates_as_of(db, item_ids, from_date - timedelta(days=1))
    close_rates = rates_as_of(db, item_ids, to_date)
    rows = []
    for item_id_, loc_id in keys:
        item, loc = items.get(item_id_), locs.get(loc_id)
        o, c = opening.get((item_id_, loc_id), {}), closing.get((item_id_, loc_id), {})
        m = moves.get((item_id_, loc_id), {"receipts": 0.0, "issues": 0.0})
        o_rate, _ = open_rates.get(item_id_, (0.0, "none"))
        c_rate, c_src = close_rates.get(item_id_, (0.0, "none"))
        oq, cq = o.get("total", 0.0), c.get("total", 0.0)
        rows.append({
            "item_id": item_id_, "item_code": item.item_code if item else None, "item_name": item.item_name if item else f"Item {item_id_}",
            "uom": item.uom if item else None, "location_id": loc_id, "location_name": loc.name if loc else f"Store {loc_id}",
            "opening_qty": round(oq, 4), "opening_value": round(oq * o_rate, 2),
            "receipt_qty": round(m["receipts"], 4), "issue_qty": round(m["issues"], 4),
            "closing_qty": round(cq, 4), "closing_free_qty": c.get("free", 0.0), "closing_quality_qty": c.get("quality", 0.0),
            "closing_blocked_qty": c.get("blocked", 0.0), "closing_vendor_qty": c.get("vendor", 0.0), "closing_rate": c_rate, "closing_value": round(cq * c_rate, 2),
            "rate_source": c_src,
        })
    rows.sort(key=lambda r: ((r["item_name"] or "").lower(), (r["location_name"] or "").lower()))
    return {
        "from_date": from_date, "to_date": to_date, "rows": rows,
        "total_opening_value": round(sum(r["opening_value"] for r in rows), 2),
        "total_closing_value": round(sum(r["closing_value"] for r in rows), 2),
    }
