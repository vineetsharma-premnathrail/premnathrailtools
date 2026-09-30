from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.production.models.work_order import ProductionWorkOrder, ProductionWorkOrderOperation, ProductionTimeLog
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.schemas.insights import ProductionPlanningResponse
from app.modules.production.service import material_requirements, schedule_entry, OPEN_WORK_ORDER_STATUSES
from app.modules.store.models.item import StoreItem

router = APIRouter(
    prefix="/production/planning", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)


def _workstation_load(db: Session) -> list[dict]:
    """Remaining planned hours (planned − already logged) of every open
    operation on released / in-progress orders, per workstation."""
    ops = db.query(ProductionWorkOrderOperation).join(
        ProductionWorkOrder, ProductionWorkOrder.id == ProductionWorkOrderOperation.work_order_id
    ).filter(
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status.in_(("released", "in_progress")),
        ProductionWorkOrderOperation.status != "completed",
    ).all()
    logged: dict[int, float] = {}
    if ops:
        for log in db.query(ProductionTimeLog).filter(ProductionTimeLog.operation_id.in_({o.id for o in ops})).all():
            logged[log.operation_id] = logged.get(log.operation_id, 0.0) + log.hours

    workstations = db.query(ProductionWorkstation).filter(ProductionWorkstation.is_deleted == False).all()  # noqa: E712
    load = {
        ws.id: {"workstation_id": ws.id, "workstation_name": f"{ws.code} — {ws.name}", "status": ws.status,
                "capacity_hours_per_day": ws.capacity_hours_per_day, "open_operations": 0, "remaining_hours": 0.0}
        for ws in workstations
    }
    for op in ops:
        key = op.workstation_id if op.workstation_id in load else None
        entry = load.setdefault(key, {"workstation_id": None, "workstation_name": "Unassigned", "status": None,
                                      "capacity_hours_per_day": 0.0, "open_operations": 0, "remaining_hours": 0.0})
        entry["open_operations"] += 1
        entry["remaining_hours"] += max(op.planned_hours - logged.get(op.id, 0.0), 0.0)
    out = []
    for entry in load.values():
        entry["remaining_hours"] = round(entry["remaining_hours"], 2)
        cap = entry["capacity_hours_per_day"]
        entry["load_days"] = round(entry["remaining_hours"] / cap, 1) if cap else None
        out.append(entry)
    out.sort(key=lambda e: -e["remaining_hours"])
    return out


@router.get("", response_model=ProductionPlanningResponse)
async def get_planning(
    include_draft: bool = True,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "planning")),
):
    orders = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status.in_(OPEN_WORK_ORDER_STATUSES),
    ).all()
    products = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({o.product_item_id for o in orders})).all()} if orders else {}
    schedule = sorted(
        (schedule_entry(o, products.get(o.product_item_id)) for o in orders),
        key=lambda e: (e["planned_start_date"] is None, e["planned_start_date"] or e["planned_end_date"], e["wo_number"]),
    )
    return {
        "requirements": material_requirements(db, include_draft=include_draft),
        "workstation_load": _workstation_load(db),
        "schedule": schedule,
    }
