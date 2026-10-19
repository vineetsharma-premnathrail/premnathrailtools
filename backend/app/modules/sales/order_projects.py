"""Order Projects — execution projects created from confirmed Sales Orders
(models/order_project.py explains the idea).

The API later phases (Design, Purchase, Store, Production, Quality, Dispatch)
call — keep these signatures stable:

    ensure_order_project(db, so, actor) -> OrderProject | None
    project_for_order(db, so_id) -> OrderProject | None
    elements_for_order(db, so_id, *, include_cancelled=False) -> list[OrderProjectElement]
    element_for_schedule(db, schedule_id) -> OrderProjectElement | None
    resolve_element(db, element_id, *, project_id=None, allow_cancelled=False) -> (OrderProject, OrderProjectElement)
    resolve_project(db, project_id, *, allow_closed=False) -> OrderProject
    element_display(project, element) -> "PEW-2026-0001 / 01 · Vehicle 1"
    refresh_element_status(db, element, *, so=None, events=None) -> str
    refresh_order_project(db, so) -> None
    register_element_status_hook(fn)        fn(db, element, so, status) -> status | None
    register_department_provider(key, fn)   fn(db, project, elements) -> {element_id: cell | None}
    register_project_hook(fn)               fn(db, project, so, actor, new_elements) -> None

A department cell (what the 360 table shows) is a small dict:
    {"status": "<code>", "label": "<short text>", "tone": "neutral|info|success|warning|danger",
     "detail": "<tooltip / second line>" | None, "date": "yyyy-mm-dd" | None}
None means "not linked yet". Departments: design, purchase, store,
production, quality, dispatch, delivery — dispatch and delivery are filled
here from the Sales delivery events; the others by their module's provider.

Plain functions; business-rule failures raise HTTPException with the reason
and the fix (routes and other modules can call them directly)."""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.sales.models.delivery import SalesDeliveryEvent
from app.modules.sales.models.order import SalesOrder, SalesOrderLine, SalesOrderSchedule
from app.modules.sales.models.order_project import (
    OrderProject, OrderProjectElement, ORDER_PROJECT_LOT_LINE_TYPES,
)

logger = logging.getLogger("sales")

EPS = 1e-6
DEPARTMENTS = ("design", "purchase", "store", "production", "quality", "dispatch", "delivery")
# Projects other modules may pick (the lookup) / link new work to.
PICKABLE_PROJECT_STATUSES = ("active", "on_hold")
# Sales order statuses an order project exists for (backfill).
PROJECT_SO_STATUSES = ("confirmed", "in_execution", "partially_delivered", "delivered", "on_hold", "short_closed")

ELEMENT_STATUS_LABEL = {
    "planned": "Planned", "in_progress": "In progress", "ready": "Ready", "dispatched": "Dispatched",
    "delivered": "Delivered", "cancelled": "Cancelled",
}
PROJECT_STATUS_LABEL = {
    "active": "Active", "on_hold": "On hold", "delivered": "Delivered", "closed": "Closed", "cancelled": "Cancelled",
}

_status_hooks: list[Callable] = []
_department_providers: dict[str, Callable] = {}
_project_hooks: list[Callable] = []


def register_project_hook(fn: Callable) -> None:
    """Other modules start their work when a project is created or gains
    elements (Production plans a build per new vehicle, Design opens a design
    request…): fn(db, project, so, actor, new_elements) after every
    ensure_order_project; new_elements is empty when nothing was added. A
    failing hook is logged and never blocks the order's confirmation."""
    if fn not in _project_hooks:
        _project_hooks.append(fn)


def register_element_status_hook(fn: Callable) -> None:
    """Later phases refine an element's status: fn(db, element, so, status) returns
    the new status or None to keep it. Delivery-derived dispatched / delivered
    always win (a hook can't move a delivered vehicle back)."""
    if fn not in _status_hooks:
        _status_hooks.append(fn)


def register_department_provider(key: str, fn: Callable) -> None:
    """fn(db, project, elements) -> {element_id: cell | None} for one 360-table column."""
    if key not in DEPARTMENTS:
        raise ValueError(f"Unknown department '{key}' — use one of {', '.join(DEPARTMENTS)}.")
    _department_providers[key] = fn


# ---------------------------------------------------------------- numbering

def generate_op_number(db: Session, on: date | None = None) -> str:
    """PEW-<YYYY>-<NNNN> — one series shared with the PM projects (core/pew_numbers.py);
    it replaced OP-<YYYY>-<NNN> on 2026-10-19."""
    from app.core.pew_numbers import next_pew_number
    return next_pew_number(db, on)


def _next_element_no(project: OrderProject) -> str:
    last = 0
    for el in project.elements:
        tail = (el.element_no or "").rsplit("/", 1)[-1]
        if tail.isdigit():
            last = max(last, int(tail))
    return f"{project.op_number}/{last + 1:02d}"


# ---------------------------------------------------------------- helpers

def _rrv_lines(so: SalesOrder) -> list[SalesOrderLine]:
    return [ln for ln in so.lines if ln.line_type == "rrv"]


def needs_project(so: SalesOrder) -> bool:
    """Only orders that build RRVs get a project; spares-from-stock / service orders don't."""
    return any(ln.line_type == "rrv" for ln in so.lines)


def _title(so: SalesOrder) -> str:
    who = so.customer_name or "Customer"
    ref = so.customer_po_number or so.loa_number or so.display_number
    return f"{who} — {ref}"[:400]


def _so_dates(so: SalesOrder) -> tuple[date | None, date | None]:
    start = so.confirmed_at.date() if isinstance(so.confirmed_at, datetime) else date.today()
    dates = [r.contract_delivery_date for r in so.schedules if r.status != "cancelled" and r.contract_delivery_date]
    return start, (max(dates) if dates else None)


def _vehicle_label(so: SalesOrder, line: SalesOrderLine, row: SalesOrderSchedule) -> str:
    multi = len(_rrv_lines(so)) > 1
    return f"Vehicle {row.sequence}" + (f" (line {line.line_number})" if multi else "")


def _lot_label(line: SalesOrderLine) -> str:
    desc = " ".join((line.description or "").split())
    if len(desc) > 80:
        desc = desc[:77] + "…"
    return f"Lot — line {line.line_number}: {desc}" if desc else f"Lot — line {line.line_number}"


def element_display(project: OrderProject, element: OrderProjectElement) -> str:
    """'PEW-2026-0001 / 01 · Vehicle 1' — how pickers and chips name an element."""
    tail = element.element_no.rsplit("/", 1)[-1]
    return f"{project.op_number} / {tail} · {element.label}"


# ---------------------------------------------------------------- create / sync

def ensure_order_project(db: Session, so: SalesOrder, actor: User | None) -> OrderProject | None:
    """Idempotent: creates the project for a confirmed order that has an RRV line,
    then syncs its elements with the order's lines / delivery rows (new vehicles
    added, removed ones cancelled — never deleted). Returns None when the order
    needs no project (no RRV line). Safe to call after every confirmation /
    approved amendment."""
    db.flush()  # delivery rows appended in this transaction need their ids
    project = project_for_order(db, so.id)
    if project is None:
        if not needs_project(so) or not so.so_number:
            return None
        start, end = _so_dates(so)
        project = OrderProject(
            op_number=generate_op_number(db, start), sales_order_id=so.id, customer_id=so.customer_id,
            customer_name=so.customer_name, title=_title(so), status="active", planned_start=start, planned_end=end,
            branch_id=so.branch_id, created_by_id=actor.id if actor else None,
        )
        db.add(project)
        db.flush()
    else:
        _, end = _so_dates(so)
        if end and (project.planned_end is None or end > project.planned_end):
            project.planned_end = end  # an amendment moved the last contractual date out
        project.customer_name = so.customer_name or project.customer_name
    known = {el.id for el in project.elements if el.id}
    sync_elements(db, project, so)
    refresh_order_project(db, so, project=project)
    new_elements = [el for el in project.elements if el.id not in known and el.status != "cancelled"]
    for hook in _project_hooks:
        try:
            with db.begin_nested():
                hook(db, project, so, actor, new_elements)
        except Exception:  # noqa: BLE001 — a department hook must never block the confirmation
            logger.exception("Order project hook %s failed for %s", getattr(hook, "__name__", hook), project.op_number)
    return project


def sync_elements(db: Session, project: OrderProject, so: SalesOrder) -> None:
    """One vehicle element per RRV delivery row, one lot per spares / other line."""
    by_schedule = {el.sales_schedule_id: el for el in project.elements if el.sales_schedule_id}
    lots = {el.sales_order_line_id: el for el in project.elements if el.kind == "lot"}
    lines = {ln.id: ln for ln in so.lines}

    for ln in so.lines:
        if ln.line_type == "rrv":
            rows = sorted((r for r in so.schedules if r.so_line_id == ln.id),
                          key=lambda r: (r.status == "cancelled", r.sequence or 0, r.id or 0))
            for row in rows:
                el = by_schedule.get(row.id)
                if el is None:
                    if row.status == "cancelled":
                        continue  # cancelled before the project knew it — nothing to track
                    el = OrderProjectElement(element_no=_next_element_no(project), kind="vehicle",
                                             sales_order_line_id=ln.id, sales_schedule_id=row.id, status="planned",
                                             label="", quantity=1)
                    project.elements.append(el)
                el.label = _vehicle_label(so, ln, row)
                el.quantity = float(row.quantity or 1)
                el.contractual_date = row.contract_delivery_date
                if row.status == "cancelled":
                    el.status = "cancelled"
        elif ln.line_type in ORDER_PROJECT_LOT_LINE_TYPES:
            el = lots.get(ln.id)
            if el is None:
                if float(ln.quantity or 0) <= EPS:
                    continue
                el = OrderProjectElement(element_no=_next_element_no(project), kind="lot", sales_order_line_id=ln.id,
                                         sales_schedule_id=None, status="planned", label="", quantity=0)
                project.elements.append(el)
            el.label = _lot_label(ln)
            el.quantity = float(ln.quantity or 0)
            dates = [r.contract_delivery_date for r in so.schedules
                     if r.so_line_id == ln.id and r.status != "cancelled" and r.contract_delivery_date]
            el.contractual_date = max(dates) if dates else None
            if el.quantity <= EPS:
                el.status = "cancelled"

    # Elements whose line / row left the order (or whose line turned into service / freight).
    live_rows = {r.id for r in so.schedules if r.status != "cancelled"}
    for el in project.elements:
        ln = lines.get(el.sales_order_line_id)
        if el.kind == "vehicle" and (el.sales_schedule_id not in live_rows or ln is None or ln.line_type != "rrv"):
            el.status = "cancelled"
        elif el.kind == "lot" and (ln is None or ln.line_type not in ORDER_PROJECT_LOT_LINE_TYPES):
            el.status = "cancelled"
    db.flush()


# ---------------------------------------------------------------- status derivation

def _live_events(db: Session, so_id: int) -> list[SalesDeliveryEvent]:
    return (db.query(SalesDeliveryEvent)
            .filter(SalesDeliveryEvent.so_id == so_id, SalesDeliveryEvent.reversed_at.is_(None))
            .order_by(SalesDeliveryEvent.event_date, SalesDeliveryEvent.id).all())


def _element_events(element: OrderProjectElement, so: SalesOrder, events: list[SalesDeliveryEvent]) -> list[SalesDeliveryEvent]:
    if element.kind == "vehicle":
        return [e for e in events if e.schedule_id == element.sales_schedule_id]
    return [e for e in events if e.so_line_id == element.sales_order_line_id]


def _qty(events: list[SalesDeliveryEvent], kind: str) -> float:
    return round(sum(float(e.quantity or 0) for e in events if e.event == kind), 4)


def refresh_element_status(db: Session, element: OrderProjectElement, *, so: SalesOrder | None = None,
                           events: list[SalesDeliveryEvent] | None = None) -> str:
    """Re-derive one element's status and store it. Cancelled stays cancelled.
    Order: delivery events (dispatched / delivered) > Production's build on the
    delivery row (in_progress / ready) > registered hooks > planned."""
    if element.status == "cancelled":
        return "cancelled"
    if so is None:
        project = element.project or db.get(OrderProject, element.order_project_id)
        so = db.get(SalesOrder, project.sales_order_id)
    if events is None:
        events = _live_events(db, so.id)
    evs = _element_events(element, so, events)
    qty = float(element.quantity or 0)
    status = "planned"
    if element.kind == "vehicle":
        row = next((r for r in so.schedules if r.id == element.sales_schedule_id), None)
        if row is not None:
            status = {"in_production": "in_progress", "ready": "ready"}.get(row.status, "planned")
    for hook in _status_hooks:
        try:
            new = hook(db, element, so, status)
        except Exception:  # a later phase's hook must never break Sales
            logger.exception("Order project status hook %s failed for element %s", getattr(hook, "__name__", hook), element.id)
            new = None
        if new:
            status = new
    if qty > EPS and _qty(evs, "delivery") >= qty - EPS:
        status = "delivered"
    elif qty > EPS and _qty(evs, "dispatch") >= qty - EPS:
        status = "dispatched"
    element.status = status
    return status


def refresh_project_status(project: OrderProject, so: SalesOrder | None = None) -> str:
    """Cancelled / closed follow the Sales Order; 'delivered' when every live
    element is delivered; on_hold is kept until someone resumes it."""
    if so is not None and so.status == "cancelled":
        project.status = "cancelled"
    elif so is not None and so.status == "closed":
        project.status = "closed"
    elif project.status in ("active", "delivered"):
        live = [el for el in project.elements if el.status != "cancelled"]
        project.status = "delivered" if live and all(el.status == "delivered" for el in live) else "active"
    return project.status


def refresh_order_project(db: Session, so: SalesOrder, *, project: OrderProject | None = None) -> None:
    """Re-derive every element and the project status — called after a delivery
    event is recorded / reversed (sales/delivery.py after_change) and on open."""
    project = project or project_for_order(db, so.id)
    if project is None:
        return
    events = _live_events(db, so.id)
    for el in project.elements:
        refresh_element_status(db, el, so=so, events=events)
    refresh_project_status(project, so)
    db.flush()


# ---------------------------------------------------------------- 360 view

def _date_txt(d: date | None) -> str:
    return d.strftime("%d-%b-%Y") if d else ""


def _delivery_cells(element: OrderProjectElement, evs: list[SalesDeliveryEvent]) -> tuple[dict, dict]:
    qty = float(element.quantity or 0)
    out = []
    for kind, done_label in (("dispatch", "Dispatched"), ("delivery", "Delivered")):
        rows = [e for e in evs if e.event == kind]
        q = _qty(rows, kind)
        last = rows[-1] if rows else None
        if not rows:
            out.append({"status": "pending", "label": "Pending", "tone": "neutral", "detail": None, "date": None})
        elif q >= qty - EPS:
            refs = ", ".join(sorted({e.reference for e in rows if e.reference}))
            out.append({"status": "done", "label": done_label, "tone": "success",
                        "detail": f"{_date_txt(last.event_date)}" + (f" · {refs}" if refs else ""),
                        "date": last.event_date.isoformat()})
        else:
            out.append({"status": "partial", "label": f"{q:g} of {qty:g}", "tone": "info",
                        "detail": f"Last on {_date_txt(last.event_date)}", "date": last.event_date.isoformat()})
    return out[0], out[1]


def department_cells(db: Session, project: OrderProject, so: SalesOrder,
                     elements: list[OrderProjectElement]) -> dict[int, dict[str, dict | None]]:
    """{element_id: {department: cell | None}} for the 360 table."""
    events = _live_events(db, so.id)
    cells: dict[int, dict[str, dict | None]] = {el.id: {k: None for k in DEPARTMENTS} for el in elements}
    for el in elements:
        if el.status == "cancelled":
            continue
        disp, deliv = _delivery_cells(el, _element_events(el, so, events))
        cells[el.id]["dispatch"], cells[el.id]["delivery"] = disp, deliv
    for key, fn in _department_providers.items():
        try:
            filled = fn(db, project, elements) or {}
        except Exception:
            logger.exception("Order project department provider '%s' failed for %s", key, project.op_number)
            continue
        for eid, cell in filled.items():
            if eid in cells:
                cells[eid][key] = cell
    return cells


# ---------------------------------------------------------------- lookups for other modules

def project_for_order(db: Session, so_id: int) -> OrderProject | None:
    return db.query(OrderProject).filter(OrderProject.sales_order_id == so_id).first()


def elements_for_order(db: Session, so_id: int, *, include_cancelled: bool = False) -> list[OrderProjectElement]:
    q = (db.query(OrderProjectElement).join(OrderProject, OrderProject.id == OrderProjectElement.order_project_id)
         .filter(OrderProject.sales_order_id == so_id))
    if not include_cancelled:
        q = q.filter(OrderProjectElement.status != "cancelled")
    return q.order_by(OrderProjectElement.id).all()


def element_for_schedule(db: Session, schedule_id: int) -> OrderProjectElement | None:
    """The vehicle element of a Sales delivery row (None for a row with no project)."""
    return (db.query(OrderProjectElement).filter(OrderProjectElement.sales_schedule_id == schedule_id)
            .order_by(OrderProjectElement.id.desc()).first())


def resolve_project(db: Session, project_id: int, *, allow_closed: bool = False) -> OrderProject:
    project = db.get(OrderProject, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Order project #{project_id} doesn't exist — pick the project again "
                                                    f"from the list (Sales › Order Projects).")
    if not allow_closed and project.status not in PICKABLE_PROJECT_STATUSES:
        raise HTTPException(status_code=422, detail=f"Order project {project.op_number} is "
                                                    f"{PROJECT_STATUS_LABEL.get(project.status, project.status)} — new work can't "
                                                    f"be linked to it. Pick an active project, or ask Sales to resume it.")
    return project


def resolve_element(db: Session, element_id: int, *, project_id: int | None = None,
                    allow_cancelled: bool = False) -> tuple[OrderProject, OrderProjectElement]:
    """Validate an element id another module received (404 unknown, 422 wrong
    project / cancelled). Returns (project, element)."""
    el = db.get(OrderProjectElement, element_id)
    if el is None:
        raise HTTPException(status_code=404, detail=f"Order project element #{element_id} doesn't exist — pick the "
                                                    f"vehicle / lot again from the Order Project picker.")
    project = el.project
    if project_id is not None and project.id != project_id:
        raise HTTPException(status_code=422, detail=f"{el.element_no} belongs to {project.op_number}, not to the project "
                                                    f"you picked — pick the element again under the right project.")
    if el.status == "cancelled" and not allow_cancelled:
        raise HTTPException(status_code=422, detail=f"{el.element_no} ({el.label}) was cancelled by an amendment of the "
                                                    f"sales order — pick another vehicle / lot of {project.op_number}.")
    return project, el


# ---------------------------------------------------------------- backfill

def backfill(db: Session, actor: User | None) -> list[OrderProject]:
    """Projects for already-confirmed orders (not cancelled / closed) that have an
    RRV line and no project yet. Returns the projects created."""
    have = {sid for (sid,) in db.query(OrderProject.sales_order_id).all()}
    orders = (db.query(SalesOrder)
              .filter(SalesOrder.is_deleted == False, SalesOrder.status.in_(PROJECT_SO_STATUSES),  # noqa: E712
                      SalesOrder.so_number.isnot(None))
              .order_by(SalesOrder.confirmed_at.asc().nullsfirst(), SalesOrder.id.asc()).all())
    created = []
    for so in orders:
        if so.id in have or not needs_project(so):
            continue
        p = ensure_order_project(db, so, actor)
        if p is not None:
            created.append(p)
    return created
