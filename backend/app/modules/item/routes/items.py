from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.permissions import require_any_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.item.models.item import Item
from app.modules.item.schemas.item import ItemCreate, ItemUpdate, ItemBulkCreate, ItemResponse
from app.modules.store.models.location import StoreLocation

router = APIRouter(prefix="/items", tags=["Items"])


def _attach_warehouse_name(db: Session, items: list[Item]) -> list[Item]:
    warehouse_ids = {i.default_warehouse_id for i in items if i.default_warehouse_id}
    locations = {}
    if warehouse_ids:
        locations = {
            loc.id: loc.name
            for loc in db.query(StoreLocation).filter(StoreLocation.id.in_(warehouse_ids)).all()
        }
    for i in items:
        i.default_warehouse_name = locations.get(i.default_warehouse_id)
    return items


@router.get("", response_model=list[ItemResponse])
async def list_items(
    search: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("purchase", "store")),
):
    query = db.query(Item)
    if search:
        query = query.filter(
            (Item.item_code.ilike(f"%{search}%")) | (Item.item_name.ilike(f"%{search}%"))
        )
    items = query.order_by(Item.item_code.asc()).offset(skip).limit(limit).all()
    return _attach_warehouse_name(db, items)


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(
    item_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("purchase", "store")),
):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    _attach_warehouse_name(db, [item])
    return item


@router.post("", response_model=ItemResponse)
async def create_item(
    payload: ItemCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("purchase", "store")),
):
    item = Item(**payload.model_dump())
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Item code '{payload.item_code}' already exists")
    db.refresh(item)
    _attach_warehouse_name(db, [item])
    return item


@router.put("/{item_id}", response_model=ItemResponse)
async def update_item(
    item_id: int,
    payload: ItemUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("purchase", "store")),
):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Item code '{payload.item_code}' already exists")
    db.refresh(item)
    _attach_warehouse_name(db, [item])
    return item


@router.post("/bulk", response_model=list[ItemResponse])
async def bulk_create_items(
    payload: ItemBulkCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("purchase", "store")),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="No items provided")

    codes = [i.item_code.strip() for i in payload.items]
    if len(codes) != len(set(codes)):
        raise HTTPException(status_code=400, detail="Duplicate item codes in the same submission")

    items = [Item(**i.model_dump()) for i in payload.items]
    db.add_all(items)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="One or more item codes already exist")
    for item in items:
        db.refresh(item)
    return _attach_warehouse_name(db, items)
