"""Project stock — material held for a project vehicle / lot (2026-10-17).

Kept lightweight, the SAP "special stock via reservation" way: the stock
balance and valuation have NO project dimension. Material belongs to a
vehicle while a StoreStockReservation with order_project_element_id holds it:

  * a hold blocks its quantity from free stock (StoreStockBalance.reserved_qty,
    the same mechanism as every reservation), so no other issue / transfer can
    take it;
  * bought-out material of a project PO line is held automatically when its
    GRN puts it into Free stock (on_free_stock_in — a stock-ledger posting
    hook, so it works for the GRN inspection, an inspection-lot release and
    the older direct GRN receipt alike);
  * an issue for the same element consumes that element's holds first
    (secure_issue_qty) — the stock then leaves through the ordinary issue;
  * an issue for another element, or one with no element, can't take project
    stock: refused with who holds it — unless a Store Manager (or the store's
    manager / an admin) overrides it with a recorded reason;
  * a GRN reversal releases the holds that GRN created, so the reversal can
    take its stock back out.

Mandatory element (resolve_issue_project): an issue for an RRV order — a work
order / RRV build / sales order that has a project — must say which
vehicle / lot it is for. It is filled from the build / delivery row where it
can be, and refused with the reason where it can't.

Plain functions; rule violations raise HTTPException with the reason and the
fix. Other modules (Production's work-order issue) can call
consume_element_holds / secure_issue_qty before posting their own issue."""
from __future__ import annotations

import logging
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.services.stock_ledger import adjust_reserved_qty, get_locked_balance

logger = logging.getLogger("store")

EPS = 1e-9
_QTY = 4
GRN_SOURCE = "grn_item"
# Issue types whose material goes to building / reworking / delivering an
# order — they carry the project unit. Other types (maintenance,
# general, job work, scrap, sample, testing, service) are never project
# issues: their element is cleared and they can't draw project stock.
PROJECT_ISSUE_TYPES = ("production", "rework", "project", "dispatch")


# ---------------------------------------------------------------- helpers

def is_store_manager(user, location=None) -> bool:
    """Store Manager authority: the user flag, the store's own manager, or an admin."""
    if user is None:
        return False
    return bool(user.role == "admin" or getattr(user, "is_azure_admin", False) or getattr(user, "is_store_manager", False)
                or (location is not None and location.manager_user_id and location.manager_user_id == user.id))


def element_label(db: Session, element_id: int | None) -> str | None:
    """'PEW-80 / 01 · Vehicle 1' for messages and responses."""
    if not element_id:
        return None
    from app.modules.projects.models.element import PmProjectElement
    from app.modules.projects.so_projects import element_display
    el = db.get(PmProjectElement, element_id)
    return element_display(el.project, el) if el is not None else None


def element_info(db: Session, element_id: int | None) -> dict:
    """Display fields for responses / chips (empty dict when unlinked)."""
    if not element_id:
        return {}
    from app.modules.projects.models.element import PmProjectElement
    el = db.get(PmProjectElement, element_id)
    if el is None:
        return {}
    return {"order_project_id": el.project_id, "op_number": el.project.project_code, "element_no": el.element_no,
            "element_label": el.label}


def element_for_schedule_row(db: Session, schedule_id: int | None):
    """The element a Sales delivery row ships: its vehicle element, or the lot
    element of the row's line (spares / other). None when the order has no
    project."""
    if not schedule_id:
        return None
    from app.modules.sales.models.order import SalesOrderSchedule
    from app.modules.projects.models.element import PmProjectElement
    from app.modules.projects.so_projects import element_for_schedule
    el = element_for_schedule(db, schedule_id)
    if el is not None:
        return el
    row = db.get(SalesOrderSchedule, schedule_id)
    if row is None:
        return None
    return (db.query(PmProjectElement)
            .filter(PmProjectElement.sales_order_line_id == row.so_line_id, PmProjectElement.kind == "lot")
            .order_by(PmProjectElement.id.desc()).first())


def _project_of_order(db: Session, so_id: int | None):
    if not so_id:
        return None
    from app.modules.projects.so_projects import project_for_order
    return project_for_order(db, so_id)


def _build_element(db: Session, build):
    """(element, project) of an RRV build: its own link (Production phase 2)
    or the vehicle element of its delivery row; else the order's project."""
    from app.modules.projects.models.element import PmProjectElement
    eid = getattr(build, "order_project_element_id", None)
    if eid:
        el = db.get(PmProjectElement, eid)
        if el is not None:
            return el, el.project
    el = element_for_schedule_row(db, getattr(build, "sales_schedule_id", None))
    if el is not None:
        return el, el.project
    return None, _project_of_order(db, getattr(build, "sales_order_id", None))


def work_order_context(db: Session, ref: str | None):
    """What a 'Work order no.' on an issue points at: a Production work order
    or RRV build number (exact, case-insensitive — they are unique document
    numbers). Returns (element | None, project | None, document label) or
    (None, None, None) when the text isn't one of them."""
    text = (ref or "").strip()
    if not text:
        return None, None, None
    try:
        from app.modules.production.models.rrv_build import ProductionRrvBuild
        from app.modules.production.models.work_order import ProductionWorkOrder
    except Exception:  # noqa: BLE001 — Production not installed
        return None, None, None
    from app.modules.projects.models.element import PmProjectElement
    wo = db.query(ProductionWorkOrder).filter(func.lower(ProductionWorkOrder.wo_number) == text.lower()).first()
    if wo is not None:
        label = f"work order {wo.wo_number}"
        eid = getattr(wo, "order_project_element_id", None)
        if eid and (el := db.get(PmProjectElement, eid)) is not None:
            return el, el.project, label
        if wo.rrv_build_id and (build := db.get(ProductionRrvBuild, wo.rrv_build_id)) is not None:
            el, project = _build_element(db, build)
            if el is not None or project is not None:
                return el, project, label
        return None, _project_of_order(db, wo.sales_order_id), label
    build = db.query(ProductionRrvBuild).filter(func.lower(ProductionRrvBuild.build_number) == text.lower()).first()
    if build is not None:
        el, project = _build_element(db, build)
        return el, project, f"RRV build {build.build_number}"
    return None, None, None


# ---------------------------------------------------------------- issue: which element

def resolve_issue_project(db: Session, issue_type: str | None, payload) -> dict:
    """Decide the project link of a new material issue.

    Returns {"project_id", "element_id", "line_elements": [element_id | None per
    payload item]}. Raises 422 when an RRV-order issue has no element or the
    picked element contradicts the work order / build / delivery row."""
    from app.modules.projects.so_projects import resolve_element, resolve_project

    items = list(payload.items or [])
    if issue_type not in PROJECT_ISSUE_TYPES and issue_type is not None:
        return {"project_id": None, "element_id": None, "line_elements": [None] * len(items)}

    picked_project_id = getattr(payload, "order_project_id", None)
    picked_el = None
    if getattr(payload, "order_project_element_id", None):
        _p, picked_el = resolve_element(db, payload.order_project_element_id, project_id=picked_project_id)
    elif picked_project_id:
        p = resolve_project(db, picked_project_id)
        raise HTTPException(status_code=422, detail=f"Pick the vehicle / lot of {p.project_code} this material goes to — an issue "
                                                    "is booked to one unit of the project, not to the project as a whole.")

    # What the issue's own references say.
    derived_el, derived_project, source = None, None, None
    if issue_type in ("production", "rework", None):
        derived_el, derived_project, source = work_order_context(db, getattr(payload, "project_or_work_order", None))
    if issue_type == "dispatch" and getattr(payload, "sales_order_id", None):
        derived_project = _project_of_order(db, payload.sales_order_id)
        if derived_project is not None:
            from app.modules.sales.models.order import SalesOrder
            so = db.get(SalesOrder, payload.sales_order_id)
            source = f"sales order {so.display_number if so else payload.sales_order_id}"

    if derived_el is not None and picked_el is not None and derived_el.id != picked_el.id:
        raise HTTPException(status_code=422, detail=(
            f"{source[0].upper() + source[1:]} builds {element_label(db, derived_el.id)}, but the issue names "
            f"{element_label(db, picked_el.id)} — pick the element of that {source.split(' ')[0]} "
            "(or correct the work order no.)."))
    if picked_el is not None and derived_project is not None and picked_el.project_id != derived_project.id:
        raise HTTPException(status_code=422, detail=(
            f"{element_label(db, picked_el.id)} belongs to another project than {source} "
            f"({derived_project.project_code}) — pick an element of {derived_project.project_code}."))
    header_el = picked_el or derived_el

    # Lines: a dispatch line ships a delivery row → that row's element.
    line_elements: list[int | None] = []
    for it in items:
        row_el = element_for_schedule_row(db, getattr(it, "sales_schedule_id", None)) if issue_type == "dispatch" else None
        own_id = getattr(it, "order_project_element_id", None)
        own = resolve_element(db, own_id)[1] if own_id else None
        if row_el is not None and own is not None and row_el.id != own.id:
            raise HTTPException(status_code=422, detail=(
                f"A dispatched line names {element_label(db, own.id)} but its delivery row is {element_label(db, row_el.id)} "
                "— the element follows the delivery row; clear the line's element or pick the right row."))
        el = row_el or own or header_el
        if el is not None and header_el is not None and issue_type != "dispatch" and el.id != header_el.id:
            raise HTTPException(status_code=422, detail=(
                f"A line names {element_label(db, el.id)} but the issue is for {element_label(db, header_el.id)} — "
                "one issue goes to one vehicle / lot (a dispatch may ship several delivery rows)."))
        line_elements.append(el.id if el is not None else None)

    # Mandatory rule: an issue for an RRV order carries the element.
    if derived_project is not None and header_el is None and not (items and all(line_elements)):
        raise HTTPException(status_code=422, detail=(
            f"{source[0].upper() + source[1:]} is for an RRV order (project {derived_project.project_code}) — pick the "
            "vehicle / lot this material goes to in 'Project unit', so the material is booked to that vehicle."))

    ids = {e for e in line_elements if e}
    project_id = None
    if header_el is not None:
        project_id = header_el.project_id
    elif ids:
        from app.modules.projects.models.element import PmProjectElement
        projects = {db.get(PmProjectElement, e).project_id for e in ids}
        project_id = projects.pop() if len(projects) == 1 else None
    element_id = header_el.id if header_el is not None else (next(iter(ids)) if len(ids) == 1 else None)
    return {"project_id": project_id, "element_id": element_id, "line_elements": line_elements}


# ---------------------------------------------------------------- holds

def active_holds(db: Session, item_id: int, location_id: int, *, lock: bool = True) -> list[StoreStockReservation]:
    q = db.query(StoreStockReservation).filter(
        StoreStockReservation.item_id == item_id, StoreStockReservation.location_id == location_id,
        StoreStockReservation.status == "active")
    if lock:
        q = q.with_for_update()
    return q.order_by(StoreStockReservation.required_date.asc().nullslast(), StoreStockReservation.id.asc()).all()


def _take(db: Session, res: StoreStockReservation, qty: float, *, emptied_status: str, note: str | None = None) -> float:
    take = round(min(float(res.quantity or 0), qty), _QTY)
    if take <= EPS:
        return 0.0
    adjust_reserved_qty(db, item_id=res.item_id, location_id=res.location_id, delta=-take)
    left = round(float(res.quantity or 0) - take, _QTY)
    if left <= EPS:
        res.status = emptied_status
    else:
        res.quantity = left
    if note:
        res.remarks = f"{res.remarks}\n{note}" if res.remarks else note
    return take


def consume_element_holds(db: Session, *, item_id: int, location_id: int, qty: float, element_id: int | None) -> float:
    """Before issuing `qty` to `element_id`, hand back that element's holds of
    the item at the store (oldest need first) so the issue's available-stock
    check counts them. A partly drawn hold keeps the remainder; an emptied one
    becomes fulfilled. Returns the quantity consumed."""
    if not element_id or qty <= EPS:
        return 0.0
    left = qty
    for res in active_holds(db, item_id, location_id):
        if res.order_project_element_id != element_id:
            continue
        left -= _take(db, res, left, emptied_status="fulfilled")
        if left <= EPS:
            break
    return round(qty - max(left, 0.0), _QTY)


def _holder_text(db: Session, holds: list[StoreStockReservation]) -> str:
    from app.modules.main.models.user import User
    parts = []
    for r in holds:
        who = db.get(User, r.reserved_by_id) if r.reserved_by_id else None
        by = f", reserved by {who.name or who.email}" if who else ""
        src = f" from {r.source_reference}" if r.source_reference else ""
        parts.append(f"{float(r.quantity):g} for {element_label(db, r.order_project_element_id) or 'another project'} "
                     f"({r.reservation_number}{src}{by})")
    return "; ".join(parts)


def secure_issue_qty(db: Session, *, item_id: int, location_id: int, qty: float, element_id: int | None, user, location=None,
                     override_reason: str | None = None, document: str = "this issue") -> dict:
    """Make `qty` issuable for `element_id` (None = a non-project issue):
    consume the element's own holds, then — if free stock is still short and
    the rest is held for OTHER elements — refuse with who holds it, or, for a
    Store Manager with a reason, release just the shortfall from those holds.
    Non-project holds (work orders, manual) are never touched here — the
    ledger's own 'not enough stock' message covers them.

    Returns {"consumed": float, "overridden": [(reservation_number, qty, element label)]}."""
    from app.modules.store.services import valuation
    if valuation.valuation_enabled(db):
        valuation.lock_valuation(db, item_id)  # ledger lock order: valuation, then balance
    consumed = consume_element_holds(db, item_id=item_id, location_id=location_id, qty=qty, element_id=element_id)
    balance = get_locked_balance(db, item_id, location_id)
    free = float(balance.on_hand_qty or 0) - float(balance.reserved_qty or 0)
    short = round(qty - free, _QTY)
    out = {"consumed": consumed, "overridden": []}
    if short <= EPS:
        return out
    others = [r for r in active_holds(db, item_id, location_id)
              if r.order_project_element_id and r.order_project_element_id != element_id]
    if not others:
        return out
    item = db.get(StoreItem, item_id)
    name = f"{item.item_code} — {item.item_name}" if item else f"item #{item_id}"
    held = round(sum(float(r.quantity or 0) for r in others), _QTY)
    target = f"to {element_label(db, element_id)}" if element_id else "to a non-project issue"
    if not is_store_manager(user, location):
        raise HTTPException(status_code=409, detail=(
            f"{short:g} of the {qty:g} {name} needed is project stock held for another vehicle: {_holder_text(db, others)}. "
            f"It can't be issued {target}. Issue it against the element that holds it, reserve / buy stock for this one, "
            "or ask a Store Manager to release it (they must give a reason)."))
    reason = (override_reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail=(
            f"{short:g} of the {qty:g} {name} is project stock held for another vehicle ({_holder_text(db, others)}). As a "
            f"Store Manager you may still issue it {target}, but say why in 'Reason for using project stock' — it is recorded "
            "on the issue and on the reservation."))
    need = min(short, held)
    for res in others:
        if need <= EPS:
            break
        label = element_label(db, res.order_project_element_id)
        take = _take(db, res, need, emptied_status="cancelled",
                     note=f"{min(float(res.quantity or 0), need):g} released by {user.name or user.email} on {date.today():%d-%m-%Y} "
                          f"for {document} — Store Manager override: {reason}")
        need -= take
        out["overridden"].append((res.reservation_number, take, label))
    return out


def reserve_for_element(db: Session, *, item_id: int, location_id: int, qty: float, element_id: int, user_id: int | None,
                        source_type: str | None = None, source_id: int | None = None, source_reference: str | None = None,
                        required_date: date | None = None, remarks: str | None = None) -> StoreStockReservation:
    """Hold `qty` of free stock for an element: tops up the active hold of the
    same source (a later release of the same GRN line) or opens a new one.
    Raises ValueError when free stock is short (adjust_reserved_qty)."""
    from app.modules.projects.models.element import PmProjectElement
    from app.modules.store.service import generate_stock_reservation_number
    el = db.get(PmProjectElement, element_id)
    adjust_reserved_qty(db, item_id=item_id, location_id=location_id, delta=qty)
    res = None
    if source_type and source_id:
        res = (db.query(StoreStockReservation)
               .filter(StoreStockReservation.source_type == source_type, StoreStockReservation.source_id == source_id,
                       StoreStockReservation.status == "active", StoreStockReservation.location_id == location_id,
                       StoreStockReservation.item_id == item_id).with_for_update().first())
    if res is not None:
        res.quantity = round(float(res.quantity or 0) + qty, _QTY)
        res.original_qty = round(float(res.original_qty or 0) + qty, _QTY)
        return res
    res = StoreStockReservation(
        reservation_number=generate_stock_reservation_number(db), item_id=item_id, location_id=location_id,
        quantity=round(qty, _QTY), original_qty=round(qty, _QTY), reserved_by_id=user_id, status="active",
        required_date=required_date or (el.contractual_date if el is not None else None),
        order_project_id=el.project_id if el is not None else None, order_project_element_id=element_id,
        source_type=source_type, source_id=source_id, source_reference=source_reference, remarks=remarks,
    )
    db.add(res)
    db.flush()
    return res


# ---------------------------------------------------------------- GRN → hold (stock-ledger hooks)

def _grn_line_element(line) -> int | None:
    eid = getattr(line, "order_project_element_id", None)
    if not eid and getattr(line, "po_item", None) is not None:
        eid = getattr(line.po_item, "order_project_element_id", None)
    return eid


def _grn_lines_for_txn(db: Session, txn) -> list:
    try:
        from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
    except Exception:  # noqa: BLE001
        return []
    if txn.reference_type == "grn":
        grn = db.query(P2PGoodsReceipt).filter(P2PGoodsReceipt.grn_number == txn.reference_number).first()
        if grn is None:
            return []
        return sorted((ln for ln in grn.items if ln.store_item_id == txn.item_id), key=lambda ln: ln.id)
    if txn.reference_type == "inspection_lot":
        from app.modules.quality.models.inspection_lot import QualityInspectionLot
        lot = db.query(QualityInspectionLot).filter(QualityInspectionLot.lot_number == txn.reference_number).first()
        if lot is None or not lot.grn_item_id:
            return []
        line = db.get(P2PGoodsReceiptItem, lot.grn_item_id)
        return [line] if line is not None and line.store_item_id == txn.item_id else []
    return []


def on_free_stock_in(db: Session, txn) -> None:
    """Stock-ledger posting hook: when material of a project PO line reaches
    Free stock (GRN inspection release, inspection-lot release, older direct
    GRN receipt), hold it for the line's project unit — at most the
    line's received quantity over all its releases."""
    if txn.transaction_type not in ("quality_release", "receipt") or txn.reference_type not in ("grn", "inspection_lot"):
        return
    lines = [ln for ln in _grn_lines_for_txn(db, txn) if _grn_line_element(ln)]
    if not lines:
        return
    from app.modules.projects.so_projects import resolve_element
    left = float(txn.quantity or 0)
    for ln in lines:
        if left <= EPS:
            break
        cap = float(ln.received_quantity or 0) - float(ln.returned_quantity or 0)
        so_far = float(db.query(func.coalesce(func.sum(StoreStockReservation.original_qty), 0.0)).filter(
            StoreStockReservation.source_type == GRN_SOURCE, StoreStockReservation.source_id == ln.id).scalar() or 0)
        take = round(min(left, cap - so_far), _QTY)
        if take <= EPS:
            continue
        try:
            _p, el = resolve_element(db, _grn_line_element(ln))
        except HTTPException as e:  # element cancelled by an amendment — the stock stays free
            logger.info("GRN %s line %s not held for its project: %s", txn.reference_number, ln.id, e.detail)
            continue
        grn_no = ln.goods_receipt.grn_number if ln.goods_receipt is not None else txn.reference_number
        reserve_for_element(
            db, item_id=txn.item_id, location_id=txn.location_id, qty=take, element_id=el.id, user_id=txn.created_by_id,
            source_type=GRN_SOURCE, source_id=ln.id, source_reference=grn_no,
            remarks=f"Bought out for {element_label(db, el.id)} — held automatically from GRN {grn_no}",
        )
        left -= take


def before_outbound(db: Session, *, item_id: int, location_id: int, transaction_type: str, quantity: float,
                    reference_type: str | None, reference_number: str | None) -> None:
    """Stock-ledger pre-posting hook: a GRN reversal takes its stock back out —
    release the project holds that GRN created for the item first, so the
    reversal isn't refused by its own hold."""
    if transaction_type != "return_out" or reference_type != "grn_reversal" or not reference_number:
        return
    left = quantity
    holds = (db.query(StoreStockReservation)
             .filter(StoreStockReservation.source_type == GRN_SOURCE, StoreStockReservation.source_reference == reference_number,
                     StoreStockReservation.item_id == item_id, StoreStockReservation.location_id == location_id,
                     StoreStockReservation.status == "active").with_for_update().all())
    for res in holds:
        if left <= EPS:
            break
        left -= _take(db, res, left, emptied_status="cancelled", note=f"Released — GRN {reference_number} reversed")
