from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import (
    ensure_can_delete, ensure_feature_action, require_app_access, require_feature_action, require_tab_access, require_tab_action,
)
from app.modules.maintenance.sensitive import sees_costs
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.accounts.models.vendor import Vendor
from app.modules.maintenance.models.asset import (
    MaintenanceAsset, MAINTENANCE_ASSET_CATEGORIES, MAINTENANCE_ASSET_CRITICALITIES, MAINTENANCE_ASSET_MANUAL_STATUSES,
)
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder, MAINTENANCE_WO_OPEN_STATUSES
from app.modules.maintenance.schemas.asset import (
    MaintenanceAssetCreate, MaintenanceAssetUpdate, MaintenanceAssetResponse, MaintenanceAssetHistoryEntry,
)
from app.modules.maintenance.service import suggest_asset_code, sync_asset_status, retire_asset_pm
from app.modules.maintenance import access  # noqa: F401 — registers the maintenance data scopes

router = APIRouter(
    prefix="/maintenance/assets", tags=["Maintenance"],
    dependencies=[Depends(require_app_access("maintenance"))],
)


def _workstation(db: Session, workstation_id: int | None):
    if not workstation_id:
        return None
    try:
        from app.modules.production.models.workstation import ProductionWorkstation
    except Exception:  # pragma: no cover
        return None
    return db.query(ProductionWorkstation).filter(ProductionWorkstation.id == workstation_id).first()


def _to_response(db: Session, asset: MaintenanceAsset) -> MaintenanceAssetResponse:
    resp = MaintenanceAssetResponse.model_validate(asset)
    branch = db.query(Branch.name).filter(Branch.id == asset.branch_id).first()
    resp.branch_name = branch[0] if branch else None
    if asset.department_id:
        dept = db.query(Department.name).filter(Department.id == asset.department_id).first()
        resp.department_name = dept[0] if dept else None
    if asset.parent_asset_id:
        parent = db.query(MaintenanceAsset.asset_code).filter(MaintenanceAsset.id == asset.parent_asset_id).first()
        resp.parent_asset_code = parent[0] if parent else None
    ws = _workstation(db, asset.workstation_id)
    if ws:
        resp.workstation_code = ws.code
        resp.workstation_status = ws.status
    vendor_ids = [v for v in (asset.supplier_vendor_id, asset.amc_vendor_id) if v]
    if vendor_ids:
        names = dict(db.query(Vendor.id, Vendor.name).filter(Vendor.id.in_(vendor_ids)).all())
        resp.supplier_vendor_name = names.get(asset.supplier_vendor_id)
        resp.amc_vendor_name = names.get(asset.amc_vendor_id)
    open_wos = db.query(MaintenanceWorkOrder).filter(
        MaintenanceWorkOrder.asset_id == asset.id, MaintenanceWorkOrder.status.in_(MAINTENANCE_WO_OPEN_STATUSES),
    ).all()
    resp.open_work_orders = len(open_wos)
    if asset.status in ("breakdown", "under_maintenance"):
        starts = [wo.downtime_start for wo in open_wos if wo.machine_down and wo.downtime_start]
        starts += [r.reported_at for r in db.query(MaintenanceRequest).filter(
            MaintenanceRequest.asset_id == asset.id, MaintenanceRequest.machine_down == True,  # noqa: E712
            MaintenanceRequest.status.in_(("open", "acknowledged")),
        ).all()]
        resp.down_since = min(starts) if starts else None
    return resp


def _get_or_404(db: Session, asset_id: int, user: User | None = None) -> MaintenanceAsset:
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == asset_id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
    if not asset:
        raise HTTPException(status_code=404, detail=f"Asset #{asset_id} not found (it may have been deleted).")
    if user is not None:
        ensure_in_scope(db, user, asset)  # 403 when outside the user's Maintenance data scope
    return asset


def _validate(db: Session, data: dict, asset: MaintenanceAsset | None = None) -> None:
    if "category" in data and data["category"] and data["category"] not in MAINTENANCE_ASSET_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category '{data['category']}'. Valid: {', '.join(MAINTENANCE_ASSET_CATEGORIES)}.")
    if "criticality" in data and data["criticality"] and data["criticality"] not in MAINTENANCE_ASSET_CRITICALITIES:
        raise HTTPException(status_code=400, detail="Criticality must be A (line stops if it fails), B or C.")
    if data.get("branch_id") and not db.query(Branch.id).filter(Branch.id == data["branch_id"]).first():
        raise HTTPException(status_code=404, detail=f"Plant #{data['branch_id']} not found — pick the plant again.")
    if data.get("department_id") and not db.query(Department.id).filter(Department.id == data["department_id"]).first():
        raise HTTPException(status_code=404, detail=f"Department #{data['department_id']} not found — pick it again.")
    for key, label in (("supplier_vendor_id", "Supplier"), ("amc_vendor_id", "AMC vendor")):
        if data.get(key) and not db.query(Vendor.id).filter(Vendor.id == data[key]).first():
            raise HTTPException(status_code=404, detail=f"{label} vendor #{data[key]} not found in the vendor master.")
    parent_id = data.get("parent_asset_id")
    if parent_id:
        if asset and parent_id == asset.id:
            raise HTTPException(status_code=400, detail="An asset can't be its own parent.")
        if not db.query(MaintenanceAsset.id).filter(MaintenanceAsset.id == parent_id, MaintenanceAsset.is_deleted == False).first():  # noqa: E712
            raise HTTPException(status_code=404, detail=f"Parent asset #{parent_id} not found.")
    ws_id = data.get("workstation_id")
    if ws_id:
        if not _workstation(db, ws_id):
            raise HTTPException(status_code=404, detail=f"Production workstation #{ws_id} not found — pick it again.")
        other = db.query(MaintenanceAsset).filter(
            MaintenanceAsset.workstation_id == ws_id, MaintenanceAsset.is_deleted == False,  # noqa: E712
            MaintenanceAsset.id != (asset.id if asset else 0),
        ).first()
        if other:
            raise HTTPException(status_code=409, detail=f"That workstation is already linked to asset {other.asset_code}. Unlink it there first.")
    year = data.get("year_of_manufacture")
    if year and not (1900 <= year <= datetime.now().year + 1):
        raise HTTPException(status_code=400, detail=f"Year of manufacture {year} doesn't look right.")
    for key in ("purchase_cost", "current_meter_reading"):
        if data.get(key) is not None and data[key] < 0:
            raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} can't be negative.")


# ── Excel import (Phase 2) — registered before /{asset_id} so the path isn't read as an id ──

@router.get("/import-template")
async def asset_import_template(
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("maintenance", "assets")),
):
    from fastapi.responses import Response
    from app.modules.maintenance.asset_import import build_template

    return Response(
        content=build_template(db),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="maintenance_asset_import_template.xlsx"'},
    )


@router.post("/import")
async def import_assets(
    file: UploadFile = File(...),
    dry_run: bool = Query(True),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "assets", "import")),
):
    """dry_run=true: validate every row, write nothing. dry_run=false: import
    all rows in one transaction, or nothing if any row has an error."""
    from app.modules.maintenance.asset_import import run_import

    return run_import(db, file.filename or "", await file.read(), dry_run, user.id)


@router.get("", response_model=list[MaintenanceAssetResponse])
async def list_assets(
    branch_id: int | None = None,
    category: str | None = None,
    status_filter: str | None = Query(None, alias="status", description="An asset status, or 'down' = breakdown + under maintenance"),
    criticality: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("maintenance", "assets")),
):
    query = apply_scope(db.query(MaintenanceAsset).filter(MaintenanceAsset.is_deleted == False), user, MaintenanceAsset)  # noqa: E712
    if branch_id:
        query = query.filter(MaintenanceAsset.branch_id == branch_id)
    if category:
        query = query.filter(MaintenanceAsset.category == category)
    if status_filter == "down":
        # "Machines Down" (dashboard tile): broken down or being repaired.
        query = query.filter(MaintenanceAsset.status.in_(("breakdown", "under_maintenance")))
    elif status_filter:
        query = query.filter(MaintenanceAsset.status == status_filter)
    if criticality:
        query = query.filter(MaintenanceAsset.criticality == criticality)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (MaintenanceAsset.asset_code.ilike(like)) | (MaintenanceAsset.name.ilike(like))
            | (MaintenanceAsset.serial_number.ilike(like)) | (MaintenanceAsset.location_text.ilike(like))
        )
    return [_to_response(db, a) for a in query.order_by(MaintenanceAsset.asset_code).all()]


@router.post("", response_model=MaintenanceAssetResponse)
async def create_asset(
    payload: MaintenanceAssetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "assets", "create")),
):
    data = payload.model_dump()
    if not data["name"].strip():
        raise HTTPException(status_code=400, detail="Asset name is required.")
    _validate(db, data)
    code = (data.pop("asset_code") or "").strip().upper() or suggest_asset_code(db)
    if db.query(MaintenanceAsset.id).filter(MaintenanceAsset.asset_code == code).first():
        raise HTTPException(status_code=409, detail=f"Asset code {code} is already used. Use the plant's machine number or leave it blank to auto-number.")
    asset = MaintenanceAsset(**data, asset_code=code, status="operational", created_by_id=user.id)
    asset.name = asset.name.strip()
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _to_response(db, asset)


@router.get("/{asset_id}", response_model=MaintenanceAssetResponse)
async def get_asset(asset_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("maintenance"))):
    return _to_response(db, _get_or_404(db, asset_id, user))


@router.patch("/{asset_id}", response_model=MaintenanceAssetResponse)
async def update_asset(
    asset_id: int,
    payload: MaintenanceAssetUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "assets", "edit")),
):
    asset = _get_or_404(db, asset_id, user)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and not (data["name"] or "").strip():
        raise HTTPException(status_code=400, detail="Asset name can't be empty.")
    if "branch_id" in data and not data["branch_id"]:
        raise HTTPException(status_code=400, detail="Plant is required.")
    _validate(db, data, asset)
    if "asset_code" in data:
        code = (data["asset_code"] or "").strip().upper()
        if not code:
            raise HTTPException(status_code=400, detail="Asset code can't be empty.")
        if db.query(MaintenanceAsset.id).filter(MaintenanceAsset.asset_code == code, MaintenanceAsset.id != asset.id).first():
            raise HTTPException(status_code=409, detail=f"Asset code {code} is already used by another asset.")
        data["asset_code"] = code

    new_status = data.pop("status", None)
    if new_status and new_status != asset.status:
        if new_status not in MAINTENANCE_ASSET_MANUAL_STATUSES:
            raise HTTPException(
                status_code=400,
                detail="Breakdown and Under Maintenance are set automatically by requests and work orders. You can only set Operational, Standby or Decommissioned by hand.",
            )
        if asset.status in ("breakdown", "under_maintenance"):
            raise HTTPException(
                status_code=409,
                detail=f"{asset.asset_code} is currently {asset.status.replace('_', ' ')} — close or cancel its open work orders / requests first.",
            )
        asset.status = new_status
        if new_status == "decommissioned":
            if not asset.decommissioned_on:
                asset.decommissioned_on = datetime.now(timezone.utc).date()
            # A retired machine stops generating PM jobs and reminders.
            try:
                retire_asset_pm(db, asset)
            except ValueError as exc:
                db.rollback()
                raise HTTPException(status_code=409, detail=str(exc))
    # A changed counter is booked as a measuring document (history, no
    # backwards counter, counter-based PM) — see maintenance/counters.py.
    new_reading = None
    if "current_meter_reading" in data and data["current_meter_reading"] != asset.current_meter_reading:
        new_reading = data.pop("current_meter_reading")
    else:
        data.pop("current_meter_reading", None)
    old_ws = asset.workstation_id
    for field, val in data.items():
        setattr(asset, field, val)
    if new_reading is not None and asset.meter_unit:
        from app.modules.maintenance.counters import post_reading
        post_reading(db, asset, new_reading, user, source="manual", remarks="Entered on the asset form")
    elif new_reading is not None or ("current_meter_reading" in payload.model_fields_set and payload.current_meter_reading is None):
        asset.current_meter_reading = new_reading
        asset.meter_updated_at = datetime.now(timezone.utc)
    if "workstation_id" in data and old_ws and old_ws != asset.workstation_id:
        from app.modules.maintenance.service import _sync_workstation
        _sync_workstation(db, old_ws, down=False)  # release the old workstation
    sync_asset_status(db, asset)
    db.commit()
    db.refresh(asset)
    return _to_response(db, asset)


@router.delete("/{asset_id}")
async def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "assets", "delete")),
):
    asset = _get_or_404(db, asset_id, user)
    ensure_can_delete(user, asset, "maintenance", "assets", what="asset")
    wo_count = db.query(MaintenanceWorkOrder.id).filter(MaintenanceWorkOrder.asset_id == asset.id).count()
    req_count = db.query(MaintenanceRequest.id).filter(MaintenanceRequest.asset_id == asset.id).count()
    if wo_count or req_count:
        raise HTTPException(
            status_code=400,
            detail=f"Can't delete {asset.asset_code}: it has maintenance history ({req_count} request(s), {wo_count} work order(s)). Set its status to Decommissioned instead.",
        )
    from app.modules.maintenance.models.pm_plan import MaintenancePmPlan
    plan = db.query(MaintenancePmPlan.plan_code).filter(
        MaintenancePmPlan.asset_id == asset.id, MaintenancePmPlan.is_deleted == False,  # noqa: E712
        MaintenancePmPlan.is_active == True,  # noqa: E712 — an inactive plan can't raise jobs (and can't be re-activated on a deleted asset)
    ).order_by(MaintenancePmPlan.id).first()
    if plan:
        raise HTTPException(
            status_code=409,
            detail=f"Can't delete {asset.asset_code}: PM plan {plan[0]} is attached — deactivate or delete the plan first, or decommission the asset instead.",
        )
    child = db.query(MaintenanceAsset.asset_code).filter(MaintenanceAsset.parent_asset_id == asset.id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
    if child:
        raise HTTPException(status_code=400, detail=f"Can't delete {asset.asset_code}: sub-asset {child[0]} belongs to it. Move or delete the sub-assets first.")
    if asset.workstation_id:
        from app.modules.maintenance.service import _sync_workstation
        _sync_workstation(db, asset.workstation_id, down=False)
    asset.is_deleted = True
    asset.deleted_at = datetime.now(timezone.utc)
    asset.workstation_id = None
    db.commit()
    return {"message": f"{asset.asset_code} deleted"}


@router.get("/{asset_id}/history", response_model=list[MaintenanceAssetHistoryEntry])
async def asset_history(asset_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("maintenance"))):
    ensure_feature_action(user, "maintenance", "assets", "history", "view")
    asset = _get_or_404(db, asset_id, user)
    show_cost = sees_costs(user)  # maintenance:work_orders.costs:view
    entries = [
        MaintenanceAssetHistoryEntry(
            kind="request", id=r.id, number=r.request_number, title=r.problem_description[:120],
            status=r.status, date=r.reported_at,
        )
        for r in apply_scope(db.query(MaintenanceRequest).filter(MaintenanceRequest.asset_id == asset.id), user, MaintenanceRequest).all()
    ] + [
        MaintenanceAssetHistoryEntry(
            kind="work_order", id=w.id, number=w.wo_number, title=w.title, status=w.status,
            date=w.actual_start or w.created_at, downtime_minutes=w.downtime_minutes, total_cost=w.total_cost if show_cost else None,
        )
        for w in apply_scope(db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.asset_id == asset.id), user, MaintenanceWorkOrder).all()
    ]
    entries.sort(key=lambda e: (e.date.replace(tzinfo=timezone.utc) if e.date and e.date.tzinfo is None else e.date) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return entries


# ---------------------------------------------------------------------------
# Bill of spares — which Store items this asset consumes. Stock figures are
# read from the Store (balances), never stored here.
# ---------------------------------------------------------------------------

from app.modules.maintenance.schemas.spare import MaintenanceAssetSparesUpdate  # noqa: E402

def _asset_spares_response(db: Session, asset_id: int):
    from app.modules.maintenance.models.asset import MaintenanceAssetSpare
    from app.modules.maintenance.schemas.spare import MaintenanceAssetSpareResponse
    from app.modules.maintenance.service import on_hand_totals, is_below_min
    from app.modules.store.models.item import StoreItem

    lines = db.query(MaintenanceAssetSpare).filter(MaintenanceAssetSpare.asset_id == asset_id).order_by(MaintenanceAssetSpare.id).all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([l.store_item_id for l in lines] or [0])).all()}
    totals = on_hand_totals(db, items.keys())
    out = []
    for line in lines:
        resp = MaintenanceAssetSpareResponse.model_validate(line)
        item = items.get(line.store_item_id)
        if item:
            total = totals.get(item.id, 0.0)
            resp.item_code, resp.item_name, resp.uom, resp.item_type = item.item_code, item.item_name, item.uom, item.item_type
            resp.on_hand_total = total
            resp.minimum_stock, resp.reorder_level, resp.reorder_quantity = item.minimum_stock, item.reorder_level, item.reorder_quantity
            resp.below_min = is_below_min(item, total)
        out.append(resp)
    return out


@router.get("/{asset_id}/spares")
async def get_asset_spares(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("maintenance", "assets", "spare_parts", "view")),
):
    _get_or_404(db, asset_id, user)
    return _asset_spares_response(db, asset_id)


@router.put("/{asset_id}/spares")
async def put_asset_spares(
    asset_id: int,
    payload: MaintenanceAssetSparesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("maintenance", "assets", "spare_parts", "edit")),
):
    """Replaces the whole bill of spares for the asset."""
    from app.modules.maintenance.models.asset import MaintenanceAssetSpare
    from app.modules.store.models.item import StoreItem

    asset = _get_or_404(db, asset_id, user)
    wanted = [l.store_item_id for l in payload.lines]
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(wanted or [0])).all()}
    seen: set[int] = set()
    for n, line in enumerate(payload.lines, start=1):
        item = items.get(line.store_item_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"Line {n}: Store item #{line.store_item_id} not found — pick the spare again.")
        if line.store_item_id in seen:
            raise HTTPException(status_code=400, detail=f"'{item.item_name}' ({item.item_code}) is listed twice on {asset.asset_code}'s bill of spares. Keep one line and set its quantity.")
        seen.add(line.store_item_id)
        if line.qty_per_replacement is None or line.qty_per_replacement <= 0:
            raise HTTPException(status_code=400, detail=f"Line {n} ('{item.item_name}'): quantity per replacement must be greater than 0.")

    existing = {l.store_item_id: l for l in db.query(MaintenanceAssetSpare).filter(MaintenanceAssetSpare.asset_id == asset.id).all()}
    for item_id, row in existing.items():
        if item_id not in seen:
            db.delete(row)
    for line in payload.lines:
        row = existing.get(line.store_item_id)
        remarks = (line.remarks or "").strip() or None
        if row:  # keep the row (and its audit history) — just update it
            row.qty_per_replacement, row.is_critical, row.remarks = line.qty_per_replacement, line.is_critical, remarks
        else:
            db.add(MaintenanceAssetSpare(
                asset_id=asset.id, store_item_id=line.store_item_id, qty_per_replacement=line.qty_per_replacement,
                is_critical=line.is_critical, remarks=remarks,
            ))
    db.commit()
    return _asset_spares_response(db, asset.id)

