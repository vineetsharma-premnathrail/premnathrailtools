from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.schemas.category import StoreItemCategoryCreate, StoreItemCategoryUpdate, StoreItemCategoryResponse

router = APIRouter(prefix="/store/categories", tags=["Store"])


def _to_response(category: StoreItemCategory, db: Session) -> StoreItemCategoryResponse:
    parent = db.query(StoreItemCategory).filter(StoreItemCategory.id == category.parent_id).first() if category.parent_id else None
    return StoreItemCategoryResponse.model_validate(category).model_copy(update={"parent_name": parent.name if parent else None})


@router.get("", response_model=list[StoreItemCategoryResponse])
async def list_categories(
    parent_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreItemCategory)
    if parent_id is not None:
        query = query.filter(StoreItemCategory.parent_id == parent_id)
    categories = query.order_by(StoreItemCategory.name.asc()).all()
    return [_to_response(c, db) for c in categories]


@router.post("", response_model=StoreItemCategoryResponse)
async def create_category(
    payload: StoreItemCategoryCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    if db.query(StoreItemCategory).filter(StoreItemCategory.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Category code '{payload.code}' already exists")
    category = StoreItemCategory(**payload.model_dump())
    db.add(category)
    db.commit()
    db.refresh(category)
    return _to_response(category, db)


@router.patch("/{category_id}", response_model=StoreItemCategoryResponse)
async def update_category(
    category_id: int,
    payload: StoreItemCategoryUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    category = db.query(StoreItemCategory).filter(StoreItemCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, val)
    db.commit()
    db.refresh(category)
    return _to_response(category, db)


@router.delete("/{category_id}")
async def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    category = db.query(StoreItemCategory).filter(StoreItemCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    if db.query(StoreItemCategory).filter(StoreItemCategory.parent_id == category_id).first():
        raise HTTPException(status_code=409, detail="Cannot delete — this category has subcategories under it.")
    db.delete(category)
    db.commit()
    return {"ok": True}
