"""MRP engine (SAP MD01N multi-level, sales-order driven, ETO).

Per plant and per item, lowest BOM level first (low-level code):

  requirements  Sales Order schedule lines not yet dispatched (when no RRV
                build with work orders covers them), RRV builds with no work
                order yet, outstanding work-order material lines (the order
                reservations), other active Store reservations, safety stock,
                and the components of planned orders (dependent demand).
  supply        unrestricted on-hand stock at the plant's stores, open PR
                lines with no PO yet and open PO lines not yet received
                (same rules as store/services/reorder.on_order), open
                work-order output, firmed planned orders.

Netting is lot-for-lot (SAP "EX"): each requirement still uncovered after
stock and the receipts dated on or before it — or a fixed receipt within the
rescheduling horizon after it, which gets a "bring forward" message instead —
becomes a planned order finishing on the requirement date. Buy items start
`lead_time_days` earlier (Item Master); make items start earlier by their
routing hours at MRP_PARAMETERS["hours_per_day"]. A make planned order passes
its BOM components down as dependent requirements on its start date.

A plant run (branch_id set) reads lead time, safety stock, in-house
production days, MRP type and procurement type through
store/services/plant_data.plant_views (plant row, else Item Master): items
whose plant MRP type is not "mrp" are not planned (exception
not_mrp_planned), and procurement make/buy overrides the BOM rule ("both" or
no plant row = active BOM → make). Company-wide runs use the Item Master.

The parameters are coded (MRP_PARAMETERS) — not admin-configurable — and the
values used are stored on each run.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from math import ceil
import heapq

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.mrp import (
    MRP_EXCEPTION_LABELS, ProductionMrpException, ProductionMrpRun, ProductionPlannedOrder,
)
from app.modules.production.models.rrv_build import PRODUCTION_RRV_OPEN_STATUSES, ProductionRrvBuild
from app.modules.production.models.work_order import ProductionWorkOrder, ProductionWorkOrderMaterial
from app.modules.production.service import _lock_number_series, explode_bom, outstanding_qty
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_reservation import StoreStockReservation

EPS = 1e-6
_QTY = 4

MRP_PARAMETERS: dict = {
    "lot_sizing": "EX",                 # lot-for-lot: one planned order per uncovered requirement
    "planning_horizon_days": 365,       # requirements later than this are not planned
    "reschedule_in_days": 30,           # a fixed receipt up to this many days late is pulled in, not re-ordered
    "reschedule_out_tolerance_days": 5,  # a receipt this many days earlier than needed gets "postpone"
    "hours_per_day": 8.0,               # make lead time = routing hours / this (whole days, min 1)
    "default_make_days": 1,             # make item without routing hours or Item Master lead time
    "include_draft_work_orders": True,  # draft work orders count as firm demand + receipt
    "max_bom_depth": 15,
}
# Overridable per run from the run screen (validated in the route).
RUN_OVERRIDABLE = ("planning_horizon_days", "include_draft_work_orders")

# Units planned in whole numbers (a planned order for 2.3 NOS is 3 NOS).
DISCRETE_UOMS = {"NOS", "NO", "NO.", "PCS", "PC", "SET", "SETS", "EA", "EACH", "UNIT", "UNITS", "PAIR", "PR", "KIT"}

# Store reorder rules: what a PR / PO line still has on order.
from app.modules.store.services.reorder import CLOSED_PR_STATUSES, OPEN_PO_STATUSES, PRE_PO_PR_STATUSES  # noqa: E402

SO_PLANNED_STATUSES = ("confirmed", "in_execution", "partially_delivered")
SCHEDULE_PLANNED_STATUSES = ("open", "build_planned", "in_production", "ready")
RRV_PLANNED_STATUSES = tuple(s for s in PRODUCTION_RRV_OPEN_STATUSES if s != "on_hold")
WO_DEMAND_STATUSES = ("released", "in_progress")

# MD04 element labels (SAP short names in brackets).
ELEMENT_LABELS = {
    "stock": "Stock", "safety_stock": "Safety stock (SafeSt)", "so_schedule": "Sales order schedule (CusOrd)",
    "rrv_build": "RRV build demand", "wo_requirement": "Work order requirement (OrdRes)",
    "reservation": "Reservation (MtlRes)", "dependent": "Dependent requirement (DepReq)",
    "pr": "Purchase requisition (PurRqs)", "po": "Purchase order (POitem)", "wo_receipt": "Work order receipt (PrdOrd)",
    "planned_order": "Planned order (PlOrd.)",
}


class MrpError(Exception):
    """A real, user-facing reason the request can't be done (route → 4xx)."""

    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.message, self.status_code = message, status_code


@dataclass
class Scope:
    """The plant being planned. branch_id None = company-wide."""
    branch_id: int | None
    include_unassigned: bool = True

    def has(self, branch_id: int | None) -> bool:
        if self.branch_id is None:
            return True
        if branch_id is None:
            return self.include_unassigned
        return branch_id == self.branch_id


@dataclass(eq=False)
class Element:
    item_id: int
    date: date
    qty: float
    receipt: bool
    kind: str
    ref: str
    ref_type: str | None = None
    ref_id: int | None = None
    fixed: bool = True
    peg: dict = field(default_factory=dict)
    planned_order: ProductionPlannedOrder | None = None


@dataclass(eq=False)
class _Slot:
    element: Element
    remaining: float
    first_need: date | None = None
    synthetic: bool = False


@dataclass
class NetResult:
    shortages: list = field(default_factory=list)   # (req Element, uncovered qty, order qty)
    messages: list = field(default_factory=list)    # dicts (code, message, element, dates, qty)
    ending: float = 0.0


def _fmt(d: date | None) -> str:
    return d.strftime("%d-%m-%Y") if d else "—"


def _q(x: float) -> float:
    return round(x + 0.0, _QTY)


# ---------------------------------------------------------------------------
# Netting (pure)
# ---------------------------------------------------------------------------

def net_item(*, stock: float, safety: float, reqs: list[Element], receipts: list[Element], today: date,
             params: dict, lot_size=None, uom: str = "") -> NetResult:
    """Lot-for-lot netting of one item. `lot_size(qty) -> order qty` creates
    planned orders (an MRP run); without it the uncovered quantities are
    just reported (MD04)."""
    res = NetResult()
    slots = sorted((_Slot(r, r.qty) for r in receipts if r.qty > EPS), key=lambda s: (s.element.date, s.element.ref))
    free = max(stock, 0.0)
    if safety > EPS and stock < safety - EPS:
        res.messages.append({"code": "below_safety_stock", "element": None, "date": today, "suggested": None, "qty": _q(safety - stock),
                             "message": f"Stock {_q(stock)} {uom} is below the safety stock of {_q(safety)} {uom}."})
    demand = sorted((r for r in reqs if r.qty > EPS), key=lambda r: (r.date, r.ref))
    if safety > EPS:
        demand.insert(0, Element(item_id=0, date=today, qty=safety, receipt=False, kind="safety_stock", ref="Safety stock",
                                 peg={"demand_type": "safety_stock", "demand_label": "Safety stock"}))
    window = timedelta(days=int(params.get("reschedule_in_days", 0)))
    for req in demand:
        need = req.qty
        take = min(free, need)
        free -= take
        need -= take
        if need > EPS:
            for slot in slots:
                if need <= EPS:
                    break
                if slot.remaining > EPS and slot.element.date <= req.date:
                    take = min(slot.remaining, need)
                    slot.remaining -= take
                    need -= take
                    slot.first_need = min(slot.first_need or req.date, req.date)
        if need > EPS:
            for slot in slots:
                if need <= EPS:
                    break
                if slot.remaining > EPS and req.date < slot.element.date <= req.date + window and not slot.synthetic:
                    take = min(slot.remaining, need)
                    slot.remaining -= take
                    need -= take
                    slot.first_need = min(slot.first_need or req.date, req.date)
        if need > EPS:
            order_qty = lot_size(need) if lot_size else need
            res.shortages.append((req, _q(need), _q(order_qty)))
            if order_qty - need > EPS:
                surplus = Element(item_id=req.item_id, date=req.date, qty=order_qty - need, receipt=True, kind="planned_order",
                                  ref="lot surplus", fixed=False)
                slots.append(_Slot(surplus, order_qty - need, synthetic=True))
                slots.sort(key=lambda s: (s.element.date, s.element.ref))
    tol = int(params.get("reschedule_out_tolerance_days", 0))
    for slot in slots:
        el = slot.element
        if slot.synthetic or not el.fixed:
            continue
        what = f"{el.ref} ({_q(el.qty)} {uom})"
        if el.date < today:
            res.messages.append({"code": "finish_in_past", "element": el, "date": el.date, "suggested": today, "qty": _q(el.qty),
                                 "message": f"{what} was due on {_fmt(el.date)} and has not been received — chase it or re-date it."})
        if slot.first_need is None:
            res.messages.append({"code": "cancel", "element": el, "date": el.date, "suggested": None, "qty": _q(el.qty),
                                 "message": f"{what} is not needed by any requirement in the horizon — cancel or reduce it."})
        elif slot.first_need < el.date:
            res.messages.append({"code": "reschedule_in", "element": el, "date": el.date, "suggested": slot.first_need, "qty": _q(el.qty),
                                 "message": f"{what} arrives {_fmt(el.date)} but is needed from {_fmt(slot.first_need)} — bring it forward to {_fmt(slot.first_need)}."})
        elif (slot.first_need - el.date).days > tol:
            res.messages.append({"code": "reschedule_out", "element": el, "date": el.date, "suggested": slot.first_need, "qty": _q(el.qty),
                                 "message": f"{what} arrives {_fmt(el.date)} but is first needed on {_fmt(slot.first_need)} — it can be postponed to {_fmt(slot.first_need)}."})
    res.ending = _q(free + sum(s.remaining for s in slots))
    return res


@dataclass
class Planning:
    """The planning parameters MRP uses for one item: the plant view
    (store/services/plant_data) on a plant run, the Item Master otherwise."""
    make: bool
    safety_stock: float
    lead_time_days: int | None
    min_order_qty: float
    make_days: int | None = None
    mrp_type: str | None = None          # plant MRP type; None = company-wide run / no plant row
    source: str = "item"

    @property
    def planned_by_mrp(self) -> bool:
        return self.mrp_type is None or self.mrp_type == "mrp"


def planning_for(item: StoreItem, bom: ProductionBom | None, view: dict | None = None) -> Planning:
    """Item Master values, overridden by the plant row when the run is for a
    plant and the item has plant data. Make/buy: the plant's procurement
    type when it says make or buy; "both" (or no plant row) = has an active
    BOM → make, else buy."""
    p = Planning(make=bom is not None, safety_stock=float(item.safety_stock or 0), lead_time_days=item.lead_time_days,
                 min_order_qty=float(item.min_order_qty or 0))
    if view is None or view.get("source") != "plant":
        return p
    p.source, p.mrp_type = "plant", view.get("mrp_type")
    p.safety_stock = float(view.get("safety_stock") or 0)
    p.lead_time_days = view.get("lead_time_days")
    p.make_days = view.get("inhouse_production_days")
    proc = view.get("procurement_type")
    if proc == "make":
        p.make = True
    elif proc == "buy":
        p.make = False
    return p


def lot_size_for(item: StoreItem, make: bool, min_order_qty: float | None = None):
    discrete = make or (item.uom or "").strip().upper() in DISCRETE_UOMS
    base = float(item.min_order_qty or 0) if min_order_qty is None else float(min_order_qty or 0)
    moq = base if not make else 0.0

    def _size(qty: float) -> float:
        q = float(ceil(qty - 1e-9)) if discrete else qty
        if moq > 0:
            q = max(moq, ceil(q / moq - 1e-9) * moq)
        return _q(q)
    return _size


def lead_days(item: StoreItem, bom: ProductionBom | None, qty: float, params: dict, plan: Planning | None = None) -> int:
    plan = plan or planning_for(item, bom)
    if plan.make:
        hours = sum((op.setup_hours or 0) + (op.run_hours_per_unit or 0) * qty for op in bom.operations) if bom is not None else 0
        if hours > 0:
            return max(int(ceil(hours / float(params.get("hours_per_day") or 8.0) - 1e-9)), 1)
        return int(plan.make_days or plan.lead_time_days or params.get("default_make_days") or 1)
    return int(plan.lead_time_days or 0)


# ---------------------------------------------------------------------------
# Master data
# ---------------------------------------------------------------------------

def active_boms(db: Session) -> dict[int, ProductionBom]:
    """product item id -> its active Production BOM (highest version)."""
    out: dict[int, ProductionBom] = {}
    for bom in (db.query(ProductionBom).options(selectinload(ProductionBom.items), selectinload(ProductionBom.operations))
                .filter(ProductionBom.status == "active", ProductionBom.is_deleted == False)  # noqa: E712
                .order_by(ProductionBom.version).all()):
        out[bom.product_item_id] = bom
    return out


def low_level_codes(boms: dict[int, ProductionBom], max_depth: int = 15) -> tuple[dict[int, int], set[int]]:
    """Deepest level each item appears at in any BOM structure (0 = top),
    and the items whose structure loops back on itself."""
    llc: dict[int, int] = {}
    cycles: set[int] = set()

    def visit(item_id: int, level: int, path: frozenset) -> None:
        if item_id in path:
            cycles.add(item_id)
            return
        if level > max_depth or llc.get(item_id, -1) >= level:
            return
        llc[item_id] = level
        bom = boms.get(item_id)
        if bom:
            for line in bom.items:
                # Text / document lines carry no component item.
                if not line.component_item_id or (getattr(line, "item_category", None) or "stock") not in ("stock", "non_stock"):
                    continue
                visit(line.component_item_id, level + 1, path | {item_id})

    for product_id in list(boms):
        visit(product_id, 0, frozenset())
    return llc, cycles


# ---------------------------------------------------------------------------
# Element collection
# ---------------------------------------------------------------------------

def _want(item_ids: set[int] | None, item_id: int | None) -> bool:
    return item_id is not None and (item_ids is None or item_id in item_ids)


def stock_by_item(db: Session, scope: Scope, item_ids: set[int] | None = None) -> dict[int, float]:
    q = (db.query(StoreStockBalance.item_id, StoreLocation.branch_id, func.sum(StoreStockBalance.on_hand_qty))
         .join(StoreLocation, StoreLocation.id == StoreStockBalance.location_id)
         .group_by(StoreStockBalance.item_id, StoreLocation.branch_id))
    if item_ids is not None:
        q = q.filter(StoreStockBalance.item_id.in_(item_ids or {-1}))
    out: dict[int, float] = {}
    for item_id, branch_id, qty in q.all():
        if scope.has(branch_id):
            out[item_id] = out.get(item_id, 0.0) + float(qty or 0)
    return out


def _peg_wo(wo: ProductionWorkOrder) -> dict:
    return {"demand_type": "work_order", "demand_ref_id": wo.id, "demand_label": wo.wo_number, "work_order_id": wo.id,
            "rrv_build_id": wo.rrv_build_id, "erp_project_id": wo.erp_project_id,
            "order_project_id": wo.order_project_id, "order_project_element_id": wo.order_project_element_id}


def _work_order_elements(db, scope, params, today, item_ids, add) -> None:
    statuses = ("draft", *WO_DEMAND_STATUSES) if params.get("include_draft_work_orders") else WO_DEMAND_STATUSES
    for wo in (db.query(ProductionWorkOrder).options(selectinload(ProductionWorkOrder.materials))
               .filter(ProductionWorkOrder.is_deleted == False, ProductionWorkOrder.status.in_(statuses)).all()):  # noqa: E712
        if not scope.has(wo.branch_id):
            continue
        peg = _peg_wo(wo)
        open_out = (wo.quantity_planned or 0) - (wo.quantity_completed or 0) - (wo.quantity_scrapped or 0)
        if open_out > EPS and _want(item_ids, wo.product_item_id):
            add(Element(item_id=wo.product_item_id, date=wo.planned_end_date or wo.planned_start_date or today, qty=open_out,
                        receipt=True, kind="wo_receipt", ref=wo.wo_number, ref_type="work_order", ref_id=wo.id, peg=peg))
        for m in wo.materials:
            need = outstanding_qty(m)
            if need > EPS and _want(item_ids, m.item_id):
                add(Element(item_id=m.item_id, date=wo.planned_start_date or today, qty=need, receipt=False, kind="wo_requirement",
                            ref=wo.wo_number, ref_type="work_order", ref_id=wo.id, peg=peg))


def _reservation_elements(db, scope, today, item_ids, add) -> None:
    """Active Store reservations not held for a work-order line (those are
    the work order's own requirement)."""
    wo_held = select(ProductionWorkOrderMaterial.reservation_id).where(ProductionWorkOrderMaterial.reservation_id.isnot(None))
    q = (db.query(StoreStockReservation, StoreLocation.branch_id)
         .join(StoreLocation, StoreLocation.id == StoreStockReservation.location_id)
         .filter(StoreStockReservation.status == "active", StoreStockReservation.id.notin_(wo_held)))
    if item_ids is not None:
        q = q.filter(StoreStockReservation.item_id.in_(item_ids or {-1}))
    for res, branch_id in q.all():
        if not scope.has(branch_id) or (res.quantity or 0) <= EPS:
            continue
        label = res.reservation_number + (f" — {res.project}" if res.project else "")
        add(Element(item_id=res.item_id, date=res.required_date or today, qty=float(res.quantity), receipt=False, kind="reservation",
                    ref=label, ref_type="reservation", ref_id=res.id,
                    peg={"demand_type": "reservation", "demand_ref_id": res.id, "demand_label": label}))


def _p2p_elements(db, today, item_ids, add) -> None:
    """Open PR lines (no PO yet) and open PO lines — the same rules as
    store/services/reorder.on_order, but per document and dated. P2P
    documents carry no plant, so they count in every plant's run."""
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

    q = (db.query(P2PRequestItem, P2PRequest).join(P2PRequest, P2PRequest.id == P2PRequestItem.p2p_request_id)
         .filter(P2PRequestItem.store_item_id.isnot(None), P2PRequest.status.in_(PRE_PO_PR_STATUSES),
                 P2PRequestItem.fulfillment_status != "stock_issued"))
    if item_ids is not None:
        q = q.filter(P2PRequestItem.store_item_id.in_(item_ids or {-1}))
    for line, pr in q.all():
        open_qty = (line.quantity or 0) - (line.issued_qty or 0)
        if open_qty > EPS:
            add(Element(item_id=line.store_item_id, date=pr.required_date or today, qty=open_qty, receipt=True, kind="pr",
                        ref=pr.p2p_number, ref_type="p2p_request", ref_id=pr.id))

    q = (db.query(P2PPurchaseOrderItem, P2PPurchaseOrder)
         .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
         .outerjoin(P2PRequest, P2PRequest.id == P2PPurchaseOrder.p2p_request_id)
         .filter(P2PPurchaseOrderItem.store_item_id.isnot(None), P2PPurchaseOrder.status.in_(OPEN_PO_STATUSES),
                 P2PRequest.status.is_(None) | P2PRequest.status.notin_(CLOSED_PR_STATUSES)))
    if item_ids is not None:
        q = q.filter(P2PPurchaseOrderItem.store_item_id.in_(item_ids or {-1}))
    po_lines = q.all()
    received: dict[int, float] = {}
    if po_lines:
        for gi, _status in (db.query(P2PGoodsReceiptItem, P2PGoodsReceipt.status)
                            .join(P2PGoodsReceipt, P2PGoodsReceipt.id == P2PGoodsReceiptItem.goods_receipt_id)
                            .filter(P2PGoodsReceiptItem.po_item_id.in_([ln.id for ln, _ in po_lines]),
                                    P2PGoodsReceipt.status != "reversed").all()):
            decided = gi.quality_status in ("passed", "failed", "partial")
            got = max((gi.accepted_quantity or 0) - (gi.returned_quantity or 0), 0) if decided else (gi.received_quantity or 0)
            received[gi.po_item_id] = received.get(gi.po_item_id, 0) + got
    for line, po in po_lines:
        open_qty = (line.quantity or 0) - received.get(line.id, 0)
        if open_qty > EPS:
            add(Element(item_id=line.store_item_id, date=po.expected_delivery or po.po_date or today, qty=open_qty, receipt=True,
                        kind="po", ref=po.po_number, ref_type="purchase_order", ref_id=po.id))


def _independent_demand(db, scope, today, item_ids, add, problems: list) -> None:
    """Sales Order schedule lines and RRV builds that no work order covers yet."""
    from app.modules.sales.models.order import SalesOrder, SalesOrderLine, SalesOrderSchedule
    from app.modules.production.order_project_links import element_maps

    # Project unit of each demand (vehicle = its delivery row, lot = its line).
    el_by_row, el_by_lot_line = element_maps(db)

    def _el_peg(el) -> dict:
        return {"order_project_id": el.project_id, "order_project_element_id": el.id} if el is not None else {}

    build_has_wo = {bid for (bid,) in db.query(ProductionWorkOrder.rrv_build_id).filter(
        ProductionWorkOrder.rrv_build_id.isnot(None), ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status != "cancelled").distinct().all()}
    builds = {b.id: b for b in db.query(ProductionRrvBuild).filter(
        ProductionRrvBuild.is_deleted == False, ProductionRrvBuild.status.in_(RRV_PLANNED_STATUSES)).all()}  # noqa: E712

    rows = (db.query(SalesOrderSchedule, SalesOrderLine, SalesOrder)
            .join(SalesOrderLine, SalesOrderLine.id == SalesOrderSchedule.so_line_id)
            .join(SalesOrder, SalesOrder.id == SalesOrderSchedule.so_id)
            .filter(SalesOrder.status.in_(SO_PLANNED_STATUSES), SalesOrderSchedule.status.in_(SCHEDULE_PLANNED_STATUSES),
                    SalesOrderLine.line_type.notin_(("service", "freight"))).all())
    lines_by_id = {}
    for sched, line, so in rows:
        lines_by_id[line.id] = (line, so)
        if not scope.has(so.branch_id):
            continue
        if sched.rrv_build_id:
            # The build is the demand (below) until its work orders exist;
            # after that the work orders' own requirements are.
            continue
        open_qty = (sched.quantity or 0) - (sched.qty_dispatched or 0)
        if open_qty <= EPS:
            continue
        label = f"{so.display_number} line {line.line_number} lot {sched.sequence}" + (f" ({so.customer_name})" if so.customer_name else "")
        if not line.product_item_id:
            if item_ids is None:
                problems.append({"code": "no_product_item", "item_id": None, "date": sched.current_delivery_date, "ref": label,
                                 "message": f"{label} has no Store item on its Sales Order line, so MRP can't plan it — "
                                            "set the product item on the Sales Order line."})
            continue
        if not _want(item_ids, line.product_item_id):
            continue
        add(Element(item_id=line.product_item_id, date=sched.current_delivery_date or sched.contract_delivery_date or today,
                    qty=open_qty, receipt=False, kind="so_schedule", ref=label, ref_type="sales_order", ref_id=so.id,
                    peg={"demand_type": "sales_schedule", "demand_ref_id": sched.id, "demand_label": label, "sales_order_id": so.id,
                         "sales_schedule_id": sched.id, "erp_project_id": sched.erp_project_id,
                         **_el_peg(el_by_row.get(sched.id) or el_by_lot_line.get(line.id))}))

    for build in builds.values():
        if build.id in build_has_wo or not scope.has(build.branch_id):
            continue
        product_id = None
        if build.sales_order_line_id:
            hit = lines_by_id.get(build.sales_order_line_id)
            if hit is None:
                line = db.get(SalesOrderLine, build.sales_order_line_id)
                product_id = line.product_item_id if line else None
            else:
                product_id = hit[0].product_item_id
        label = f"{build.build_number} — {build.rrv_model}"
        if not product_id:
            if item_ids is None:
                problems.append({"code": "no_product_item", "item_id": None, "date": build.target_completion_date, "ref": label,
                                 "message": f"RRV build {label} has no product Store item (it is not linked to a Sales Order "
                                            "line with a product item), so MRP can't plan it — link it to its Sales Order line."})
            continue
        if not _want(item_ids, product_id):
            continue
        add(Element(item_id=product_id, date=build.target_completion_date or build.target_handover_date or build.planned_start_date or today,
                    qty=1.0, receipt=False, kind="rrv_build", ref=label, ref_type="rrv_build", ref_id=build.id,
                    peg={"demand_type": "rrv_build", "demand_ref_id": build.id, "demand_label": label, "rrv_build_id": build.id,
                         "sales_order_id": build.sales_order_id, "sales_schedule_id": build.sales_schedule_id,
                         "erp_project_id": build.erp_project_id,
                         **_el_peg(el_by_row.get(build.sales_schedule_id) if build.sales_schedule_id else None)}))


def planned_order_peg(po: ProductionPlannedOrder) -> dict:
    return {"demand_type": po.demand_type, "demand_ref_id": po.demand_ref_id, "demand_label": po.demand_label,
            "sales_order_id": po.sales_order_id, "sales_schedule_id": po.sales_schedule_id, "rrv_build_id": po.rrv_build_id,
            "erp_project_id": po.erp_project_id, "work_order_id": po.work_order_id, "parent_planned_order_id": po.id,
            "order_project_id": po.order_project_id, "order_project_element_id": po.order_project_element_id}


def dependent_elements(po: ProductionPlannedOrder, bom: ProductionBom | None) -> list[Element]:
    """The components a make planned order needs, on its start date."""
    if po.procurement != "make" or bom is None:
        return []
    materials, _ops = explode_bom(bom, po.quantity)
    return [Element(item_id=m.item_id, date=po.start_date, qty=m.required_qty, receipt=False, kind="dependent",
                    ref=po.order_number, ref_type="planned_order", ref_id=po.id, peg=planned_order_peg(po))
            for m in materials if m.required_qty > EPS]


def _planned_order_elements(db, scope, boms, item_ids, add, *, firmed_only: bool) -> None:
    q = db.query(ProductionPlannedOrder).filter(ProductionPlannedOrder.status == "open")
    if firmed_only:
        q = q.filter(ProductionPlannedOrder.firmed == True)  # noqa: E712
    for po in q.all():
        if not scope.has(po.branch_id):
            continue
        if _want(item_ids, po.item_id):
            add(Element(item_id=po.item_id, date=po.finish_date, qty=po.quantity, receipt=True, kind="planned_order",
                        ref=po.order_number + (" (firmed)" if po.firmed else ""), ref_type="planned_order", ref_id=po.id,
                        fixed=po.firmed, peg=planned_order_peg(po), planned_order=po))
        bom = db.get(ProductionBom, po.bom_id) if po.bom_id else boms.get(po.item_id)
        for el in dependent_elements(po, bom):
            if _want(item_ids, el.item_id):
                add(el)


def collect_elements(db: Session, scope: Scope, params: dict, today: date, boms: dict[int, ProductionBom],
                     item_ids: set[int] | None = None, *, firmed_planned_only: bool = True) -> tuple[dict[int, list[Element]], list[dict]]:
    elements: dict[int, list[Element]] = {}
    problems: list[dict] = []

    def add(el: Element) -> None:
        elements.setdefault(el.item_id, []).append(el)

    _independent_demand(db, scope, today, item_ids, add, problems)
    _work_order_elements(db, scope, params, today, item_ids, add)
    _reservation_elements(db, scope, today, item_ids, add)
    _p2p_elements(db, today, item_ids, add)
    _planned_order_elements(db, scope, boms, item_ids, add, firmed_only=firmed_planned_only)
    return elements, problems


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------

class _Series:
    """PLO-/MRP- numbers: one read of the year's last number, then counted
    up locally (a run can create hundreds of planned orders)."""

    def __init__(self, db: Session, column, prefix: str):
        _lock_number_series(db, prefix)
        last = 0
        for (value,) in db.query(column).filter(column.like(f"{prefix}%")).all():
            suffix = (value or "")[len(prefix):]
            if suffix.isdigit():
                last = max(last, int(suffix))
        self.prefix, self.last = prefix, last

    def next(self) -> str:
        self.last += 1
        return f"{self.prefix}{self.last:04d}"


def planned_order_series(db: Session) -> _Series:
    return _Series(db, ProductionPlannedOrder.order_number, f"PLO-{date.today().year}-")


# ---------------------------------------------------------------------------
# The run (MD01N)
# ---------------------------------------------------------------------------

def _apply_peg(po: ProductionPlannedOrder, peg: dict) -> None:
    for key in ("demand_type", "demand_ref_id", "demand_label", "sales_order_id", "sales_schedule_id", "rrv_build_id",
                "erp_project_id", "work_order_id", "parent_planned_order_id", "order_project_id", "order_project_element_id"):
        if peg.get(key) is not None:
            setattr(po, key, peg[key])


def run_mrp(db: Session, *, branch_id: int | None, include_unassigned: bool, user_id: int | None,
            overrides: dict | None = None) -> ProductionMrpRun:
    """Plan one plant. Flushes; the caller commits."""
    params = {**MRP_PARAMETERS, **{k: v for k, v in (overrides or {}).items() if k in RUN_OVERRIDABLE and v is not None}}
    today = date.today()
    scope = Scope(branch_id, include_unassigned if branch_id is not None else True)
    # One run per plant at a time (Postgres advisory lock; no-op on SQLite).
    _lock_number_series(db, f"MRP-RUN-{branch_id or 'ALL'}")
    run_no = _Series(db, ProductionMrpRun.run_number, f"MRP-{today.year}-").next()
    run = ProductionMrpRun(run_number=run_no, branch_id=branch_id, include_unassigned=scope.include_unassigned, status="running",
                           parameters=params, started_at=datetime.now(timezone.utc), run_by_id=user_id, item_results=[], log=[])
    db.add(run)
    db.flush()
    log: list[dict] = []

    def note(message: str, level: str = "info") -> None:
        log.append({"level": level, "message": message})

    # Re-planning: the previous run's open, not firmed planned orders of this
    # plant scope go; firmed and converted ones stay.
    stale = db.query(ProductionPlannedOrder).filter(
        ProductionPlannedOrder.status == "open", ProductionPlannedOrder.firmed == False,  # noqa: E712
        ProductionPlannedOrder.branch_id.is_(None) if branch_id is None else ProductionPlannedOrder.branch_id == branch_id)
    stale_ids = [p.id for p in stale.all()]
    if stale_ids:
        db.query(ProductionPlannedOrder).filter(ProductionPlannedOrder.id.in_(stale_ids)).update(
            {ProductionPlannedOrder.status: "deleted", ProductionPlannedOrder.changed_by_id: user_id,
             ProductionPlannedOrder.remarks: f"Deleted by MRP run {run_no}."}, synchronize_session=False)
    run.planned_orders_deleted = len(stale_ids)
    note(f"Deleted {len(stale_ids)} open planned order(s) of the previous run (firmed and converted orders are kept).")

    boms = active_boms(db)
    llc, cycles = low_level_codes(boms, int(params["max_bom_depth"]))
    elements, problems = collect_elements(db, scope, params, today, boms, firmed_planned_only=True)
    exceptions: list[dict] = list(problems)
    for item_id in cycles:
        exceptions.append({"code": "bom_cycle", "item_id": item_id, "message":
                           "This item's active BOM contains itself (directly or through a sub-assembly) — planning below it "
                           "stops at the loop. Fix the BOM structure."})
    stock = stock_by_item(db, scope)
    note(f"Plant: {'company-wide' if branch_id is None else f'branch #{branch_id}'}"
         + ("" if branch_id is None else (" + documents without a plant" if scope.include_unassigned else " only")) + ".")
    note(f"Demand and supply collected for {len(elements)} item(s); {len(boms)} active BOM(s).")

    item_cache: dict[int, StoreItem] = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(set(elements) or {-1})).all()}

    def item_of(item_id: int) -> StoreItem | None:
        if item_id not in item_cache:
            item_cache[item_id] = db.get(StoreItem, item_id)
        return item_cache[item_id]

    # Plant run: the plant's planning data (Store › Item Master › Plant data),
    # loaded once for every item that has demand or can get dependent demand.
    views: dict[int, dict] = {}
    if branch_id is not None:
        from app.modules.store.services.plant_data import plant_views
        plan_ids = set(elements) | set(boms) | {ln.component_item_id for b in boms.values() for ln in b.items if ln.component_item_id}
        views = plant_views(db, plan_ids, branch_id)
        note(f"Plant data: {sum(1 for v in views.values() if v['source'] == 'plant')} item(s) planned with this plant's own "
             "MRP type, procurement type, lead time and safety stock; the rest use the Item Master.")

    horizon_end = today + timedelta(days=int(params["planning_horizon_days"]))
    series = planned_order_series(db)
    heap = [(llc.get(i, 0), i) for i in elements]
    heapq.heapify(heap)
    done: set[int] = set()
    results: list[dict] = []
    made = bought = 0

    while heap:
        level, item_id = heapq.heappop(heap)
        if item_id in done:
            continue
        done.add(item_id)
        item = item_of(item_id)
        if item is None:
            continue
        elems = elements.get(item_id, [])
        reqs = [e for e in elems if not e.receipt and e.date <= horizon_end]
        late = [e for e in elems if not e.receipt and e.date > horizon_end]
        receipts = [e for e in elems if e.receipt]
        if late:
            exceptions.append({"code": "beyond_horizon", "item_id": item_id, "date": min(e.date for e in late), "qty": _q(sum(e.qty for e in late)),
                               "message": f"{len(late)} requirement(s) after {_fmt(horizon_end)} are outside the "
                                          f"{params['planning_horizon_days']}-day planning horizon and were not planned."})
        bom = boms.get(item_id)
        if branch_id is not None and item_id not in views:
            from app.modules.store.services.plant_data import plant_view
            views[item_id] = plant_view(db, item, branch_id)
        plan = planning_for(item, bom, views.get(item_id))
        make = plan.make
        on_hand = stock.get(item_id, 0.0)
        safety = plan.safety_stock
        row = {"item_id": item_id, "item_code": item.item_code, "item_name": item.item_name, "uom": item.uom, "low_level_code": level,
               "procurement": "make" if make else "buy", "stock": _q(on_hand), "safety_stock": _q(safety),
               "requirements_qty": _q(sum(e.qty for e in reqs)), "receipts_qty": _q(sum(e.qty for e in receipts)),
               "planned_qty": 0.0, "planned_orders": 0, "exceptions": 0, "lead_time_days": plan.lead_time_days,
               "planning_source": plan.source, "mrp_type": plan.mrp_type}
        before = len(exceptions)
        if not plan.planned_by_mrp:
            if reqs:
                how = "the Store reorder list (reorder point)" if plan.mrp_type == "reorder_point" else "nobody (no planning)"
                exceptions.append({"code": "not_mrp_planned", "item_id": item_id, "qty": row["requirements_qty"],
                                   "message": f"{item.item_code} is planned by {how} at this plant, so MRP created no planned order for its "
                                              f"{row['requirements_qty']} {item.uom or ''} of requirements. Set MRP type to 'MRP' in "
                                              "Store › Item Master › Plant data if MRP should plan it."})
            row["ending_available"] = _q(on_hand + row["receipts_qty"] - row["requirements_qty"])
            row["exceptions"] = len(exceptions) - before
            results.append(row)
            continue
        if make and bom is None and reqs:
            exceptions.append({"code": "make_without_bom", "item_id": item_id, "message":
                               f"{item.item_code} is set to Make at this plant but has no active BOM, so its planned orders carry "
                               "no components — activate a BOM in BOM & Routing, or set Procurement type to Buy in Plant data."})
        if item.status != "active":
            if reqs:
                exceptions.append({"code": "item_inactive", "item_id": item_id, "qty": row["requirements_qty"],
                                   "message": f"{item.item_code} is {item.status} in the Item Master but still has "
                                              f"{row['requirements_qty']} {item.uom or ''} of requirements — no planned order was created. "
                                              "Reactivate the item or replace it in the BOM / order."})
            row["ending_available"] = _q(on_hand + row["receipts_qty"] - row["requirements_qty"])
            row["exceptions"] = len(exceptions) - before
            results.append(row)
            continue
        if not make and plan.lead_time_days is None and reqs:
            exceptions.append({"code": "no_lead_time", "item_id": item_id, "message":
                               f"{item.item_code} has no lead time in the Item Master{' or its plant data' if plan.source == 'plant' else ''}, "
                               "so its planned orders are dated on the day they are needed — set Lead Time (days) on the item."})
        result = net_item(stock=on_hand, safety=safety, reqs=reqs, receipts=receipts, today=today, params=params,
                          lot_size=lot_size_for(item, make, plan.min_order_qty), uom=item.uom or "")
        for msg in result.messages:
            el = msg["element"]
            exceptions.append({"code": msg["code"], "item_id": item_id, "message": msg["message"], "date": msg["date"],
                               "suggested": msg["suggested"], "qty": msg["qty"],
                               "element_type": el.kind if el else None, "ref": el.ref if el else None})
        for req, _need, order_qty in result.shortages:
            days = lead_days(item, bom, order_qty, params, plan)
            finish = req.date
            start = finish - timedelta(days=days)
            po = ProductionPlannedOrder(
                order_number=series.next(), run_id=run.id, source="mrp", branch_id=branch_id, item_id=item_id,
                procurement="make" if make else "buy", bom_id=bom.id if (bom and make) else None, quantity=order_qty,
                start_date=start, finish_date=finish, firmed=False, status="open",
            )
            _apply_peg(po, req.peg)
            db.add(po)
            db.flush()
            row["planned_qty"] = _q(row["planned_qty"] + order_qty)
            row["planned_orders"] += 1
            made += 1 if make else 0
            bought += 0 if make else 1
            if start < today:
                exceptions.append({"code": "start_in_past", "item_id": item_id, "date": start, "suggested": today, "qty": order_qty,
                                   "element_type": "planned_order", "ref": po.order_number,
                                   "message": f"Planned order {po.order_number} ({order_qty} {item.uom or ''}) should have "
                                              f"{'started' if make else 'been ordered'} on {_fmt(start)} to be ready by {_fmt(finish)} "
                                              f"({days} day(s) {'production' if make else 'lead'} time) — expedite it or re-date the demand."})
            for dep in dependent_elements(po, bom):
                if dep.item_id in done:
                    exceptions.append({"code": "bom_cycle", "item_id": dep.item_id, "ref": po.order_number,
                                       "message": f"{po.order_number} needs an item already planned at a higher level — "
                                                  "the BOM structure loops; fix it in BOM & Routing."})
                    continue
                elements.setdefault(dep.item_id, []).append(dep)
                heapq.heappush(heap, (max(llc.get(dep.item_id, level + 1), level + 1), dep.item_id))
        row["ending_available"] = _q(on_hand + row["receipts_qty"] + row["planned_qty"] - row["requirements_qty"])
        row["exceptions"] = len(exceptions) - before
        results.append(row)

    for exc in exceptions:
        db.add(ProductionMrpException(
            run_id=run.id, branch_id=branch_id, item_id=exc.get("item_id"), code=exc["code"], message=exc["message"],
            element_type=exc.get("element_type"), element_ref=(exc.get("ref") or None) and str(exc["ref"])[:200],
            element_date=exc.get("date"), suggested_date=exc.get("suggested"), quantity=exc.get("qty"),
        ))
    results.sort(key=lambda r: (r["low_level_code"], r["item_code"] or ""))
    run.item_results = results
    run.items_planned = len(results)
    run.planned_orders_created = made + bought
    run.make_orders, run.buy_orders = made, bought
    run.exceptions_count = len(exceptions)
    note(f"Created {made + bought} planned order(s): {made} make, {bought} buy; {len(exceptions)} exception message(s).")
    run.log = log
    run.status = "completed"
    run.finished_at = datetime.now(timezone.utc)
    db.flush()
    return run


# ---------------------------------------------------------------------------
# MD04 stock / requirements list
# ---------------------------------------------------------------------------

def stock_requirements(db: Session, item: StoreItem, scope: Scope, params: dict | None = None) -> dict:
    params = {**MRP_PARAMETERS, **(params or {})}
    today = date.today()
    boms = active_boms(db)
    elements, _ = collect_elements(db, scope, params, today, boms, {item.id}, firmed_planned_only=False)
    elems = elements.get(item.id, [])
    on_hand = stock_by_item(db, scope, {item.id}).get(item.id, 0.0)
    bom = boms.get(item.id)
    view = None
    if scope.branch_id is not None:
        from app.modules.store.services.plant_data import plant_view
        view = plant_view(db, item, scope.branch_id)
    plan = planning_for(item, bom, view)
    safety = plan.safety_stock
    result = net_item(stock=on_hand, safety=safety, reqs=[e for e in elems if not e.receipt], receipts=[e for e in elems if e.receipt],
                      today=today, params=params, uom=item.uom or "")
    by_element: dict[int, list[str]] = {}
    exceptions = []
    for msg in result.messages:
        if msg["element"] is not None:
            by_element.setdefault(id(msg["element"]), []).append(msg["code"])
        exceptions.append({"code": msg["code"], "label": MRP_EXCEPTION_LABELS.get(msg["code"], msg["code"]), "message": msg["message"],
                           "date": msg["date"], "suggested_date": msg["suggested"], "quantity": msg["qty"],
                           "reference": msg["element"].ref if msg["element"] else None})
    for req, need, _ in result.shortages:
        by_element.setdefault(id(req), []).append("shortage")
        exceptions.append({"code": "shortage", "label": MRP_EXCEPTION_LABELS["shortage"], "date": req.date, "suggested_date": None,
                           "quantity": need, "reference": req.ref,
                           "message": f"{need} {item.uom or ''} of {req.ref} on {_fmt(req.date)} is not covered by stock or any "
                                      "receipt — run MRP or raise a work order / PR."})

    rows = [{"date": today, "element": "stock", "element_label": ELEMENT_LABELS["stock"], "reference": "Unrestricted stock",
             "ref_type": None, "ref_id": None, "quantity": _q(on_hand), "available": _q(on_hand), "exceptions": [], "firmed": None}]
    available = on_hand
    if safety > EPS:
        available -= safety
        rows.append({"date": today, "element": "safety_stock", "element_label": ELEMENT_LABELS["safety_stock"],
                     "reference": "Plant data" if plan.source == "plant" else "Item Master",
                     "ref_type": None, "ref_id": None, "quantity": _q(-safety), "available": _q(available),
                     "exceptions": ["below_safety_stock"] if on_hand < safety - EPS else [], "firmed": None})
    for el in sorted(elems, key=lambda e: (e.date, 0 if e.receipt else 1, e.ref)):
        available += el.qty if el.receipt else -el.qty
        rows.append({"date": el.date, "element": el.kind, "element_label": ELEMENT_LABELS.get(el.kind, el.kind), "reference": el.ref,
                     "ref_type": el.ref_type, "ref_id": el.ref_id, "quantity": _q(el.qty if el.receipt else -el.qty),
                     "available": _q(available), "exceptions": by_element.get(id(el), []),
                     "pegged_to": el.peg.get("demand_label") if el.kind in ("dependent", "planned_order") else None,
                     "firmed": el.planned_order.firmed if el.planned_order is not None else None})
    return {
        "item_id": item.id, "item_code": item.item_code, "item_name": item.item_name, "uom": item.uom,
        "procurement": "make" if plan.make else "buy", "bom_id": bom.id if bom else None, "bom_number": bom.bom_number if bom else None,
        "branch_id": scope.branch_id, "stock": _q(on_hand), "safety_stock": _q(safety), "lead_time_days": plan.lead_time_days,
        "min_order_qty": item.min_order_qty, "ending_available": _q(available), "rows": rows, "exceptions": exceptions,
        "planning_source": plan.source, "mrp_type": plan.mrp_type, "planned_by_mrp": plan.planned_by_mrp,
    }
