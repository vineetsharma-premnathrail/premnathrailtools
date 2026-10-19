from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.permissions import ensure_can_delete, require_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.access import require_store_lookup
from app.modules.store.models.item import StoreItem, STORE_ITEM_STATUSES
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.valuation import StoreItemValuation
from app.modules.store.routes.item_types import check_item_type, type_options
from app.modules.store.models.location import StoreLocation
from app.modules.store.schemas.item import StoreItemCreate, StoreItemUpdate, StoreItemResponse
from app.modules.store.service import generate_item_code
from app.modules.store.routes.uoms import uom_options
from app.modules.store.services.stock_values import sees_standard_cost, sees_stock_values
from app.modules.store.services.item_accounts import LEDGER_PURPOSES, check_item_ledger, item_ledger, ledger_label
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.settings import GSTRate
from app.modules.accounts.models.vendor import Vendor

router = APIRouter(prefix="/store/items", tags=["Store"])


def apply_item_search(query, search: str | None):
    """Word-by-word search: every word (any order, extra spaces ignored) must
    appear in the item's name, code, legacy (v3 / Tally) code, part code,
    description or category."""
    for word in (search or "").split():
        like = f"%{word}%"
        query = query.filter(
            StoreItem.item_name.ilike(like) | StoreItem.item_code.ilike(like) | StoreItem.legacy_code.ilike(like)
            | StoreItem.part_number.ilike(like)
            | StoreItem.description.ilike(like) | StoreItem.category.ilike(like)
        )
    return query


def item_search_order(search: str | None):
    """ORDER BY for the item list: by item code (serial order, e.g. MT-HYD-0001,
    MT-HYD-0002 …). With a search, items whose NAME matches come first (exact,
    then starts-with, then contains), then code matches, then the rest
    (matched only in technical specification / category); by code within
    each group."""
    q = " ".join((search or "").split()).lower()
    if not q:
        return [StoreItem.item_code.asc(), StoreItem.id.asc()]
    name = func.lower(StoreItem.item_name)
    words = q.split()
    rank = case(
        (name == q, 0),
        (name.like(f"{q}%"), 1),
        (name.like(f"%{q}%"), 2),
        (and_(*[name.like(f"%{w}%") for w in words]), 3),
        (func.lower(StoreItem.item_code).like(f"%{q}%"), 4),
        else_=5,
    )
    return [rank, StoreItem.item_code.asc(), StoreItem.id.asc()]


def _to_response(item: StoreItem, db: Session, detail: bool = False, user: User | None = None) -> StoreItemResponse:
    warehouse = db.query(StoreLocation).filter(StoreLocation.id == item.preferred_warehouse_id).first() if item.preferred_warehouse_id else None
    val = db.get(StoreItemValuation, item.id)
    vendor = db.get(Vendor, item.preferred_vendor_id) if item.preferred_vendor_id else None
    update = {"preferred_warehouse_name": warehouse.name if warehouse else None, "has_photo": bool(item.photo_path),
              "last_receipt_rate": val.last_receipt_rate if val else None,
              "last_receipt_date": val.last_receipt_date if val else None,
              "preferred_vendor_name": f"{vendor.name} ({vendor.code})" if vendor else None,
              "purchase_gl_account_name": ledger_label(db, item.purchase_gl_account_id),
              "sales_gl_account_name": ledger_label(db, item.sales_gl_account_id)}
    if detail:
        # Which ledger will actually be used (item -> category -> Finance default).
        for purpose in LEDGER_PURPOSES:
            account, source = item_ledger(db, item, purpose)
            update[f"effective_{purpose}_gl"] = f"{account.code} — {account.name}" if account else None
            update[f"effective_{purpose}_gl_source"] = source
    # Store › Items › Stock value & rates (sensitive): blank the rates for
    # users without it; standard cost stays for item editors (they edit it).
    if user is not None and not sees_stock_values(user):
        update.update(moving_average_cost=None, last_receipt_rate=None)
        if not sees_standard_cost(user):
            update["standard_cost"] = None
    return StoreItemResponse.model_validate(item).model_copy(update=update)


LEAD_TIME_MAX_DAYS = 730


def check_lead_time(value) -> int | None:
    """Purchase lead time in calendar days, 0–730 (None = not set). Raises
    ValueError with the user-facing reason."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Purchase lead time '{value}' isn't a number — enter whole calendar days from PO to goods in store, e.g. 21.") from None
    if not f.is_integer():
        raise ValueError(f"Purchase lead time must be whole days — {f:g} has a fraction; round it to full days.")
    if f < 0 or f > LEAD_TIME_MAX_DAYS:
        raise ValueError(f"Purchase lead time must be between 0 and {LEAD_TIME_MAX_DAYS} calendar days — {int(f)} is outside that range.")
    return int(f)


def check_legacy_code(db: Session, value, item_id: int | None = None) -> str | None:
    """Trimmed v3 / Tally code, unique (case-insensitive) when set. Raises
    ValueError with the user-facing reason."""
    code = str(value).strip() if value is not None else ""
    if not code:
        return None
    if len(code) > 50:
        raise ValueError(f"Legacy code can be at most 50 characters — '{code[:20]}…' has {len(code)}; shorten it.")
    q = db.query(StoreItem.item_code, StoreItem.item_name).filter(func.lower(StoreItem.legacy_code) == code.lower())
    if item_id is not None:
        q = q.filter(StoreItem.id != item_id)
    clash = q.first()
    if clash:
        raise ValueError(f"Legacy code '{code}' is already used by {clash[0]} '{clash[1]}' — each legacy code can belong to one item only.")
    return code


NON_NEGATIVE_FIELDS = {
    "min_order_qty": "Minimum order quantity", "standard_cost": "Standard cost", "minimum_stock": "Minimum stock",
    "maximum_stock": "Maximum stock", "reorder_level": "Reorder level", "safety_stock": "Safety stock",
    "reorder_quantity": "Reorder quantity", "shelf_life_days": "Shelf life (days)",
}


def check_hsn_sac(value, item_type: str | None) -> str | None:
    """HSN (goods: 4, 6 or 8 digits) / SAC (services: 6 digits starting 99).
    Raises ValueError with the reason."""
    code = "".join(str(value or "").split())
    if not code:
        return None
    if not code.isdigit():
        raise ValueError(f"HSN / SAC code '{code}' must contain digits only — e.g. 7318 for bolts, 998719 for repair services.")
    if item_type == "service":
        if len(code) != 6 or not code.startswith("99"):
            raise ValueError(f"'{code}' isn't a SAC code — services use a 6-digit SAC starting with 99 (e.g. 998719). Check the vendor's invoice or ask Finance.")
    elif len(code) not in (4, 6, 8):
        raise ValueError(f"HSN code '{code}' has {len(code)} digits — goods use 4, 6 or 8 digits (8 on e-invoices). Check the vendor's invoice.")
    return code


def _clean_erp_fields(db: Session, data: dict, item: StoreItem | None = None) -> None:
    """Validate the tax, vendor, ledger and stock-level fields of a create /
    update payload (merged with the saved item). 400 with the real reason."""
    def merged(field):
        return data[field] if field in data else (getattr(item, field) if item else None)

    try:
        if "hsn_sac_code" in data or ("item_type" in data and item and item.hsn_sac_code):
            data["hsn_sac_code"] = check_hsn_sac(merged("hsn_sac_code"), merged("item_type"))
        if data.get("gst_rate") is not None:
            rate = float(data["gst_rate"])
            active = sorted(float(r) for (r,) in db.query(GSTRate.rate).filter(GSTRate.is_active.is_(True)).all())
            if not any(abs(rate - r) < 0.001 for r in active):
                offered = ", ".join(f"{r:g}%" for r in active) or "none — Finance hasn't set up GST rates yet"
                raise ValueError(f"GST {rate:g}% isn't an active rate in Finance's GST rate master. Pick one of: {offered}.")
        if data.get("preferred_vendor_id") is not None:
            vendor = db.get(Vendor, data["preferred_vendor_id"])
            if not vendor:
                raise ValueError("The preferred vendor picked no longer exists — reload the page and pick it again.")
            if vendor.status != "active" and (not item or item.preferred_vendor_id != vendor.id):
                raise ValueError(f"Vendor '{vendor.name}' is {vendor.status}, so it can't be the preferred vendor. Pick an active vendor, or ask Procurement to re-activate it.")
        for purpose, (col, _role, _types) in LEDGER_PURPOSES.items():
            if col in data:
                data[col] = check_item_ledger(db, purpose, data[col])
        for field, label in NON_NEGATIVE_FIELDS.items():
            if data.get(field) is not None and float(data[field]) < 0:
                raise ValueError(f"{label} can't be negative — enter 0 or more, or leave it blank.")
        def touched(*fields):
            return item is None or any(f in data for f in fields)

        lo, hi = merged("minimum_stock"), merged("maximum_stock")
        if touched("minimum_stock", "maximum_stock") and lo is not None and hi is not None and float(lo) > float(hi):
            raise ValueError(f"Minimum stock ({lo:g}) is more than maximum stock ({hi:g}) — the maximum must be the larger number.")
        rl = merged("reorder_level")
        if touched("reorder_level", "maximum_stock") and rl is not None and hi is not None and float(rl) > float(hi):
            raise ValueError(f"Reorder level ({rl:g}) is above maximum stock ({hi:g}) — you would reorder when the store is already full. Lower the reorder level.")
        ss = merged("safety_stock")
        if touched("safety_stock", "reorder_level") and ss is not None and rl is not None and float(ss) > float(rl):
            raise ValueError(f"Safety stock ({ss:g}) is above the reorder level ({rl:g}) — reorder must trigger before stock falls into the safety buffer. Raise the reorder level.")
        if touched("test_certificate_required", "inspection_on_receipt") and merged("test_certificate_required") and not merged("inspection_on_receipt"):
            raise ValueError("'Test certificate required' only works with 'Inspection on receipt' — the certificate is checked when Quality accepts the inspection lot. Tick both, or untick the certificate.")
        if touched("expiry_controlled", "shelf_life_days") and merged("expiry_controlled") and not merged("shelf_life_days"):
            raise ValueError("Expiry-controlled items need a shelf life — enter the shelf life in days, or untick expiry control.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


def _clean_planning_fields(db: Session, data: dict, item_id: int | None = None) -> None:
    try:
        if "lead_time_days" in data:
            data["lead_time_days"] = check_lead_time(data["lead_time_days"])
        if "legacy_code" in data:
            data["legacy_code"] = check_legacy_code(db, data["legacy_code"], item_id)
    except ValueError as exc:
        status = 409 if "already used" in str(exc) else 400
        raise HTTPException(status_code=status, detail=str(exc)) from None


@router.get("", response_model=list[StoreItemResponse])
async def list_items(
    category: str | None = Query(None),
    subcategory: str | None = Query(None),
    item_type: str | None = Query(None),
    search: str | None = Query(None),
    status: str | None = Query(None),
    no_lead_time: bool = Query(False, description="Only items with no purchase lead time (MRP treats these as assumed)"),
    db: Session = Depends(get_db),
    user: User = Depends(require_store_lookup()),
):
    query = db.query(StoreItem)
    if no_lead_time:
        query = query.filter(StoreItem.lead_time_days.is_(None))
    if category is not None:
        query = query.filter(StoreItem.category == category)
    if subcategory:
        query = query.filter(StoreItem.subcategory == subcategory)
    if item_type is not None:
        query = query.filter(StoreItem.item_type == item_type)
    if status is not None:
        query = query.filter(StoreItem.status == status)
    query = apply_item_search(query, search)
    items = query.order_by(*item_search_order(search)).all()
    return [_to_response(i, db, user=user) for i in items]




def _validate_type_and_uom(item_type: str | None, uom: str | None, db: Session | None = None) -> str | None:
    """Returns the normalised UOM code; 400s on an unknown type or unit."""
    if db is not None:
        check_item_type(db, item_type)
    if uom is None:
        return None
    code = uom.strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Enter the unit of measure — pick one from the UOM dropdown.")
    if code not in {o["value"] for o in uom_options(db)}:
        raise HTTPException(status_code=400, detail=f"'{uom}' isn't a unit in the list. Pick one from the UOM dropdown, or add it there with '+ Add unit'.")
    return code


@router.get("/meta")
async def item_meta(db: Session = Depends(get_db), _user: User = Depends(require_store_lookup())):
    """Dropdown options for the item master form."""
    def ledgers(types):
        rows = (db.query(GLAccount).filter(GLAccount.account_type.in_(types), GLAccount.status == "active",
                                           GLAccount.is_posting_account.is_(True)).order_by(GLAccount.code).all())
        return [{"value": a.id, "label": f"{a.code} — {a.name}"} for a in rows]

    vendors = db.query(Vendor).filter(Vendor.status == "active").order_by(Vendor.name).all()
    return {
        "item_types": type_options(db),
        "uoms": uom_options(db),
        "gst_rates": [float(r) for (r,) in db.query(GSTRate.rate).filter(GSTRate.is_active.is_(True)).order_by(GSTRate.rate).all()],
        "purchase_ledgers": ledgers(LEDGER_PURPOSES["purchase"][2]),
        "sales_ledgers": ledgers(LEDGER_PURPOSES["sales"][2]),
        "vendors": [{"value": v.id, "label": f"{v.name} ({v.code})"} for v in vendors],
    }


@router.get("/next-code")
async def next_item_code(
    item_type: str | None = Query(None),
    category: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("store", "items", "create")),
):
    """Preview of the code the next item of this type + category would get.
    Not reserved — the real code is assigned when the item is saved."""
    _validate_type_and_uom(item_type, None, db)
    return {"item_code": generate_item_code(db, item_type, category)}


@router.get("/{item_id}", response_model=StoreItemResponse)
async def get_item(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_store_lookup()),
):
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _to_response(item, db, detail=True, user=user)


def _norm(text: str | None) -> str:
    return " ".join((text or "").lower().split())


@router.get("/{item_id}/vendors")
async def item_vendor_suggestions(
    item_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("store", "items", "vendor_suggestions", "view")),
):
    """Who can supply this item, best first: the preferred vendor, vendors
    whose catalog lists it (price, lead time), and vendors it was actually
    bought from (last PO rate and date). P2P lines don't carry the item id
    yet (foundation plan §5.4), so catalog / PO lines match on part code =
    item code / legacy code / part no., else on the exact item name."""
    from app.modules.accounts.models.vendor_catalog_item import VendorCatalogItem
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

    item = db.get(StoreItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    codes = {_norm(c) for c in (item.item_code, item.legacy_code, item.part_number, item.manufacturer_part_number) if c}
    name = _norm(item.item_name)

    def matches(part_code, item_name) -> bool:
        return (bool(part_code) and _norm(part_code) in codes) or _norm(item_name) == name

    rows: dict[int | str, dict] = {}

    def row(vendor_id, vendor_name):
        key = vendor_id or _norm(vendor_name)
        if key not in rows:
            rows[key] = {"vendor_id": vendor_id, "vendor_name": vendor_name, "preferred": False,
                         "catalog_price": None, "catalog_unit": None, "catalog_lead_time_days": None,
                         "last_po_rate": None, "last_po_unit": None, "last_po_date": None, "last_po_number": None,
                         "po_count": 0, "total_qty": 0.0}
        return rows[key]

    if item.preferred_vendor_id:
        v = db.get(Vendor, item.preferred_vendor_id)
        if v:
            row(v.id, v.name)["preferred"] = True

    first_word = name.split()[0] if name else ""
    catalog = (db.query(VendorCatalogItem, Vendor.name).join(Vendor, Vendor.id == VendorCatalogItem.vendor_id)
               .filter(VendorCatalogItem.is_active.is_(True), Vendor.status == "active",
                       VendorCatalogItem.part_code.isnot(None) | VendorCatalogItem.item_name.ilike(f"%{first_word}%"))
               .all())
    for c, vname in catalog:
        if matches(c.part_code, c.item_name):
            r = row(c.vendor_id, vname)
            r.update(catalog_price=c.unit_price, catalog_unit=c.unit, catalog_lead_time_days=c.lead_time_days)

    po_lines = (db.query(P2PPurchaseOrderItem, P2PPurchaseOrder)
                .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
                .filter(P2PPurchaseOrder.status.notin_(("draft", "cancelled")),
                        (P2PPurchaseOrderItem.store_item_id == item.id)
                        | (P2PPurchaseOrderItem.store_item_id.is_(None)
                           & (P2PPurchaseOrderItem.part_code.isnot(None) | P2PPurchaseOrderItem.item_name.ilike(f"%{first_word}%"))))
                .order_by(P2PPurchaseOrder.po_date.desc(), P2PPurchaseOrder.id.desc())
                .limit(2000).all())
    for line, po in po_lines:
        # PO lines carry the item id; only older unlinked lines fall back to
        # the part-code / name match (history display only).
        if line.store_item_id != item.id and not matches(line.part_code, line.item_name):
            continue
        if not (po.vendor_id or po.vendor_name):
            continue
        r = row(po.vendor_id, po.vendor_name)
        if r["last_po_date"] is None:  # newest first
            r.update(last_po_rate=line.unit_price, last_po_unit=line.unit, last_po_date=po.po_date, last_po_number=po.po_number)
        r["po_count"] += 1
        r["total_qty"] += float(line.quantity or 0)

    return sorted(rows.values(), key=lambda r: (not r["preferred"], r["last_po_date"] is None,
                                                -(r["last_po_date"].toordinal() if r["last_po_date"] else 0),
                                                r["catalog_price"] is None, r["catalog_price"] or 0))


@router.post("", response_model=StoreItemResponse)
async def create_item(
    payload: StoreItemCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "items", "create")),
):
    data = payload.model_dump()
    if not (data.get("item_name") or "").strip():
        raise HTTPException(status_code=400, detail="Enter the item name.")
    if not data.get("uom"):
        raise HTTPException(status_code=400, detail="Pick the unit of measure (UOM) for this item.")
    data["uom"] = _validate_type_and_uom(data.get("item_type"), data["uom"], db)
    data["part_number"] = (data.get("part_number") or "").strip() or None
    _clean_planning_fields(db, data)
    _clean_erp_fields(db, data)
    code = (data.get("item_code") or "").strip().upper()
    if code:
        if db.query(StoreItem).filter(StoreItem.item_code == code).first():
            raise HTTPException(status_code=409, detail=f"Item code '{code}' already exists — leave the code blank to auto-generate one.")
    else:
        code = generate_item_code(db, data.get("item_type"), data.get("category"))
    data["item_code"] = code
    data["item_name"] = data["item_name"].strip()
    item = StoreItem(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_response(item, db, detail=True, user=user)


@router.patch("/{item_id}", response_model=StoreItemResponse)
async def update_item(
    item_id: int,
    payload: StoreItemUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "items", "edit")),
):
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    changes = payload.model_dump(exclude_unset=True)
    if "status" in changes and changes["status"] not in STORE_ITEM_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status '{changes['status']}' isn't valid — choose one of: {', '.join(STORE_ITEM_STATUSES)}.")
    if changes.get("uom") and changes["uom"] != item.uom and _has_stock_history(db, item.id):
        # Existing ledger quantities were counted in the old unit; switching
        # it would silently turn "10 KG" into "10 TON".
        raise HTTPException(status_code=409, detail=f"'{item.item_name}' already has stock movements in {item.uom}, so its unit can't be changed — create a new item for the new unit.")
    if "uom" in changes and not changes["uom"]:
        raise HTTPException(status_code=400, detail="An item must keep a unit of measure — pick one from the UOM dropdown.")
    if "uom" in changes or "item_type" in changes:
        normalised = _validate_type_and_uom(changes.get("item_type"), changes.get("uom"), db)
        if "uom" in changes:
            changes["uom"] = normalised
    if "part_number" in changes:
        changes["part_number"] = (changes["part_number"] or "").strip() or None
    _clean_planning_fields(db, changes, item.id)
    _clean_erp_fields(db, changes, item)
    for field, val in changes.items():
        setattr(item, field, val)
    db.commit()
    db.refresh(item)
    return _to_response(item, db, detail=True, user=user)


def _has_stock_history(db: Session, item_id: int) -> bool:
    return db.query(StoreStockTransaction.id).filter(StoreStockTransaction.item_id == item_id).first() is not None


@router.delete("/{item_id}")
async def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "items")),
):
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    ensure_can_delete(user, item, "store", "items", what="item")
    from app.modules.store.models.material_issue import StoreMaterialIssueItem
    from app.modules.store.models.material_return import StoreMaterialReturnItem
    from app.modules.store.models.stock_adjustment import StoreStockAdjustmentItem
    from app.modules.store.models.stock_reservation import StoreStockReservation
    from app.modules.store.models.stock_transfer import StoreStockTransferItem

    used = [
        (db.query(StoreStockTransaction.id).filter(StoreStockTransaction.item_id == item.id).count(), "stock movement(s)"),
        (db.query(StoreMaterialIssueItem.id).filter(StoreMaterialIssueItem.item_id == item.id).count(), "material issue line(s)"),
        (db.query(StoreMaterialReturnItem.id).filter(StoreMaterialReturnItem.item_id == item.id).count(), "return line(s)"),
        (db.query(StoreStockTransferItem.id).filter(StoreStockTransferItem.item_id == item.id).count(), "transfer line(s)"),
        (db.query(StoreStockAdjustmentItem.id).filter(StoreStockAdjustmentItem.item_id == item.id).count(), "adjustment line(s)"),
        (db.query(StoreStockReservation.id).filter(StoreStockReservation.item_id == item.id).count(), "reservation(s)"),
    ]
    if in_use := [f"{n} {what}" for n, what in used if n]:
        raise HTTPException(status_code=409, detail=f"'{item.item_name}' can't be deleted — it has {', '.join(in_use)}. Set its status to Inactive instead so it's no longer offered.")
    db.query(StoreStockBalance).filter(StoreStockBalance.item_id == item.id).delete()
    db.delete(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"'{item.item_name}' can't be deleted — another module (BOM, work order, design document or spare-part list) still links to it. Remove it there first, or set the item to Inactive.")
    return {"ok": True}
