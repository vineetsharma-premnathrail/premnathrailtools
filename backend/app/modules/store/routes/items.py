from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem, STORE_ITEM_STATUSES
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.routes.item_types import check_item_type, type_options
from app.modules.store.models.location import StoreLocation
from app.modules.store.schemas.item import StoreItemCreate, StoreItemUpdate, StoreItemResponse
from app.modules.store.service import generate_item_code
from app.modules.store.routes.uoms import uom_options

router = APIRouter(prefix="/store/items", tags=["Store"])


def apply_item_search(query, search: str | None):
    """Word-by-word search: every word (any order, extra spaces ignored) must
    appear in the item's name, code, part code, description or category."""
    for word in (search or "").split():
        like = f"%{word}%"
        query = query.filter(
            StoreItem.item_name.ilike(like) | StoreItem.item_code.ilike(like) | StoreItem.part_number.ilike(like)
            | StoreItem.description.ilike(like) | StoreItem.category.ilike(like)
        )
    return query


def item_search_order(search: str | None):
    """ORDER BY for a search: items whose NAME matches come first (exact, then
    starts-with, then contains), then code matches, then the rest (matched
    only in technical specification / category); A–Z within each group."""
    q = " ".join((search or "").split()).lower()
    if not q:
        return [StoreItem.item_name.asc()]
    name = func.lower(StoreItem.item_name)
    words = q.split()
    rank = case(
        (name == q, 0),
        (name.like(f"{q}%"), 1),
        (name.like(f"%{q}%"), 2),
        (and_(*[name.like(f"%{w}%") for w in words]), 3),
        (func.lower(StoreItem.item_code).like(f"%{q}%"), 4),
        else_=5,
    )
    return [rank, StoreItem.item_name.asc()]


def _to_response(item: StoreItem, db: Session) -> StoreItemResponse:
    warehouse = db.query(StoreLocation).filter(StoreLocation.id == item.preferred_warehouse_id).first() if item.preferred_warehouse_id else None
    return StoreItemResponse.model_validate(item).model_copy(
        update={"preferred_warehouse_name": warehouse.name if warehouse else None, "has_photo": bool(item.photo_path)}
    )


@router.get("", response_model=list[StoreItemResponse])
async def list_items(
    category: str | None = Query(None),
    subcategory: str | None = Query(None),
    item_type: str | None = Query(None),
    search: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreItem)
    if category is not None:
        query = query.filter(StoreItem.category == category)
    if subcategory:
        query = query.filter(StoreItem.subcategory == subcategory)
    if item_type is not None:
        query = query.filter(StoreItem.item_type == item_type)
    if status is not None:
        query = query.filter(StoreItem.status == status)
    query = apply_item_search(query, search)
    items = query.order_by(*item_search_order(search)).all()
    return [_to_response(i, db) for i in items]




def _validate_type_and_uom(item_type: str | None, uom: str | None, db: Session | None = None) -> str | None:
    """Returns the normalised UOM code; 400s on an unknown type or unit."""
    if db is not None:
        check_item_type(db, item_type)
    if uom is None:
        return None
    code = uom.strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Enter the unit of measure — pick one from the UOM dropdown.")
    if code not in {o["value"] for o in uom_options(db)}:
        raise HTTPException(status_code=400, detail=f"'{uom}' isn't a unit in the list. Pick one from the UOM dropdown, or add it there with '+ Add unit'.")
    return code


@router.get("/meta")
async def item_meta(db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    """Dropdown options for the item master form."""
    return {
        "item_types": type_options(db),
        "uoms": uom_options(db),
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
    _validate_type_and_uom(item_type, None, db)
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
    data["uom"] = _validate_type_and_uom(data.get("item_type"), data["uom"], db)
    data["part_number"] = (data.get("part_number") or "").strip() or None
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
    if "status" in changes and changes["status"] not in STORE_ITEM_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status '{changes['status']}' isn't valid — choose one of: {', '.join(STORE_ITEM_STATUSES)}.")
    if changes.get("uom") and changes["uom"] != item.uom and _has_stock_history(db, item.id):
        # Existing ledger quantities were counted in the old unit; switching
        # it would silently turn "10 KG" into "10 TON".
        raise HTTPException(status_code=409, detail=f"'{item.item_name}' already has stock movements in {item.uom}, so its unit can't be changed — create a new item for the new unit.")
    if "uom" in changes and not changes["uom"]:
        raise HTTPException(status_code=400, detail="An item must keep a unit of measure — pick one from the UOM dropdown.")
    if "uom" in changes or "item_type" in changes:
        normalised = _validate_type_and_uom(changes.get("item_type"), changes.get("uom"), db)
        if "uom" in changes:
            changes["uom"] = normalised
    if "part_number" in changes:
        changes["part_number"] = (changes["part_number"] or "").strip() or None
    for field, val in changes.items():
        setattr(item, field, val)
    db.commit()
    db.refresh(item)
    return _to_response(item, db)


def _has_stock_history(db: Session, item_id: int) -> bool:
    return db.query(StoreStockTransaction.id).filter(StoreStockTransaction.item_id == item_id).first() is not None


@router.delete("/{item_id}")
async def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    from app.modules.store.models.material_issue import StoreMaterialIssueItem
    from app.modules.store.models.material_return import StoreMaterialReturnItem
    from app.modules.store.models.stock_adjustment import StoreStockAdjustmentItem
    from app.modules.store.models.stock_reservation import StoreStockReservation
    from app.modules.store.models.stock_transfer import StoreStockTransferItem

    used = [
        (db.query(StoreStockTransaction.id).filter(StoreStockTransaction.item_id == item.id).count(), "stock movement(s)"),
        (db.query(StoreMaterialIssueItem.id).filter(StoreMaterialIssueItem.item_id == item.id).count(), "material issue line(s)"),
        (db.query(StoreMaterialReturnItem.id).filter(StoreMaterialReturnItem.item_id == item.id).count(), "return line(s)"),
        (db.query(StoreStockTransferItem.id).filter(StoreStockTransferItem.item_id == item.id).count(), "transfer line(s)"),
        (db.query(StoreStockAdjustmentItem.id).filter(StoreStockAdjustmentItem.item_id == item.id).count(), "adjustment line(s)"),
        (db.query(StoreStockReservation.id).filter(StoreStockReservation.item_id == item.id).count(), "reservation(s)"),
    ]
    if in_use := [f"{n} {what}" for n, what in used if n]:
        raise HTTPException(status_code=409, detail=f"'{item.item_name}' can't be deleted — it has {', '.join(in_use)}. Set its status to Inactive instead so it's no longer offered.")
    db.query(StoreStockBalance).filter(StoreStockBalance.item_id == item.id).delete()
    db.delete(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"'{item.item_name}' can't be deleted — another module (BOM, work order, design document or spare-part list) still links to it. Remove it there first, or set the item to Inactive.")
    return {"ok": True}
