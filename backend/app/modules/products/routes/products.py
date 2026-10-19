"""Product master: the finished products the company makes and sells, with
their applications and technical specifications."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_can_delete, require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.products.models.application import ProductApplication
from app.modules.products.models.product import (
    FinishedProduct, ProductSpecification, PRODUCT_STATUSES, PRODUCT_STATUS_LABELS, PRODUCT_TYPES, PRODUCT_TYPE_LABELS,
)
from app.modules.products.schemas.product import (
    ProductCreate, ProductUpdate, ProductResponse, ProductSpecificationPayload,
)
from app.modules.store.models.item import StoreItem
from app.modules.products import access  # noqa: F401 — registers the product data scope

router = APIRouter(prefix="/products", tags=["Products"], dependencies=[Depends(require_app_access("products"))])

_CAN_CREATE = require_tab_action("products", "products", "create")
_CAN_EDIT = require_tab_action("products", "products", "edit")


def _norm_code(code: str) -> str:
    c = (code or "").strip().upper()
    if not c or len(c) > 30:
        raise HTTPException(status_code=422, detail="Product code is required (up to 30 characters), e.g. RRB-SV.")
    return c


def _check_choices(product_type: str | None, status: str | None) -> None:
    if product_type is not None and product_type not in PRODUCT_TYPES:
        raise HTTPException(status_code=422, detail=f"Product type must be one of: {', '.join(PRODUCT_TYPE_LABELS.values())}.")
    if status is not None and status not in PRODUCT_STATUSES:
        raise HTTPException(status_code=422, detail=f"Status must be one of: {', '.join(PRODUCT_STATUS_LABELS.values())}.")


def _check_numbers(warranty_months: int | None) -> None:
    if warranty_months is not None and not 0 <= warranty_months <= 240:
        raise HTTPException(status_code=422, detail="Warranty must be between 0 and 240 months — leave it empty if there is no standard warranty.")


def _applications(db: Session, ids: list[int]) -> list[ProductApplication]:
    wanted = list(dict.fromkeys(ids))
    rows = db.query(ProductApplication).filter(ProductApplication.id.in_(wanted)).all() if wanted else []
    missing = set(wanted) - {r.id for r in rows}
    if missing:
        raise HTTPException(status_code=422, detail=f"Application(s) #{', #'.join(map(str, sorted(missing)))} no longer exist — refresh the page and pick again.")
    return rows


def _store_item(db: Session, item_id: int | None, product_id: int | None) -> None:
    if item_id is None:
        return
    if not db.get(StoreItem, item_id):
        raise HTTPException(status_code=422, detail=f"Store item #{item_id} not found — pick the finished-good item again from the list.")
    other = db.query(FinishedProduct).filter(FinishedProduct.store_item_id == item_id, FinishedProduct.id != (product_id or 0)).first()
    if other:
        raise HTTPException(status_code=409, detail=f"That store item is already linked to product {other.code} ({other.name}) — one stock item can represent only one product.")


def _specs(rows: list[ProductSpecificationPayload]) -> list[ProductSpecification]:
    out = []
    for i, s in enumerate(rows):
        parameter, value = (s.parameter or "").strip(), (s.value or "").strip()
        if not parameter and not value:
            continue
        if not parameter or not value:
            raise HTTPException(status_code=422, detail=f"Specification row {i + 1} needs both a parameter and a value (e.g. Max speed on rail = 40).")
        out.append(ProductSpecification(sort_order=len(out), parameter=parameter, value=value, unit=(s.unit or "").strip() or None))
    return out


def _out(p: FinishedProduct) -> ProductResponse:
    out = ProductResponse.model_validate(p)
    if p.store_item:
        out.store_item_code = p.store_item.item_code
        out.store_item_name = p.store_item.item_name
    out.created_by_name = p.created_by.name if p.created_by else None
    return out


def _get(db: Session, product_id: int, user: User | None = None) -> FinishedProduct:
    p = (
        db.query(FinishedProduct)
        .options(selectinload(FinishedProduct.applications), selectinload(FinishedProduct.specifications))
        .filter(FinishedProduct.id == product_id)
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail=f"Product #{product_id} not found — it may have been deleted; go back to the product list.")
    if user is not None:
        ensure_in_scope(db, user, p)  # 403 when outside the user's Products data scope
    return p


@router.get("/meta")
async def product_meta():
    return {
        "types": [{"value": k, "label": PRODUCT_TYPE_LABELS[k]} for k in PRODUCT_TYPES],
        "statuses": [{"value": k, "label": PRODUCT_STATUS_LABELS[k]} for k in PRODUCT_STATUSES],
    }


@router.get("/lookups/store-items")
async def lookup_store_items(search: str = "", db: Session = Depends(get_db)):
    """Store items to link as a product's finished-good stock item. Lives here
    so Product Management users don't need the Store app to pick one."""
    q = db.query(StoreItem).filter(StoreItem.status == "active")
    term = search.strip()
    if term:
        like = f"%{term}%"
        q = q.filter(or_(StoreItem.item_code.ilike(like), StoreItem.item_name.ilike(like), StoreItem.model.ilike(like)))
    rows = q.order_by(StoreItem.item_name).limit(30).all()
    return [{"id": r.id, "item_code": r.item_code, "item_name": r.item_name, "uom": r.uom, "hsn_sac_code": r.hsn_sac_code} for r in rows]


@router.get("", response_model=list[ProductResponse])
async def list_products(
    search: str = "", product_type: str = "", status: str = "", application_id: int | None = None,
    db: Session = Depends(get_db), user: User = Depends(require_app_access("products")),
):
    q = apply_scope(
        db.query(FinishedProduct).options(selectinload(FinishedProduct.applications), selectinload(FinishedProduct.specifications)),
        user, FinishedProduct,
    )
    term = search.strip()
    if term:
        like = f"%{term}%"
        q = q.filter(or_(FinishedProduct.code.ilike(like), FinishedProduct.name.ilike(like), FinishedProduct.model_number.ilike(like)))
    if product_type:
        q = q.filter(FinishedProduct.product_type == product_type)
    if status:
        q = q.filter(FinishedProduct.status == status)
    if application_id:
        q = q.filter(FinishedProduct.applications.any(ProductApplication.id == application_id))
    return [_out(p) for p in q.order_by(FinishedProduct.name).all()]


@router.post("", response_model=ProductResponse)
async def create_product(payload: ProductCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    code = _norm_code(payload.code)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Product name is required, e.g. RRB Sanding Vehicle.")
    _check_choices(payload.product_type, payload.status)
    _check_numbers(payload.warranty_months)
    existing = db.query(FinishedProduct).filter(func.upper(FinishedProduct.code) == code).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Product code '{code}' is already used by {existing.name} — codes are unique; pick another code or edit that product.")
    _store_item(db, payload.store_item_id, None)
    p = FinishedProduct(
        code=code, name=name, product_type=payload.product_type, status=payload.status,
        model_number=(payload.model_number or "").strip() or None,
        short_description=(payload.short_description or "").strip() or None,
        description=(payload.description or "").strip() or None,
        hsn_code=(payload.hsn_code or "").strip() or None,
        uom=(payload.uom or "").strip() or "Nos",
        warranty_months=payload.warranty_months, store_item_id=payload.store_item_id, created_by_id=user.id,
    )
    p.applications = _applications(db, payload.application_ids)
    p.specifications = _specs(payload.specifications)
    db.add(p)
    db.commit()
    return _out(_get(db, p.id))


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(product_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("products"))):
    return _out(_get(db, product_id, user))


@router.patch("/{product_id}", response_model=ProductResponse)
async def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    p = _get(db, product_id, user)
    data = payload.model_dump(exclude_unset=True)
    _check_choices(data.get("product_type"), data.get("status"))
    _check_numbers(data.get("warranty_months"))
    if "name" in data:
        data["name"] = (data["name"] or "").strip()
        if not data["name"]:
            raise HTTPException(status_code=422, detail="Product name can't be blank.")
    for field in ("product_type", "status"):
        if field in data and data[field] is None:
            data.pop(field)
    if "store_item_id" in data:
        _store_item(db, data["store_item_id"], p.id)
    app_ids = data.pop("application_ids", None)
    specs = data.pop("specifications", None)
    for field in ("model_number", "short_description", "description", "hsn_code"):
        if field in data:
            data[field] = (data[field] or "").strip() or None
    if "uom" in data:
        data["uom"] = (data["uom"] or "").strip() or "Nos"
    for k, v in data.items():
        setattr(p, k, v)
    if app_ids is not None:
        p.applications = _applications(db, app_ids)
    if specs is not None:
        p.specifications = _specs([ProductSpecificationPayload(**s) for s in specs])
    db.commit()
    return _out(_get(db, p.id))


@router.delete("/{product_id}")
async def delete_product(product_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("products"))):
    p = _get(db, product_id, user)
    ensure_can_delete(user, p, "products", "products", "product")
    if p.status != "development":
        raise HTTPException(
            status_code=409,
            detail=f"{p.code} is {PRODUCT_STATUS_LABELS.get(p.status, p.status)} — only a product still in development can be deleted. "
                   "Set its status to Discontinued instead so its history is kept.",
        )
    db.delete(p)
    db.commit()
    return {"ok": True}
