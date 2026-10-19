"""Sales order line pricing from the pricing conditions (products/pricing.py).

On every line save (draft or amendment) sales/service.apply_lines calls
apply_line_pricing:

  - product_id (Product Management master) or a spare's Item Master item
    (product_item_id on a spares line) picks the condition records;
  - the price on the order's PO date (else today) for the order's customer
    is copied to `list_price`; a line saved with no price (0) takes it, and
    a line with no discount takes the customer's agreed discount;
  - HSN / UoM default from the product when blank;
  - a typed price that differs from the conditions, or a higher discount,
    needs `price_override_reason` (422 otherwise). Lines whose price and
    discount didn't change in this save are not re-checked, so a later
    price-list change never blocks editing an old line.

line_deviation_flags adds 'price_below_list' at submit when a line's net
price is under the condition's minimum price — a deviation the approval
workflow escalates like the other non-standard terms."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.products import pricing


def price_key(ln) -> dict | None:
    if ln.product_id:
        return {"product_id": ln.product_id}
    if ln.line_type == "spares" and ln.product_item_id:
        return {"store_item_id": ln.product_item_id}
    return None


def _day(so) -> date:
    return so.customer_po_date or date.today()


def apply_line_pricing(db: Session, so, ln, data: dict, *, was: tuple | None, label: str) -> str | None:
    """Returns the problem text (caller raises 422) or None. `was` is the
    line's (unit_price, discount_percent, product key) before this save, None for a new line."""
    from app.modules.products.models.product import FinishedProduct

    if ln.product_id:
        p = db.get(FinishedProduct, ln.product_id)
        if p is None:
            return f"{label}: product #{ln.product_id} isn't in the product master any more — pick the product again."
        if not (ln.hsn_sac_code or "").strip() and p.hsn_code:
            ln.hsn_sac_code = p.hsn_code
        if not (ln.uom or "").strip() and p.uom:
            ln.uom = p.uom
    key = price_key(ln)
    reason = (data.get("price_override_reason") or "").strip() or None
    if key is None:
        ln.list_price, ln.price_condition_id = None, None
        ln.price_override_reason = reason
        return None
    r = pricing.resolve(db, customer_id=so.customer_id, on=_day(so), **key)
    if r["price"] is None:
        ln.list_price, ln.price_condition_id = None, None
        ln.price_override_reason = reason
        return None
    ln.list_price, ln.price_condition_id = r["price"], r["price_condition_id"]
    if not float(ln.unit_price or 0):
        ln.unit_price = r["price"]
    if not float(ln.discount_percent or 0) and r["discount_percent"]:
        ln.discount_percent = r["discount_percent"]
    changed = was is None or abs(float(was[0] or 0) - float(ln.unit_price or 0)) > 0.005 \
        or abs(float(was[1] or 0) - float(ln.discount_percent or 0)) > 0.0005 or was[2] != key
    problem = pricing.override_problem(r, unit_price=ln.unit_price, discount_percent=ln.discount_percent, label=label)
    if problem is None:
        ln.price_override_reason = None
        return None
    if reason:
        ln.price_override_reason = reason
        return None
    if not changed and ln.price_override_reason:
        return None
    if not changed:
        return None  # untouched line priced before the current conditions
    return problem + " — enter a reason for the manual price (it is shown to the approvers), or use the price-list price."


def line_deviation_flags(db: Session, so) -> list[str]:
    for ln in so.lines:
        key = price_key(ln)
        if key is None:
            continue
        r = pricing.resolve(db, customer_id=so.customer_id, on=_day(so), **key)
        if pricing.below_min(r, unit_price=ln.unit_price, discount_percent=ln.discount_percent):
            return ["price_below_list"]
    return []


def freight_suggestion(db: Session, so) -> dict | None:
    """The freight condition for the order's customer, as a line to add."""
    r = pricing.resolve(db, customer_id=so.customer_id, on=_day(so))
    taxable = sum(float(ln.taxable_amount or 0) for ln in so.lines if ln.line_type != "freight")
    amount = pricing.freight_amount(r, taxable)
    if amount is None:
        return None
    return {"condition_id": r["freight"]["condition_id"], "amount": amount, "basis": r["freight"]["basis"],
            "percent": r["freight"]["percent"], "on_value": round(taxable, 2)}
