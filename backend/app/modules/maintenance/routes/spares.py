"""Spares page — read-only over the Store. Maintenance owns no stock: the
item master, stock balances and the ledger are the Store's; this router only
joins them with the assets' bills of spares."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.maintenance.models.asset import MaintenanceAsset, MaintenanceAssetSpare
from app.modules.maintenance.schemas.spare import (
    MaintenanceSpareResponse, MaintenanceSpareLocationStock, MaintenanceSpareAssetRef,
)
from app.modules.maintenance.service import is_below_min, suggested_order_qty

router = APIRouter(
    prefix="/maintenance", tags=["Maintenance"],
    dependencies=[Depends(require_app_access("maintenance"))],
)

SPARE_ITEM_TYPE = "spare_part"
CONSUMPTION_DAYS = 90


@router.get("/spares", response_model=list[MaintenanceSpareResponse])
async def list_spares(
    branch_id: int | None = None,
    location_id: int | None = None,
    search: str | None = None,
    below_min_only: bool = False,
    critical_only: bool = False,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("maintenance", "spares")),
):
    """Every Store item that is a spare part or sits on any asset's bill of
    spares, with on-hand per location (FREE stock), the Store minimum /
    reorder level, which assets use it and the last-90-days maintenance
    consumption (issues minus returns on the Store ledger)."""
    bos_rows = (
        db.query(MaintenanceAssetSpare, MaintenanceAsset)
        .join(MaintenanceAsset, MaintenanceAsset.id == MaintenanceAssetSpare.asset_id)
        .filter(MaintenanceAsset.is_deleted == False)  # noqa: E712
        .all()
    )
    bos_item_ids = {s.store_item_id for s, _a in bos_rows}

    q = db.query(StoreItem).filter((StoreItem.item_type == SPARE_ITEM_TYPE) | (StoreItem.id.in_(bos_item_ids or [0])))
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(
            StoreItem.item_name.ilike(like) | StoreItem.item_code.ilike(like)
            | StoreItem.part_number.ilike(like) | StoreItem.manufacturer_part_number.ilike(like)
        )
    items = q.order_by(StoreItem.item_name).all()
    if not items:
        return []
    item_ids = [i.id for i in items]

    # Stock per location — the Store's balances, never a copy.
    locations = {l.id: l for l in db.query(StoreLocation).all()}
    per_item_locs: dict[int, list[MaintenanceSpareLocationStock]] = {}
    totals: dict[int, float] = {}
    for b in db.query(StoreStockBalance).filter(StoreStockBalance.item_id.in_(item_ids)).all():
        totals[b.item_id] = totals.get(b.item_id, 0.0) + (b.on_hand_qty or 0.0)
        loc = locations.get(b.location_id)
        if not loc:
            continue
        if location_id and loc.id != location_id:
            continue
        if branch_id and loc.branch_id != branch_id:
            continue
        if not (b.on_hand_qty or b.reserved_qty):
            continue
        per_item_locs.setdefault(b.item_id, []).append(MaintenanceSpareLocationStock(
            location_id=loc.id, location_name=loc.name, branch_id=loc.branch_id,
            on_hand=round(b.on_hand_qty or 0.0, 4), reserved=round(b.reserved_qty or 0.0, 4),
        ))

    # Last-90-days maintenance consumption from the Store ledger.
    since = date.today() - timedelta(days=CONSUMPTION_DAYS)
    consumed: dict[int, float] = {}
    for item_id, txn_type, qty in (
        db.query(StoreStockTransaction.item_id, StoreStockTransaction.transaction_type, func.sum(StoreStockTransaction.quantity))
        .filter(
            StoreStockTransaction.item_id.in_(item_ids),
            StoreStockTransaction.reference_type == "maintenance_work_order",
            StoreStockTransaction.transaction_type.in_(("issue", "return_in")),
            StoreStockTransaction.transaction_date >= since,
        )
        .group_by(StoreStockTransaction.item_id, StoreStockTransaction.transaction_type)
        .all()
    ):
        consumed[item_id] = consumed.get(item_id, 0.0) + (qty or 0.0) * (1 if txn_type == "issue" else -1)

    assets_by_item: dict[int, list[MaintenanceSpareAssetRef]] = {}
    for spare, asset in bos_rows:
        assets_by_item.setdefault(spare.store_item_id, []).append(MaintenanceSpareAssetRef(
            asset_id=asset.id, asset_code=asset.asset_code, asset_name=asset.name, branch_id=asset.branch_id,
            qty_per_replacement=spare.qty_per_replacement, is_critical=spare.is_critical,
        ))

    out: list[MaintenanceSpareResponse] = []
    for item in items:
        locs = sorted(per_item_locs.get(item.id, []), key=lambda l: l.location_name)
        assets = sorted(assets_by_item.get(item.id, []), key=lambda a: a.asset_code)
        if branch_id or location_id:
            # Plant / store scope: keep items stocked there or used by that plant's assets.
            used_here = branch_id and any(a.branch_id == branch_id for a in assets)
            if not locs and not used_here:
                continue
        total = round(totals.get(item.id, 0.0), 4)
        below = is_below_min(item, total)
        critical = any(a.is_critical for a in assets)
        if below_min_only and not below:
            continue
        if critical_only and not critical:
            continue
        out.append(MaintenanceSpareResponse(
            store_item_id=item.id, item_code=item.item_code, item_name=item.item_name, uom=item.uom,
            item_type=item.item_type, part_number=item.part_number or item.manufacturer_part_number,
            make=item.make or item.manufacturer, category=item.category,
            locations=locs, on_hand_total=total,
            minimum_stock=item.minimum_stock, reorder_level=item.reorder_level, reorder_quantity=item.reorder_quantity,
            below_min=below, at_reorder=item.reorder_level is not None and total <= item.reorder_level,
            is_critical=critical, suggested_order_qty=suggested_order_qty(item, total),
            assets=assets, consumed_90d=round(max(0.0, consumed.get(item.id, 0.0)), 4),
        ))
    # Below-minimum critical spares first, then by name.
    out.sort(key=lambda s: (not (s.below_min and s.is_critical), not s.below_min, s.item_name.lower()))
    return out
