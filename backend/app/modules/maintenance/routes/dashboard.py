from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_any_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.store.models.location import StoreLocation
from app.modules.accounts.models.vendor import Vendor
from app.modules.maintenance.models.asset import (
    MaintenanceAsset, MAINTENANCE_ASSET_CATEGORIES, MAINTENANCE_ASSET_STATUSES, MAINTENANCE_ASSET_CRITICALITIES,
)
from app.modules.maintenance.models.request import MaintenanceRequest, MAINTENANCE_REQUEST_TYPES, MAINTENANCE_PRIORITIES
from app.modules.maintenance.models.work_order import (
    MaintenanceWorkOrder, MAINTENANCE_WO_TYPES, MAINTENANCE_WO_STATUSES, MAINTENANCE_WO_OPEN_STATUSES, MAINTENANCE_FAILURE_CATEGORIES,
)
from app.modules.maintenance.service import now_utc, minutes_between, user_names, _aware

router = APIRouter(prefix="/maintenance", tags=["Maintenance"])


@router.get("/dashboard")
async def maintenance_dashboard(
    branch_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("maintenance")),
    _tab: User = Depends(require_tab_access("maintenance", "dashboard")),
):
    now = now_utc()
    assets_q = db.query(MaintenanceAsset).filter(MaintenanceAsset.is_deleted == False)  # noqa: E712
    if branch_id:
        assets_q = assets_q.filter(MaintenanceAsset.branch_id == branch_id)
    assets = assets_q.all()
    asset_ids = [a.id for a in assets] or [0]
    by_id = {a.id: a for a in assets}

    wos = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.asset_id.in_(asset_ids)).all()
    reqs = db.query(MaintenanceRequest).filter(MaintenanceRequest.asset_id.in_(asset_ids)).all()

    # Machines down right now, with how long they've been down.
    down = []
    for a in assets:
        if a.status not in ("breakdown", "under_maintenance"):
            continue
        starts = [_aware(w.downtime_start) for w in wos if w.asset_id == a.id and w.machine_down and w.downtime_start and w.status in MAINTENANCE_WO_OPEN_STATUSES]
        starts += [_aware(r.reported_at) for r in reqs if r.asset_id == a.id and r.machine_down and r.status in ("open", "acknowledged")]
        since = min(starts) if starts else None
        open_wo = next((w for w in wos if w.asset_id == a.id and w.status in MAINTENANCE_WO_OPEN_STATUSES), None)
        down.append({
            "asset_id": a.id, "asset_code": a.asset_code, "name": a.name, "status": a.status, "criticality": a.criticality,
            "down_since": since, "down_minutes": minutes_between(since, now) if since else None,
            "work_order_id": open_wo.id if open_wo else None, "wo_number": open_wo.wo_number if open_wo else None,
        })
    down.sort(key=lambda d: (d["criticality"], -(d["down_minutes"] or 0)))

    open_requests = sorted([r for r in reqs if r.status == "open"], key=lambda r: _aware(r.reported_at))
    my_wos = [w for w in wos if w.assigned_to_id == user.id and w.status in MAINTENANCE_WO_OPEN_STATUSES]
    awaiting_close = [w for w in wos if w.status == "completed"]

    # Last 30 days of closed/completed breakdown work: downtime and MTTR.
    since_30 = now - timedelta(days=30)
    recent_bd = [
        w for w in wos
        if w.wo_type == "breakdown" and w.status in ("completed", "closed") and w.actual_end and _aware(w.actual_end) >= since_30
    ]
    downtime_30 = sum(w.downtime_minutes or 0 for w in recent_bd)
    cost_30 = round(sum(w.total_cost or 0 for w in wos if w.actual_end and _aware(w.actual_end) >= since_30), 2)

    names = user_names(db, [r.raised_by_id for r in open_requests] + [w.assigned_to_id for w in my_wos])
    return {
        "counts": {
            "assets": len(assets),
            "down": len(down),
            "open_requests": len(open_requests),
            "open_work_orders": sum(1 for w in wos if w.status in MAINTENANCE_WO_OPEN_STATUSES),
            "awaiting_close": len(awaiting_close),
            "my_work_orders": len(my_wos),
        },
        "last_30_days": {
            "breakdowns": len(recent_bd),
            "downtime_minutes": downtime_30,
            "mttr_minutes": round(downtime_30 / len(recent_bd)) if recent_bd else None,
            "maintenance_cost": cost_30,
        },
        "machines_down": down,
        "open_requests": [
            {
                "id": r.id, "request_number": r.request_number, "asset_code": by_id[r.asset_id].asset_code,
                "asset_name": by_id[r.asset_id].name, "priority": r.priority, "machine_down": r.machine_down,
                "reported_at": r.reported_at, "raised_by_name": names.get(r.raised_by_id),
                "problem_description": r.problem_description[:160],
            } for r in open_requests[:10]
        ],
        "my_work_orders": [
            {
                "id": w.id, "wo_number": w.wo_number, "title": w.title, "status": w.status, "priority": w.priority,
                "asset_code": by_id[w.asset_id].asset_code, "planned_start": w.planned_start,
            } for w in sorted(my_wos, key=lambda w: MAINTENANCE_PRIORITIES.index(w.priority) if w.priority in MAINTENANCE_PRIORITIES else 0, reverse=True)[:10]
        ],
        "awaiting_close": [
            {"id": w.id, "wo_number": w.wo_number, "title": w.title, "asset_code": by_id[w.asset_id].asset_code,
             "awaiting_confirmation": bool(w.request_id and not w.requester_confirmed_at)}
            for w in awaiting_close[:10]
        ],
    }


@router.get("/lookups")
async def maintenance_lookups(
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("maintenance", "production")),
):
    """Enums + picker lists. Readable by requesters too (for the raise form)."""
    technicians = [u for u in db.query(User).filter(User.is_active == True).order_by(User.name).all() if "maintenance" in u.get_apps() and u.role != "admin"]  # noqa: E712
    from app.modules.organization.models.department import Department

    workstations = []
    try:
        from app.modules.production.models.workstation import ProductionWorkstation
    except Exception:  # pragma: no cover — Production module absent
        ProductionWorkstation = None
    if ProductionWorkstation is not None:
        linked = dict(db.query(MaintenanceAsset.workstation_id, MaintenanceAsset.id).filter(
            MaintenanceAsset.workstation_id.isnot(None), MaintenanceAsset.is_deleted == False,  # noqa: E712
        ).all())
        workstations = [
            {"id": w.id, "code": w.code, "name": w.name, "branch_id": w.branch_id, "status": w.status, "linked_asset_id": linked.get(w.id)}
            for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.is_deleted == False).order_by(ProductionWorkstation.code).all()  # noqa: E712
        ]
    return {
        "departments": [{"id": d.id, "name": d.name, "branch_id": d.branch_id} for d in db.query(Department).order_by(Department.name).all()],
        "workstations": workstations,
        "asset_categories": list(MAINTENANCE_ASSET_CATEGORIES),
        "asset_statuses": list(MAINTENANCE_ASSET_STATUSES),
        "criticalities": list(MAINTENANCE_ASSET_CRITICALITIES),
        "request_types": list(MAINTENANCE_REQUEST_TYPES),
        "priorities": list(MAINTENANCE_PRIORITIES),
        "wo_types": list(MAINTENANCE_WO_TYPES),
        "wo_statuses": list(MAINTENANCE_WO_STATUSES),
        "failure_categories": list(MAINTENANCE_FAILURE_CATEGORIES),
        "branches": [{"id": b.id, "name": b.name} for b in db.query(Branch).order_by(Branch.name).all()],
        "technicians": [{"id": u.id, "name": u.name or u.email, "email": u.email} for u in technicians],
        "store_locations": [
            {"id": l.id, "name": l.name, "branch_id": l.branch_id}
            for l in db.query(StoreLocation).filter(StoreLocation.is_active == True).order_by(StoreLocation.name).all()  # noqa: E712
        ],
        "vendors": [{"id": v.id, "name": v.name} for v in db.query(Vendor).order_by(Vendor.name).all()],
    }


@router.get("/lookups/assets")
async def lookup_assets(
    search: str | None = None,
    branch_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("maintenance", "production")),
):
    """Asset picker for the request form — requesters don't have the assets tab."""
    q = db.query(MaintenanceAsset).filter(MaintenanceAsset.is_deleted == False, MaintenanceAsset.status != "decommissioned")  # noqa: E712
    if branch_id:
        q = q.filter(MaintenanceAsset.branch_id == branch_id)
    if search:
        like = f"%{search}%"
        q = q.filter((MaintenanceAsset.asset_code.ilike(like)) | (MaintenanceAsset.name.ilike(like)) | (MaintenanceAsset.location_text.ilike(like)))
    return [
        {"id": a.id, "asset_code": a.asset_code, "name": a.name, "criticality": a.criticality, "status": a.status,
         "branch_id": a.branch_id, "location_text": a.location_text}
        for a in q.order_by(MaintenanceAsset.asset_code).limit(100).all()
    ]


@router.get("/lookups/store-items")
async def lookup_store_items(
    search: str | None = None,
    location_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("maintenance")),
):
    """Spare-part picker for work orders (maintenance users usually don't hold
    the store app). Spare parts first, then everything else that matches."""
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.stock_balance import StoreStockBalance

    q = db.query(StoreItem)
    if search:
        like = f"%{search}%"
        q = q.filter((StoreItem.item_name.ilike(like)) | (StoreItem.item_code.ilike(like)) | (StoreItem.part_number.ilike(like)))
    items = q.limit(200).all()
    items.sort(key=lambda i: (i.item_type != "material", i.item_name))
    items = items[:50]
    avail = {}
    if location_id and items:
        for b in db.query(StoreStockBalance).filter(StoreStockBalance.location_id == location_id, StoreStockBalance.item_id.in_([i.id for i in items])).all():
            avail[b.item_id] = round(b.on_hand_qty - b.reserved_qty, 4)
    return [
        {"id": i.id, "item_code": i.item_code, "item_name": i.item_name, "uom": i.uom, "item_type": i.item_type,
         "available_qty": avail.get(i.id, 0.0) if location_id else None}
        for i in items
    ]
