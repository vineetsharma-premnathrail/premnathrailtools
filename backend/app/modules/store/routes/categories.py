import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import ensure_can_delete, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.access import require_store_lookup
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.item import StoreItem
from app.modules.store.routes.item_types import check_item_type
from app.modules.store.service import CATEGORY_CODE_LEN, fixed_length_code
from app.modules.store.schemas.category import StoreItemCategoryCreate, StoreItemCategoryUpdate, StoreItemCategoryResponse
from app.modules.store.services.item_accounts import check_item_ledger, ledger_label

router = APIRouter(prefix="/store/categories", tags=["Store"])


def _to_response(category: StoreItemCategory, db: Session) -> StoreItemCategoryResponse:
    parent = db.query(StoreItemCategory).filter(StoreItemCategory.id == category.parent_id).first() if category.parent_id else None
    return StoreItemCategoryResponse.model_validate(category).model_copy(update={
        "parent_name": parent.name if parent else None,
        "purchase_gl_account_name": ledger_label(db, category.purchase_gl_account_id),
        "sales_gl_account_name": ledger_label(db, category.sales_gl_account_id),
    })


def _auto_code(db: Session, name: str) -> str:
    """Category code from the name — always exactly 3 characters, unique: ELE,
    then ELC, ELT… if taken. (Not part of item codes, which are a global number.)"""
    return fixed_length_code(name, CATEGORY_CODE_LEN,
                             lambda c: db.query(StoreItemCategory.id).filter(StoreItemCategory.code == c).first() is not None)


def _same_level(category_parent_id: int | None):
    return StoreItemCategory.parent_id == category_parent_id if category_parent_id else StoreItemCategory.parent_id.is_(None)


# Cross-module lookup: item pickers everywhere filter by category.
@router.get("", response_model=list[StoreItemCategoryResponse])
async def list_categories(
    parent_id: int | None = Query(None),
    item_type: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_store_lookup()),
):
    query = db.query(StoreItemCategory)
    if item_type is not None:
        query = query.filter((StoreItemCategory.item_type == item_type) | StoreItemCategory.item_type.is_(None))
    if parent_id is not None:
        query = query.filter(StoreItemCategory.parent_id == parent_id)
    categories = query.order_by(StoreItemCategory.name.asc()).all()
    return [_to_response(c, db) for c in categories]


@router.post("", response_model=StoreItemCategoryResponse)
async def create_category(
    payload: StoreItemCategoryCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("store", "categories", "create")),
):
    data = payload.model_dump()
    data["name"] = (data.get("name") or "").strip()
    if not data["name"]:
        raise HTTPException(status_code=400, detail="Enter the category name.")
    check_item_type(db, data.get("item_type"))
    parent = None
    if data.get("parent_id"):
        parent = db.query(StoreItemCategory).filter(StoreItemCategory.id == data["parent_id"]).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent category not found — reload the page and pick it again.")
        data["item_type"] = parent.item_type
        if data.get("purchase_gl_account_id") or data.get("sales_gl_account_id"):
            raise HTTPException(status_code=400, detail=f"Ledgers are set on the top-level category, not on a subcategory — set it on '{parent.name}'.")
    try:
        for purpose in ("purchase", "sales"):
            data[f"{purpose}_gl_account_id"] = check_item_ledger(db, purpose, data.get(f"{purpose}_gl_account_id"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if db.query(StoreItemCategory).filter(StoreItemCategory.name.ilike(data["name"]), _same_level(data.get("parent_id"))).first():
        where = f"under '{parent.name}'" if parent else "as a top-level category"
        raise HTTPException(status_code=409, detail=f"'{data['name']}' already exists {where} — pick it from the list or edit it instead.")
    data["code"] = (data.get("code") or "").strip().upper() or _auto_code(db, data["name"])
    if not re.fullmatch(rf"[A-Z0-9]{{{CATEGORY_CODE_LEN}}}", data["code"]):
        raise HTTPException(status_code=400, detail=(
            f"Category code '{data['code']}' must be exactly {CATEGORY_CODE_LEN} letters or digits (e.g. ELE). "
            f"Leave it blank to make one from the name."))
    if db.query(StoreItemCategory).filter(StoreItemCategory.code == data["code"]).first():
        raise HTTPException(status_code=409, detail=f"Category code '{data['code']}' already exists — use a different code.")
    category = StoreItemCategory(**data)
    db.add(category)
    db.commit()
    db.refresh(category)
    return _to_response(category, db)


@router.patch("/{category_id}", response_model=StoreItemCategoryResponse)
async def update_category(
    category_id: int,
    payload: StoreItemCategoryUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("store", "categories", "edit")),
):
    category = db.query(StoreItemCategory).filter(StoreItemCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    changes = payload.model_dump(exclude_unset=True)
    check_item_type(db, changes.get("item_type"))
    if "name" in changes:
        new_name = (changes["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Enter the category name.")
        changes["name"] = new_name
        if db.query(StoreItemCategory).filter(
            StoreItemCategory.id != category.id, StoreItemCategory.name.ilike(new_name), _same_level(category.parent_id)
        ).first():
            raise HTTPException(status_code=409, detail=f"'{new_name}' already exists here — choose a different name.")
        # Items store category/subcategory by name — keep them on the renamed one.
        if new_name != category.name:
            if category.parent_id:
                parent = db.query(StoreItemCategory).filter(StoreItemCategory.id == category.parent_id).first()
                db.query(StoreItem).filter(
                    StoreItem.subcategory == category.name, StoreItem.category == (parent.name if parent else None)
                ).update({StoreItem.subcategory: new_name}, synchronize_session=False)
            else:
                db.query(StoreItem).filter(StoreItem.category == category.name).update(
                    {StoreItem.category: new_name}, synchronize_session=False)
    for purpose in ("purchase", "sales"):
        col = f"{purpose}_gl_account_id"
        if col in changes:
            if category.parent_id and changes[col]:
                raise HTTPException(status_code=400, detail=f"Ledgers are set on the top-level category, not on a subcategory — set it on the category above '{category.name}'.")
            try:
                changes[col] = check_item_ledger(db, purpose, changes[col])
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from None
    if category.parent_id:
        # subcategories always follow their parent's item type
        changes.pop("item_type", None)
    else:
        inherited = {getattr(StoreItemCategory, f): changes[f] for f in ("item_type",) if f in changes}
        if inherited:
            db.query(StoreItemCategory).filter(StoreItemCategory.parent_id == category.id).update(
                inherited, synchronize_session=False)
    for field, val in changes.items():
        setattr(category, field, val)
    db.commit()
    db.refresh(category)
    return _to_response(category, db)


@router.delete("/{category_id}")
async def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "categories")),
):
    category = db.query(StoreItemCategory).filter(StoreItemCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    ensure_can_delete(user, category, "store", "categories", what="category")
    if db.query(StoreItemCategory).filter(StoreItemCategory.parent_id == category_id).first():
        raise HTTPException(status_code=409, detail="Cannot delete — this category has subcategories under it.")
    # Items hold the category / subcategory by name, so deleting a used one
    # would leave them pointing at a category that no longer exists.
    if category.parent_id:
        parent = db.query(StoreItemCategory).filter(StoreItemCategory.id == category.parent_id).first()
        used = db.query(StoreItem).filter(StoreItem.subcategory == category.name, StoreItem.category == (parent.name if parent else None)).count()
    else:
        used = db.query(StoreItem).filter(StoreItem.category == category.name).count()
    if used:
        raise HTTPException(status_code=409, detail=f"'{category.name}' can't be deleted — {used} item(s) are in it. Move them to another category first, or untick Active so it's no longer offered.")
    db.delete(category)
    db.commit()
    return {"ok": True}
