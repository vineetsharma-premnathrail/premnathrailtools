"""Production ↔ project Units (projects/so_projects.py, owner decision
2026-10-17: RRVs are built to order and every department works against the
PM project of the confirmed Sales Order).

What Production plugs in (registered at import — routes/rrv_builds.py and
routes/work_orders.py import this module, so it runs at app start-up):

* project hook   — every NEW vehicle element gets a planned RRV build, linked
                   to the element and to its Sales delivery row through the
                   Sales link_build (so the row's status / committed date stay
                   in sync). A row that already has a build keeps it; the
                   element is just attached. Planners are told.
* status hook    — a vehicle element is in_progress while its build is
                   running (in progress / on hold) and ready once the build is
                   completed / handed over; a lot element follows its work
                   orders. Delivery events (dispatched / delivered) still win.
* 'production'   — the 360 column: build number + state + target date per
  provider         vehicle, work-order count / state per lot.

Plus the helpers the work-order routes and MRP use: apply_wo_element (the
"element required when the sales order has a project" rule),
resolve_build_element, element_maps and sync_build_element.

The RRV vehicle element is defined by its delivery row, so a build's element
is always re-derived from build.sales_schedule_id when it has one (a build
linked / unlinked by hand on the Sales delivery schedule follows along)."""
from __future__ import annotations

import logging
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.projects import so_projects as op_core
from app.modules.projects.models.element import PmProjectElement
from app.modules.projects.models.project import PmProject

logger = logging.getLogger("production")

BUILD_STATUS_LABEL = {
    "planned": "Planned", "in_progress": "In progress", "on_hold": "On hold", "completed": "Completed",
    "handed_over": "Handed over", "cancelled": "Cancelled",
}
_BUILD_TONE = {
    "planned": "neutral", "in_progress": "info", "on_hold": "warning", "completed": "success",
    "handed_over": "success", "cancelled": "danger",
}
_WO_LIVE = ("draft", "released", "in_progress", "completed", "closed")


def _d(d: date | None) -> str:
    return d.strftime("%d-%b-%Y") if d else ""


# ---------------------------------------------------------------- build ↔ element

def resolve_build_element(db: Session, build, *, persist: bool = False) -> PmProjectElement | None:
    """The vehicle element a build makes: the element of its delivery row when
    it sits on one, else the element stored on the build (None once the build
    was unlinked from its row). `persist` writes the result onto the build."""
    el = None
    if build.sales_schedule_id:
        el = op_core.element_for_schedule(db, build.sales_schedule_id)
    elif build.order_project_element_id:
        stored = db.get(PmProjectElement, build.order_project_element_id)
        # A vehicle element always comes with a delivery row — a build that
        # left its row no longer makes that vehicle.
        el = stored if stored is not None and stored.kind != "vehicle" else None
    if persist:
        build.order_project_element_id = el.id if el else None
        build.order_project_id = el.project_id if el else None
    return el


def build_elements(db: Session, builds: list) -> dict[int, tuple[PmProject, PmProjectElement]]:
    """Bulk resolve_build_element for list responses: {build_id: (project, element)}."""
    sched_ids = {b.sales_schedule_id for b in builds if b.sales_schedule_id}
    stored_ids = {b.order_project_element_id for b in builds if not b.sales_schedule_id and b.order_project_element_id}
    by_row: dict[int, PmProjectElement] = {}
    by_id: dict[int, PmProjectElement] = {}
    if sched_ids:
        for el in (db.query(PmProjectElement).filter(PmProjectElement.sales_schedule_id.in_(sched_ids))
                   .order_by(PmProjectElement.id).all()):
            by_row[el.sales_schedule_id] = el  # latest wins, as element_for_schedule
    if stored_ids:
        by_id = {el.id: el for el in db.query(PmProjectElement).filter(PmProjectElement.id.in_(stored_ids)).all()
                 if el.kind != "vehicle"}
    out = {}
    for b in builds:
        el = by_row.get(b.sales_schedule_id) if b.sales_schedule_id else by_id.get(b.order_project_element_id)
        if el is not None:
            out[b.id] = (el.project, el)
    return out


def sync_build_element(db: Session, build) -> None:
    """After a build changes state: re-attach its element and re-derive the
    element's status (in_progress / ready). Never raises — the build's own
    transition must not fail on the project side."""
    try:
        el = resolve_build_element(db, build, persist=True)
        if el is not None and el.status != "cancelled":
            op_core.refresh_element_status(db, el)
    except Exception:  # noqa: BLE001
        logger.exception("Project unit sync failed for build %s", getattr(build, "build_number", build))


# ---------------------------------------------------------------- project hook: plan builds

def plan_builds_for_project(db: Session, project: PmProject, so, actor, new_elements: list[PmProjectElement]) -> None:
    """A planned build per new vehicle element (idempotent — a delivery row
    that already has a build keeps it and the element is attached)."""
    from app.modules.production.models.rrv_build import ProductionRrvBuild, PRODUCTION_RRV_DEFAULT_REQUIRED_TESTS
    from app.modules.production.service import generate_rrv_build_number, rrv_log, seed_rrv_stages
    from app.modules.sales import service as sales_svc

    vehicles = [el for el in new_elements if el.kind == "vehicle" and el.status != "cancelled" and el.sales_schedule_id]
    if not vehicles:
        return
    rows = {r.id: r for r in so.schedules}
    lines = {ln.id: ln for ln in so.lines}
    created: list[tuple[ProductionRrvBuild, PmProjectElement]] = []
    attached = 0
    for el in vehicles:
        row = rows.get(el.sales_schedule_id)
        if row is None or row.status == "cancelled":
            continue
        existing = None
        if row.rrv_build_id:
            existing = db.get(ProductionRrvBuild, row.rrv_build_id)
        if existing is None:
            existing = (db.query(ProductionRrvBuild)
                        .filter(ProductionRrvBuild.sales_schedule_id == row.id, ProductionRrvBuild.is_deleted == False)  # noqa: E712
                        .first())
        if existing is not None:
            existing.order_project_id, existing.order_project_element_id = project.id, el.id
            if (existing.build_number or "").startswith("RRV-") and not db.query(ProductionRrvBuild.id).filter(
                    ProductionRrvBuild.build_number == el.element_no).first():
                # Known by its project vehicle number from now on (owner 2026-10-27).
                rrv_log(db, existing.id, "renumbered", actor, f"{existing.build_number} is now {el.element_no}")
                existing.build_number = el.element_no
            attached += 1
            continue
        line = lines.get(el.sales_order_line_id)
        model = (line.rrv_model if line is not None and line.rrv_model else None) or \
                (" ".join((line.description or "").split())[:200] if line is not None else None) or "RRV"
        build = ProductionRrvBuild(
            build_number=generate_rrv_build_number(db, el), rrv_model=model[:200], status="planned", priority="normal",
            branch_id=so.branch_id, created_by_id=actor.id if actor else None,
            target_handover_date=el.contractual_date or row.current_delivery_date,
            required_tests=list(PRODUCTION_RRV_DEFAULT_REQUIRED_TESTS),
            order_project_id=project.id, order_project_element_id=el.id,
        )
        seed_rrv_stages(build)
        db.add(build)
        db.flush()
        # The Sales link (customer, PO, SO ids, delivery row ↔ build) — same
        # rules as linking a build by hand on the delivery schedule.
        sales_svc.link_build(db, so, row, build.id)
        rrv_log(db, build.id, "created", actor,
                f"Planned automatically for {op_core.element_display(project, el)} ({so.so_number or so.display_number}) "
                f"when the sales order was confirmed")
        created.append((build, el))
    if not created and not attached:
        return
    db.flush()
    sales_svc.refresh_order(db, so)
    if created:
        parts = ", ".join(f"{b.build_number} ({el.label})" for b, el in created)
        msg = (f"{so.customer_name or 'Customer'}: PO {so.customer_po_number or '—'} — {project.project_code}. "
               f"Planned build created for each vehicle: {parts}. Assign a build manager and plan the stages "
               f"(Production › RRV Builds).")
        try:
            sales_svc.notify_bell(db, sales_svc.production_planners(db),
                                  f"Planned build created — {so.so_number or so.display_number}", msg,
                                  "production_rrv_planned", "sales_order", so.id,
                                  exclude_user_id=actor.id if actor else None)
        except Exception:  # noqa: BLE001 — a notification must never undo the plan
            logger.exception("Planned-build notification failed for %s", project.project_code)


# ---------------------------------------------------------------- status hook

def _live_builds_for(db: Session, element: PmProjectElement) -> list:
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    q = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.is_deleted == False,  # noqa: E712
                                            ProductionRrvBuild.status != "cancelled")
    if element.sales_schedule_id:
        return q.filter(ProductionRrvBuild.sales_schedule_id == element.sales_schedule_id).all()
    return q.filter(ProductionRrvBuild.order_project_element_id == element.id).all()


def element_status_hook(db: Session, element: PmProjectElement, so, status: str) -> str | None:
    if element.kind == "vehicle":
        # The build is the truth (the delivery row's cached status can lag
        # until Sales re-derives it): no running build → planned.
        states = {b.status for b in _live_builds_for(db, element)}
        if states & {"completed", "handed_over"}:
            return "ready"
        if states & {"in_progress", "on_hold"}:
            return "in_progress"
        return "planned"
    from app.modules.production.models.work_order import ProductionWorkOrder
    wos = db.query(ProductionWorkOrder.status).filter(
        ProductionWorkOrder.order_project_element_id == element.id, ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status != "cancelled").all()
    states = [s for (s,) in wos]
    if not states:
        return None
    if all(s in ("completed", "closed") for s in states):
        return "ready"
    if any(s in ("released", "in_progress", "completed", "closed") for s in states):
        return "in_progress"
    return None


# ---------------------------------------------------------------- 360 provider

def production_cells(db: Session, project: PmProject, elements: list[PmProjectElement]) -> dict[int, dict | None]:
    from app.modules.production.models.rrv_build import ProductionRrvBuild, PRODUCTION_RRV_DONE_STAGE_STATUSES
    from app.modules.production.models.work_order import ProductionWorkOrder
    from app.modules.production.service import RRV_STAGE_META

    today = date.today()
    out: dict[int, dict | None] = {}
    vehicles = [el for el in elements if el.kind == "vehicle" and el.status != "cancelled"]
    lots = [el for el in elements if el.kind == "lot" and el.status != "cancelled"]

    if vehicles:
        sched_ids = [el.sales_schedule_id for el in vehicles if el.sales_schedule_id]
        builds = (db.query(ProductionRrvBuild)
                  .filter(ProductionRrvBuild.is_deleted == False, ProductionRrvBuild.sales_schedule_id.in_(sched_ids or [-1]))  # noqa: E712
                  .all())
        by_row: dict[int, ProductionRrvBuild] = {}
        for b in sorted(builds, key=lambda x: (x.status == "cancelled", -x.id)):
            by_row.setdefault(b.sales_schedule_id, b)
        for el in vehicles:
            b = by_row.get(el.sales_schedule_id)
            if b is None:
                out[el.id] = None
                continue
            target = b.target_handover_date or b.target_completion_date
            overdue = bool(target and target < today and b.status in ("planned", "in_progress", "on_hold"))
            done = sum(1 for s in b.stages if s.status in PRODUCTION_RRV_DONE_STAGE_STATUSES)
            current = next((s for s in b.stages if s.status not in PRODUCTION_RRV_DONE_STAGE_STATUSES), None)
            bits = [f"{done}/{len(b.stages)} stages"]
            if current is not None and b.status in ("in_progress", "on_hold"):
                bits.append(RRV_STAGE_META[current.stage_key][0])
            if target:
                bits.append(("Overdue — target " if overdue else "Target ") + _d(target))
            out[el.id] = {
                "status": b.status, "label": f"{b.build_number} · {BUILD_STATUS_LABEL.get(b.status, b.status)}",
                "tone": "danger" if overdue else _BUILD_TONE.get(b.status, "neutral"),
                "detail": " · ".join(bits), "date": target.isoformat() if target else None,
            }

    if lots:
        wos = (db.query(ProductionWorkOrder)
               .filter(ProductionWorkOrder.order_project_element_id.in_([el.id for el in lots]),
                       ProductionWorkOrder.is_deleted == False, ProductionWorkOrder.status.in_(_WO_LIVE))  # noqa: E712
               .order_by(ProductionWorkOrder.id).all())
        by_el: dict[int, list] = {}
        for w in wos:
            by_el.setdefault(w.order_project_element_id, []).append(w)
        for el in lots:
            rows = by_el.get(el.id)
            if not rows:
                out[el.id] = None
                continue
            states = [w.status for w in rows]
            n = len(rows)
            if all(s in ("completed", "closed") for s in states):
                status, label, tone = "done", "Done", "success"
            elif any(s in ("released", "in_progress", "completed", "closed") for s in states):
                status, label, tone = "in_progress", "In progress", "info"
            else:
                status, label, tone = "draft", "Draft", "neutral"
            end = max((w.planned_end_date for w in rows if w.planned_end_date), default=None)
            overdue = bool(end and end < today and status != "done")
            out[el.id] = {
                "status": status, "label": f"{n} WO{'s' if n != 1 else ''} · {label}",
                "tone": "danger" if overdue else tone,
                "detail": ", ".join(f"{w.wo_number} ({w.status.replace('_', ' ')})" for w in rows)[:300],
                "date": end.isoformat() if end else None,
            }
    return out


# ---------------------------------------------------------------- work orders

def _so_number(db: Session, so_id: int) -> str:
    from app.modules.sales.models.order import SalesOrder
    so = db.get(SalesOrder, so_id)
    return so.display_number if so else f"#{so_id}"


def apply_wo_element(db: Session, data: dict, product_item_id: int) -> None:
    """Validate / fill the project unit of a work order. Mutates
    `data` (order_project_id, order_project_element_id and — when only the
    element was picked — sales_order_id / sales_order_line_id).

    * A picked element must exist, be live and belong to the WO's sales order
      (and line, when one is set); it fills in an empty sales order.
    * A WO assigned to a sales order that has a project must name its
      element; when the order line has exactly one live element (a spares lot,
      or a one-vehicle line) it is filled in, otherwise 422."""
    from app.modules.production import routing_control

    element_id = data.get("order_project_element_id")
    project_id = data.get("order_project_id")
    if element_id:
        project, el = op_core.resolve_element(db, element_id, project_id=project_id)
        so_id, line_id = data.get("sales_order_id"), data.get("sales_order_line_id")
        if so_id and project.sales_order_id and so_id != project.sales_order_id:
            raise HTTPException(status_code=422, detail=(
                f"{el.element_no} belongs to {project.project_code}, the project of sales order "
                f"{_so_number(db, project.sales_order_id)}, but this work order is assigned to sales order "
                f"{_so_number(db, so_id)}. Pick a unit of that order's project, or clear the sales order."))
        if line_id and line_id != el.sales_order_line_id:
            raise HTTPException(status_code=422, detail=(
                f"{el.element_no} ({el.label}) is for a different sales order line than the one picked. "
                f"Pick the unit of that line, or clear the sales order line."))
        if project.sales_order_id and (not so_id or not line_id):
            data["sales_order_id"], data["sales_order_line_id"] = project.sales_order_id, el.sales_order_line_id
            try:
                routing_control.validate_sales_assignment(db, data, product_item_id)
            except routing_control.RoutingError as e:
                raise HTTPException(status_code=e.status, detail=str(e))
        data["order_project_id"], data["order_project_element_id"] = project.id, el.id
        return

    data["order_project_id"] = None
    data["order_project_element_id"] = None
    so_id = data.get("sales_order_id")
    if not so_id:
        return
    project = op_core.project_for_order(db, so_id)
    if project is None:
        return
    candidates = [el for el in project.elements if el.status != "cancelled"]
    if data.get("sales_order_line_id"):
        candidates = [el for el in candidates if el.sales_order_line_id == data["sales_order_line_id"]]
        if len(candidates) == 1:
            data["order_project_id"], data["order_project_element_id"] = project.id, candidates[0].id
            return
    raise HTTPException(status_code=422, detail=(
        f"Sales order {_so_number(db, so_id)} has project {project.project_code}, so a work order for it "
        f"must name the unit (vehicle / lot) it builds. Pick it in the Project unit field (e.g. "
        f"{project.project_code} / 01), or clear the sales order if this is stock work."))


def inherit_element(target: dict, source) -> None:
    """Copy the element of a build / parent order onto new work-order data."""
    if getattr(source, "order_project_element_id", None):
        target["order_project_id"] = source.order_project_id
        target["order_project_element_id"] = source.order_project_element_id


# ---------------------------------------------------------------- MRP

def element_maps(db: Session) -> tuple[dict[int, PmProjectElement], dict[int, PmProjectElement]]:
    """({schedule_id: vehicle element}, {so_line_id: lot element}) of live elements."""
    by_row: dict[int, PmProjectElement] = {}
    by_lot_line: dict[int, PmProjectElement] = {}
    for el in db.query(PmProjectElement).filter(PmProjectElement.status != "cancelled").all():
        if el.kind == "vehicle" and el.sales_schedule_id:
            by_row[el.sales_schedule_id] = el
        elif el.kind == "lot":
            by_lot_line[el.sales_order_line_id] = el
    return by_row, by_lot_line


def element_labels(db: Session, element_ids: set[int]) -> dict[int, tuple[str, str, int]]:
    """{element_id: (display, op_number, project_id)} for list responses."""
    ids = {i for i in element_ids if i}
    if not ids:
        return {}
    rows = (db.query(PmProjectElement, PmProject)
            .join(PmProject, PmProject.id == PmProjectElement.project_id)
            .filter(PmProjectElement.id.in_(ids)).all())
    return {el.id: (op_core.element_display(p, el), p.project_code, p.id) for el, p in rows}


op_core.register_project_hook(plan_builds_for_project)
op_core.register_element_status_hook(element_status_hook)
op_core.register_department_provider("production", production_cells)
