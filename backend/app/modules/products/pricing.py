"""Price determination from the pricing conditions (SAP VK11 records, read the
way an SD pricing procedure reads them — but with a fixed, coded order).

For an item (product / spare / service rate), a customer and a day:

  price     customer price record for the item, else the list record
  min price from the record the price came from (else the list record)
  discount  customer discount for the item, else the customer-wide
            discount (item kind 'any'), else none
  freight   customer freight record, else the list freight record

Only active records valid on the day count. Overlaps are refused when a
record is saved (check_overlap), so at most one record matches each step.

Documents (SO lines, quotation lines, service invoices) call resolve() to
default their price. A user may still type a different price or a higher
discount, but must give a reason (kept on the line, shown to approvers);
a net price below the minimum is a deviation that needs approval."""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.products.models.price_condition import (
    FREIGHT_BASES, PRICE_CONDITION_TYPES, PRICE_CONDITION_TYPE_LABELS, PRICE_ITEM_KINDS, SERVICE_RATE_CODES,
    SERVICE_RATE_LABELS, ProductPriceCondition,
)


def _live(db: Session, condition_type: str, on: date):
    return db.query(ProductPriceCondition).filter(
        ProductPriceCondition.condition_type == condition_type,
        ProductPriceCondition.is_active == True,  # noqa: E712
        ProductPriceCondition.valid_from <= on,
        or_(ProductPriceCondition.valid_to.is_(None), ProductPriceCondition.valid_to >= on),
    )


def _item_filter(q, *, product_id=None, store_item_id=None, service_code=None):
    if product_id:
        return q.filter(ProductPriceCondition.item_kind == "product", ProductPriceCondition.product_id == product_id)
    if store_item_id:
        return q.filter(ProductPriceCondition.item_kind == "spare", ProductPriceCondition.store_item_id == store_item_id)
    if service_code:
        return q.filter(ProductPriceCondition.item_kind == "service", ProductPriceCondition.service_code == service_code)
    return q.filter(ProductPriceCondition.item_kind == "any")


def _one(q, customer_id):
    if customer_id is None:
        return (q.filter(ProductPriceCondition.customer_id.is_(None), ProductPriceCondition.country.is_(None))
                .order_by(ProductPriceCondition.valid_from.desc()).first())
    return q.filter(ProductPriceCondition.customer_id == customer_id).order_by(ProductPriceCondition.valid_from.desc()).first()


def _country_one(q, country: str | None):
    if not country:
        return None
    return (q.filter(ProductPriceCondition.customer_id.is_(None), func.lower(ProductPriceCondition.country) == country.strip().lower())
            .order_by(ProductPriceCondition.valid_from.desc()).first())


def resolve(db: Session, *, product_id: int | None = None, store_item_id: int | None = None, service_code: str | None = None,
            customer_id: int | None = None, on: date | None = None) -> dict:
    on = on or date.today()
    item = {"product_id": product_id, "store_item_id": store_item_id, "service_code": service_code}
    has_item = any(item.values())
    out = {"on": on, "price": None, "price_source": None, "price_condition_id": None, "list_price": None,
           "customer_price": None, "min_price": None, "uom": None, "discount_percent": 0.0, "discount_condition_id": None,
           "freight": None, "country_price": None, "country": None, "currency": None}
    if has_item:
        q = _item_filter(_live(db, "price", on), **item)
        lst = _one(q, None)
        cust = _one(q, customer_id) if customer_id else None
        country = None
        if customer_id:
            from app.modules.crm.models.organization import Organization
            org = db.get(Organization, customer_id)
            country = org.country if org is not None else None
        ctry = _country_one(q, country)
        chosen = cust or ctry or lst
        if lst is not None:
            out["list_price"] = float(lst.amount or 0)
        if cust is not None:
            out["customer_price"] = float(cust.amount or 0)
        if ctry is not None:
            out.update(country_price=float(ctry.amount or 0), country=ctry.country)
        if chosen is not None:
            source = "customer" if chosen is cust else "country" if chosen is ctry else "list"
            out.update(price=float(chosen.amount or 0), price_source=source, currency=chosen.currency,
                       price_condition_id=chosen.id, uom=chosen.uom)
            floor = chosen.min_price if chosen.min_price is not None else (lst.min_price if lst is not None else None)
            out["min_price"] = float(floor) if floor is not None else None
    if customer_id:
        disc = None
        if has_item:
            disc = _one(_item_filter(_live(db, "discount", on), **item), customer_id)
        disc = disc or _one(_item_filter(_live(db, "discount", on)), customer_id)
        if disc is not None:
            out["discount_percent"] = float(disc.percent or 0)
            out["discount_condition_id"] = disc.id
    fq = _item_filter(_live(db, "freight", on))
    fr = (_one(fq, customer_id) if customer_id else None) or _one(fq, None)
    if fr is not None:
        out["freight"] = {"condition_id": fr.id, "basis": fr.freight_basis or "per_order",
                          "amount": float(fr.amount) if fr.amount is not None else None,
                          "percent": float(fr.percent) if fr.percent is not None else None,
                          "customer_specific": fr.customer_id is not None}
    return out


def freight_amount(resolved: dict, order_value: float) -> float | None:
    fr = resolved.get("freight")
    if not fr:
        return None
    if fr["basis"] == "percent":
        return round(float(order_value or 0) * float(fr["percent"] or 0) / 100, 2)
    return round(float(fr["amount"] or 0), 2)


def override_problem(resolved: dict, *, unit_price: float, discount_percent: float, label: str) -> str | None:
    """Why a typed price / discount differs from the conditions, or None."""
    if resolved.get("price") is not None and abs(float(unit_price or 0) - resolved["price"]) > 0.005:
        src = "customer price" if resolved["price_source"] == "customer" else "list price"
        return (f"{label}: the {src} on {resolved['on']:%d-%m-%Y} is ₹{resolved['price']:,.2f} but ₹{float(unit_price or 0):,.2f} "
                "was entered")
    if float(discount_percent or 0) > float(resolved.get("discount_percent") or 0) + 0.0005:
        return (f"{label}: the customer's agreed discount is {float(resolved.get('discount_percent') or 0):g}% but "
                f"{float(discount_percent or 0):g}% was entered")
    return None


def below_min(resolved: dict, *, unit_price: float, discount_percent: float) -> bool:
    floor = resolved.get("min_price")
    if floor is None:
        return False
    net = float(unit_price or 0) * (1 - float(discount_percent or 0) / 100)
    return net + 0.005 < float(floor)


# ── Saving a condition record ───────────────────────────────────────────

def validate(db: Session, data: dict, *, exclude_id: int | None = None) -> dict:
    """Normalises and checks one record (dict of model fields). Raises 422 /
    409 with the real reason."""
    from app.modules.crm.models.organization import Organization
    from app.modules.products.models.product import FinishedProduct
    from app.modules.store.models.item import StoreItem

    ctype, kind = data.get("condition_type"), data.get("item_kind")
    if ctype not in PRICE_CONDITION_TYPES:
        raise HTTPException(status_code=422, detail="Condition type must be Price, Discount or Freight.")
    if kind not in PRICE_ITEM_KINDS:
        raise HTTPException(status_code=422, detail="Pick what the condition is for: a product, a spare, a service rate, or all items.")
    label = PRICE_CONDITION_TYPE_LABELS[ctype]
    # Exactly the one item column of the kind; the others are cleared.
    for col in ("product_id", "store_item_id", "service_code"):
        if col != {"product": "product_id", "spare": "store_item_id", "service": "service_code"}.get(kind):
            data[col] = None
    if kind == "product":
        if not data.get("product_id") or not db.get(FinishedProduct, data["product_id"]):
            raise HTTPException(status_code=422, detail="Pick the product this condition is for (Sales › Products).")
    elif kind == "spare":
        if not data.get("store_item_id") or not db.get(StoreItem, data["store_item_id"]):
            raise HTTPException(status_code=422, detail="Pick the spare from the Item Master — spares are priced by item, never by name.")
    elif kind == "service":
        if data.get("service_code") not in SERVICE_RATE_CODES:
            raise HTTPException(status_code=422, detail="Pick the service rate: " + ", ".join(SERVICE_RATE_LABELS.values()) + ".")
    if ctype == "price" and kind == "any":
        raise HTTPException(status_code=422, detail="A price is always for one item — pick the product, spare or service rate.")
    if ctype == "freight" and kind != "any":
        raise HTTPException(status_code=422, detail="Freight is charged per order, not per item — set 'For' to All items.")
    # Finished products are priced by country, never per customer (owner, 2026-10-29).
    if kind == "product" and (ctype != "price" or data.get("customer_id")):
        raise HTTPException(status_code=422, detail="A product is priced by country, not by customer — add a list price "
                                                    "(blank country) or a price for one country.")
    if ctype == "discount" and not data.get("customer_id"):
        raise HTTPException(status_code=422, detail="A discount is agreed with a customer — pick the customer. "
                                                    "(For everyone, lower the list price instead.)")
    if data.get("customer_id") and not db.get(Organization, data["customer_id"]):
        raise HTTPException(status_code=422, detail=f"Customer #{data['customer_id']} isn't in CRM any more — pick the customer again.")
    # Country price: for every customer in that country (a customer price is already specific).
    data["country"] = (data.get("country") or "").strip() or None
    if data["country"]:
        if data.get("customer_id"):
            raise HTTPException(status_code=422, detail="Pick a customer or a country, not both — a customer price already applies "
                                                        "to that one customer wherever it is.")
        if ctype != "price":
            raise HTTPException(status_code=422, detail="A country can be set on a price only. For a discount, pick the customer.")
    # Currency: any active currency of Finance's currency master (Finance › Masters › Currencies & FX).
    cur = (data.get("currency") or "INR").strip().upper()
    if cur != "INR":
        from app.modules.accounts.services import fx
        try:
            cur = fx.normalise_currency(db, cur)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    data["currency"] = cur

    if ctype == "price":
        if data.get("amount") is None or float(data["amount"]) < 0:
            raise HTTPException(status_code=422, detail=f"Enter the rate ({data['currency']} per unit, 0 or more).")
        data["percent"], data["freight_basis"] = None, None
        if data.get("min_price") is not None:
            if float(data["min_price"]) < 0:
                raise HTTPException(status_code=422, detail="Minimum price can't be negative.")
            if float(data["min_price"]) > float(data["amount"]):
                raise HTTPException(status_code=422, detail=f"Minimum price ₹{float(data['min_price']):,.2f} is above the rate "
                                                            f"₹{float(data['amount']):,.2f} — the floor must be at or below the price.")
    elif ctype == "discount":
        p = data.get("percent")
        if p is None or not 0 < float(p) <= 100:
            raise HTTPException(status_code=422, detail="Enter the discount % (more than 0, up to 100).")
        data["amount"], data["min_price"], data["freight_basis"] = None, None, None
    else:
        basis = data.get("freight_basis") or "per_order"
        if basis not in FREIGHT_BASES:
            raise HTTPException(status_code=422, detail="Freight basis must be 'per order' (amount) or '% of order value'.")
        data["freight_basis"] = basis
        if basis == "percent":
            if data.get("percent") is None or not 0 < float(data["percent"]) <= 100:
                raise HTTPException(status_code=422, detail="Enter the freight % of the order value (more than 0, up to 100).")
            data["amount"] = None
        else:
            if data.get("amount") is None or float(data["amount"]) <= 0:
                raise HTTPException(status_code=422, detail="Enter the freight amount per order (₹, more than 0).")
            data["percent"] = None
        data["min_price"] = None

    vf, vt = data.get("valid_from"), data.get("valid_to")
    if not vf:
        raise HTTPException(status_code=422, detail="Enter the 'valid from' date.")
    if vt and vt < vf:
        raise HTTPException(status_code=422, detail=f"'Valid to' ({vt:%d-%m-%Y}) is before 'valid from' ({vf:%d-%m-%Y}).")
    if data.get("is_active", True):
        check_overlap(db, data, exclude_id=exclude_id)
    return data


def check_overlap(db: Session, data: dict, *, exclude_id: int | None = None) -> None:
    q = db.query(ProductPriceCondition).filter(
        ProductPriceCondition.condition_type == data["condition_type"],
        ProductPriceCondition.item_kind == data["item_kind"],
        ProductPriceCondition.is_active == True,  # noqa: E712
    )
    for col in ("product_id", "store_item_id", "service_code", "customer_id", "country"):
        v = data.get(col)
        q = q.filter(getattr(ProductPriceCondition, col).is_(None) if v is None else getattr(ProductPriceCondition, col) == v)
    if exclude_id:
        q = q.filter(ProductPriceCondition.id != exclude_id)
    vf, vt = data["valid_from"], data.get("valid_to")
    for other in q.all():
        o_to = other.valid_to or date.max
        if vf <= o_to and (vt or date.max) >= other.valid_from:
            till = f"{other.valid_to:%d-%m-%Y}" if other.valid_to else "open-ended"
            raise HTTPException(
                status_code=409,
                detail=f"This overlaps price record #{other.id} (valid {other.valid_from:%d-%m-%Y} to {till}) for the same item, "
                       "customer and country — only one record may apply on a day. End the old record the day before the new one starts "
                       "(set its 'valid to'), then save this one.",
            )
