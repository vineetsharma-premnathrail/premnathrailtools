from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.manufacturing.models.material import Material
from app.modules.manufacturing.models.bom import BOM
from app.modules.manufacturing.models.work_order import WorkOrder
from app.modules.manufacturing.models.stock_entry import StockEntry

router = APIRouter(prefix="/manufacturing/dashboard", tags=["Manufacturing"])


class ManufacturingDashboardResponse(BaseModel):
    material_count: int
    bom_count: int
    work_orders_planned: int
    work_orders_in_progress: int
    work_orders_completed: int
    stock_entries_count: int


@router.get("", response_model=ManufacturingDashboardResponse)
async def get_dashboard(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    return ManufacturingDashboardResponse(
        material_count=db.query(Material).count(),
        bom_count=db.query(BOM).count(),
        work_orders_planned=db.query(WorkOrder).filter(WorkOrder.status == "planned").count(),
        work_orders_in_progress=db.query(WorkOrder).filter(WorkOrder.status == "in_progress").count(),
        work_orders_completed=db.query(WorkOrder).filter(WorkOrder.status == "completed").count(),
        stock_entries_count=db.query(StockEntry).count(),
    )
