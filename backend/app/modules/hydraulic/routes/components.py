from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.hydraulic.models.bom import HydBom, HydBomItem
from app.modules.hydraulic.models.component import HydComponent, HYD_COMPONENT_CATEGORIES, HYD_COMPONENT_STATUSES
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.schemas.component import HydComponentCreate, HydComponentUpdate, HydComponentResponse
from app.modules.hydraulic.service import (
    generate_component_code, check_choice, check_system_type, check_store_item, get_component_or_404,
)
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem

router = APIRouter(
    prefix="/hydraulic/components", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)


def _to_responses(db: Session, comps: list[HydComponent]) -> list[HydComponentResponse]:
    ids = [c.id for c in comps]
    item_ids = {c.store_item_id for c in comps if c.store_item_id}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    usage, spares = {}, {}
    if ids:
        usage = dict(db.query(HydBomItem.component_id, func.count(func.distinct(HydBomItem.bom_id))).join(
            HydBom, HydBom.id == HydBomItem.bom_id
        ).filter(HydBomItem.component_id.in_(ids), HydBom.is_deleted == False).group_by(HydBomItem.component_id).all())  # noqa: E712
        spares = dict(db.query(HydSparePart.component_id, func.count(HydSparePart.id)).filter(
            HydSparePart.component_id.in_(ids), HydSparePart.is_deleted == False,  # noqa: E712
        ).group_by(HydSparePart.component_id).all())
    out = []
    for c in comps:
        resp = HydComponentResponse.model_validate(c)
        item = items.get(c.store_item_id)
        resp.store_item_code = item.item_code if item else None
        resp.store_item_name = item.item_name if item else None
        resp.bom_usage_count = usage.get(c.id, 0)
        resp.spare_count = spares.get(c.id, 0)
        out.append(resp)
    return out


def _validate(db: Session, data: dict) -> None:
    check_system_type(data.get("system_type"), allow_both=True)
    check_choice(data.get("status"), HYD_COMPONENT_STATUSES, "status")
    check_store_item(db, data.get("store_item_id"))
    bore, rod = data.get("bore_mm"), data.get("rod_mm")
    if bore and rod and rod >= bore:
        raise HTTPException(status_code=400, detail=f"Rod diameter ({rod:g} mm) must be smaller than the bore ({bore:g} mm).")
    rp, mp = data.get("rated_pressure_bar"), data.get("max_pressure_bar")
    if rp is not None and mp is not None and rp > mp:
        raise HTTPException(status_code=400, detail=f"Rated pressure ({rp:g} bar) can't exceed the maximum/peak pressure ({mp:g} bar).")


@router.get("", response_model=list[HydComponentResponse])
async def list_components(
    category: str | None = None,
    system_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "components")),
):
    query = db.query(HydComponent).filter(HydComponent.is_deleted == False)  # noqa: E712
    if category:
        query = query.filter(HydComponent.category == category)
    if system_type:
        # "both" components show under either medium.
        query = query.filter(HydComponent.system_type.in_((system_type, "both")))
    if status_filter:
        query = query.filter(HydComponent.status == status_filter)
    if search:
        like = f"%{search}%"
        query = query.filter(
            HydComponent.code.ilike(like) | HydComponent.name.ilike(like) | HydComponent.manufacturer.ilike(like)
            | HydComponent.model_number.ilike(like) | HydComponent.part_number.ilike(like)
        )
    return _to_responses(db, query.order_by(HydComponent.code).all())


@router.post("", response_model=HydComponentResponse)
async def create_component(
    payload: HydComponentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "components", "create")),
):
    data = payload.model_dump()
    if data["category"] not in HYD_COMPONENT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category '{data['category']}'. Use one of: {', '.join(HYD_COMPONENT_CATEGORIES)}.")
    _validate(db, data)
    comp = HydComponent(**data, code=generate_component_code(db, data["category"]), created_by_id=user.id)
    db.add(comp)
    db.commit()
    db.refresh(comp)
    return _to_responses(db, [comp])[0]


@router.get("/{component_id}", response_model=HydComponentResponse)
async def get_component(component_id: int, db: Session = Depends(get_db)):
    return _to_responses(db, [get_component_or_404(db, component_id)])[0]


@router.patch("/{component_id}", response_model=HydComponentResponse)
async def update_component(
    component_id: int,
    payload: HydComponentUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "components", "edit")),
):
    comp = get_component_or_404(db, component_id)
    updates = payload.model_dump(exclude_unset=True)
    merged = {c: getattr(comp, c) for c in ("bore_mm", "rod_mm", "rated_pressure_bar", "max_pressure_bar")}
    merged.update(updates)
    _validate(db, merged)
    for field, val in updates.items():
        setattr(comp, field, val)
    db.commit()
    db.refresh(comp)
    return _to_responses(db, [comp])[0]


@router.delete("/{component_id}")
async def delete_component(
    component_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "components", "delete")),
):
    comp = get_component_or_404(db, component_id)
    draft_boms = db.query(HydBom.bom_number).join(HydBomItem, HydBomItem.bom_id == HydBom.id).filter(
        HydBomItem.component_id == comp.id, HydBom.is_deleted == False, HydBom.status == "draft",  # noqa: E712
    ).distinct().all()
    if draft_boms:
        raise HTTPException(
            status_code=409,
            detail=f"{comp.code} is on draft BOM(s) {', '.join(b[0] for b in draft_boms)}. Remove it from those BOMs first, "
                   "or mark the component 'Obsolete' instead of deleting it.",
        )
    # Soft delete — released BOMs, tests and spares keep their history.
    comp.is_deleted = True
    comp.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Component {comp.code} deleted"}
