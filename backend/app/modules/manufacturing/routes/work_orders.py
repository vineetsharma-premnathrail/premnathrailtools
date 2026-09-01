from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.manufacturing.models.work_order import WorkOrder, WORK_ORDER_STATUSES
from app.modules.manufacturing.models.bom import BOM, BOMItem
from app.modules.manufacturing.models.stock_entry import StockEntry
from app.modules.manufacturing.schemas.work_order import WorkOrderCreate, WorkOrderUpdate, WorkOrderResponse

router = APIRouter(prefix="/manufacturing/work-orders", tags=["Manufacturing"])


def _next_wo_number(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    count = db.query(WorkOrder).filter(WorkOrder.wo_number.like(f"WO-{year}-%")).count()
    return f"WO-{year}-{count + 1:04d}"


def _to_response(wo: WorkOrder, db: Session) -> WorkOrderResponse:
    bom = db.query(BOM).filter(BOM.id == wo.bom_id).first()
    creator = db.query(User).filter(User.id == wo.created_by_id).first() if wo.created_by_id else None
    return WorkOrderResponse.model_validate(wo).model_copy(
        update={"bom_name": bom.name if bom else None, "created_by_name": creator.name if creator else None}
    )


@router.get("", response_model=list[WorkOrderResponse])
async def list_work_orders(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    orders = db.query(WorkOrder).order_by(WorkOrder.id.desc()).all()
    return [_to_response(w, db) for w in orders]


@router.post("", response_model=WorkOrderResponse)
async def create_work_order(
    payload: WorkOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("manufacturing")),
):
    if not db.query(BOM).filter(BOM.id == payload.bom_id).first():
        raise HTTPException(status_code=404, detail="BOM not found")
    wo = WorkOrder(
        wo_number=_next_wo_number(db),
        bom_id=payload.bom_id,
        quantity=payload.quantity,
        remarks=payload.remarks,
        created_by_id=user.id,
    )
    db.add(wo)
    db.commit()
    db.refresh(wo)
    return _to_response(wo, db)


@router.patch("/{work_order_id}", response_model=WorkOrderResponse)
async def update_work_order(
    work_order_id: int,
    payload: WorkOrderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("manufacturing")),
):
    wo = db.query(WorkOrder).filter(WorkOrder.id == work_order_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if payload.status is not None:
        if payload.status not in WORK_ORDER_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")
        # Completing a work order consumes its BOM's component materials —
        # one issue StockEntry per component, scaled to the WO quantity —
        # and produces the BOM's output material as a receipt. Only fires
        # once, on the planned/in_progress -> completed transition, not on
        # every save while already completed.
        if payload.status == "completed" and wo.status != "completed":
            bom = db.query(BOM).filter(BOM.id == wo.bom_id).first()
            if bom:
                scale = wo.quantity / bom.output_quantity if bom.output_quantity else wo.quantity
                for item in db.query(BOMItem).filter(BOMItem.bom_id == bom.id).all():
                    db.add(StockEntry(
                        material_id=item.material_id, work_order_id=wo.id, type="issue",
                        quantity=item.quantity * scale, remarks=f"Consumed by {wo.wo_number}", created_by_id=user.id,
                    ))
                db.add(StockEntry(
                    material_id=bom.output_material_id, work_order_id=wo.id, type="receipt",
                    quantity=wo.quantity, remarks=f"Produced by {wo.wo_number}", created_by_id=user.id,
                ))
        wo.status = payload.status
    if payload.remarks is not None:
        wo.remarks = payload.remarks
    db.commit()
    db.refresh(wo)
    return _to_response(wo, db)
