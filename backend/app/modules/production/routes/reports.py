from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.production.models.work_order import ProductionWorkOrder, ProductionTimeLog, WORK_ORDER_REFERENCE_TYPE
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.schemas.insights import ProductionReportResponse
from app.modules.production.service import work_order_costing
from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_transaction import StoreStockTransaction

router = APIRouter(
    prefix="/production/reports", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)

_MAX_RANGE_DAYS = 366


def _working_days(start: date, end: date) -> int:
    """Mon–Sat days in the range (Sunday is the shop's weekly off)."""
    return sum(1 for n in range((end - start).days + 1) if (start + timedelta(days=n)).weekday() != 6)


@router.get("", response_model=ProductionReportResponse)
async def get_report(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "reports")),
):
    date_to = date_to or date.today()
    date_from = date_from or (date_to - timedelta(days=29))
    if date_from > date_to:
        raise HTTPException(status_code=400, detail=f"'From' date ({date_from:%d-%m-%Y}) is after the 'To' date ({date_to:%d-%m-%Y}).")
    if (date_to - date_from).days > _MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail="Pick a range of one year or less — longer ranges are too slow to cost order by order.")

    # Finished-goods output, straight from the Store ledger.
    receipts = db.query(
        StoreStockTransaction.item_id,
        func.sum(StoreStockTransaction.quantity),
        func.count(func.distinct(StoreStockTransaction.reference_number)),
    ).filter(
        StoreStockTransaction.reference_type == WORK_ORDER_REFERENCE_TYPE,
        StoreStockTransaction.transaction_type == "receipt",
        StoreStockTransaction.transaction_date >= date_from,
        StoreStockTransaction.transaction_date <= date_to,
    ).group_by(StoreStockTransaction.item_id).all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({r[0] for r in receipts})).all()} if receipts else {}
    output = sorted((
        {"item_id": item_id, "item_code": items[item_id].item_code if item_id in items else None,
         "item_name": items[item_id].item_name if item_id in items else None,
         "uom": items[item_id].uom if item_id in items else None,
         "quantity": round(float(qty or 0), 4), "work_orders": wo_count}
        for item_id, qty, wo_count in receipts
    ), key=lambda r: -r["quantity"])

    # Estimated vs actual cost of orders finished in the range.
    start_dt = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc)
    finished = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status.in_(("completed", "closed")),
        ProductionWorkOrder.actual_end_at >= start_dt,
        ProductionWorkOrder.actual_end_at < end_dt,
    ).order_by(ProductionWorkOrder.actual_end_at.desc()).all()
    products = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({o.product_item_id for o in finished})).all()} if finished else {}
    costs = []
    for wo in finished:
        c = work_order_costing(db, wo)
        costs.append({
            "work_order_id": wo.id, "wo_number": wo.wo_number, "status": wo.status,
            "product_name": products[wo.product_item_id].item_name if wo.product_item_id in products else None,
            "quantity_planned": wo.quantity_planned, "quantity_completed": wo.quantity_completed,
            "quantity_scrapped": wo.quantity_scrapped,
            "estimated_total_cost": c["estimated_total_cost"], "actual_total_cost": c["actual_total_cost"],
            "variance": c["variance"], "variance_percent": c["variance_percent"], "cost_per_unit": c["cost_per_unit"],
        })

    # Workstation utilization = hours booked ÷ (capacity/day × working days).
    logs = db.query(ProductionTimeLog).filter(ProductionTimeLog.log_date >= date_from, ProductionTimeLog.log_date <= date_to).all()
    workstations = {w.id: w for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.is_deleted == False).all()}  # noqa: E712
    days = _working_days(date_from, date_to)
    util: dict[int | None, dict] = {}
    for log in logs:
        key = log.workstation_id if log.workstation_id in workstations else None
        ws = workstations.get(key)
        entry = util.setdefault(key, {
            "workstation_id": key, "workstation_name": f"{ws.code} — {ws.name}" if ws else "Unassigned",
            "hours_logged": 0.0, "capacity_hours": round(ws.capacity_hours_per_day * days, 2) if ws else 0.0,
            "qty_good": 0.0, "qty_scrap": 0.0,
        })
        entry["hours_logged"] += log.hours
        entry["qty_good"] += log.qty_good
        entry["qty_scrap"] += log.qty_scrap
    for ws_id, ws in workstations.items():
        if ws.status == "active" and ws_id not in util:
            util[ws_id] = {"workstation_id": ws_id, "workstation_name": f"{ws.code} — {ws.name}", "hours_logged": 0.0,
                           "capacity_hours": round(ws.capacity_hours_per_day * days, 2), "qty_good": 0.0, "qty_scrap": 0.0}
    utilization = []
    for entry in util.values():
        entry["hours_logged"] = round(entry["hours_logged"], 2)
        entry["utilization_percent"] = round(entry["hours_logged"] / entry["capacity_hours"] * 100, 1) if entry["capacity_hours"] else None
        utilization.append(entry)
    utilization.sort(key=lambda e: -e["hours_logged"])

    total_good = sum(log.qty_good for log in logs)
    total_scrap = sum(log.qty_scrap for log in logs)
    return {
        "date_from": date_from, "date_to": date_to,
        "output": output, "costs": costs, "utilization": utilization,
        "total_output": round(sum(r["quantity"] for r in output), 4),
        "total_scrap": round(total_scrap, 4),
        "scrap_rate_percent": round(total_scrap / (total_good + total_scrap) * 100, 1) if (total_good + total_scrap) else None,
    }
