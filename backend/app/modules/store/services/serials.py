"""Serial number management (SAP IQ01 / serial profile on GR and GI).

An item with StoreItem.serial_controlled = True (its "serial profile") must
name one serial number per unit on every goods movement:

  GRN              serials captured, one per unit received → Quality stock
  GRN inspection   accepted units → In stock; the rejected ones (named on the
                   inspection) → Blocked
  Quality lot      all accepted / all rejected moves every unit of the line
  Issue            the units picked (must be In stock at that store) → Issued,
                   recording what they went against (work order / machine / SR)
  Return           issued units come back → In stock (or Blocked if damaged)
  Transfer         In stock → In transit (dispatch) → In stock at the
                   receiving store (receipt)
  Return to vendor Blocked / In stock units → Returned to vendor
  GRN reversal     units still in the store → Cancelled

Every change writes a StoreSerialEvent row — the serial history."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem
from app.modules.store.models.serial_number import (
    STORE_SERIAL_IN_STORE, STORE_SERIAL_STATUS_LABELS, StoreSerialEvent, StoreSerialNumber,
)


class SerialError(ValueError):
    """A serial-number rule broken — the message says what to do."""


def is_serialised(item: StoreItem | None) -> bool:
    return bool(item is not None and item.serial_controlled)


def _units(qty: float, item: StoreItem) -> int:
    n = int(round(qty))
    if abs(qty - n) > 1e-9:
        raise SerialError(f"'{item.item_name}' is serial-numbered, so it moves in whole units — {qty:g} isn't a whole number.")
    return n


def normalise(serials: list[str] | None) -> list[str]:
    return [s.strip().upper() for s in (serials or []) if s and s.strip()]


def check_list(item: StoreItem, qty: float, serials: list[str] | None, *, action: str) -> list[str]:
    """The serial list for `qty` units of a serialised item: required, one per
    unit, no duplicates. Refuses serials on an item without a serial profile."""
    clean = normalise(serials)
    if not is_serialised(item):
        if clean:
            raise SerialError(f"'{item.item_name}' isn't serial-numbered (no serial profile in the Item Master), so don't enter "
                              "serial numbers for it — or tick 'Serial numbers' on the item first.")
        return []
    n = _units(qty, item)
    if not clean:
        raise SerialError(f"'{item.item_name}' is serial-numbered — enter the {n} serial number(s) {action}, one per unit.")
    if len(clean) != n:
        raise SerialError(f"'{item.item_name}': {len(clean)} serial number(s) entered for {n} unit(s) {action} — enter exactly one per unit.")
    dup = sorted({s for s in clean if clean.count(s) > 1})
    if dup:
        raise SerialError(f"'{item.item_name}': serial number {', '.join(dup)} is entered twice — each unit has its own serial.")
    return clean


def move(db: Session, units: list[StoreSerialNumber], to_status: str, event: str, *, user_id: int | None,
         reference_type: str | None, reference_number: str | None, remarks: str | None = None,
         event_date: date | None = None, **fields) -> None:
    """Moves units to `to_status` (setting any extra fields first, so the
    history row shows the new store / bin) and writes their history."""
    for u in units:
        old = u.status
        for k, v in fields.items():
            setattr(u, k, v)
        db.add(StoreSerialEvent(serial_id=u.id, event=event, from_status=old, to_status=to_status, location_id=u.location_id,
                                bin_id=u.bin_id, reference_type=reference_type, reference_number=reference_number,
                                event_date=event_date or date.today(), remarks=remarks, created_by_id=user_id))
        u.status = to_status
    db.flush()


# ── GRN ─────────────────────────────────────────────────────────────────────

def check_new_for_grn(db: Session, item: StoreItem, qty: float, serials: list[str] | None) -> list[str]:
    clean = check_list(item, qty, serials, action="received")
    if not clean:
        return []
    existing = {u.serial_no: u for u in db.query(StoreSerialNumber).filter(
        StoreSerialNumber.item_id == item.id, StoreSerialNumber.serial_no.in_(clean)).all()}
    # A unit that went back to the vendor (or whose GRN was reversed) may come
    # in again — e.g. the repaired / replacement unit carries the same serial.
    clash = [s for s, u in existing.items() if u.status not in ("returned_to_vendor", "cancelled")]
    if clash:
        u = existing[clash[0]]
        raise SerialError(f"'{item.item_name}' serial {', '.join(clash)} is already in the books "
                          f"({STORE_SERIAL_STATUS_LABELS.get(u.status, u.status)}) — check the number on the unit's name plate.")
    return clean


def receive_on_grn(db: Session, *, grn, line, item: StoreItem, serials: list[str], vendor_name: str | None, user_id: int,
                   warranty_until: date | None = None) -> list[StoreSerialNumber]:
    if not serials:
        return []
    existing = {u.serial_no: u for u in db.query(StoreSerialNumber).filter(
        StoreSerialNumber.item_id == item.id, StoreSerialNumber.serial_no.in_(serials)).all()}
    units = []
    for s in serials:
        u = existing.get(s)
        fields = dict(location_id=grn.store_location_id, bin_id=line.bin_id, grn_id=grn.id, grn_item_id=line.id,
                      vendor_name=vendor_name, received_date=grn.received_date, vendor_warranty_until=warranty_until,
                      issue_id=None, issue_item_id=None, issued_to=None, work_order=None, erp_project_id=None,
                      service_request_id=None, transfer_item_id=None)
        if u is None:
            u = StoreSerialNumber(item_id=item.id, serial_no=s, status="quality", created_by_id=user_id, **fields)
            db.add(u)
            db.flush()
            db.add(StoreSerialEvent(serial_id=u.id, event="received", from_status=None, to_status="quality",
                                    location_id=u.location_id, bin_id=u.bin_id, reference_type="grn",
                                    reference_number=grn.grn_number, event_date=grn.received_date, created_by_id=user_id,
                                    remarks=f"Received from {vendor_name or 'vendor'} — in Quality stock until inspected"))
        else:
            move(db, [u], "quality", "received", user_id=user_id, reference_type="grn", reference_number=grn.grn_number,
                 event_date=grn.received_date, remarks=f"Received again from {vendor_name or 'vendor'}", **fields)
        units.append(u)
    db.flush()
    return units


def line_units(db: Session, grn_item_id: int, statuses: tuple[str, ...] | None = None) -> list[StoreSerialNumber]:
    q = db.query(StoreSerialNumber).filter(StoreSerialNumber.grn_item_id == grn_item_id)
    if statuses:
        q = q.filter(StoreSerialNumber.status.in_(statuses))
    return q.order_by(StoreSerialNumber.id).all()


def inspect_grn_line(db: Session, *, grn, line, item: StoreItem, rejected_serials: list[str] | None, user_id: int) -> None:
    """GRN inspection of a serialised line: the rejected units must be named
    (the inspector knows which pump failed), the rest go to stock."""
    units = line_units(db, line.id, ("quality",))
    if not units:
        return
    rejected = line.rejected_quantity or 0
    named = normalise(rejected_serials)
    if rejected > 1e-9 and (line.accepted_quantity or 0) > 1e-9:
        n = _units(rejected, item)
        if len(named) != n:
            raise SerialError(f"'{item.item_name}' is serial-numbered and {n:g} unit(s) were rejected — name the rejected "
                              f"serial number(s) ({len(named)} named).")
    elif rejected > 1e-9:
        named = [u.serial_no for u in units]
    else:
        named = []
    by_no = {u.serial_no: u for u in units}
    unknown = [s for s in named if s not in by_no]
    if unknown:
        raise SerialError(f"'{item.item_name}': serial {', '.join(unknown)} isn't on this GRN line — pick from {', '.join(by_no)}.")
    bad = [by_no[s] for s in named]
    good = [u for u in units if u.serial_no not in set(named)]
    if good:
        move(db, good, "in_stock", "inspection_accepted", user_id=user_id, reference_type="grn", reference_number=grn.grn_number,
             remarks="Accepted on the GRN inspection")
    if bad:
        move(db, bad, "blocked", "inspection_rejected", user_id=user_id, reference_type="grn", reference_number=grn.grn_number,
             remarks=line.rejection_reason or "Rejected on the GRN inspection")


def lot_decided(db: Session, *, line, accepted: float, rejected: float, user_id: int, reason: str | None) -> None:
    """Quality lot usage decision on a serialised GRN line. All accepted / all
    rejected moves every unit; a partial decision leaves the units in Quality
    with a note — the lot doesn't say which unit failed, so the store names
    them on Store › Serial numbers (block / release)."""
    units = line_units(db, line.id, ("quality",))
    if not units:
        return
    ref = getattr(line.goods_receipt, "grn_number", None) if getattr(line, "goods_receipt", None) else None
    if rejected <= 1e-9:
        move(db, units, "in_stock", "lot_accepted", user_id=user_id, reference_type="inspection_lot", reference_number=ref, remarks=reason)
    elif accepted <= 1e-9:
        move(db, units, "blocked", "lot_rejected", user_id=user_id, reference_type="inspection_lot", reference_number=ref, remarks=reason)


def set_quality_result(db: Session, unit: StoreSerialNumber, to_status: str, user_id: int, reason: str) -> None:
    """Store names which unit of a partly-accepted lot passed / failed."""
    if unit.status != "quality":
        raise SerialError(f"Serial {unit.serial_no} is {STORE_SERIAL_STATUS_LABELS.get(unit.status, unit.status)}, not in Quality stock — "
                          "only units still waiting for their inspection result can be released or blocked here.")
    if to_status not in ("in_stock", "blocked"):
        raise SerialError("Choose 'release to stock' or 'block'.")
    if not (reason or "").strip():
        raise SerialError("Say why (e.g. the inspection lot number and result) — it is kept in the serial history.")
    move(db, [unit], to_status, "quality_result", user_id=user_id, reference_type="manual", reference_number=None, remarks=reason.strip())


def reverse_grn_line(db: Session, *, grn, line, user_id: int, reason: str) -> None:
    units = line_units(db, line.id, STORE_SERIAL_IN_STORE)
    if units:
        move(db, units, "cancelled", "grn_reversed", user_id=user_id, reference_type="grn_reversal", reference_number=grn.grn_number,
             remarks=reason, location_id=None, bin_id=None)


def return_to_vendor(db: Session, *, line, item: StoreItem, source: str, qty: float, serials: list[str] | None,
                     rtv_number: str, user_id: int, return_date: date) -> None:
    """RTV of a serialised GRN line: named units, or — when only that many are
    left in the matching state — all of them."""
    status = "in_stock" if source == "accepted" else "blocked"
    pool = line_units(db, line.id, (status,))
    if not pool:
        return
    n = _units(qty, item)
    named = normalise(serials)
    if not named:
        if len(pool) != n:
            raise SerialError(f"'{item.item_name}' is serial-numbered — name the {n} serial number(s) going back to the vendor "
                              f"(on this GRN: {', '.join(u.serial_no for u in pool)}).")
        units = pool
    else:
        by_no = {u.serial_no: u for u in pool}
        unknown = [s for s in named if s not in by_no]
        if unknown or len(named) != n:
            raise SerialError(f"'{item.item_name}': name exactly {n} serial number(s) from {', '.join(by_no)} "
                              f"({'not on this GRN / not ' + STORE_SERIAL_STATUS_LABELS[status] + ': ' + ', '.join(unknown) if unknown else str(len(named)) + ' named'}).")
        units = [by_no[s] for s in named]
    move(db, units, "returned_to_vendor", "returned_to_vendor", user_id=user_id, reference_type="vendor_return",
         reference_number=rtv_number, event_date=return_date, location_id=None, bin_id=None)


# ── Issue / return / transfer ───────────────────────────────────────────────

def pick(db: Session, item: StoreItem, location_id: int, qty: float, serials: list[str] | None, *,
         statuses: tuple[str, ...] = ("in_stock",), action: str = "issued", bin_id: int | None = None,
         exclude_ids: set[int] | None = None) -> list[StoreSerialNumber]:
    """The units named for an outbound move — each must be In stock at that
    store (and, when a bin is given, in that bin)."""
    clean = check_list(item, qty, serials, action=action)
    if not clean:
        return []
    units = {u.serial_no: u for u in db.query(StoreSerialNumber).filter(
        StoreSerialNumber.item_id == item.id, StoreSerialNumber.serial_no.in_(clean)).with_for_update().all()}
    problems = []
    for s in clean:
        u = units.get(s)
        if u is None:
            problems.append(f"{s} isn't in the books")
        elif exclude_ids and u.id in exclude_ids:
            problems.append(f"{s} is already on another line")
        elif u.status not in statuses or u.location_id != location_id:
            problems.append(f"{s} is {STORE_SERIAL_STATUS_LABELS.get(u.status, u.status).lower()}"
                            + (" at another store" if u.status in STORE_SERIAL_IN_STORE and u.location_id != location_id else ""))
        elif u.transfer_item_id and action != "dispatched":
            problems.append(f"{s} is booked on a stock transfer")
        elif bin_id is not None and u.bin_id not in (None, bin_id):
            problems.append(f"{s} is in another bin")
    if problems:
        raise SerialError(f"'{item.item_name}' can't be {action}: " + "; ".join(problems) + ". Pick serials that are in stock here "
                          "(Store › Serial numbers).")
    return [units[s] for s in clean]


def issue_units(db: Session, units: list[StoreSerialNumber], *, issue, line, against: str | None, user_id: int) -> None:
    if not units:
        return
    move(db, units, "issued", "issued", user_id=user_id, reference_type="material_issue", reference_number=issue.issue_number,
         event_date=issue.issue_date, remarks=against, issue_id=issue.id, issue_item_id=line.id, issued_to=against,
         work_order=issue.project_or_work_order, erp_project_id=issue.erp_project_id,
         service_request_id=issue.service_request_id, bin_id=None, location_id=issue.location_id)


def check_return(db: Session, item: StoreItem, qty: float, serials: list[str] | None, source_issue_id: int | None) -> list[str]:
    clean = check_list(item, qty, serials, action="returned")
    if not clean:
        return []
    units = {u.serial_no: u for u in db.query(StoreSerialNumber).filter(
        StoreSerialNumber.item_id == item.id, StoreSerialNumber.serial_no.in_(clean)).all()}
    problems = []
    for s in clean:
        u = units.get(s)
        if u is None:
            problems.append(f"{s} isn't in the books")
        elif u.status != "issued":
            problems.append(f"{s} is {STORE_SERIAL_STATUS_LABELS.get(u.status, u.status).lower()}, not issued")
        elif source_issue_id and u.issue_id != source_issue_id:
            problems.append(f"{s} wasn't issued on this issue")
    if problems:
        raise SerialError(f"'{item.item_name}' can't be returned: " + "; ".join(problems) + ".")
    return clean


def return_units(db: Session, item_id: int, serials: list[str] | None, *, location_id: int, bin_id: int | None,
                 blocked: bool, reference_number: str, user_id: int, event_date: date | None = None) -> None:
    if not serials:
        return
    units = db.query(StoreSerialNumber).filter(StoreSerialNumber.item_id == item_id, StoreSerialNumber.serial_no.in_(serials)).all()
    move(db, units, "blocked" if blocked else "in_stock", "returned", user_id=user_id, reference_type="material_return",
         reference_number=reference_number, event_date=event_date, location_id=location_id, bin_id=bin_id)


def book_on_transfer(db: Session, units: list[StoreSerialNumber], transfer_item_id: int) -> None:
    for u in units:
        u.transfer_item_id = transfer_item_id
    db.flush()


def transfer_units(db: Session, transfer_item_id: int) -> list[StoreSerialNumber]:
    return db.query(StoreSerialNumber).filter(StoreSerialNumber.transfer_item_id == transfer_item_id).order_by(StoreSerialNumber.id).all()


def dispatch_transfer(db: Session, line, transfer_number: str, user_id: int) -> None:
    units = transfer_units(db, line.id)
    bad = [u.serial_no for u in units if u.status != "in_stock"]
    if bad:
        raise SerialError(f"Serial {', '.join(bad)} is no longer in stock — cancel the transfer and raise it again with units that are.")
    move(db, units, "in_transit", "transfer_out", user_id=user_id, reference_type="stock_transfer", reference_number=transfer_number,
         bin_id=None)


def receive_transfer(db: Session, line, to_location_id: int, to_bin_id: int | None, transfer_number: str, user_id: int) -> None:
    units = transfer_units(db, line.id)
    move(db, units, "in_stock", "transfer_in", user_id=user_id, reference_type="stock_transfer", reference_number=transfer_number,
         location_id=to_location_id, bin_id=to_bin_id, transfer_item_id=None)


def release_transfer(db: Session, line) -> None:
    for u in transfer_units(db, line.id):
        u.transfer_item_id = None
    db.flush()


# ── Reads ───────────────────────────────────────────────────────────────────

def serial_dict(db: Session, u: StoreSerialNumber, *, items=None, locs=None, bins=None) -> dict:
    from app.modules.store.models.bin import StoreBin
    from app.modules.store.models.location import StoreLocation
    it = (items or {}).get(u.item_id) or db.get(StoreItem, u.item_id)
    loc = (locs or {}).get(u.location_id) if locs is not None else (db.get(StoreLocation, u.location_id) if u.location_id else None)
    b = (bins or {}).get(u.bin_id) if bins is not None else (db.get(StoreBin, u.bin_id) if u.bin_id else None)
    grn_number = None
    if u.grn_id:
        from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
        grn_number = db.query(P2PGoodsReceipt.grn_number).filter(P2PGoodsReceipt.id == u.grn_id).scalar()
    issue_number = None
    if u.issue_id:
        from app.modules.store.models.material_issue import StoreMaterialIssue
        issue_number = db.query(StoreMaterialIssue.issue_number).filter(StoreMaterialIssue.id == u.issue_id).scalar()
    return {
        "id": u.id, "item_id": u.item_id, "item_code": it.item_code if it else None, "item_name": it.item_name if it else None,
        "serial_no": u.serial_no, "status": u.status, "status_label": STORE_SERIAL_STATUS_LABELS.get(u.status, u.status),
        "location_id": u.location_id, "location_name": loc.name if loc else None, "bin_id": u.bin_id, "bin_code": b.code if b else None,
        "batch_number": u.batch_number, "vendor_name": u.vendor_name, "grn_id": u.grn_id, "grn_number": grn_number,
        "received_date": u.received_date, "vendor_warranty_until": u.vendor_warranty_until,
        "issue_id": u.issue_id, "issue_number": issue_number, "issued_to": u.issued_to, "work_order": u.work_order,
        "erp_project_id": u.erp_project_id, "service_request_id": u.service_request_id,
        "on_transfer": bool(u.transfer_item_id), "remarks": u.remarks,
    }


def history(db: Session, u: StoreSerialNumber) -> list[dict]:
    from app.modules.main.models.user import User
    from app.modules.store.models.bin import StoreBin
    from app.modules.store.models.location import StoreLocation
    rows = db.query(StoreSerialEvent).filter(StoreSerialEvent.serial_id == u.id).order_by(StoreSerialEvent.id).all()
    users = {x.id: x.name or x.email for x in db.query(User).filter(User.id.in_({r.created_by_id for r in rows} - {None})).all()}
    locs = {x.id: x.name for x in db.query(StoreLocation).filter(StoreLocation.id.in_({r.location_id for r in rows} - {None})).all()}
    bins = {x.id: x.code for x in db.query(StoreBin).filter(StoreBin.id.in_({r.bin_id for r in rows} - {None})).all()}
    return [{"id": r.id, "event": r.event, "from_status": r.from_status, "to_status": r.to_status,
             "to_status_label": STORE_SERIAL_STATUS_LABELS.get(r.to_status, r.to_status),
             "location_name": locs.get(r.location_id), "bin_code": bins.get(r.bin_id), "reference_type": r.reference_type,
             "reference_number": r.reference_number, "event_date": r.event_date, "remarks": r.remarks,
             "created_by_name": users.get(r.created_by_id)} for r in rows]
