"""Pricing conditions (country prices inside a product) and the price lookup
documents use to default their line prices.

Reading (list + resolve) is open to CRM and Service users — each of them
prices something. Maintaining the records is the feature CRM › Products ›
Pricing (create / edit / delete in the Permission Matrix); it needs no other
tab than Products (moved from Sales on 2026-10-30)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_any_app_access, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.products import pricing
from app.modules.products.models.price_condition import (
    FREIGHT_BASES, PRICE_CONDITION_TYPE_LABELS, PRICE_ITEM_KIND_LABELS, SERVICE_RATE_LABELS, SERVICE_RATE_UOM,
    ProductPriceCondition,
)
from app.modules.products.schemas.price_condition import (
    ProductPriceConditionCreate, ProductPriceConditionResponse, ProductPriceConditionUpdate,
)

router = APIRouter(prefix="/products/price-conditions", tags=["Products - Pricing"])

_READ = require_any_app_access("crm", "erp")
_CAN_CREATE = require_feature_action("crm", "products", "pricing", "create")
_CAN_EDIT = require_feature_action("crm", "products", "pricing", "edit")
_CAN_DELETE = require_feature_action("crm", "products", "pricing", "delete")


def _item_label(c: ProductPriceCondition) -> str:
    if c.item_kind == "product" and c.product is not None:
        return f"{c.product.code} — {c.product.name}"
    if c.item_kind == "spare" and c.store_item is not None:
        return f"{c.store_item.item_code} — {c.store_item.item_name}"
    if c.item_kind == "service":
        return SERVICE_RATE_LABELS.get(c.service_code or "", c.service_code or "")
    return "All items"


def _out(c: ProductPriceCondition, today: date | None = None) -> ProductPriceConditionResponse:
    today = today or date.today()
    out = ProductPriceConditionResponse.model_validate(c)
    out.item_label = _item_label(c)
    out.customer_name = c.customer.name if c.customer is not None else None
    out.is_current = bool(c.is_active and c.valid_from <= today and (c.valid_to is None or c.valid_to >= today))
    return out


def _get(db: Session, cid: int) -> ProductPriceCondition:
    c = db.get(ProductPriceCondition, cid)
    if c is None:
        raise HTTPException(status_code=404, detail=f"Price condition #{cid} not found — it may have been deleted; reload the list.")
    return c


@router.get("/meta")
async def meta(_user: User = Depends(_READ)):
    return {
        "condition_types": [{"value": k, "label": v} for k, v in PRICE_CONDITION_TYPE_LABELS.items()],
        "item_kinds": [{"value": k, "label": v} for k, v in PRICE_ITEM_KIND_LABELS.items()],
        "service_codes": [{"value": k, "label": v, "uom": SERVICE_RATE_UOM[k]} for k, v in SERVICE_RATE_LABELS.items()],
        "freight_bases": [{"value": k, "label": "Per order (₹)" if k == "per_order" else "% of order value"} for k in FREIGHT_BASES],
    }


@router.get("/lookups/items")
async def lookup_items(kind: str = "product", search: str = "", db: Session = Depends(get_db), _user: User = Depends(_READ)):
    """Pick-list for the condition form: products (master) or spares (Item
    Master) — here so Sales users don't need the Products / Store apps."""
    from sqlalchemy import or_
    from app.modules.products.models.product import FinishedProduct
    from app.modules.store.models.item import StoreItem
    like = f"%{search.strip()}%" if search.strip() else None
    if kind == "spare":
        q = db.query(StoreItem).filter(StoreItem.status == "active")
        if like:
            q = q.filter(or_(StoreItem.item_code.ilike(like), StoreItem.item_name.ilike(like)))
        return [{"id": r.id, "label": f"{r.item_code} — {r.item_name}", "uom": r.uom} for r in q.order_by(StoreItem.item_name).limit(40).all()]
    q = db.query(FinishedProduct).filter(FinishedProduct.status != "discontinued")
    if like:
        q = q.filter(or_(FinishedProduct.code.ilike(like), FinishedProduct.name.ilike(like), FinishedProduct.model_number.ilike(like)))
    return [{"id": p.id, "label": f"{p.code} — {p.name}", "uom": p.uom} for p in q.order_by(FinishedProduct.name).limit(200).all()]


@router.get("/convert")
async def convert_price(amount: float, currency: str = "INR", on: date | None = None,
                        db: Session = Depends(get_db), _user: User = Depends(_READ)):
    """A price in every active currency at Finance's exchange rate in force on the
    day (Finance › Masters › Currencies & FX: 1 unit = rate INR). A currency with
    no rate yet comes back without an amount and says where to enter the rate."""
    from app.modules.accounts.models.fx import BOOKS_CURRENCY, Currency
    from app.modules.accounts.services import fx
    on = on or date.today()
    src = (currency or BOOKS_CURRENCY).upper()
    try:
        inr = amount * fx.rate_on(db, src, on)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    out = []
    for c in db.query(Currency).filter(Currency.is_active == True).order_by(Currency.code).all():  # noqa: E712
        row = {"currency": c.code, "name": c.name, "symbol": c.symbol, "rate": None, "amount": None, "note": None}
        try:
            rate = fx.rate_on(db, c.code, on)
            row.update(rate=rate, amount=round(inr / rate, 2))
        except ValueError:
            row["note"] = f"No exchange rate for {c.code} yet — enter it under Finance › Masters › Currencies & FX."
        out.append(row)
    if not any(r["currency"] == BOOKS_CURRENCY for r in out):
        out.insert(0, {"currency": BOOKS_CURRENCY, "name": "Indian Rupee", "symbol": "₹", "rate": 1.0, "amount": round(inr, 2), "note": None})
    return {"on": on, "amount": amount, "currency": src, "inr": round(inr, 2), "rows": out}


@router.get("/resolve")
async def resolve_price(
    product_id: int | None = None, store_item_id: int | None = None, service_code: str | None = None,
    customer_id: int | None = None, on: date | None = None,
    db: Session = Depends(get_db), _user: User = Depends(_READ),
):
    """The price, discount and freight that apply to an item for a customer
    on a day — what a document line defaults to."""
    if sum(1 for x in (product_id, store_item_id, service_code) if x) > 1:
        raise HTTPException(status_code=422, detail="Ask for one item at a time: a product, a spare or a service rate.")
    return pricing.resolve(db, product_id=product_id, store_item_id=store_item_id, service_code=service_code,
                           customer_id=customer_id, on=on)


@router.get("", response_model=list[ProductPriceConditionResponse])
async def list_conditions(
    condition_type: str | None = None, item_kind: str | None = None, product_id: int | None = None,
    store_item_id: int | None = None, customer_id: int | None = None, current_only: bool = False,
    include_inactive: bool = False, db: Session = Depends(get_db), _user: User = Depends(_READ),
):
    q = db.query(ProductPriceCondition)
    if condition_type:
        q = q.filter(ProductPriceCondition.condition_type == condition_type)
    if item_kind:
        q = q.filter(ProductPriceCondition.item_kind == item_kind)
    if product_id:
        q = q.filter(ProductPriceCondition.product_id == product_id)
    if store_item_id:
        q = q.filter(ProductPriceCondition.store_item_id == store_item_id)
    if customer_id:
        q = q.filter(ProductPriceCondition.customer_id == customer_id)
    if not include_inactive:
        q = q.filter(ProductPriceCondition.is_active == True)  # noqa: E712
    today = date.today()
    rows = [_out(c, today) for c in q.order_by(ProductPriceCondition.condition_type, ProductPriceCondition.valid_from.desc()).limit(2000).all()]
    return [r for r in rows if r.is_current] if current_only else rows


@router.post("", response_model=ProductPriceConditionResponse, status_code=201)
async def create_condition(payload: ProductPriceConditionCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    data = pricing.validate(db, payload.model_dump())
    data["uom"] = (data.get("uom") or "").strip() or None
    data["remarks"] = (data.get("remarks") or "").strip() or None
    c = ProductPriceCondition(**data, created_by_id=user.id)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _out(c)


@router.patch("/{cid}", response_model=ProductPriceConditionResponse)
async def update_condition(cid: int, payload: ProductPriceConditionUpdate, db: Session = Depends(get_db),
                           _user: User = Depends(_CAN_EDIT)):
    """Rate, validity and status change; the key (type, item, customer)
    doesn't — end the record and create a new one for a different key."""
    c = _get(db, cid)
    changes = payload.model_dump(exclude_unset=True)
    keys = ("condition_type", "item_kind", "product_id", "store_item_id", "service_code", "customer_id", "country", "amount", "percent",
            "freight_basis", "min_price", "uom", "currency", "valid_from", "valid_to", "is_active", "remarks")
    data = {k: getattr(c, k) for k in keys}
    data.update({k: v for k, v in changes.items() if not (k in ("valid_from", "is_active") and v is None)})
    data = pricing.validate(db, data, exclude_id=c.id)
    for k in keys:
        setattr(c, k, data.get(k))
    c.uom = (c.uom or "").strip() or None
    c.remarks = (c.remarks or "").strip() or None
    db.commit()
    db.refresh(c)
    return _out(c)


@router.delete("/{cid}")
async def delete_condition(cid: int, db: Session = Depends(get_db), _user: User = Depends(_CAN_DELETE)):
    """Removes a record. Lines already priced from it keep their price — the
    rate is copied onto the line, so history never changes."""
    c = _get(db, cid)
    db.delete(c)
    db.commit()
    return {"ok": True}
