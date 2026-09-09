from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.crm.models.product_category import ProductCategory
from app.modules.crm.schemas.product_category import ProductCategoryCreate, ProductCategoryResponse

router = APIRouter(prefix="/crm/product-categories", tags=["CRM - Product Categories"])


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
