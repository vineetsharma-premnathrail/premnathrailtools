"""Read-only Production data other modules show on their own pages — e.g.
the work orders building an ERP machine, on that machine's detail page.
Gated on Production *or* the consuming module's app, so an ERP user who
doesn't hold Production can still see what's being built for their machine."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_any_app_access
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.production.schemas.insights import ProductionScheduleEntry
from app.modules.production.service import schedule_entry
from app.modules.store.models.item import StoreItem

router = APIRouter(prefix="/production/integrations", tags=["Production"])


@router.get("/projects/{project_id}/work-orders", response_model=list[ProductionScheduleEntry])
async def work_orders_for_project(
    project_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_any_app_access("production", "erp")),
):
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail=f"Machine / project #{project_id} not found in ERP")
    orders = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.erp_project_id == project_id,
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
    ).order_by(ProductionWorkOrder.created_at.desc()).all()
    products = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({o.product_item_id for o in orders})).all()} if orders else {}
    return [schedule_entry(o, products.get(o.product_item_id)) for o in orders]
