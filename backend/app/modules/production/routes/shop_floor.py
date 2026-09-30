from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.production.models.work_order import (
    ProductionWorkOrder, ProductionWorkOrderOperation, ProductionTimeLog,
)
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.routes.work_orders import ensure_workstation_available
from app.modules.production.service import mark_started, project_label
from app.modules.production.schemas.insights import ProductionQueueEntry
from app.modules.production.schemas.time_log import ProductionTimeLogCreate, ProductionTimeLogResponse
from app.modules.erp.models.project import Project
from app.modules.quality.models.inspection import QualityInspection
from app.modules.store.models.item import StoreItem

router = APIRouter(
    prefix="/production", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)

_PRIORITY_RANK = {"urgent": 0, "high": 1, "normal": 2, "low": 3}


@router.get("/shop-floor/queue", response_model=list[ProductionQueueEntry])
async def shop_floor_queue(
    workstation_id: int | None = None,
    include_pending: bool = True,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "shop_floor")),
):
    """Every not-yet-completed operation on a released / in-progress work
    order, most urgent first — what each workstation should be working on."""
    statuses = ["in_progress", "pending"] if include_pending else ["in_progress"]
    query = db.query(ProductionWorkOrderOperation, ProductionWorkOrder).join(
        ProductionWorkOrder, ProductionWorkOrder.id == ProductionWorkOrderOperation.work_order_id
    ).filter(
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status.in_(("released", "in_progress")),
        ProductionWorkOrderOperation.status.in_(statuses),
    )
    if workstation_id:
        query = query.filter(ProductionWorkOrderOperation.workstation_id == workstation_id)
    rows = query.all()
    if not rows:
        return []

    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({wo.product_item_id for _, wo in rows})).all()}
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_({wo.erp_project_id for _, wo in rows if wo.erp_project_id})).all()}
    ws_ids = {op.workstation_id for op, _ in rows if op.workstation_id}
    ws_names = {w.id: f"{w.code} — {w.name}" for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_(ws_ids)).all()} if ws_ids else {}
    insp_ids = {op.quality_inspection_id for op, _ in rows if op.quality_inspection_id}
    inspections = {i.id: i for i in db.query(QualityInspection).filter(QualityInspection.id.in_(insp_ids), QualityInspection.is_deleted == False).all()}  # noqa: E712 if insp_ids else {}
    hours: dict[int, float] = {}
    for log in db.query(ProductionTimeLog).filter(ProductionTimeLog.operation_id.in_({op.id for op, _ in rows})).all():
        hours[log.operation_id] = hours.get(log.operation_id, 0.0) + log.hours

    today = date.today()
    out = []
    for op, wo in rows:
        product = items.get(wo.product_item_id)
        insp = inspections.get(op.quality_inspection_id)
        out.append(ProductionQueueEntry(
            operation_id=op.id, work_order_id=wo.id, wo_number=wo.wo_number, wo_status=wo.status, priority=wo.priority,
            product_code=product.item_code if product else None, product_name=product.item_name if product else None,
            project_label=project_label(projects.get(wo.erp_project_id)), quantity_planned=wo.quantity_planned,
            sequence=op.sequence, operation_name=op.operation_name, status=op.status,
            workstation_id=op.workstation_id, workstation_name=ws_names.get(op.workstation_id),
            planned_hours=op.planned_hours, actual_hours=round(hours.get(op.id, 0.0), 2),
            qty_good=op.qty_good, qty_scrap=op.qty_scrap, requires_inspection=op.requires_inspection,
            inspection_number=insp.inspection_number if insp else None, inspection_status=insp.status if insp else None,
            planned_end_date=wo.planned_end_date, is_overdue=bool(wo.planned_end_date and wo.planned_end_date < today),
            instructions=op.instructions,
        ))
    out.sort(key=lambda e: (
        0 if e.status == "in_progress" else 1, _PRIORITY_RANK.get(e.priority, 9),
        e.planned_end_date or date.max, e.wo_number, e.sequence,
    ))
    return out


def _log_responses(db: Session, logs: list[ProductionTimeLog]) -> list[ProductionTimeLogResponse]:
    if not logs:
        return []
    wos = {w.id: w.wo_number for w in db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id.in_({log.work_order_id for log in logs})).all()}
    op_ids = {log.operation_id for log in logs if log.operation_id}
    ops = {o.id: f"{o.sequence} {o.operation_name}" for o in db.query(ProductionWorkOrderOperation).filter(ProductionWorkOrderOperation.id.in_(op_ids)).all()} if op_ids else {}
    ws_ids = {log.workstation_id for log in logs if log.workstation_id}
    ws_names = {w.id: f"{w.code} — {w.name}" for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_(ws_ids)).all()} if ws_ids else {}
    user_ids = {log.operator_id for log in logs if log.operator_id}
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    out = []
    for log in logs:
        resp = ProductionTimeLogResponse.model_validate(log)
        resp.wo_number = wos.get(log.work_order_id)
        resp.operation_label = ops.get(log.operation_id)
        resp.workstation_name = ws_names.get(log.workstation_id)
        resp.operator_name = users.get(log.operator_id)
        out.append(resp)
    return out


@router.get("/time-logs", response_model=list[ProductionTimeLogResponse])
async def list_time_logs(
    work_order_id: int | None = None,
    workstation_id: int | None = None,
    operator_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(ProductionTimeLog)
    if work_order_id:
        query = query.filter(ProductionTimeLog.work_order_id == work_order_id)
    if workstation_id:
        query = query.filter(ProductionTimeLog.workstation_id == workstation_id)
    if operator_id:
        query = query.filter(ProductionTimeLog.operator_id == operator_id)
    if date_from:
        query = query.filter(ProductionTimeLog.log_date >= date_from)
    if date_to:
        query = query.filter(ProductionTimeLog.log_date <= date_to)
    logs = query.order_by(ProductionTimeLog.log_date.desc(), ProductionTimeLog.id.desc()).limit(500).all()
    return _log_responses(db, logs)


@router.post("/time-logs", response_model=ProductionTimeLogResponse)
async def create_time_log(
    payload: ProductionTimeLogCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_tab_action("production", "shop_floor", "edit")),
):
    wo = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.id == payload.work_order_id, ProductionWorkOrder.is_deleted == False  # noqa: E712
    ).with_for_update().first()
    if not wo:
        raise HTTPException(status_code=404, detail=f"Work order #{payload.work_order_id} not found")
    if wo.status not in ("released", "in_progress"):
        raise HTTPException(status_code=409, detail=f"Work order {wo.wo_number} is {wo.status.replace('_', ' ')} — time can only be booked while it is released or in progress.")
    op = next((o for o in wo.operations if o.id == payload.operation_id), None)
    if not op:
        raise HTTPException(status_code=404, detail=f"Operation #{payload.operation_id} is not part of work order {wo.wo_number}")
    if op.status == "completed":
        raise HTTPException(status_code=409, detail=f"Operation {op.sequence} {op.operation_name} is already completed, so no more time can be booked on it.")
    if op.status == "pending":
        ensure_workstation_available(db, op)
    if payload.log_date > date.today():
        raise HTTPException(status_code=400, detail="Time can't be booked for a future date.")
    operator_id = payload.operator_id or user.id
    if not db.query(User).filter(User.id == operator_id, User.is_active == True).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Operator user #{operator_id} not found or inactive")

    log = ProductionTimeLog(
        work_order_id=wo.id, operation_id=op.id, workstation_id=op.workstation_id, operator_id=operator_id,
        log_date=payload.log_date, hours=payload.hours, qty_good=payload.qty_good, qty_scrap=payload.qty_scrap,
        remarks=payload.remarks, created_by_id=user.id,
    )
    db.add(log)
    op.qty_good = round(op.qty_good + payload.qty_good, 4)
    op.qty_scrap = round(op.qty_scrap + payload.qty_scrap, 4)
    wo.quantity_scrapped = round(wo.quantity_scrapped + payload.qty_scrap, 4)
    if op.status == "pending":
        op.status = "in_progress"
        op.started_at = op.started_at or datetime.now(timezone.utc)
    mark_started(wo)
    db.commit()
    db.refresh(log)
    return _log_responses(db, [log])[0]


@router.delete("/time-logs/{log_id}")
async def delete_time_log(
    log_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("production", "shop_floor", "delete")),
):
    log = db.query(ProductionTimeLog).filter(ProductionTimeLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail=f"Time log #{log_id} not found")
    wo = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == log.work_order_id).with_for_update().first()
    op = db.query(ProductionWorkOrderOperation).filter(ProductionWorkOrderOperation.id == log.operation_id).first() if log.operation_id else None
    if wo and wo.status not in ("released", "in_progress"):
        raise HTTPException(status_code=409, detail=f"Work order {wo.wo_number} is {wo.status.replace('_', ' ')}, so its time logs are locked.")
    if op and op.status == "completed":
        raise HTTPException(status_code=409, detail=f"Operation {op.sequence} {op.operation_name} is completed, so its time logs are locked.")
    if op:
        op.qty_good = max(round(op.qty_good - log.qty_good, 4), 0.0)
        op.qty_scrap = max(round(op.qty_scrap - log.qty_scrap, 4), 0.0)
    if wo:
        wo.quantity_scrapped = max(round(wo.quantity_scrapped - log.qty_scrap, 4), 0.0)
    db.delete(log)
    db.commit()
    return {"message": "Time log deleted"}
