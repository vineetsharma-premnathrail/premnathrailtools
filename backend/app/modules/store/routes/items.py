from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem, STORE_ITEM_TYPES, STORE_ITEM_TYPE_PREFIXES, STORE_UOMS
from app.modules.store.models.location import StoreLocation
from app.modules.store.schemas.item import StoreItemCreate, StoreItemUpdate, StoreItemResponse
from app.modules.store.service import generate_item_code

router = APIRouter(prefix="/store/items", tags=["Store"])


def _to_response(item: StoreItem, db: Session) -> StoreItemResponse:
    warehouse = db.query(StoreLocation).filter(StoreLocation.id == item.preferred_warehouse_id).first() if item.preferred_warehouse_id else None
    return StoreItemResponse.model_validate(item).model_copy(
        update={"preferred_warehouse_name": warehouse.name if warehouse else None}
    )


@router.get("", response_model=list[StoreItemResponse])
async def list_items(
    category: str | None = Query(None),
    item_type: str | None = Query(None),
    search: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreItem)
    if category is not None:
        query = query.filter(StoreItem.category == category)
    if item_type is not None:
        query = query.filter(StoreItem.item_type == item_type)
    if status is not None:
        query = query.filter(StoreItem.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter((StoreItem.item_name.ilike(like)) | (StoreItem.item_code.ilike(like)))
    items = query.order_by(StoreItem.item_name.asc()).all()
    return [_to_response(i, db) for i in items]


_TYPE_LABELS = {
    "raw_material": "Raw Material", "consumable": "Consumable", "spare_part": "Spare Part", "finished_good": "Finished Good",
    "semi_finished": "Semi-Finished", "asset": "Asset", "other": "Other",
}


def _validate_type_and_uom(item_type: str | None, uom: str | None) -> str | None:
    """Returns the normalised UOM code; 400s on an unknown type or unit."""
    if item_type is not None and item_type not in STORE_ITEM_TYPES:
        raise HTTPException(status_code=400, detail=f"'{item_type}' isn't a valid item type. Choose one of: {', '.join(STORE_ITEM_TYPES)}.")
    if uom is None:
        return None
    code = uom.strip().upper()
    if code not in STORE_UOMS:
        raise HTTPException(status_code=400, detail=f"'{uom}' isn't a unit in the list. Pick one from the UOM dropdown ({', '.join(STORE_UOMS)}).")
    return code


@router.get("/meta")
async def item_meta(_user: User = Depends(require_app_access("store"))):
    """Dropdown options for the item master form."""
    return {
        "item_types": [{"value": t, "label": _TYPE_LABELS.get(t, t), "prefix": STORE_ITEM_TYPE_PREFIXES.get(t, "OT")} for t in STORE_ITEM_TYPES],
        "uoms": [{"value": code, "label": f"{code} — {label}"} for code, label in STORE_UOMS.items()],
    }


@router.get("/next-code")
async def next_item_code(
    item_type: str | None = Query(None),
    category: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    """Preview of the code the next item of this type + category would get.
    Not reserved — the real code is assigned when the item is saved."""
    _validate_type_and_uom(item_type, None)
    return {"item_code": generate_item_code(db, item_type, category)}


@router.get("/{item_id}", response_model=StoreItemResponse)
async def get_item(
    item_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _to_response(item, db)


@router.post("", response_model=StoreItemResponse)
async def create_item(
    payload: StoreItemCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    data = payload.model_dump()
    if not (data.get("item_name") or "").strip():
        raise HTTPException(status_code=400, detail="Enter the item name.")
    if not data.get("uom"):
        raise HTTPException(status_code=400, detail="Pick the unit of measure (UOM) for this item.")
    data["uom"] = _validate_type_and_uom(data.get("item_type"), data["uom"])
    code = (data.get("item_code") or "").strip().upper()
    if code:
        if db.query(StoreItem).filter(StoreItem.item_code == code).first():
            raise HTTPException(status_code=409, detail=f"Item code '{code}' already exists — leave the code blank to auto-generate one.")
    else:
        code = generate_item_code(db, data.get("item_type"), data.get("category"))
    data["item_code"] = code
    data["item_name"] = data["item_name"].strip()
    item = StoreItem(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_response(item, db)


@router.patch("/{item_id}", response_model=StoreItemResponse)
async def update_item(
    item_id: int,
    payload: StoreItemUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    changes = payload.model_dump(exclude_unset=True)
    if "uom" in changes and not changes["uom"]:
        raise HTTPException(status_code=400, detail="An item must keep a unit of measure — pick one from the UOM dropdown.")
    if "uom" in changes or "item_type" in changes:
        normalised = _validate_type_and_uom(changes.get("item_type"), changes.get("uom"))
        if "uom" in changes:
            changes["uom"] = normalised
    for field, val in changes.items():
        setattr(item, field, val)
    db.commit()
    db.refresh(item)
    return _to_response(item, db)


@router.delete("/{item_id}")
async def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
