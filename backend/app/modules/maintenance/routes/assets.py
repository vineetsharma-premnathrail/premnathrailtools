from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
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
from app.modules.maintenance.service import suggest_asset_code, sync_asset_status

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


def _get_or_404(db: Session, asset_id: int) -> MaintenanceAsset:
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == asset_id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
    if not asset:
        raise HTTPException(status_code=404, detail=f"Asset #{asset_id} not found (it may have been deleted).")
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


@router.get("", response_model=list[MaintenanceAssetResponse])
async def list_assets(
    branch_id: int | None = None,
    category: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    criticality: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("maintenance", "assets")),
):
    query = db.query(MaintenanceAsset).filter(MaintenanceAsset.is_deleted == False)  # noqa: E712
    if branch_id:
        query = query.filter(MaintenanceAsset.branch_id == branch_id)
    if category:
        query = query.filter(MaintenanceAsset.category == category)
    if status_filter:
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
async def get_asset(asset_id: int, db: Session = Depends(get_db)):
    return _to_response(db, _get_or_404(db, asset_id))


@router.patch("/{asset_id}", response_model=MaintenanceAssetResponse)
async def update_asset(
    asset_id: int,
    payload: MaintenanceAssetUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "assets", "edit")),
):
    asset = _get_or_404(db, asset_id)
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
        if new_status == "decommissioned" and not asset.decommissioned_on:
            asset.decommissioned_on = datetime.now(timezone.utc).date()
    if "current_meter_reading" in data and data["current_meter_reading"] != asset.current_meter_reading:
        asset.meter_updated_at = datetime.now(timezone.utc)
    old_ws = asset.workstation_id
    for field, val in data.items():
        setattr(asset, field, val)
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
    _user: User = Depends(require_tab_action("maintenance", "assets", "delete")),
):
    asset = _get_or_404(db, asset_id)
    wo_count = db.query(MaintenanceWorkOrder.id).filter(MaintenanceWorkOrder.asset_id == asset.id).count()
    req_count = db.query(MaintenanceRequest.id).filter(MaintenanceRequest.asset_id == asset.id).count()
    if wo_count or req_count:
        raise HTTPException(
            status_code=400,
            detail=f"Can't delete {asset.asset_code}: it has maintenance history ({req_count} request(s), {wo_count} work order(s)). Set its status to Decommissioned instead.",
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
async def asset_history(asset_id: int, db: Session = Depends(get_db)):
    asset = _get_or_404(db, asset_id)
    entries = [
        MaintenanceAssetHistoryEntry(
            kind="request", id=r.id, number=r.request_number, title=r.problem_description[:120],
            status=r.status, date=r.reported_at,
        )
        for r in db.query(MaintenanceRequest).filter(MaintenanceRequest.asset_id == asset.id).all()
    ] + [
        MaintenanceAssetHistoryEntry(
            kind="work_order", id=w.id, number=w.wo_number, title=w.title, status=w.status,
            date=w.actual_start or w.created_at, downtime_minutes=w.downtime_minutes, total_cost=w.total_cost,
        )
        for w in db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.asset_id == asset.id).all()
    ]
    entries.sort(key=lambda e: (e.date.replace(tzinfo=timezone.utc) if e.date and e.date.tzinfo is None else e.date) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return entries
