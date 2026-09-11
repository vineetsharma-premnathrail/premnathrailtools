from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.crm.models.product_category import ProductCategory
from app.modules.crm.schemas.product_category import ProductCategoryCreate, ProductCategoryUpdate, ProductCategoryResponse

router = APIRouter(prefix="/crm/product-categories", tags=["CRM - Product Categories"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


@router.get("", response_model=list[ProductCategoryResponse])
async def list_product_categories(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    return db.query(ProductCategory).filter(ProductCategory.is_deleted == False).order_by(ProductCategory.name.asc()).all()  # noqa: E712


@router.post("", response_model=ProductCategoryResponse, status_code=201)
async def create_product_category(
    payload: ProductCategoryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    name = payload.name.strip()
    existing = db.query(ProductCategory).filter(
        ProductCategory.is_deleted == False, ProductCategory.name.ilike(name)  # noqa: E712
    ).first()
    if existing:
        return existing
    category = ProductCategory(name=name, created_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.patch("/{category_id}", response_model=ProductCategoryResponse)
async def update_product_category(
    category_id: int,
    payload: ProductCategoryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    category = db.query(ProductCategory).filter(
        ProductCategory.id == category_id, ProductCategory.is_deleted == False  # noqa: E712
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Product category not found")
    if not _can_modify(category, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this product category.")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        existing = db.query(ProductCategory).filter(
            ProductCategory.is_deleted == False, ProductCategory.name.ilike(name),  # noqa: E712
            ProductCategory.id != category_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="A product category with this name already exists.")
        category.name = name
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}")
async def delete_product_category(
    category_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    category = db.query(ProductCategory).filter(
        ProductCategory.id == category_id, ProductCategory.is_deleted == False  # noqa: E712
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Product category not found")
    if not _can_modify(category, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this product category.")
    category.is_deleted = True
    category.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}
