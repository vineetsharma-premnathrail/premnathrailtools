"""Item Master link for purchase lines.

Every PR line is picked from the Store Item Master; its id travels PR line →
PO line → GRN line, and the GRN posts stock against that id. A new item is
added to the Item Master first, then selected — lines are never matched to
the master by name."""
from fastapi import HTTPException
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
