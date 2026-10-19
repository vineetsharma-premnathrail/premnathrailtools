"""Material master plant views — the one reader every planner uses.

`plant_view(db, item, branch_id)` returns the planning data of an item at a
plant: the plant row's value where it is filled in (store_item_plants), else
the company-wide Item Master field. Store reorder (services/reorder.py),
Production MRP and P2P purchasing checks all read through here, so a plant
override is honoured everywhere and single-plant setups (no plant rows)
behave exactly as before.

Keys returned (PLANT_FIELDS + meta):
  reorder_level, safety_stock, minimum_stock, maximum_stock, reorder_quantity,
  lead_time_days, inhouse_production_days, default_location_id, mrp_type,
  procurement_type, purchasing_blocked, branch_id, plant_row_id,
  source ("plant" when a plant row exists, else "item")."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem
from app.modules.store.models.item_plant import STORE_MRP_TYPES, STORE_PROCUREMENT_TYPES, StoreItemPlant

# Plant field -> Item Master fallback field (None = no company-wide equivalent).
PLANT_FIELDS: dict[str, str | None] = {
    "reorder_level": "reorder_level",
    "safety_stock": "safety_stock",
    "minimum_stock": "minimum_stock",
    "maximum_stock": "maximum_stock",
    "reorder_quantity": "reorder_quantity",
    "lead_time_days": "lead_time_days",
    "inhouse_production_days": None,
    "default_location_id": "preferred_warehouse_id",
}


def _merge(item: StoreItem, row: StoreItemPlant | None, branch_id: int | None) -> dict:
    out: dict = {}
    for f, fallback in PLANT_FIELDS.items():
        v = getattr(row, f) if row is not None else None
        if v is None and fallback:
            v = getattr(item, fallback, None)
        out[f] = v
    out["mrp_type"] = row.mrp_type if row is not None else "reorder_point"
    out["procurement_type"] = row.procurement_type if row is not None else "buy"
    out["purchasing_blocked"] = bool(row.purchasing_blocked) if row is not None else False
    out["branch_id"] = branch_id
    out["plant_row_id"] = row.id if row is not None else None
    out["source"] = "plant" if row is not None else "item"
    return out


def plant_view(db: Session, item: StoreItem | int, branch_id: int | None) -> dict:
    """Planning data of one item at one plant (branch_id None = company-wide)."""
    if isinstance(item, int):
        item = db.get(StoreItem, item)
        if item is None:
            raise ValueError("Item not found in the Item Master — it may have been deleted.")
    row = None
    if branch_id is not None:
        row = db.query(StoreItemPlant).filter(StoreItemPlant.item_id == item.id, StoreItemPlant.branch_id == branch_id).first()
    return _merge(item, row, branch_id)


def plant_views(db: Session, item_ids, branch_id: int | None) -> dict[int, dict]:
    """plant_view for many items in two queries — {item_id: view}."""
    ids = {int(i) for i in item_ids if i}
    if not ids:
        return {}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(ids)).all()}
    rows: dict[int, StoreItemPlant] = {}
    if branch_id is not None:
        rows = {r.item_id: r for r in db.query(StoreItemPlant).filter(
            StoreItemPlant.item_id.in_(ids), StoreItemPlant.branch_id == branch_id).all()}
    return {iid: _merge(it, rows.get(iid), branch_id) for iid, it in items.items()}


def plant_rows(db: Session, item_id: int) -> list[StoreItemPlant]:
    return (db.query(StoreItemPlant).filter(StoreItemPlant.item_id == item_id)
            .order_by(StoreItemPlant.branch_id).all())


def branch_of_location(db: Session, location_id: int | None) -> int | None:
    from app.modules.store.models.location import StoreLocation
    if not location_id:
        return None
    loc = db.get(StoreLocation, location_id)
    return loc.branch_id if loc else None


def purchasing_block_message(db: Session, item: StoreItem, branch_id: int | None) -> str | None:
    """Real reason when the item is blocked for purchasing at this plant."""
    if branch_id is None:
        return None
    v = plant_view(db, item, branch_id)
    if not v["purchasing_blocked"]:
        return None
    from app.modules.organization.models.branch import Branch
    b = db.get(Branch, branch_id)
    return (f"'{item.item_name}' ({item.item_code}) is blocked for purchasing at plant {b.name if b else branch_id}. "
            "Clear 'Purchasing blocked' in Store › Item Master › Plant data, or buy it for another plant.")


def validate_plant_payload(db: Session, item: StoreItem, data: dict) -> dict:
    """Cleans one plant-view payload; raises ValueError with what to fix."""
    from app.modules.organization.models.branch import Branch
    from app.modules.store.models.location import StoreLocation

    branch_id = data.get("branch_id")
    branch = db.get(Branch, branch_id) if branch_id else None
    if branch is None:
        raise ValueError("Pick the plant this data is for — it must be a plant from Organization › Plants.")
    mrp = (data.get("mrp_type") or "reorder_point").strip()
    if mrp not in STORE_MRP_TYPES:
        raise ValueError(f"MRP type must be one of: {', '.join(STORE_MRP_TYPES)}.")
    proc = (data.get("procurement_type") or "buy").strip()
    if proc not in STORE_PROCUREMENT_TYPES:
        raise ValueError(f"Procurement type must be one of: {', '.join(STORE_PROCUREMENT_TYPES)}.")
    for f in ("reorder_level", "safety_stock", "minimum_stock", "maximum_stock", "reorder_quantity",
              "lead_time_days", "inhouse_production_days"):
        v = data.get(f)
        if v is not None and float(v) < 0:
            raise ValueError(f"{f.replace('_', ' ').capitalize()} at plant {branch.name} can't be negative.")
    mn, mx = data.get("minimum_stock"), data.get("maximum_stock")
    if mn is not None and mx is not None and float(mx) < float(mn):
        raise ValueError(f"Maximum stock ({mx:g}) at plant {branch.name} is below the minimum stock ({mn:g}) — raise the maximum or lower the minimum.")
    rl, ss = data.get("reorder_level"), data.get("safety_stock")
    if rl is not None and ss is not None and float(rl) < float(ss):
        raise ValueError(f"Reorder level ({rl:g}) at plant {branch.name} is below the safety stock ({ss:g}) — "
                         "the reorder point must cover the safety stock plus demand over the lead time.")
    loc_id = data.get("default_location_id")
    if loc_id:
        loc = db.get(StoreLocation, loc_id)
        if loc is None:
            raise ValueError("The default store picked no longer exists — pick another store.")
        if loc.branch_id and loc.branch_id != branch.id:
            raise ValueError(f"Store {loc.name} belongs to another plant — the default store must be one of plant {branch.name}'s stores.")
    return {
        "branch_id": branch.id, "mrp_type": mrp, "procurement_type": proc,
        **{f: data.get(f) for f in ("reorder_level", "safety_stock", "minimum_stock", "maximum_stock", "reorder_quantity",
                                    "lead_time_days", "inhouse_production_days", "default_location_id")},
        "purchasing_blocked": bool(data.get("purchasing_blocked")),
        "remarks": (data.get("remarks") or "").strip() or None,
    }
