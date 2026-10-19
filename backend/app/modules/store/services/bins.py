"""WM bin stock (SAP LS24 stock per material / LS26 stock per bin, LT10 bin
to bin move).

Bin stock is DERIVED, never a second balance that can drift: the
location-level store_stock_balances stays the source of truth, and the
quantity in a bin is

    + every stock-ledger row that brought material physically INTO the store
      at that bin (GRN putaway, return, transfer in, adjustment in, ...)
    − every row that took it physically OUT of the store from that bin
      (issue, transfer out, vendor return, adjustment out, ...)
    + bin moves into it − bin moves out of it (store_bin_moves).

"Physically in the store" = Free + Quality + Blocked stock; moves between
those three (an inspection release, a block) don't move the material between
bins. What is in the store but in no bin is shown as "Unassigned"."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.store.models.bin import StoreBin
from app.modules.store.models.bin_move import StoreBinMove
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import STORE_STOCK_TYPE_EFFECT, StoreStockTransaction

_EPS = 1e-9
_PHYSICAL = {"free", "quality", "blocked"}


class BinError(ValueError):
    """A bin rule broken — the message says what to do."""


def physical_sign(transaction_type: str) -> int:
    """+1 when the movement brings material into the store, −1 when it takes
    it out, 0 when it only changes the stock type inside the store."""
    src, dst = STORE_STOCK_TYPE_EFFECT.get(transaction_type, (None, None))
    return (1 if dst in _PHYSICAL else 0) - (1 if src in _PHYSICAL else 0)


def _ledger_sign_case():
    from sqlalchemy import case
    plus = [t for t in STORE_STOCK_TYPE_EFFECT if physical_sign(t) > 0]
    minus = [t for t in STORE_STOCK_TYPE_EFFECT if physical_sign(t) < 0]
    return case(
        (StoreStockTransaction.transaction_type.in_(plus), StoreStockTransaction.quantity),
        (StoreStockTransaction.transaction_type.in_(minus), -StoreStockTransaction.quantity),
        else_=0.0,
    )


def bin_quantities(db: Session, *, location_id: int | None = None, item_id: int | None = None,
                   bin_id: int | None = None, location_ids: set[int] | None = None,
                   by_batch: bool = False) -> dict[tuple, float]:
    """{(item_id, location_id, bin_id[, batch_number]): qty} for every bin
    holding (or having held) stock. bin_id None rows are not returned — the
    unassigned part is location stock minus the bins (see stock_by_bin)."""
    keys = [StoreStockTransaction.item_id, StoreStockTransaction.location_id, StoreStockTransaction.bin_id]
    if by_batch:
        keys.append(StoreStockTransaction.batch_number)
    q = db.query(*keys, func.sum(_ledger_sign_case())).filter(StoreStockTransaction.bin_id.isnot(None))
    if location_id is not None:
        q = q.filter(StoreStockTransaction.location_id == location_id)
    if location_ids is not None:
        q = q.filter(StoreStockTransaction.location_id.in_(location_ids or {-1}))
    if item_id is not None:
        q = q.filter(StoreStockTransaction.item_id == item_id)
    if bin_id is not None:
        q = q.filter(StoreStockTransaction.bin_id == bin_id)
    out: dict[tuple, float] = {}
    for row in q.group_by(*keys).all():
        out[tuple(row[:-1])] = (out.get(tuple(row[:-1]), 0.0)) + float(row[-1] or 0)

    def _moves(col, sign):
        mk = [StoreBinMove.item_id, StoreBinMove.location_id, col] + ([StoreBinMove.batch_number] if by_batch else [])
        mq = db.query(*mk, func.sum(StoreBinMove.quantity)).filter(col.isnot(None))
        if location_id is not None:
            mq = mq.filter(StoreBinMove.location_id == location_id)
        if location_ids is not None:
            mq = mq.filter(StoreBinMove.location_id.in_(location_ids or {-1}))
        if item_id is not None:
            mq = mq.filter(StoreBinMove.item_id == item_id)
        if bin_id is not None:
            mq = mq.filter(col == bin_id)
        for row in mq.group_by(*mk).all():
            k = tuple(row[:-1])
            out[k] = out.get(k, 0.0) + sign * float(row[-1] or 0)

    _moves(StoreBinMove.to_bin_id, 1)
    _moves(StoreBinMove.from_bin_id, -1)
    return {k: round(v, 6) for k, v in out.items()}


def bin_qty(db: Session, item_id: int, location_id: int, bin_id: int, batch_number: str | None = None) -> float:
    if batch_number:
        rows = bin_quantities(db, item_id=item_id, location_id=location_id, bin_id=bin_id, by_batch=True)
        return sum(v for k, v in rows.items() if (k[3] or None) == batch_number)
    return sum(bin_quantities(db, item_id=item_id, location_id=location_id, bin_id=bin_id).values())


def physical_qty(db: Session, item_id: int, location_id: int) -> float:
    b = db.query(StoreStockBalance).filter(StoreStockBalance.item_id == item_id, StoreStockBalance.location_id == location_id).first()
    if not b:
        return 0.0
    return (b.on_hand_qty or 0) + (b.quality_qty or 0) + (b.quarantine_qty or 0)


def unassigned_qty(db: Session, item_id: int, location_id: int) -> float:
    binned = sum(bin_quantities(db, item_id=item_id, location_id=location_id).values())
    return round(physical_qty(db, item_id, location_id) - binned, 6)


def bin_label(b: StoreBin | None) -> str | None:
    if b is None:
        return None
    return f"{b.code}" + (f" — {b.name}" if b.name else "")


def validate_bin(db: Session, bin_id: int | None, location_id: int, *, what: str = "this line") -> StoreBin | None:
    """The bin must exist, be active and belong to the SAME store."""
    if bin_id is None:
        return None
    b = db.get(StoreBin, bin_id)
    if b is None:
        raise BinError(f"Bin #{bin_id} on {what} doesn't exist any more — reload the page and pick the bin again.")
    if b.location_id != location_id:
        loc = db.query(StoreLocation.name).filter(StoreLocation.id == location_id).scalar()
        raise BinError(f"Bin '{b.code}' on {what} belongs to another store, not {loc or 'this store'} — pick a bin of {loc or 'this store'}.")
    if b.is_active is False:
        raise BinError(f"Bin '{b.code}' is inactive — reactivate it under Store › Inventory › Bins, or pick another bin.")
    return b


def ensure_pick_possible(db: Session, *, item: StoreItem, location_id: int, qty: float, bin_id: int | None,
                         batch_number: str | None = None, already: float = 0.0) -> None:
    """Outbound from a bin: the bin must hold the quantity. Outbound without a
    bin: allowed only while the store's UNASSIGNED stock covers it — once an
    item is put away into bins, the picker must say which bin it comes from,
    or the bin stock stops matching the shelf."""
    if bin_id is not None:
        b = db.get(StoreBin, bin_id)
        have = bin_qty(db, item.id, location_id, bin_id, batch_number) - already
        if have + _EPS < qty:
            raise BinError(f"Bin '{b.code if b else bin_id}' holds only {max(have, 0):g} {item.uom or ''} of '{item.item_name}'"
                           f"{' batch ' + batch_number if batch_number else ''}, {qty:g} requested — pick another bin "
                           "or split the line over bins (Store › Stock › By bin).")
        return
    binned = bin_quantities(db, item_id=item.id, location_id=location_id)
    if not binned or all(abs(v) < _EPS for v in binned.values()):
        return  # item not put away into bins at this store — nothing to keep in step
    free = unassigned_qty(db, item.id, location_id) - already
    if free + _EPS < qty:
        bins = {k[2]: v for k, v in binned.items() if v > _EPS}
        names = {b.id: b.code for b in db.query(StoreBin).filter(StoreBin.id.in_(bins)).all()} if bins else {}
        where = ", ".join(f"{names.get(i, i)}: {v:g}" for i, v in bins.items())
        raise BinError(f"'{item.item_name}' is kept in bins at this store ({where}) and only {max(free, 0):g} is unassigned — "
                       f"pick the bin the {qty:g} {item.uom or ''} come from.")


def bin_if_covered(db: Session, item_id: int, location_id: int, bin_id: int | None, qty: float) -> int | None:
    """For corrections that must never be blocked (GRN reversal, vendor
    return): take the stock out of the putaway bin when it still holds it,
    otherwise out of unassigned stock."""
    if bin_id is None:
        return None
    return bin_id if bin_qty(db, item_id, location_id, bin_id) + _EPS >= qty else None


def generate_bin_move_number(db: Session) -> str:
    from app.modules.store.service import _lock_number_series
    prefix = f"BM-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreBinMove.move_number)).filter(StoreBinMove.move_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{(int(last.rsplit('-', 1)[-1]) + 1) if last else 1:04d}"


def move_between_bins(db: Session, *, item: StoreItem, location_id: int, from_bin_id: int | None, to_bin_id: int | None,
                      qty: float, batch_number: str | None, user_id: int, remarks: str | None = None,
                      move_date: date | None = None) -> StoreBinMove:
    if qty <= 0:
        raise BinError("Quantity to move must be greater than zero.")
    if from_bin_id == to_bin_id:
        raise BinError("The 'from' and 'to' bin are the same — pick a different destination bin.")
    validate_bin(db, from_bin_id, location_id, what="the 'from' side")
    validate_bin(db, to_bin_id, location_id, what="the 'to' side")
    if from_bin_id is not None:
        have = bin_qty(db, item.id, location_id, from_bin_id, batch_number)
        if have + _EPS < qty:
            b = db.get(StoreBin, from_bin_id)
            raise BinError(f"Bin '{b.code}' holds only {max(have, 0):g} {item.uom or ''} of '{item.item_name}', {qty:g} requested to move.")
    else:
        free = unassigned_qty(db, item.id, location_id)
        if free + _EPS < qty:
            raise BinError(f"Only {max(free, 0):g} {item.uom or ''} of '{item.item_name}' is unassigned at this store, {qty:g} requested "
                           "to put away — pick the bin it is in now as the 'from' bin.")
    move = StoreBinMove(move_number=generate_bin_move_number(db), item_id=item.id, location_id=location_id,
                        from_bin_id=from_bin_id, to_bin_id=to_bin_id, quantity=qty, batch_number=batch_number,
                        move_date=move_date or date.today(), remarks=remarks, created_by_id=user_id)
    db.add(move)
    db.flush()
    # Serialised units keep their bin in step with the material.
    from app.modules.store.models.serial_number import StoreSerialNumber
    if item.serial_controlled and from_bin_id is not None:
        units = db.query(StoreSerialNumber).filter(StoreSerialNumber.item_id == item.id, StoreSerialNumber.location_id == location_id,
                                                   StoreSerialNumber.bin_id == from_bin_id,
                                                   StoreSerialNumber.status.in_(("in_stock", "quality", "blocked"))).limit(int(qty)).all()
        for u in units:
            u.bin_id = to_bin_id
    return move


def stock_by_bin(db: Session, *, location_ids: set[int] | None, location_id: int | None = None, item_id: int | None = None,
                 bin_id: int | None = None, include_unassigned: bool = True) -> list[dict]:
    """LS24 / LS26 rows: item × store × bin (with an 'Unassigned' row per
    item and store for what is in no bin)."""
    qtys = bin_quantities(db, location_id=location_id, item_id=item_id, bin_id=bin_id, location_ids=location_ids)
    rows: list[dict] = []
    item_ids = {k[0] for k in qtys}
    loc_ids = {k[1] for k in qtys}
    if include_unassigned and bin_id is None:
        bq = db.query(StoreStockBalance)
        if location_id is not None:
            bq = bq.filter(StoreStockBalance.location_id == location_id)
        if location_ids is not None:
            bq = bq.filter(StoreStockBalance.location_id.in_(location_ids or {-1}))
        if item_id is not None:
            bq = bq.filter(StoreStockBalance.item_id == item_id)
        balances = bq.all()
    else:
        balances = []
    item_ids |= {b.item_id for b in balances}
    loc_ids |= {b.location_id for b in balances}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    locs = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_(loc_ids)).all()} if loc_ids else {}
    bins = {b.id: b for b in db.query(StoreBin).filter(StoreBin.id.in_({k[2] for k in qtys})).all()} if qtys else {}

    def _row(iid, lid, bid, qty):
        it, loc, b = items.get(iid), locs.get(lid), bins.get(bid) if bid else None
        return {"item_id": iid, "item_code": it.item_code if it else None, "item_name": it.item_name if it else None,
                "uom": it.uom if it else None, "location_id": lid, "location_name": loc.name if loc else None,
                "bin_id": bid, "bin_code": b.code if b else None, "bin_name": b.name if b else None, "quantity": round(qty, 6)}

    binned_total: dict[tuple[int, int], float] = {}
    for (iid, lid, bid), q in qtys.items():
        binned_total[(iid, lid)] = binned_total.get((iid, lid), 0.0) + q
        if abs(q) > _EPS:
            rows.append(_row(iid, lid, bid, q))
    for b in balances:
        phys = (b.on_hand_qty or 0) + (b.quality_qty or 0) + (b.quarantine_qty or 0)
        rest = phys - binned_total.get((b.item_id, b.location_id), 0.0)
        if abs(rest) > _EPS:
            rows.append(_row(b.item_id, b.location_id, None, rest))
    rows.sort(key=lambda r: (r["item_code"] or "", r["location_name"] or "", r["bin_code"] or "~"))
    return rows
