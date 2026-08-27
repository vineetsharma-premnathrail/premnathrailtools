from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.crm.models.product import Product
from app.modules.crm.schemas.product import ProductCreate, ProductUpdate, ProductResponse

router = APIRouter(prefix="/crm/products", tags=["CRM - Products"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


@router.get("", response_model=list[ProductResponse])
async def list_products(
    search: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    query = db.query(Product).filter(Product.is_deleted == False)  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Product.name.ilike(like)) | (Product.model_number.ilike(like)) | (Product.category.ilike(like))
        )
    return query.order_by(Product.id.desc()).all()


@router.post("", response_model=ProductResponse, status_code=201)
async def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    product = Product(**payload.model_dump(), created_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.patch("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    product = db.query(Product).filter(Product.id == product_id, Product.is_deleted == False).first()  # noqa: E712
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not _can_modify(product, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this product.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}")
async def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    product = db.query(Product).filter(Product.id == product_id, Product.is_deleted == False).first()  # noqa: E712
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not _can_modify(product, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this product.")
    product.is_deleted = True
    product.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}
