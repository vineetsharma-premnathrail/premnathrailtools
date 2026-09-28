from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.schemas.item import StoreItemCreate, StoreItemUpdate, StoreItemResponse

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
    if db.query(StoreItem).filter(StoreItem.item_code == payload.item_code).first():
        raise HTTPException(status_code=409, detail=f"Item code '{payload.item_code}' already exists")
    item = StoreItem(**payload.model_dump())
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
    for field, val in payload.model_dump(exclude_unset=True).items():
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
