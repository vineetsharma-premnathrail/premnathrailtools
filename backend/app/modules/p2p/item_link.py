"""Item Master link for purchase lines.

Every PR line is picked from the Store Item Master; its id travels PR line →
PO line → GRN line, and the GRN posts stock against that id. A new item is
added to the Item Master first, then selected — lines are never matched to
the master by name.

Manual lines (owner, 2026-11-18 — "for now"): a PR line may instead be typed
(type + category + name + technical details + unit) when the item isn't in the
Item Master yet. It has no store_item_id; Store gives it an item code on the
GRN (pick an existing item or quick-add a new one), which links the PO line and
the PR line before the stock posts. Its technical details are kept in the
line's name ("Name — details") so the buyer, RFQ, PO and GRN all show them."""
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem


def purchasable_item(db: Session, store_item_id: int | None, label: str) -> StoreItem:
    """The active Item Master row for a purchase line, or a 422 that says
    what to do. `label` names the line in the message (e.g. "Line 2")."""
    item = db.get(StoreItem, store_item_id) if store_item_id else None
    if item is None:
        raise HTTPException(
            status_code=422,
            detail=f"{label}: pick the item from the Item Master. If it's a new item, add it first in "
                   "Store › Item Master, then select it here.",
        )
    if item.status != "active":
        raise HTTPException(
            status_code=422,
            detail=f"{label}: {item.item_code} {item.item_name} is {item.status} in the Item Master, so it can't be "
                   "purchased. Pick another item, or ask Store to make it active again.",
        )
    return item


def item_snapshot(item: StoreItem) -> dict:
    """Fields a purchase line copies from the Item Master when it is raised —
    a record of what was asked for, even if the master is edited later."""
    return {
        "store_item_id": item.id,
        "item_name": item.item_name,
        "part_code": item.part_number or item.manufacturer_part_number,
        "unit": item.uom,
        "category": item.category,
    }


def item_category_for(db: Session, store_item_id: int | None) -> str:
    """PO item category (stock / service / asset) for a line, from its Item
    Master item type — set when the PO line is drafted and shown read-only."""
    from app.modules.p2p.models.purchase_order import po_item_category_for_type

    item = db.get(StoreItem, store_item_id) if store_item_id else None
    return po_item_category_for_type(item.item_type if item is not None else None)


MANUAL_SEP = " — "


def manual_line(db: Session, line, label: str) -> SimpleNamespace:
    """A typed PR line (no Item Master item yet) checked and shaped like an
    Item Master row, so the PR code can treat both alike (`id` is None).
    `line` is the payload line: item_name, specification, item_type, category,
    unit, make, part_code. 422 naming the line and the fix otherwise."""
    from app.modules.store.models.category import StoreItemCategory
    from app.modules.store.models.item import STORE_ITEM_TYPES

    name = (getattr(line, "item_name", "") or "").strip()
    spec = (getattr(line, "specification", None) or "").strip()
    item_type = (getattr(line, "item_type", None) or "").strip().lower()
    category = (getattr(line, "category", None) or "").strip()
    unit = (getattr(line, "unit", None) or "").strip().upper()
    if not name:
        raise HTTPException(status_code=422, detail=f"{label}: type the item name, or pick the item from the Item Master.")
    who = f"{label} ({name})"
    # For now (owner, 2026-11-18) the PR form has no Item Type and the category
    # is typed by hand. A typed category that matches an Item Master category
    # takes that category's exact name and type (so its buyer gets the line);
    # any other text is kept as typed and Purchase assigns the buyer by hand.
    if not category:
        raise HTTPException(status_code=422, detail=f"{who}: type the category (e.g. Hydraulics, Electrical) — it decides which buyer gets this line.")
    if len(category) > 100:
        raise HTTPException(status_code=422, detail=f"{who}: the category is {len(category)} characters — keep it within 100.")
    cat = (db.query(StoreItemCategory)
           .filter(func.lower(StoreItemCategory.name) == category.lower(), StoreItemCategory.is_active.is_(True)).first())
    if cat is not None:
        category = cat.name
        item_type = cat.item_type or item_type
    if item_type not in STORE_ITEM_TYPES:
        item_type = None
    if not unit:
        raise HTTPException(status_code=422, detail=f"{who}: type the unit (UOM) the quantity is counted in — NOS, KG, MTR…")
    # Typed by hand for now (owner, 2026-11-18): any unit, kept upper-case.
    if len(unit) > 20:
        raise HTTPException(status_code=422, detail=f"{who}: the unit '{unit}' is {len(unit)} characters — keep it within 20 (e.g. NOS, KG, MTR).")
    full = f"{name}{MANUAL_SEP}{spec}" if spec else name
    if len(full) > 255:
        raise HTTPException(status_code=422, detail=f"{who}: the name and technical details together are {len(full)} characters — keep them within 255 (attach a specification file for the full details).")
    return SimpleNamespace(
        id=None, item_code="", item_name=full, item_type=item_type, category=category, uom=unit,
        make=(getattr(line, "make", None) or "").strip() or None,
        part_number=(getattr(line, "part_code", None) or "").strip() or None, manufacturer_part_number=None,
        status="active",
    )
