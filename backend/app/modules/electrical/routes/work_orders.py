from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.erp.models.project import Project
from app.modules.electrical.models.work_order import (
    ElectricalWorkOrder, ELECTRICAL_WORK_ORDER_STATUSES, ELECTRICAL_WORK_ORDER_PRIORITIES,
)
from app.modules.electrical.schemas.work_order import (
    ElectricalWorkOrderCreate, ElectricalWorkOrderUpdate, ElectricalWorkOrderAssignPayload,
    ElectricalWorkOrderStatusPayload, ElectricalWorkOrderResponse,
)

router = APIRouter(prefix="/electrical/work-orders", tags=["Electrical"])


def _generate_wo_number(db: Session) -> str:
    year = date.today().year
    prefix = f"EWO-{year}-"
    last = db.query(func.max(ElectricalWorkOrder.work_order_number)).filter(
        ElectricalWorkOrder.work_order_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def _to_response(db: Session, wo: ElectricalWorkOrder) -> ElectricalWorkOrderResponse:
    resp = ElectricalWorkOrderResponse.model_validate(wo)
    project = db.query(Project).filter(Project.id == wo.project_id).first()
    resp.project_label = project.serial_number if project else None
    if wo.assigned_to_id:
        u = db.query(User).filter(User.id == wo.assigned_to_id).first()
        resp.assigned_to_name = (u.name or u.email) if u else None
    if wo.raised_by_id:
        u = db.query(User).filter(User.id == wo.raised_by_id).first()
        resp.raised_by_name = (u.name or u.email) if u else None
    return resp


@router.get("", response_model=list[ElectricalWorkOrderResponse])
async def list_work_orders(
    status: str | None = None,
    priority: str | None = None,
    project_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("electrical")),
):
    query = db.query(ElectricalWorkOrder)
    if status:
        query = query.filter(ElectricalWorkOrder.status == status)
    if priority:
        query = query.filter(ElectricalWorkOrder.priority == priority)
    if project_id:
        query = query.filter(ElectricalWorkOrder.project_id == project_id)
    wos = query.order_by(ElectricalWorkOrder.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_response(db, w) for w in wos]


@router.post("", response_model=ElectricalWorkOrderResponse)
async def create_work_order(
    payload: ElectricalWorkOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("electrical")),
):
    if payload.priority not in ELECTRICAL_WORK_ORDER_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{payload.priority}'")
    project = db.query(Project).filter(Project.id == payload.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    wo = ElectricalWorkOrder(
        work_order_number=_generate_wo_number(db),
        project_id=payload.project_id,
        equipment_tag=payload.equipment_tag,
        voltage_system=payload.voltage_system,
        fault_type=payload.fault_type,
        description=payload.description,
        source_service_request_id=payload.source_service_request_id,
        priority=payload.priority,
        expected_completion_date=payload.expected_completion_date,
        status="open",
        raised_by_id=user.id,
    )
    db.add(wo)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.get("/{wo_id}", response_model=ElectricalWorkOrderResponse)
async def get_work_order(
    wo_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("electrical")),
):
    wo = db.query(ElectricalWorkOrder).filter(ElectricalWorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    return _to_response(db, wo)


@router.patch("/{wo_id}", response_model=ElectricalWorkOrderResponse)
async def update_work_order(
    wo_id: int,
    payload: ElectricalWorkOrderUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("electrical")),
):
    wo = db.query(ElectricalWorkOrder).filter(ElectricalWorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    updates = payload.model_dump(exclude_unset=True)
    if "priority" in updates and updates["priority"] not in ELECTRICAL_WORK_ORDER_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{updates['priority']}'")
    for field, val in updates.items():
        setattr(wo, field, val)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/assign", response_model=ElectricalWorkOrderResponse)
async def assign_work_order(
    wo_id: int,
    payload: ElectricalWorkOrderAssignPayload,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("electrical")),
):
    wo = db.query(ElectricalWorkOrder).filter(ElectricalWorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if not db.query(User).filter(User.id == payload.assigned_to_id).first():
        raise HTTPException(status_code=404, detail="Assignee not found")
    wo.assigned_to_id = payload.assigned_to_id
    if wo.status == "open":
        wo.status = "assigned"
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/status", response_model=ElectricalWorkOrderResponse)
async def change_status(
    wo_id: int,
    payload: ElectricalWorkOrderStatusPayload,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("electrical")),
):
    if payload.status not in ELECTRICAL_WORK_ORDER_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")
    wo = db.query(ElectricalWorkOrder).filter(ElectricalWorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    wo.status = payload.status
    if payload.resolution_notes:
        wo.resolution_notes = payload.resolution_notes
    if payload.status == "resolved" and not wo.resolved_at:
        wo.resolved_at = datetime.now(timezone.utc)
    if payload.status == "closed" and not wo.closed_at:
        wo.closed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)
