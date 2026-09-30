"""Plain-function helpers for the Production module — document numbers, BOM
explosion into work-order lines, stock availability and cost roll-ups. Kept
out of the routes so the planning, dashboard and reports routers share one
definition of "available", "required" and "cost". Mirrors
app/modules/quality/service.py's number-generation pattern."""
from datetime import date, datetime, timezone
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.erp.models.project import Project
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.work_order import (
    ProductionWorkOrder, ProductionWorkOrderMaterial, ProductionWorkOrderOperation, ProductionTimeLog,
)
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.service import generate_stock_reservation_number
from app.modules.store.services.stock_ledger import adjust_reserved_qty
from app.utils.notifications import notify_user

_QTY_PLACES = 4


def _lock_number_series(db: Session, prefix: str) -> None:
    """Serializes concurrent number generation for a prefix with a
    transaction-scoped Postgres advisory lock (see quality/service.py for the
    full reasoning). Skipped on other dialects — the SQLite test database has
    no advisory locks and no concurrent writers."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def _next_number(db: Session, column, prefix: str) -> str:
    _lock_number_series(db, prefix)
    last = db.query(func.max(column)).filter(column.like(f"{prefix}%")).scalar()
    if last:
        return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:04d}"
    return f"{prefix}0001"


def generate_bom_number(db: Session) -> str:
    """BOM-[YEAR]-[NUMBER], sequence scoped per year."""
    return _next_number(db, ProductionBom.bom_number, f"BOM-{date.today().year}-")


def generate_work_order_number(db: Session) -> str:
    """WO-[YEAR]-[NUMBER], sequence scoped per year."""
    return _next_number(db, ProductionWorkOrder.wo_number, f"WO-{date.today().year}-")


def explode_bom(bom: ProductionBom, quantity: float) -> tuple[list[ProductionWorkOrderMaterial], list[ProductionWorkOrderOperation]]:
    """Scales the BOM's components (with their scrap allowance) and routing to
    `quantity` units of the product. Returns unsaved lines for the caller to
    attach to a work order."""
    factor = quantity / (bom.base_quantity or 1.0)
    materials = [
        ProductionWorkOrderMaterial(
            item_id=line.component_item_id,
            required_qty=round(line.quantity * factor * (1 + (line.scrap_percent or 0) / 100), _QTY_PLACES),
            remarks=line.remarks,
        )
        for line in bom.items
    ]
    operations = [
        ProductionWorkOrderOperation(
            sequence=op.sequence,
            operation_name=op.operation_name,
            workstation_id=op.workstation_id,
            planned_hours=round((op.setup_hours or 0) + (op.run_hours_per_unit or 0) * quantity, 2),
            requires_inspection=op.requires_inspection,
            instructions=op.instructions,
            status="pending",
        )
        for op in bom.operations
    ]
    return materials, operations


def item_unit_cost(item: StoreItem | None) -> float:
    """Standard cost, falling back to moving-average cost; 0 when neither is set."""
    if not item:
        return 0.0
    return float(item.standard_cost or item.moving_average_cost or 0.0)


def available_qty(db: Session, item_ids: list[int], location_id: int | None = None) -> dict[int, float]:
    """on_hand − reserved per item, at one location or summed across all."""
    if not item_ids:
        return {}
    query = db.query(
        StoreStockBalance.item_id,
        func.coalesce(func.sum(StoreStockBalance.on_hand_qty - StoreStockBalance.reserved_qty), 0.0),
    ).filter(StoreStockBalance.item_id.in_(item_ids))
    if location_id is not None:
        query = query.filter(StoreStockBalance.location_id == location_id)
    result = {item_id: 0.0 for item_id in item_ids}
    for item_id, qty in query.group_by(StoreStockBalance.item_id).all():
        result[item_id] = float(qty or 0.0)
    return result


def outstanding_qty(material: ProductionWorkOrderMaterial) -> float:
    """What's still to be issued for a line (never negative)."""
    return max(round(material.required_qty - (material.issued_qty - material.returned_qty), _QTY_PLACES), 0.0)


def workstation_rates(db: Session, workstation_ids: set[int]) -> dict[int, float]:
    ids = {i for i in workstation_ids if i}
    if not ids:
        return {}
    return {ws.id: float(ws.hourly_rate or 0.0) for ws in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_(ids)).all()}


def work_order_costing(db: Session, wo: ProductionWorkOrder) -> dict:
    """Estimated (from the planned requirement and planned hours) vs actual
    (from what was issued net of returns, and hours logged) cost for one work
    order. Computed at read time from Store costs and time logs, never
    stored, so there is no running total that can drift from its sources."""
    item_ids = [m.item_id for m in wo.materials]
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    logs = db.query(ProductionTimeLog).filter(ProductionTimeLog.work_order_id == wo.id).all()
    op_ws = {op.id: op.workstation_id for op in wo.operations}
    rates = workstation_rates(db, {op.workstation_id for op in wo.operations} | {log.workstation_id for log in logs})

    material_lines = []
    est_material = act_material = 0.0
    for m in wo.materials:
        unit = item_unit_cost(items.get(m.item_id))
        consumed = m.issued_qty - m.returned_qty
        est, act = m.required_qty * unit, consumed * unit
        est_material += est
        act_material += act
        item = items.get(m.item_id)
        material_lines.append({
            "item_id": m.item_id,
            "item_code": item.item_code if item else None,
            "item_name": item.item_name if item else None,
            "unit_cost": unit,
            "required_qty": m.required_qty,
            "consumed_qty": round(consumed, _QTY_PLACES),
            "estimated_cost": round(est, 2),
            "actual_cost": round(act, 2),
        })

    est_labour = sum(op.planned_hours * rates.get(op.workstation_id, 0.0) for op in wo.operations)
    act_hours = sum(log.hours for log in logs)
    act_labour = sum(log.hours * rates.get(log.workstation_id or op_ws.get(log.operation_id), 0.0) for log in logs)

    estimated_total = est_material + est_labour
    actual_total = act_material + act_labour
    variance = actual_total - estimated_total
    return {
        "work_order_id": wo.id,
        "estimated_material_cost": round(est_material, 2),
        "estimated_labour_cost": round(est_labour, 2),
        "estimated_total_cost": round(estimated_total, 2),
        "actual_material_cost": round(act_material, 2),
        "actual_labour_cost": round(act_labour, 2),
        "actual_total_cost": round(actual_total, 2),
        "planned_hours": round(sum(op.planned_hours for op in wo.operations), 2),
        "actual_hours": round(act_hours, 2),
        "variance": round(variance, 2),
        "variance_percent": round(variance / estimated_total * 100, 1) if estimated_total else None,
        "cost_per_unit": round(actual_total / wo.quantity_completed, 2) if wo.quantity_completed else None,
        "materials": material_lines,
    }


def bom_standard_cost(
    db: Session, bom: ProductionBom,
    items: dict[int, StoreItem] | None = None, rates: dict[int, float] | None = None,
) -> tuple[float, float]:
    """(material, labour) standard cost for `base_quantity` units of the
    product. Pass preloaded `items` / `rates` when costing many BOMs at once."""
    if items is None:
        item_ids = [line.component_item_id for line in bom.items]
        items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    material = sum(
        line.quantity * (1 + (line.scrap_percent or 0) / 100) * item_unit_cost(items.get(line.component_item_id))
        for line in bom.items
    )
    if rates is None:
        rates = workstation_rates(db, {op.workstation_id for op in bom.operations})
    labour = sum(
        ((op.setup_hours or 0) + (op.run_hours_per_unit or 0) * (bom.base_quantity or 1)) * rates.get(op.workstation_id, 0.0)
        for op in bom.operations
    )
    return round(material, 2), round(labour, 2)


def project_label(project: Project | None) -> str | None:
    if not project:
        return None
    what = project.model_name or project.machine_type
    label = f"{project.serial_number} — {what}" if what else project.serial_number
    return f"{label} ({project.client_company})" if project.client_company else label


def mark_started(wo: ProductionWorkOrder) -> None:
    """First shop-floor activity (operation start, material issue or time
    log) moves a released order to in_progress."""
    if wo.status == "released":
        wo.status = "in_progress"
    if wo.actual_start_at is None:
        wo.actual_start_at = datetime.now(timezone.utc)


OPEN_WORK_ORDER_STATUSES = ("draft", "released", "in_progress")


def material_requirements(db: Session, include_draft: bool = True) -> list[dict]:
    """Outstanding component demand of every open work order, netted per item
    against Store stock: what those orders already hold reserved, plus free
    stock (on hand − all reservations) across every location. Sorted with
    the biggest shortages first. `make_bom_id` is set when the item has its
    own active BOM — a shortage there is a sub-assembly to build, not buy."""
    statuses = OPEN_WORK_ORDER_STATUSES if include_draft else ("released", "in_progress")
    rows = db.query(ProductionWorkOrderMaterial, ProductionWorkOrder).join(
        ProductionWorkOrder, ProductionWorkOrder.id == ProductionWorkOrderMaterial.work_order_id
    ).filter(
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status.in_(statuses),
    ).all()
    held = reserved_by_line(db, [m for m, _ in rows])

    by_item: dict[int, dict] = {}
    for material, wo in rows:
        need = outstanding_qty(material)
        if need <= 0:
            continue
        entry = by_item.setdefault(material.item_id, {"item_id": material.item_id, "outstanding_qty": 0.0, "reserved_qty": 0.0, "orders": []})
        entry["outstanding_qty"] = round(entry["outstanding_qty"] + need, _QTY_PLACES)
        entry["reserved_qty"] = round(entry["reserved_qty"] + min(held.get(material.id, 0.0), need), _QTY_PLACES)
        entry["orders"].append({
            "work_order_id": wo.id, "wo_number": wo.wo_number, "status": wo.status,
            "outstanding_qty": need, "planned_start_date": wo.planned_start_date,
        })
    if not by_item:
        return []

    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(by_item.keys())).all()}
    free = available_qty(db, list(by_item.keys()))
    make_boms = dict(db.query(ProductionBom.product_item_id, ProductionBom.id).filter(
        ProductionBom.product_item_id.in_(by_item.keys()), ProductionBom.status == "active",
        ProductionBom.is_deleted == False,  # noqa: E712
    ).all())
    out = []
    for item_id, entry in by_item.items():
        item = items.get(item_id)
        available = round(max(free.get(item_id, 0.0), 0.0), _QTY_PLACES)
        entry.update({
            "item_code": item.item_code if item else None,
            "item_name": item.item_name if item else None,
            "uom": item.uom if item else None,
            "reorder_level": item.reorder_level if item else None,
            "available_qty": available,
            "shortage_qty": round(max(entry["outstanding_qty"] - entry["reserved_qty"] - available, 0.0), _QTY_PLACES),
            "make_bom_id": make_boms.get(item_id),
        })
        entry["orders"].sort(key=lambda o: (o["planned_start_date"] or date.max, o["wo_number"]))
        out.append(entry)
    out.sort(key=lambda e: (-e["shortage_qty"], e["item_code"] or ""))
    return out


def schedule_entry(wo: ProductionWorkOrder, product: StoreItem | None) -> dict:
    return {
        "work_order_id": wo.id, "wo_number": wo.wo_number, "status": wo.status, "priority": wo.priority,
        "product_name": product.item_name if product else None,
        "quantity_planned": wo.quantity_planned, "quantity_completed": wo.quantity_completed,
        "planned_start_date": wo.planned_start_date, "planned_end_date": wo.planned_end_date,
        "progress_percent": round(min(wo.quantity_completed / wo.quantity_planned * 100, 100), 1) if wo.quantity_planned else 0.0,
        "is_overdue": bool(wo.planned_end_date and wo.planned_end_date < date.today() and wo.status in OPEN_WORK_ORDER_STATUSES),
    }


# ---------------------------------------------------------------------------
# Store reservations — a released work order holds its components
# ---------------------------------------------------------------------------

def _active_reservations(db: Session, materials: list[ProductionWorkOrderMaterial]) -> dict[int, StoreStockReservation]:
    ids = {m.reservation_id for m in materials if m.reservation_id}
    if not ids:
        return {}
    return {r.id: r for r in db.query(StoreStockReservation).filter(
        StoreStockReservation.id.in_(ids), StoreStockReservation.status == "active",
    ).all()}


def reserved_by_line(db: Session, materials: list[ProductionWorkOrderMaterial]) -> dict[int, float]:
    """material line id -> quantity its Store reservation still holds (0 once
    it's fulfilled, or cancelled by a Store user)."""
    active = _active_reservations(db, materials)
    return {m.id: active[m.reservation_id].quantity for m in materials if m.reservation_id in active}


def reserve_materials(db: Session, wo: ProductionWorkOrder, user_id: int | None) -> list[str]:
    """Reserve each line's outstanding quantity (up to what's free) at the
    work order's source location, topping up an existing reservation or
    opening a new one. Returns the lines that could only be partly held, for
    the caller to report."""
    if not wo.source_location_id:
        return []
    active = _active_reservations(db, wo.materials)
    free = available_qty(db, [m.item_id for m in wo.materials], wo.source_location_id)
    short = []
    for m in wo.materials:
        res = active.get(m.reservation_id)
        if res and res.location_id != wo.source_location_id:
            continue
        need = outstanding_qty(m) - (res.quantity if res else 0.0)
        if need <= 1e-9:
            continue
        take = round(min(need, max(free.get(m.item_id, 0.0), 0.0)), _QTY_PLACES)
        if take < need - 1e-9:
            item = db.query(StoreItem).filter(StoreItem.id == m.item_id).first()
            short.append(f"{item.item_code if item else m.item_id} ({take:g} of {need:g})")
        if take <= 0:
            continue
        adjust_reserved_qty(db, item_id=m.item_id, location_id=wo.source_location_id, delta=take)
        free[m.item_id] = free.get(m.item_id, 0.0) - take
        if res:
            res.quantity = round(res.quantity + take, _QTY_PLACES)
        else:
            res = StoreStockReservation(
                reservation_number=generate_stock_reservation_number(db),
                item_id=m.item_id, location_id=wo.source_location_id, quantity=take,
                production_order=wo.wo_number, reserved_by_id=user_id,
                required_date=wo.planned_start_date, status="active",
                remarks=f"Held for Production work order {wo.wo_number}",
            )
            db.add(res)
            db.flush()
            m.reservation_id = res.id
    return short


def consume_reservation(db: Session, material: ProductionWorkOrderMaterial, quantity: float, location_id: int) -> None:
    """Before issuing `quantity` of a line from `location_id`, hand back the
    part of its reservation it covers, so the issue's available-stock check
    counts this order's own held stock. A partly drawn reservation keeps the
    remainder; a fully drawn one becomes `fulfilled`."""
    res = _active_reservations(db, [material]).get(material.reservation_id)
    if not res or res.location_id != location_id:
        return
    take = round(min(res.quantity, quantity), _QTY_PLACES)
    if take <= 0:
        return
    adjust_reserved_qty(db, item_id=res.item_id, location_id=res.location_id, delta=-take)
    if res.quantity - take <= 1e-9:
        res.status = "fulfilled"
    else:
        res.quantity = round(res.quantity - take, _QTY_PLACES)


def release_reservations(db: Session, wo: ProductionWorkOrder, status: str = "cancelled") -> None:
    """Give back everything a work order still holds (on cancel, complete, or
    a change of source location)."""
    for res in _active_reservations(db, wo.materials).values():
        adjust_reserved_qty(db, item_id=res.item_id, location_id=res.location_id, delta=-res.quantity)
        res.status = status


# ---------------------------------------------------------------------------
# Quality → Production
# ---------------------------------------------------------------------------

def notify_inspection_result(db: Session, inspection, actor_id: int | None = None) -> None:
    """Called by Quality when an inspection's status changes: tells the
    supervisor (and creator) of the work order whose quality gate it is, so
    the shop floor knows it can complete the step or must rework. Does not
    commit."""
    if inspection.status not in ("passed", "conditionally_passed", "failed"):
        return
    rrv_on_inspection_result(db, inspection, actor_id)
    op = db.query(ProductionWorkOrderOperation).filter(
        ProductionWorkOrderOperation.quality_inspection_id == inspection.id
    ).first()
    if not op:
        return
    wo = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == op.work_order_id).first()
    if not wo:
        return
    passed = inspection.status != "failed"
    title = "Quality Gate Passed" if passed else "Quality Gate Failed — Rework Needed"
    outcome = "passed. The step can now be completed." if passed else "failed. Rework the parts, then request a fresh inspection."
    message = f"Inspection {inspection.inspection_number} for {wo.wo_number} · operation {op.sequence} {op.operation_name} {outcome}"
    for user_id in {wo.supervisor_id, wo.created_by_id} - {None, actor_id}:
        if db.query(User).filter(User.id == user_id, User.is_active == True).first():  # noqa: E712
            notify_user(
                db, user_id=user_id, title=title, message=message,
                notification_type="production_inspection_result", entity_type="production_work_order", entity_id=wo.id,
            )


# ---------------------------------------------------------------------------
# RRV builds (models/rrv_build.py) — numbers, stage gates, rework, handover
# ---------------------------------------------------------------------------

from app.modules.production.models.rrv_build import (  # noqa: E402
    ProductionRrvBuild, ProductionRrvBuildStage, ProductionRrvEvent, ProductionRrvTest, ProductionReworkOrder,
    PRODUCTION_RRV_STAGES, PRODUCTION_RRV_DONE_STAGE_STATUSES, PRODUCTION_RRV_TEST_TYPES,
    PRODUCTION_REWORK_OPEN_STATUSES,
)

RRV_STAGE_META = {key: (label, phase, na) for key, label, phase, na in PRODUCTION_RRV_STAGES}
_RRV_WO_DONE = ("completed", "closed")
_RRV_PASSED_INSPECTION = ("passed", "conditionally_passed")


def generate_rrv_build_number(db: Session) -> str:
    """RRV-[YEAR]-[NUMBER], sequence scoped per year."""
    return _next_number(db, ProductionRrvBuild.build_number, f"RRV-{date.today().year}-")


def generate_rework_number(db: Session) -> str:
    """RW-[YEAR]-[NUMBER], sequence scoped per year."""
    return _next_number(db, ProductionReworkOrder.rework_number, f"RW-{date.today().year}-")


def seed_rrv_stages(build: ProductionRrvBuild) -> None:
    build.stages = [
        ProductionRrvBuildStage(stage_key=key, sequence=i + 1, status="not_started")
        for i, (key, _label, _phase, _na) in enumerate(PRODUCTION_RRV_STAGES)
    ]


def rrv_log(db: Session, build_id: int, action: str, actor: User | None, comment: str | None = None) -> None:
    db.add(ProductionRrvEvent(build_id=build_id, action=action, actor_id=actor.id if actor else None, comment=(comment or "").strip() or None))


def rrv_work_orders(db: Session, build_id: int) -> list[ProductionWorkOrder]:
    return db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.rrv_build_id == build_id, ProductionWorkOrder.is_deleted == False  # noqa: E712
    ).order_by(ProductionWorkOrder.id).all()


def rrv_latest_tests(db: Session, build_id: int) -> dict[str, ProductionRrvTest]:
    """Latest (by date, then id) live test record per test type."""
    rows = db.query(ProductionRrvTest).filter(
        ProductionRrvTest.build_id == build_id, ProductionRrvTest.is_deleted == False  # noqa: E712
    ).order_by(ProductionRrvTest.test_date, ProductionRrvTest.id).all()
    return {r.test_type: r for r in rows}


def rrv_open_rework(db: Session, build_id: int) -> list[ProductionReworkOrder]:
    return db.query(ProductionReworkOrder).filter(
        ProductionReworkOrder.build_id == build_id, ProductionReworkOrder.is_deleted == False,  # noqa: E712
        ProductionReworkOrder.status.in_(PRODUCTION_REWORK_OPEN_STATUSES),
    ).all()


def _stage_done(build: ProductionRrvBuild, key: str) -> bool:
    stage = next((s for s in build.stages if s.stage_key == key), None)
    return bool(stage and stage.status in PRODUCTION_RRV_DONE_STAGE_STATUSES)


def rrv_stage_gate_problems(db: Session, build: ProductionRrvBuild, key: str, wos: list[ProductionWorkOrder] | None = None) -> list[str]:
    """Everything that still blocks completing stage `key`, as sentences the
    user can act on. Empty list = the stage can be completed now."""
    wos = rrv_work_orders(db, build.id) if wos is None else wos
    live = [w for w in wos if w.status != "cancelled"]
    main = next((w for w in live if w.build_role == "main"), None)
    subs = [w for w in live if w.build_role == "sub_assembly"]
    problems: list[str] = []

    if key == "planning":
        if not build.target_completion_date:
            problems.append("Set the target completion date.")
        if not build.target_handover_date:
            problems.append("Set the target handover date.")
        if not main:
            problems.append("Link the main (final vehicle assembly) work order — raise it from the Work Orders tab.")

    elif key == "material_kitting":
        if not live:
            problems.append("No work orders are linked to this build yet.")
        for w in live:
            if w.status == "draft":
                problems.append(f"{w.wo_number} is still a draft — release it so its materials can be reserved and issued.")
                continue
            short = sum(1 for m in w.materials if outstanding_qty(m) > 1e-9)
            if short and w.status not in _RRV_WO_DONE:
                problems.append(f"{w.wo_number} still has {short} material line(s) not fully issued.")

    elif key == "sub_assembly":
        if not subs:
            problems.append("No sub-assembly work orders are linked. Link them, or mark this stage N/A if the vehicle has none.")
        for w in subs:
            if w.status not in _RRV_WO_DONE:
                problems.append(f"Sub-assembly {w.wo_number} is {w.status.replace('_', ' ')} — it must be completed first.")

    elif key == "main_assembly":
        if not main:
            problems.append("Link the main work order first.")
        elif main.status not in ("in_progress", *_RRV_WO_DONE):
            problems.append(f"Main work order {main.wo_number} is {main.status.replace('_', ' ')} — start it on the shop floor (issue material or book time).")
        if not _stage_done(build, "sub_assembly"):
            problems.append("Complete (or mark N/A) the Sub-Assemblies stage first — the sub-assemblies have to be fitted.")

    elif key == "electrical_integration":
        from app.modules.electrical.models.job import ElectricalJob
        if not build.erp_project_id:
            problems.append("Link the machine (ERP serial) to this build so its Electrical job can be checked — or mark N/A.")
        else:
            jobs = db.query(ElectricalJob).filter(
                ElectricalJob.erp_project_id == build.erp_project_id, ElectricalJob.is_deleted == False,  # noqa: E712
                ElectricalJob.status != "cancelled",
            ).all()
            if not jobs:
                problems.append("There's no Electrical job for this machine. Raise one in the Electrical module, or mark this stage N/A.")
            for j in jobs:
                if j.status not in ("handed_over", "closed"):
                    problems.append(f"Electrical job {j.job_number} is {j.status.replace('_', ' ')} — Electrical must hand it over first.")

    elif key == "hydraulic_integration":
        from app.modules.hydraulic.models.system import HydSystem
        from app.modules.hydraulic.models.testing import HydTest
        if not build.erp_project_id:
            problems.append("Link the machine (ERP serial) to this build so its hydraulic systems can be checked — or mark N/A.")
        else:
            systems = db.query(HydSystem).filter(
                HydSystem.erp_project_id == build.erp_project_id, HydSystem.is_deleted == False,  # noqa: E712
                HydSystem.status != "decommissioned",
            ).all()
            if not systems:
                problems.append("There's no Hydraulic system registered for this machine. Add it in the Hydraulic module, or mark this stage N/A.")
            for s in systems:
                last = db.query(HydTest).filter(
                    HydTest.system_id == s.id, HydTest.is_deleted == False, HydTest.status == "completed",  # noqa: E712
                ).order_by(HydTest.id.desc()).first()
                label = f"{s.system_number} ({s.name})"
                if not last:
                    problems.append(f"Hydraulic {label} has no completed test yet.")
                elif last.result not in ("pass", "conditional"):
                    problems.append(f"Hydraulic {label}'s latest test result is {last.result} — it needs a passing test.")

    elif key == "final_assembly":
        if not main:
            problems.append("Link the main work order first.")
        elif main.status not in _RRV_WO_DONE:
            problems.append(f"Main work order {main.wo_number} is {main.status.replace('_', ' ')} — complete all its operations and receive the vehicle first.")
        for dep in ("main_assembly", "electrical_integration", "hydraulic_integration"):
            if not _stage_done(build, dep):
                problems.append(f"Complete (or mark N/A) {RRV_STAGE_META[dep][0]} first.")

    elif key == "final_inspection":
        from app.modules.quality.models.inspection import QualityInspection
        insp = db.query(QualityInspection).filter(QualityInspection.id == build.final_inspection_id).first() if build.final_inspection_id else None
        if not insp or insp.is_deleted:
            problems.append("Request the final inspection from Quality.")
        elif insp.status not in _RRV_PASSED_INSPECTION:
            problems.append(f"Final inspection {insp.inspection_number} is {insp.status.replace('_', ' ')} — it must pass first.")

    elif key == "testing":
        latest = rrv_latest_tests(db, build.id)
        if not build.required_tests:
            problems.append("No vehicle tests are marked as required — pick them on the Tests tab.")
        for t in build.required_tests or []:
            label = PRODUCTION_RRV_TEST_TYPES.get(t, t)
            rec = latest.get(t)
            if not rec:
                problems.append(f"{label}: not tested yet.")
            elif rec.result != "pass":
                problems.append(f"{label}: latest result is a fail — rework it and record a passing retest.")

    elif key == "rework_closure":
        for rw in rrv_open_rework(db, build.id):
            problems.append(f"Rework {rw.rework_number} ({rw.title}) is {rw.status.replace('_', ' ')} — it must be verified or cancelled.")

    elif key == "rrv_completion":
        for k, label, _phase, _na in PRODUCTION_RRV_STAGES:
            if k in ("rrv_completion", "handover"):
                break
            if not _stage_done(build, k):
                problems.append(f"{label} isn't done yet.")
        if not (build.vehicle_serial_number or "").strip() and not build.erp_project_id:
            problems.append("Enter the vehicle serial number (or link the machine) — it becomes the machine's serial in the registry.")
        if not (build.chassis_number or "").strip():
            problems.append("Enter the chassis number.")

    elif key == "handover":
        if not _stage_done(build, "rrv_completion"):
            problems.append("Complete RRV Completion first.")
        if not build.handover_date:
            problems.append("Enter the handover date on the Handover tab.")
        if not (build.handed_over_to_name or "").strip():
            problems.append("Enter who the vehicle is handed over to.")
        if not (build.handover_location or "").strip():
            problems.append("Enter the handover location.")
    return problems


def rrv_can_sign_off(user: User, build: ProductionRrvBuild) -> bool:
    return user.role == "admin" or bool(getattr(user, "is_production_manager", False)) or user.id == build.build_manager_id


def rrv_notify(db: Session, build: ProductionRrvBuild, title: str, message: str, notification_type: str, actor_id: int | None, extra: set | None = None) -> None:
    for user_id in ({build.build_manager_id, build.created_by_id} | (extra or set())) - {None, actor_id}:
        if db.query(User).filter(User.id == user_id, User.is_active == True).first():  # noqa: E712
            notify_user(db, user_id=user_id, title=title, message=message, notification_type=notification_type,
                        entity_type="production_rrv_build", entity_id=build.id)


def raise_rework(
    db: Session, build: ProductionRrvBuild, *, source: str, title: str, defect: str | None, actor_id: int | None,
    source_test_id: int | None = None, inspection_id: int | None = None, work_order_id: int | None = None,
    assigned_to_id: int | None = None, ncr_id: int | None = None, due_date: date | None = None,
) -> ProductionReworkOrder:
    rw = ProductionReworkOrder(
        rework_number=generate_rework_number(db), build_id=build.id, source=source, source_test_id=source_test_id,
        quality_inspection_id=inspection_id, work_order_id=work_order_id, quality_ncr_id=ncr_id, title=title,
        defect_description=defect, assigned_to_id=assigned_to_id, due_date=due_date, status="open", created_by_id=actor_id,
    )
    db.add(rw)
    db.flush()
    actor = db.query(User).filter(User.id == actor_id).first() if actor_id else None
    rrv_log(db, build.id, "rework_raised", actor, f"{rw.rework_number}: {title}")
    rrv_notify(db, build, f"Rework raised: {build.build_number}", f"{rw.rework_number} — {title}", "production_rework_raised", actor_id, {assigned_to_id})
    return rw


def rrv_on_inspection_result(db: Session, inspection, actor_id: int | None = None) -> None:
    """Quality → RRV: a failed build final inspection, or a failed
    operation inspection on a WO that belongs to a build, raises a rework
    order (once per inspection). Passing results just notify. No commit."""
    build = db.query(ProductionRrvBuild).filter(
        ProductionRrvBuild.final_inspection_id == inspection.id, ProductionRrvBuild.is_deleted == False  # noqa: E712
    ).first()
    source, wo = "final_inspection", None
    if not build:
        op = db.query(ProductionWorkOrderOperation).filter(ProductionWorkOrderOperation.quality_inspection_id == inspection.id).first()
        wo = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == op.work_order_id).first() if op else None
        if not wo or not wo.rrv_build_id:
            return
        build = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == wo.rrv_build_id).first()
        source = "operation_inspection"
        if not build:
            return
    if inspection.status == "failed":
        exists = db.query(ProductionReworkOrder.id).filter(
            ProductionReworkOrder.quality_inspection_id == inspection.id, ProductionReworkOrder.is_deleted == False  # noqa: E712
        ).first()
        if not exists:
            where = "final inspection" if source == "final_inspection" else f"inspection on {wo.wo_number}"
            raise_rework(
                db, build, source=source, title=f"Failed {where} {inspection.inspection_number}",
                defect=inspection.remarks, actor_id=actor_id, inspection_id=inspection.id,
                work_order_id=wo.id if wo else None,
            )
    elif source == "final_inspection":
        rrv_notify(db, build, f"Final inspection passed: {build.build_number}",
                   f"{inspection.inspection_number} {inspection.status.replace('_', ' ')} — the Final Quality Inspection stage can be completed.",
                   "production_rrv_inspection_passed", actor_id)


def rework_verification_problem(db: Session, rw: ProductionReworkOrder, build: ProductionRrvBuild) -> str | None:
    """The failed check must pass again before rework can be verified."""
    if rw.source == "test" and rw.source_test_id:
        failed = db.query(ProductionRrvTest).filter(ProductionRrvTest.id == rw.source_test_id).first()
        if failed:
            retest = db.query(ProductionRrvTest).filter(
                ProductionRrvTest.build_id == build.id, ProductionRrvTest.test_type == failed.test_type,
                ProductionRrvTest.id > failed.id, ProductionRrvTest.result == "pass", ProductionRrvTest.is_deleted == False,  # noqa: E712
            ).first()
            if not retest:
                label = PRODUCTION_RRV_TEST_TYPES.get(failed.test_type, failed.test_type)
                return f"Record a passing retest of “{label}” before verifying {rw.rework_number}."
    if rw.source in ("final_inspection", "operation_inspection") and rw.quality_inspection_id:
        from app.modules.quality.models.inspection import QualityInspection
        failed = db.query(QualityInspection).filter(QualityInspection.id == rw.quality_inspection_id).first()
        # A re-request raises a new inspection for the same gate (same batch
        # and label) — the gate's own pointer is overwritten, so match on those.
        again = db.query(QualityInspection).filter(
            QualityInspection.id > rw.quality_inspection_id, QualityInspection.is_deleted == False,  # noqa: E712
            QualityInspection.batch_number == (failed.batch_number if failed else None),
            QualityInspection.project_label == (failed.project_label if failed else None),
        ).order_by(QualityInspection.id.desc()).first()
        if not again or again.status not in _RRV_PASSED_INSPECTION:
            return f"Request a fresh inspection and get it passed by Quality before verifying {rw.rework_number}."
    return None


def _add_months(start: date, months: int) -> date:
    y, m = divmod(start.month - 1 + months, 12)
    year, month = start.year + y, m + 1
    for day in (start.day, 30, 29, 28):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    return date(year, month, 28)


def register_rrv_machine(db: Session, build: ProductionRrvBuild) -> Project:
    """RRV Completion: create the ERP machine for the vehicle if the build
    doesn't have one, else fill in its identity. Status stays
    manufacturing_under_progress until handover."""
    from fastapi import HTTPException

    machine = db.query(Project).filter(Project.id == build.erp_project_id, Project.is_deleted == False).first() if build.erp_project_id else None  # noqa: E712
    if not machine:
        serial = (build.vehicle_serial_number or "").strip()
        clash = db.query(Project).filter(Project.serial_number == serial).first()
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"A machine with serial {serial} is already in the registry ({project_label(clash)}). "
                       "Link that machine to this build instead, or correct the serial number.",
            )
        machine = Project(serial_number=serial, machine_type="RRV", status="manufacturing_under_progress")
        db.add(machine)
        db.flush()
        build.erp_project_id = machine.id
        for wo in rrv_work_orders(db, build.id):
            if not wo.erp_project_id:
                wo.erp_project_id = machine.id
    machine.machine_type = machine.machine_type or "RRV"
    machine.model_name = machine.model_name or build.rrv_model
    machine.client_company = machine.client_company or build.customer_name
    machine.chassis_number = build.chassis_number or machine.chassis_number
    machine.engine_number = build.engine_number or machine.engine_number
    machine.year_of_manufacture = build.year_of_manufacture or machine.year_of_manufacture or str(date.today().year)
    machine.po_number = machine.po_number or build.customer_po_number
    machine.po_date = machine.po_date or build.customer_po_date
    if machine.status in (None, "", "active") and not machine.handover_date:
        machine.status = "manufacturing_under_progress"
    return machine


def apply_rrv_handover(db: Session, build: ProductionRrvBuild) -> Project:
    """Handover: the machine goes live — dates and warranty written to the
    registry Service works from."""
    machine = register_rrv_machine(db, build)
    machine.status = "active"
    machine.delivery_date = build.handover_date
    machine.handover_date = build.handover_date
    machine.commissioning_date = build.commissioning_date or machine.commissioning_date
    machine.warranty_start_date = build.handover_date
    machine.warranty_end_date = _add_months(build.handover_date, build.warranty_months) if build.warranty_months else machine.warranty_end_date
    machine.site_location = machine.site_location or build.handover_location
    return machine


def check_rrv_link(db: Session, build: ProductionRrvBuild, role: str | None, wo: ProductionWorkOrder | None = None) -> None:
    """Rules for tying a work order to a build (create-time or later link):
    valid role, build still open, one main WO per build, the WO not already
    on another build, and the same machine on both."""
    from fastapi import HTTPException
    from app.modules.production.models.rrv_build import PRODUCTION_RRV_WO_ROLES

    if role not in PRODUCTION_RRV_WO_ROLES:
        raise HTTPException(status_code=400, detail=f"Build role must be one of: {', '.join(PRODUCTION_RRV_WO_ROLES)}.")
    if build.status not in ("planned", "in_progress"):
        raise HTTPException(status_code=409, detail=f"{build.build_number} is {build.status.replace('_', ' ')} — work orders can only be added to a planned or in-progress build.")
    if wo is not None:
        if wo.status == "cancelled":
            raise HTTPException(status_code=409, detail=f"{wo.wo_number} is cancelled — link a live work order.")
        if wo.rrv_build_id and wo.rrv_build_id != build.id:
            other = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == wo.rrv_build_id).first()
            raise HTTPException(status_code=409, detail=f"{wo.wo_number} already belongs to {other.build_number if other else 'another build'}. Unlink it there first.")
        if wo.erp_project_id and build.erp_project_id and wo.erp_project_id != build.erp_project_id:
            raise HTTPException(status_code=409, detail=f"{wo.wo_number} is for a different machine than {build.build_number}. A build's work orders must all be for its machine.")
    if role == "main":
        main = db.query(ProductionWorkOrder).filter(
            ProductionWorkOrder.rrv_build_id == build.id, ProductionWorkOrder.build_role == "main",
            ProductionWorkOrder.is_deleted == False, ProductionWorkOrder.status != "cancelled",  # noqa: E712
            ProductionWorkOrder.id != (wo.id if wo is not None else 0),
        ).first()
        if main:
            raise HTTPException(status_code=409, detail=f"{build.build_number} already has a main work order ({main.wo_number}). Link this one as a sub-assembly, or cancel/unlink {main.wo_number} first.")
