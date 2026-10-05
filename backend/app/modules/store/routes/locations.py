from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.location import StoreLocation
from app.modules.store.schemas.location import StoreLocationCreate, StoreLocationUpdate, StoreLocationResponse

router = APIRouter(prefix="/store/locations", tags=["Store"])


def _to_response(location: StoreLocation, db: Session) -> StoreLocationResponse:
    branch_name = None
    if location.branch_id:
        from app.modules.organization.models.branch import Branch  # local import avoids a cross-module cycle at startup
        branch = db.query(Branch).filter(Branch.id == location.branch_id).first()
        branch_name = branch.name if branch else None
    manager = db.query(User).filter(User.id == location.manager_user_id).first() if location.manager_user_id else None
    return StoreLocationResponse.model_validate(location).model_copy(
        update={"branch_name": branch_name, "manager_user_name": manager.name if manager else None}
    )


@router.get("", response_model=list[StoreLocationResponse])
async def list_locations(
    branch_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreLocation)
    if branch_id is not None:
        query = query.filter(StoreLocation.branch_id == branch_id)
    locations = query.order_by(StoreLocation.name.asc()).all()
    return [_to_response(loc, db) for loc in locations]


@router.post("", response_model=StoreLocationResponse)
async def create_location(
    payload: StoreLocationCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    if db.query(StoreLocation).filter(StoreLocation.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Location code '{payload.code}' already exists")
    location = StoreLocation(**payload.model_dump())
    db.add(location)
    db.commit()
    db.refresh(location)
    return _to_response(location, db)


@router.patch("/{location_id}", response_model=StoreLocationResponse)
async def update_location(
    location_id: int,
    payload: StoreLocationUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    location = db.query(StoreLocation).filter(StoreLocation.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(location, field, val)
    db.commit()
    db.refresh(location)
    return _to_response(location, db)


@router.delete("/{location_id}")
async def delete_location(
    location_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    location = db.query(StoreLocation).filter(StoreLocation.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    # Local imports avoid cross-module cycles at startup.
    from app.modules.organization.models.branch import Branch
    from app.modules.organization.models.company import Company
    from app.modules.store.models.bin import StoreBin
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.stock_balance import StoreStockBalance
    from app.modules.store.models.stock_transaction import StoreStockTransaction
    from app.modules.store.models.material_issue import StoreMaterialIssue
    from app.modules.store.models.material_return import StoreMaterialReturn
    from app.modules.store.models.stock_adjustment import StoreStockAdjustment
    from app.modules.store.models.stock_transfer import StoreStockTransfer
    from app.modules.store.models.stock_reservation import StoreStockReservation
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem
    from app.modules.maintenance.models.work_order import MaintenanceWorkOrderSpare
    from app.modules.production.models.work_order import ProductionWorkOrder
    from app.modules.hydraulic.models.maintenance import HydServicePart

    # Stock history must stay traceable to its store — block the delete and
    # say exactly what is holding it, so the user can mark it inactive instead.
    used_by = [
        (StoreStockTransaction, [StoreStockTransaction.location_id], "stock movements"),
        (StoreMaterialIssue, [StoreMaterialIssue.location_id], "material issues"),
        (StoreMaterialReturn, [StoreMaterialReturn.location_id], "material returns"),
        (StoreStockAdjustment, [StoreStockAdjustment.location_id], "stock adjustments"),
        (StoreStockTransfer, [StoreStockTransfer.from_location_id, StoreStockTransfer.to_location_id], "stock transfers"),
        (StoreStockReservation, [StoreStockReservation.location_id], "stock reservations"),
        (P2PGoodsReceipt, [P2PGoodsReceipt.store_location_id], "goods receipts (GRN)"),
        (P2PRequestItem, [P2PRequestItem.issued_from_location_id], "purchase requisition lines"),
        (MaintenanceWorkOrderSpare, [MaintenanceWorkOrderSpare.location_id], "maintenance work order spares"),
        (ProductionWorkOrder, [ProductionWorkOrder.source_location_id, ProductionWorkOrder.target_location_id], "production work orders"),
        (HydServicePart, [HydServicePart.issued_location_id], "hydraulic service parts"),
    ]
    blockers = []
    for model, cols, label in used_by:
        n = sum(db.query(model).filter(c == location_id).count() for c in cols)
        if n:
            blockers.append(f"{n} {label}")
    if blockers:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete '{location.name}' — it has {', '.join(blockers)} recorded against it. "
                   "Edit the store and set its status to Inactive instead, so its history stays intact.",
        )

    # Plain links (defaults, preferences, empty balances, bins) are cleared,
    # not blocking — the store is no longer tied to any branch or company.
    db.query(Branch).filter(Branch.default_warehouse_id == location_id).update({Branch.default_warehouse_id: None})
    db.query(Company).filter(Company.default_warehouse_id == location_id).update({Company.default_warehouse_id: None})
    db.query(StoreItem).filter(StoreItem.preferred_warehouse_id == location_id).update({StoreItem.preferred_warehouse_id: None})
    db.query(StoreStockBalance).filter(StoreStockBalance.location_id == location_id).delete()
    db.query(StoreBin).filter(StoreBin.location_id == location_id).delete()
    db.delete(location)
    db.commit()
    return {"ok": True}
