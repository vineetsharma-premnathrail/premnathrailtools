import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItemType, STORE_ITEM_TYPES, STORE_ITEM_TYPE_LABELS, STORE_ITEM_TYPE_PREFIXES

router = APIRouter(prefix="/store/item-types", tags=["Store"])


class ItemTypeIn(BaseModel):
    label: str
    prefix: str = ""


def item_types(db: Session) -> list[StoreItemType]:
    """All item types, seeding the standard five on an empty table (fresh
    DBs built without the migration, e.g. tests)."""
    rows = db.query(StoreItemType).order_by(StoreItemType.id).all()
    if not rows:
        db.add_all([StoreItemType(value=v, label=STORE_ITEM_TYPE_LABELS[v], prefix=STORE_ITEM_TYPE_PREFIXES[v]) for v in STORE_ITEM_TYPES])
        db.commit()
        rows = db.query(StoreItemType).order_by(StoreItemType.id).all()
    return rows


def type_options(db: Session) -> list[dict]:
    return [{"value": t.value, "label": t.label, "prefix": t.prefix} for t in item_types(db)]


def check_item_type(db: Session, item_type: str | None) -> None:
    if item_type is None:
        return
    types = item_types(db)
    if item_type not in {t.value for t in types}:
        raise HTTPException(status_code=400, detail=f"'{item_type}' isn't a valid item type. Choose one of: {', '.join(t.label for t in types)}.")


def _clean(db: Session, payload: ItemTypeIn, current: StoreItemType | None = None) -> tuple[str, str]:
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Enter the item type name.")
    if len(label) > 100:
        raise HTTPException(status_code=400, detail="Item type name is too long — keep it to 100 characters or fewer.")
    q = db.query(StoreItemType).filter(func.lower(StoreItemType.label) == label.lower())
    if current:
        q = q.filter(StoreItemType.id != current.id)
    if q.first():
        raise HTTPException(status_code=409, detail=f"Item type '{label}' already exists — pick it from the list or edit it instead.")
    prefix = re.sub(r"[^A-Z0-9]", "", payload.prefix.upper())
    if not prefix:
        words = re.findall(r"[A-Za-z0-9]+", label.upper())
        prefix = ("".join(w[0] for w in words) if len(words) > 1 else "".join(words))[:2] or "IT"
    prefix = prefix[:6]
    q = db.query(StoreItemType).filter(StoreItemType.prefix == prefix)
    if current:
        q = q.filter(StoreItemType.id != current.id)
    if q.first():
        raise HTTPException(status_code=409, detail=f"Code prefix '{prefix}' is already used by another item type — enter a different prefix.")
    return label, prefix


@router.get("")
async def list_item_types(db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    return type_options(db)


@router.post("")
async def create_item_type(payload: ItemTypeIn, db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    item_types(db)
    label, prefix = _clean(db, payload)
    value = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:50] or "type"
    base, n = value, 2
    while db.query(StoreItemType.id).filter(StoreItemType.value == value).first():
        value, n = f"{base}_{n}", n + 1
    db.add(StoreItemType(value=value, label=label, prefix=prefix))
    db.commit()
    return type_options(db)


@router.put("/{value}")
async def update_item_type(value: str, payload: ItemTypeIn, db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    """Renames the type / changes its code prefix. The stored value (what items
    point at) never changes; a new prefix applies to items created from now on."""
    t = db.query(StoreItemType).filter(StoreItemType.value == value).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"Item type '{value}' wasn't found — reload the page and try again.")
    t.label, t.prefix = _clean(db, payload, t)
    db.commit()
    return type_options(db)


@router.delete("/{value}")
async def delete_item_type(value: str, db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    """Removes an item type no item or category uses yet."""
    from app.modules.store.models.category import StoreItemCategory
    from app.modules.store.models.item import StoreItem

    item_types(db)
    t = db.query(StoreItemType).filter(StoreItemType.value == value).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"Item type '{value}' wasn't found — it may already be deleted. Reload the page.")
    if t.value == "material":
        # New items and item imports fall back to 'material' when no type is given.
        raise HTTPException(status_code=409, detail=f"'{t.label}' is the default item type (used when an item or import row has no type) and can't be deleted — rename it instead.")
    used = [
        (db.query(StoreItem).filter(StoreItem.item_type == t.value).count(), "item(s)"),
        (db.query(StoreItemCategory).filter(StoreItemCategory.item_type == t.value).count(), "categor(ies)"),
    ]
    if in_use := [f"{n} {what}" for n, what in used if n]:
        raise HTTPException(status_code=409, detail=f"Item type '{t.label}' can't be deleted — it's used by {', '.join(in_use)}. Move those to another type first, or rename this one.")
    if db.query(StoreItemType).count() <= 1:
        raise HTTPException(status_code=409, detail=f"'{t.label}' is the only item type left — add another before deleting it.")
    db.delete(t)
    db.commit()
    return type_options(db)
