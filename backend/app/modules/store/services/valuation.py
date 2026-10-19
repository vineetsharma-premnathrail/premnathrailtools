"""Weighted (moving) average valuation engine — Store foundation plan §5.1.

Called only from post_stock_transaction() (store/services/stock_ledger.py),
and only while the Store setting `valuation_enabled` is on. With it off the
ledger is quantity-only, exactly as before (the rollback switch, §11).

Rules (plan §3.1, §5.1):
- One average per item for the whole company, kept as a running total value
  (`store_item_valuations.value`, the source of truth) and quantity; the rate
  is derived (value ÷ qty) and never fed back in, so it can't drift by paise.
- Followed in POSTING order (ledger id), not transaction_date: a back-dated
  receipt never recosts issues that were already posted.
- Priced inbound moves the average; outbound goes at the current average and
  the last unit out takes whatever value remains (V ends at exactly 0).
- Moves between Free / Quality / Blocked are value-neutral; transfers are
  neutral company-wide because the "in" row is given the "out" row's value.
- Lock order: valuation (item) first, then balance (item, store). Multi-line
  documents must post in ledger_sort_key() order — (item, store) — so every
  document takes locks in the same global order and can't deadlock.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import STORE_STOCK_TYPE_EFFECT
from app.modules.store.models.valuation import StoreItemValuation, StoreValuationEvent
from app.modules.store.settings import get_setting

_EPS = Decimal("1e-9")
# Quantity tolerance: half the 4-dp storage step. Quantities closer than this
# to zero (or to each other) are the same quantity — float balances and the
# Numeric(…, 4) valuation qty never match to the last bit.
_TOL = Decimal("0.00005")
_P2 = Decimal("0.01")
_P4 = Decimal("0.0001")

# Inbound types that are "user documents" (manual receipt, opening stock,
# adjustment-in): with no average and no standard cost they must carry a rate
# (while require_rate_on_manual_receipt is on). Every other unpriced inbound is
# a system document and goes in unvalued (cost_source "none", unvalued_qty).
USER_PRICED_TYPES = frozenset({"manual_in", "adjustment_in"})
# Priced receipts that update last_receipt_rate / date / ref (Engineering's
# "last PO rate" cost basis).
RECEIPT_TYPES = frozenset({"receipt", "quality_in"})


def _d(x) -> Decimal:
    return Decimal(str(x)) if x is not None else Decimal("0")


def _r2(x: Decimal) -> Decimal:
    return x.quantize(_P2, rounding=ROUND_HALF_UP)


def _r4(x: Decimal) -> Decimal:
    return x.quantize(_P4, rounding=ROUND_HALF_UP)


def _f(x: Decimal | None) -> float | None:
    return float(x) if x is not None else None


def valuation_enabled(db: Session) -> bool:
    return bool(get_setting(db, "valuation_enabled"))


def ledger_sort_key(item_id: int | None, location_id: int | None = None) -> tuple[int, int]:
    """Sort key for posting a multi-line document: (item, store). Every
    document posting in this order takes the valuation (item) lock and then
    the balance (item, store) lock in one global order, so two documents with
    crossed items and stores can't deadlock. Use as
    `sorted(lines, key=lambda l: ledger_sort_key(l.item_id, store_id))`."""
    return (item_id or 0, location_id or 0)


def _physical_qty(db: Session, item_id: int) -> Decimal:
    """Σ (on hand + quality + blocked + with vendor) over every store — the
    quantity the valuation row must always equal (plan §9 invariant). Job-work
    stock at a vendor is still ours and still valued."""
    return _d(db.query(func.coalesce(func.sum(
        StoreStockBalance.on_hand_qty + StoreStockBalance.quality_qty + StoreStockBalance.quarantine_qty
        + func.coalesce(StoreStockBalance.vendor_qty, 0)
    ), 0)).filter(StoreStockBalance.item_id == item_id).scalar())


def _negative_qty_message(item: StoreItem | None, item_id: int, qty: Decimal) -> str:
    name = item.item_name if item else f"Item {item_id}"
    return (f"'{name}' would be valued at a negative quantity ({_r4(qty).normalize()}) — the stock balances and the "
            f"valuation are out of step. Check Store → Stock for a negative balance and correct it with a stock "
            f"adjustment, then post again.")


def _valued_rate(Q: Decimal, V: Decimal, unvalued: Decimal, avg_last: Decimal | None) -> Decimal | None:
    """The current average over VALUED quantity only (unvalued units carry no
    value, so counting them would understate the rate); with no valued
    quantity, the last known average."""
    valued_q = Q - unvalued
    if valued_q > _TOL:
        return V / valued_q
    return avg_last


def _resync(db: Session, row: StoreItemValuation, item_id: int) -> None:
    """Switching valuation off and back on (the rollback switch, §11) leaves
    quantity-only postings the valuation row never saw. Before the next
    valued posting, reset qty to the real physical total at the current
    average, with a `cutover_opening` event for the value change so the
    value trail (§9) stays complete."""
    actual = _physical_qty(db, item_id)
    Q, V = _d(row.qty), _d(row.value)
    if abs(actual - Q) <= _TOL:
        return
    item = db.get(StoreItem, item_id)
    if actual < -_TOL:
        raise ValueError(_negative_qty_message(item, item_id, actual))
    if abs(actual) <= _TOL:
        actual = Decimal("0")
    unvalued = _d(row.unvalued_qty)
    avg_last = _d(row.avg_rate) if row.avg_rate is not None else None
    rate = _valued_rate(Q, V, unvalued, avg_last)
    if rate is None and item is not None:
        rate = _d(item.moving_average_cost or item.standard_cost) if (item.moving_average_cost or item.standard_cost) else None
    if rate is None:
        new_unvalued, new_value = actual, Decimal("0")
    else:
        new_unvalued = min(unvalued, actual)
        new_value = _r2((actual - new_unvalued) * rate)
    db.add(StoreValuationEvent(
        item_id=item_id, event_type="cutover_opening", value_delta=float(new_value - V), qty_basis=float(_r4(actual)),
        rate_before=_f(_r4(avg_last)) if avg_last is not None else None,
        rate_after=_f(_r4(rate)) if rate is not None else None,
        reason=(f"Valuation re-synced to the stock balances: quantity {_r4(Q).normalize()} → {_r4(actual).normalize()} "
                f"(stock moved while valuation was switched off), "
                + (f"valued at ₹{_r4(rate)} per unit." if rate is not None else "with no rate (stock counted as unvalued).")),
        event_date=date.today(),
    ))
    row.qty = float(_r4(actual))
    row.value = float(new_value)
    row.unvalued_qty = float(_r4(new_unvalued))
    if rate is not None:
        row.avg_rate = _f(_r4(rate))
    db.flush()


def lock_valuation(db: Session, item_id: int) -> StoreItemValuation:
    """Row-locks (or creates) the item's valuation row. Taken BEFORE the
    balance row lock (see module docstring).

    A missing row on an item that already has stock (valuation switched on
    without a cut-over) is seeded from the balances at the item's mirrored
    average, else standard cost, else unvalued — with a `cutover_opening`
    event so the value trail stays complete. The Phase D cut-over replaces
    this with a proper replay. An existing row whose qty no longer matches
    the balances (postings made while the switch was off) is re-synced."""
    row = db.query(StoreItemValuation).filter(StoreItemValuation.item_id == item_id).with_for_update().first()
    if row is not None:
        _resync(db, row, item_id)
        return row
    qty = _physical_qty(db, item_id)
    item = db.get(StoreItem, item_id)
    if qty < -_TOL:
        raise ValueError(_negative_qty_message(item, item_id, qty))
    if qty <= _TOL:
        qty = Decimal("0")
    rate = None
    if item is not None:
        rate = item.moving_average_cost or item.standard_cost or None
    rate_d = _d(rate) if rate else None
    value = _r2(qty * rate_d) if (rate_d is not None and qty > _EPS) else Decimal("0")
    try:
        with db.begin_nested():
            row = StoreItemValuation(
                item_id=item_id, qty=float(_r4(qty)), value=float(value),
                # With no stock, only a (typed) moving average counts as a "last
                # rate"; standard cost stays the separate fallback (§5.1.2).
                avg_rate=(_f(_r4(rate_d)) if (rate_d is not None and qty > _EPS)
                          else (float(item.moving_average_cost) if item is not None and item.moving_average_cost else None)),
                unvalued_qty=float(_r4(qty)) if (rate_d is None and qty > _EPS) else 0.0,
            )
            db.add(row)
            if qty > _EPS:
                db.add(StoreValuationEvent(
                    item_id=item_id, event_type="cutover_opening", value_delta=float(value), qty_basis=float(_r4(qty)),
                    rate_before=None, rate_after=_f(_r4(rate_d)) if rate_d is not None else None,
                    reason=("Opening value set automatically at the first valued movement "
                            + (f"from the item's {'average' if item and item.moving_average_cost else 'standard'} cost"
                               if rate_d is not None else "with no rate (stock counted as unvalued)")
                            + " — replace it with the valuation cut-over."),
                    event_date=date.today(),
                ))
            db.flush()
        return row
    except IntegrityError:
        return db.query(StoreItemValuation).filter(StoreItemValuation.item_id == item_id).with_for_update().one()


@dataclass
class PricedMovement:
    """Result of pricing one ledger row against the item's valuation. Pure —
    nothing is written until commit_valuation()."""
    unit_cost: Decimal | None
    value: Decimal | None
    cost_source: str
    qty_after: Decimal
    value_after: Decimal
    avg_after: Decimal | None
    unvalued_after: Decimal
    is_priced_receipt: bool = False
    events: list[dict] = field(default_factory=list)


def _no_rate_message(item: StoreItem | None, item_id: int) -> str:
    name = item.item_name if item else f"Item {item_id}"
    uom = (item.uom if item and item.uom else "unit")
    return (f"'{name}' has no average or standard cost yet, so this receipt needs a rate. "
            f"Enter the rate per {uom}, or set a standard cost in Store → Items.")


def _check_zero_rate(source: str, remarks: str | None) -> None:
    """A zero rate drags the item's average down, so it is allowed only as a
    deliberate manual rate with a remark saying why (e.g. a free replacement
    under warranty) — never silently, e.g. from an unpriced PO line."""
    if source != "manual_rate":
        raise ValueError("A zero rate can't be used here — this receipt must carry its real price. "
                         "If the material really came free, post it as a manual stock entry with rate 0 and a remark saying why.")
    if not (remarks or "").strip():
        raise ValueError("A zero rate needs a remark saying why the material came free (e.g. 'Free replacement under warranty').")


def price_movement(
    db: Session,
    val: StoreItemValuation,
    *,
    item_id: int,
    transaction_type: str,
    quantity: float,
    unit_cost: float | None = None,
    cost_source: str | None = None,
    value: float | None = None,
    rate_required: bool = False,
    remarks: str | None = None,
) -> PricedMovement:
    """Applies §5.1.1 / §5.1.2 to one row. Raises ValueError (user-readable)
    for an unpriced user receipt with no rate available, or a bad rate."""
    if transaction_type not in STORE_STOCK_TYPE_EFFECT:
        raise ValueError(f"Unknown stock transaction type '{transaction_type}'")
    src, dst = STORE_STOCK_TYPE_EFFECT[transaction_type]
    Q, V, q = _d(val.qty), _d(val.value), _d(quantity)
    avg_last = _d(val.avg_rate) if val.avg_rate is not None else None
    unvalued = _d(val.unvalued_qty)
    events: list[dict] = []

    if unit_cost is not None and unit_cost < 0:
        raise ValueError("A stock rate can't be negative — enter the rate per unit as a positive amount (or 0 for a free item).")

    # Internal (Free ↔ Quality ↔ Blocked): value-neutral, rate shown only.
    if src is not None and dst is not None:
        rate = _valued_rate(Q, V, unvalued, avg_last)
        return PricedMovement(
            unit_cost=_r4(rate) if rate is not None else None,
            value=_r2(q * rate) if rate is not None else None,
            cost_source="average" if rate is not None else "none",
            qty_after=Q, value_after=V, avg_after=avg_last, unvalued_after=unvalued,
        )

    if src is None:  # ---------------------------------------------- inbound
        if Q <= _TOL and V != 0:
            # Residual value with no quantity (should not happen after the
            # "last unit takes the rest" rule) — written off before the receipt.
            events.append({"event_type": "rounding_writeoff", "value_delta": -V, "qty_basis": Decimal("0"),
                           "rate_before": avg_last, "rate_after": avg_last,
                           "reason": f"Residual value ₹{V} left with zero quantity written off before the next receipt."})
            V = Decimal("0")
        if Q <= _TOL:
            Q, unvalued = Decimal("0"), Decimal("0")
        priced_receipt = False
        if value is not None:
            # Paired "in" row (transfer, quarantine release): exactly the "out" row's value.
            vin = _r2(_d(value))
            uc = _r4(_d(unit_cost)) if unit_cost is not None else (_r4(vin / q) if q > _EPS else None)
            source = cost_source or "average"
            if vin == 0 and uc is None:
                # The "out" row went out unvalued — the units stay unvalued here too.
                source = "none"
                unvalued += q
        elif unit_cost is not None:
            # Validate against the cost source that will actually be recorded.
            source = cost_source or ("po_rate" if transaction_type in RECEIPT_TYPES else "manual_rate")
            if unit_cost == 0:
                _check_zero_rate(source, remarks)
            r = _d(unit_cost)
            vin = _r2(q * r)
            uc = _r4(r)
            priced_receipt = transaction_type in RECEIPT_TYPES
        else:
            item = db.get(StoreItem, item_id)
            # Current average over valued stock only, else the last average,
            # else standard cost, else refuse (user document) or unvalued.
            rate = _valued_rate(Q, V, unvalued, avg_last)
            source = "average" if rate is not None else "none"
            if rate is None and item is not None and item.standard_cost:
                rate, source = _d(item.standard_cost), "standard"
            if rate is None:
                if rate_required:
                    raise ValueError(_no_rate_message(item, item_id))
                vin, uc, source = Decimal("0"), None, "none"
                unvalued += q
            else:
                vin, uc = _r2(q * rate), _r4(rate)
        Q2, V2 = Q + q, V + vin
        avg_after = _valued_rate(Q2, V2, unvalued, avg_last)  # all unvalued → keep the last known rate
        return PricedMovement(uc, vin, source, Q2, V2, avg_after, unvalued, priced_receipt, events)

    # -------------------------------------------------------------- outbound
    # Valued units go out first (at the average over valued quantity); once
    # they are used up the rest goes out unvalued, reducing unvalued_qty.
    valued_q = Q - unvalued
    rate_before = _valued_rate(Q, V, unvalued, avg_last)
    if unit_cost is not None:
        # e.g. return to vendor at the GRN line's rate (reverse of the receipt).
        r = _d(unit_cost)
        vout = _r2(q * r)
        uc = _r4(r)
        source = cost_source or "grn_rate"
        if vout > V:
            events.append({"event_type": "revaluation", "value_delta": Decimal("0"), "qty_basis": q,
                           "rate_before": rate_before, "rate_after": None,
                           "reason": (f"Vendor return above current average: {q.normalize()} at ₹{uc} = ₹{vout}, but the "
                                      f"stock was valued at only ₹{V}; ₹{vout - V} not taken from stock value.")})
            vout = V
    elif valued_q <= _TOL:
        # Only unvalued stock left: it goes out with no value.
        uc, source, vout = None, "none", V
    else:
        avg = V / valued_q
        if valued_q - q <= _TOL:
            vout = V  # the last valued unit takes the remaining value
        else:
            vout = _r2(q * avg)
        uc = _r4(avg) if q - valued_q <= _TOL else _r4(vout / q)
        source = "average"
    Q2, V2 = Q - q, V - vout
    if abs(Q2) <= _TOL:
        Q2 = Decimal("0")
    if Q2 <= _TOL and V2 != 0:
        events.append({"event_type": "rounding_writeoff" if unit_cost is None else "revaluation",
                       "value_delta": -V2, "qty_basis": Decimal("0"), "rate_before": avg_last, "rate_after": avg_last,
                       "reason": f"Residual value ₹{V2} left after the last unit went out written off to keep value at zero."})
        V2 = Decimal("0")
    unvalued_after = min(unvalued, max(Q2, Decimal("0")))
    if Q2 - unvalued_after > _TOL:
        avg_after = V2 / (Q2 - unvalued_after)
    elif unit_cost is None and valued_q > _TOL:
        avg_after = V / valued_q  # valued qty reached zero: keep the rate the stock went out at as the last rate
    else:
        avg_after = avg_last
    return PricedMovement(uc, vout, source, Q2, V2, avg_after, unvalued_after, False, events)


def commit_valuation(
    db: Session,
    val: StoreItemValuation,
    priced: PricedMovement,
    *,
    item_id: int,
    reference_type: str | None,
    reference_number: str | None,
    transaction_date: date,
    created_by_id: int | None,
) -> None:
    """Writes the priced result: events, the valuation row, and the
    store_items.moving_average_cost mirror."""
    for ev in priced.events:
        db.add(StoreValuationEvent(
            item_id=item_id, event_type=ev["event_type"], value_delta=float(_r2(ev["value_delta"])),
            qty_basis=_f(_r4(ev["qty_basis"])) if ev.get("qty_basis") is not None else None,
            rate_before=_f(_r4(ev["rate_before"])) if ev.get("rate_before") is not None else None,
            rate_after=_f(_r4(ev["rate_after"])) if ev.get("rate_after") is not None else None,
            reference_type=reference_type, reference_number=reference_number, reason=ev["reason"],
            created_by_id=created_by_id, event_date=transaction_date,
        ))
    old_avg = val.avg_rate
    val.qty = float(_r4(priced.qty_after))
    val.value = float(_r2(priced.value_after))
    val.avg_rate = _f(_r4(priced.avg_after)) if priced.avg_after is not None else None
    val.unvalued_qty = float(_r4(priced.unvalued_after))
    if priced.is_priced_receipt and priced.unit_cost is not None:
        val.last_receipt_rate = float(priced.unit_cost)
        val.last_receipt_date = transaction_date
        val.last_receipt_ref = reference_number
    if val.avg_rate is not None and val.avg_rate != old_avg:
        mirror_average(db, item_id, val.avg_rate)


def mirror_average(db: Session, item_id: int, avg_rate: float) -> None:
    """store_items.moving_average_cost follows the average for the readers
    that still use it (§3.4). Core UPDATE: bypasses the ORM audit hook and
    keeps updated_at as it is, so a GRN doesn't write an Item audit row."""
    tbl = StoreItem.__table__
    db.execute(
        update(tbl).where(tbl.c.id == item_id)
        .values(moving_average_cost=avg_rate, updated_at=tbl.c.updated_at)
    )


def current_rate(db: Session, item_id: int) -> float | None:
    """The item's current weighted-average rate: the valuation row's average,
    else the mirrored moving_average_cost, else standard cost, else None."""
    val = db.get(StoreItemValuation, item_id)
    if val is not None and val.avg_rate is not None:
        return float(val.avg_rate)
    item = db.get(StoreItem, item_id)
    if item is None:
        return None
    return item.moving_average_cost or item.standard_cost or None
