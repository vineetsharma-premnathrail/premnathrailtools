from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.work_order import (
    ProductionWorkOrder, ProductionWorkOrderOperation, ProductionTimeLog, WORK_ORDER_REFERENCE_TYPE,
)
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.schemas.insights import ProductionDashboardResponse
from app.modules.production.service import material_requirements, schedule_entry, OPEN_WORK_ORDER_STATUSES
from app.modules.quality.models.inspection import QualityInspection
from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_transaction import StoreStockTransaction

router = APIRouter(
    prefix="/production/dashboard", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)


@router.get("", response_model=ProductionDashboardResponse)
async def get_dashboard(
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "dashboard")),
):
    today = date.today()
    since = today - timedelta(days=30)
    live = ProductionWorkOrder.is_deleted == False  # noqa: E712

    counts = dict(db.query(ProductionWorkOrder.status, func.count(ProductionWorkOrder.id)).filter(live).group_by(ProductionWorkOrder.status).all())
    overdue = db.query(ProductionWorkOrder).filter(
        live, ProductionWorkOrder.status.in_(OPEN_WORK_ORDER_STATUSES), ProductionWorkOrder.planned_end_date < today,
    ).count()
    output_30d = db.query(func.coalesce(func.sum(StoreStockTransaction.quantity), 0.0)).filter(
        StoreStockTransaction.reference_type == WORK_ORDER_REFERENCE_TYPE,
        StoreStockTransaction.transaction_type == "receipt",
        StoreStockTransaction.transaction_date >= since,
    ).scalar()
    scrap_30d, hours_30d = db.query(
        func.coalesce(func.sum(ProductionTimeLog.qty_scrap), 0.0), func.coalesce(func.sum(ProductionTimeLog.hours), 0.0),
    ).filter(ProductionTimeLog.log_date >= since).one()
    pending_inspections = db.query(ProductionWorkOrderOperation).join(
        ProductionWorkOrder, ProductionWorkOrder.id == ProductionWorkOrderOperation.work_order_id
    ).join(
        QualityInspection, QualityInspection.id == ProductionWorkOrderOperation.quality_inspection_id
    ).filter(
        live, ProductionWorkOrder.status.in_(("released", "in_progress")),
        QualityInspection.status.in_(("pending", "in_progress")),
    ).count()

    open_orders = db.query(ProductionWorkOrder).filter(live, ProductionWorkOrder.status.in_(OPEN_WORK_ORDER_STATUSES)).all()
    recent_orders = db.query(ProductionWorkOrder).filter(live).order_by(ProductionWorkOrder.created_at.desc()).limit(8).all()
    product_ids = {o.product_item_id for o in open_orders} | {o.product_item_id for o in recent_orders}
    products = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(product_ids)).all()} if product_ids else {}
    due_soon = sorted(
        (o for o in open_orders if o.planned_end_date and o.planned_end_date <= today + timedelta(days=7)),
        key=lambda o: o.planned_end_date,
    )[:8]

    return {
        "kpis": {
            "draft": counts.get("draft", 0),
            "released": counts.get("released", 0),
            "in_progress": counts.get("in_progress", 0),
            "completed": counts.get("completed", 0),
            "overdue": overdue,
            "output_30d": round(float(output_30d or 0), 2),
            "scrap_30d": round(float(scrap_30d or 0), 2),
            "hours_30d": round(float(hours_30d or 0), 2),
            "pending_inspections": pending_inspections,
            "shortage_items": sum(1 for r in material_requirements(db, include_draft=False) if r["shortage_qty"] > 0),
            "active_boms": db.query(ProductionBom).filter(ProductionBom.is_deleted == False, ProductionBom.status == "active").count(),  # noqa: E712
            "active_workstations": db.query(ProductionWorkstation).filter(
                ProductionWorkstation.is_deleted == False, ProductionWorkstation.status == "active"  # noqa: E712
            ).count(),
        },
        "recent": [schedule_entry(o, products.get(o.product_item_id)) for o in recent_orders],
        "due_soon": [schedule_entry(o, products.get(o.product_item_id)) for o in due_soon],
    }
