from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.hydraulic.models.bom import HydBom, HydBomItem
from app.modules.hydraulic.models.maintenance import HydServicePart, HydServiceRecord
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.schemas.spare_part import (
    HydSparePartResponse, HydSparePartSystemUsage,
)
from app.modules.hydraulic.service import can_see_costs, components_by_id, store_stock, stock_status, raise_retired
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem

router = APIRouter(
    prefix="/hydraulic/spare-parts", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)


def to_spare_responses(db: Session, spares: list[HydSparePart], with_usage: bool = False) -> list[HydSparePartResponse]:
    comps = components_by_id(db, {s.component_id for s in spares})
    item_ids = {s.store_item_id for s in spares if s.store_item_id}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    stock = store_stock(db, item_ids)
    ids = [s.id for s in spares]
    since = date.today() - timedelta(days=365)
    used = dict(db.query(HydServicePart.spare_part_id, func.coalesce(func.sum(HydServicePart.quantity), 0.0)).join(
        HydServiceRecord, HydServiceRecord.id == HydServicePart.record_id
    ).filter(
        HydServicePart.spare_part_id.in_(ids), HydServiceRecord.status == "completed",
        HydServiceRecord.is_deleted == False, HydServiceRecord.completed_on >= since,  # noqa: E712
    ).group_by(HydServicePart.spare_part_id).all()) if ids else {}
    out = []
    for s in spares:
        resp = HydSparePartResponse.model_validate(s)
        comp, item = comps.get(s.component_id), items.get(s.store_item_id)
        resp.component_code = comp.code if comp else None
        resp.component_name = comp.name if comp else None
        resp.store_item_code = item.item_code if item else None
        resp.store_item_name = item.item_name if item else None
        if s.store_item_id:
            resp.on_hand_qty, resp.available_qty = stock.get(s.store_item_id, (0.0, 0.0))
        resp.stock_status = stock_status(s, resp.available_qty)
        resp.used_last_12m = round(float(used.get(s.id, 0.0)), 3)
        if with_usage and s.component_id:
            rows = db.query(HydSystem.id, HydSystem.system_number, HydSystem.name, func.sum(HydBomItem.quantity)).join(
                HydBom, HydBom.system_id == HydSystem.id
            ).join(HydBomItem, HydBomItem.bom_id == HydBom.id).filter(
                HydBomItem.component_id == s.component_id, HydBom.status == "released",
                HydBom.is_deleted == False, HydSystem.is_deleted == False,  # noqa: E712
            ).group_by(HydSystem.id, HydSystem.system_number, HydSystem.name).all()
            resp.used_in_systems = [HydSparePartSystemUsage(system_id=r[0], system_number=r[1], system_name=r[2], quantity=float(r[3] or 0)) for r in rows]
        out.append(resp)
    return out


def _shown(rows: list[HydSparePartResponse], user: User) -> list[HydSparePartResponse]:
    """Blank unit costs for anyone without Hydraulic › BOM › Prices & costs."""
    if not can_see_costs(user):
        for r in rows:
            r.unit_cost = None
    return rows


def _get_or_404(db: Session, spare_id: int) -> HydSparePart:
    spare = db.query(HydSparePart).filter(HydSparePart.id == spare_id, HydSparePart.is_deleted == False).first()  # noqa: E712
    if not spare:
        raise HTTPException(status_code=404, detail=f"Spare part #{spare_id} not found (it may have been deleted).")
    return spare


@router.get("", response_model=list[HydSparePartResponse])
async def list_spares(
    category: str | None = None,
    system_type: str | None = None,
    criticality: str | None = None,
    component_id: int | None = None,
    stock: str | None = Query(None, description="ok | low | out | not_linked | reorder (low + out)"),
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "systems")),
):
    query = db.query(HydSparePart).filter(HydSparePart.is_deleted == False)  # noqa: E712
    if category:
        query = query.filter(HydSparePart.category == category)
    if system_type:
        query = query.filter(HydSparePart.system_type.in_((system_type, "both")))
    if criticality:
        query = query.filter(HydSparePart.criticality == criticality)
    if component_id:
        query = query.filter(HydSparePart.component_id == component_id)
    if status_filter:
        query = query.filter(HydSparePart.status == status_filter)
    if search:
        like = f"%{search}%"
        query = query.filter(HydSparePart.part_code.ilike(like) | HydSparePart.name.ilike(like) | HydSparePart.part_number.ilike(like))
    rows = to_spare_responses(db, query.order_by(HydSparePart.part_code).all())
    if stock == "reorder":
        rows = [r for r in rows if r.stock_status in ("low", "out")]
    elif stock:
        rows = [r for r in rows if r.stock_status == stock]
    return _shown(rows, _tab)


@router.post("", status_code=410)
async def create_spare():
    """Retired (plan rule R5): spares come from the Engineering BOM recommended-spares list."""
    raise_retired("spare parts")


@router.get("/{spare_id}", response_model=HydSparePartResponse)
async def get_spare(
    spare_id: int, db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "systems")),
):
    return _shown(to_spare_responses(db, [_get_or_404(db, spare_id)], with_usage=True), _tab)[0]


@router.patch("/{spare_id}", status_code=410)
async def update_spare(spare_id: int):
    """Retired (plan rule R5): spares come from the Engineering BOM recommended-spares list."""
    raise_retired("spare parts")


@router.delete("/{spare_id}", status_code=410)
async def delete_spare(spare_id: int):
    """Retired (plan rule R5) — existing spares are read-only history, kept for the export."""
    raise_retired("spare parts")
