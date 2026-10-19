"""Material master plant views (MM01 Plant / MRP views) —
GET/PUT /store/items/{item_id}/plants.

PUT replaces the item's plant rows with the list sent (a plant left out is
removed and falls back to the company-wide Item Master fields)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.audit import register_audited
from app.core.permission_registry import can_view_tab
from app.core.permissions import ensure_feature_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.store.access import require_store_lookup
from app.modules.store.models.item import StoreItem
from app.modules.store.models.item_plant import STORE_MRP_TYPES, STORE_PROCUREMENT_TYPES, StoreItemPlant
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.plant_data import plant_rows, plant_view, validate_plant_payload

router = APIRouter(prefix="/store/items", tags=["Store"])

register_audited(StoreItemPlant, entity_type="store_item_plant", module_key="store", label="Item plant data",
                 ref=lambda o: f"item {o.item_id} / plant {o.branch_id}")


class StoreItemPlantPayload(BaseModel):
    branch_id: int
    mrp_type: str | None = "reorder_point"
    procurement_type: str | None = "buy"
    reorder_level: float | None = None
    safety_stock: float | None = None
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    reorder_quantity: float | None = None
    lead_time_days: int | None = None
    inhouse_production_days: int | None = None
    default_location_id: int | None = None
    purchasing_blocked: bool = False
    remarks: str | None = None


class StoreItemPlantsUpdatePayload(BaseModel):
    plants: list[StoreItemPlantPayload]


def _item(db: Session, item_id: int) -> StoreItem:
    item = db.get(StoreItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found in the Item Master — it may have been deleted. Refresh the list.")
    return item


def _payload(db: Session, item: StoreItem) -> dict:
    branches = {b.id: b for b in db.query(Branch).order_by(Branch.name).all()}
    locs = {l.id: l for l in db.query(StoreLocation).all()}
    rows = []
    for r in plant_rows(db, item.id):
        b = branches.get(r.branch_id)
        loc = locs.get(r.default_location_id) if r.default_location_id else None
        rows.append({
            "id": r.id, "branch_id": r.branch_id, "plant_name": b.name if b else None, "plant_code": b.code if b else None,
            "mrp_type": r.mrp_type, "procurement_type": r.procurement_type, "reorder_level": r.reorder_level,
            "safety_stock": r.safety_stock, "minimum_stock": r.minimum_stock, "maximum_stock": r.maximum_stock,
            "reorder_quantity": r.reorder_quantity, "lead_time_days": r.lead_time_days,
            "inhouse_production_days": r.inhouse_production_days, "default_location_id": r.default_location_id,
            "default_location_name": loc.name if loc else None, "purchasing_blocked": r.purchasing_blocked, "remarks": r.remarks,
            "effective": plant_view(db, item, r.branch_id),
        })
    return {
        "item_id": item.id, "item_code": item.item_code, "item_name": item.item_name, "uom": item.uom,
        "company_defaults": plant_view(db, item, None),
        "plants": rows,
        "meta": {
            "mrp_types": [{"value": k, "label": v} for k, v in STORE_MRP_TYPES.items()],
            "procurement_types": [{"value": k, "label": v} for k, v in STORE_PROCUREMENT_TYPES.items()],
            "plants": [{"id": b.id, "name": b.name, "code": b.code} for b in branches.values()],
            "stores": [{"id": l.id, "name": l.name, "code": l.code, "branch_id": l.branch_id} for l in locs.values() if l.is_active],
        },
    }


@router.get("/{item_id}/plants")
async def get_item_plants(item_id: int, db: Session = Depends(get_db), user: User = Depends(require_store_lookup())):
    # A cross-module lookup; Store users additionally need Items › Plant data.
    if can_view_tab(user, "store", "items"):
        ensure_feature_action(user, "store", "items", "plant_data", "view")
    return _payload(db, _item(db, item_id))


@router.put("/{item_id}/plants")
async def put_item_plants(
    item_id: int,
    payload: StoreItemPlantsUpdatePayload,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("store", "items", "plant_data", "edit")),
):
    item = _item(db, item_id)
    seen: set[int] = set()
    clean = []
    for p in payload.plants:
        try:
            c = validate_plant_payload(db, item, p.model_dump())
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        if c["branch_id"] in seen:
            b = db.get(Branch, c["branch_id"])
            raise HTTPException(status_code=422, detail=f"Plant {b.name if b else c['branch_id']} is listed twice — keep one row per plant.")
        seen.add(c["branch_id"])
        clean.append(c)
    existing = {r.branch_id: r for r in plant_rows(db, item.id)}
    for bid, row in existing.items():
        if bid not in seen:
            db.delete(row)
    for c in clean:
        row = existing.get(c["branch_id"])
        if row is None:
            db.add(StoreItemPlant(item_id=item.id, **c))
        else:
            for k, v in c.items():
                if getattr(row, k) != v:
                    setattr(row, k, v)
    db.commit()
    return _payload(db, item)
