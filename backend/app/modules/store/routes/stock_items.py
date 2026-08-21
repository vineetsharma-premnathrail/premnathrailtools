from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.stock_item import StockItem, STOCK_ITEM_STATUSES
from app.modules.store.models.stock_balance import StockBalance
from app.modules.store.schemas.stock_item import StockItemCreate, StockItemUpdate, StockItemResponse

router = APIRouter(prefix="/store/items", tags=["Store"])


def _to_response(db: Session, item: StockItem) -> StockItemResponse:
    resp = StockItemResponse.model_validate(item)
    total = db.query(func.coalesce(func.sum(StockBalance.quantity_on_hand), 0)).filter(
        StockBalance.stock_item_id == item.id
    ).scalar()
    resp.quantity_on_hand = float(total or 0)
    return resp


@router.get("", response_model=list[StockItemResponse])
async def list_stock_items(
    search: str | None = None,
    status: str | None = None,
    low_stock: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StockItem)
    if search:
        query = query.filter(
            (StockItem.description.ilike(f"%{search}%")) | (StockItem.part_code.ilike(f"%{search}%"))
        )
    if status:
        query = query.filter(StockItem.status == status)
    items = query.order_by(StockItem.description.asc()).offset(skip).limit(limit).all()
    results = [_to_response(db, item) for item in items]
    if low_stock:
        results = [r for r in results if r.quantity_on_hand <= r.reorder_point]
    return results


@router.post("", response_model=StockItemResponse)
async def create_stock_item(
    payload: StockItemCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    if db.query(StockItem).filter(StockItem.part_code == payload.part_code).first():
        raise HTTPException(status_code=409, detail=f"Part code '{payload.part_code}' already exists")
    item = StockItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_response(db, item)


@router.get("/{item_id}", response_model=StockItemResponse)
async def get_stock_item(
    item_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = db.query(StockItem).filter(StockItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Stock item not found")
    return _to_response(db, item)


@router.patch("/{item_id}", response_model=StockItemResponse)
async def update_stock_item(
    item_id: int,
    payload: StockItemUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = db.query(StockItem).filter(StockItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Stock item not found")
    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in STOCK_ITEM_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{updates['status']}'")
    for field, val in updates.items():
        setattr(item, field, val)
    db.commit()
    db.refresh(item)
    return _to_response(db, item)
