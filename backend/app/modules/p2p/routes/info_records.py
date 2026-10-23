"""ME11/ME12/ME13 purchasing info records, ME01 source list, ME1P price
history — all keyed by Item Master id (store_item_id) + vendor.

    GET   /p2p/info-records                       list (store_item_id / vendor_id / unlinked / search)
    POST  /p2p/info-records                       create for vendor + item
    PATCH /p2p/info-records/{id}                  change price / lead time / MOQ / validity
    POST  /p2p/info-records/{id}/link             one-time link of an old name-only catalog line to its item
    GET   /p2p/info-records/default-price         vendor + item -> proposed PO price
    GET   /p2p/info-records/price-history         released PO prices for an item (optionally one vendor)
    GET   /p2p/info-records/for-item              vendors for an item: info records + source list + last price
    GET   /p2p/info-records/source-list           an item's approved vendors
    POST  /p2p/info-records/source-list
    PATCH /p2p/info-records/source-list/{id}
    DELETE /p2p/info-records/source-list/{id}
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permission_registry import can_view_tab
from app.core.permissions import GRANT_HINT, ensure_can_delete, ensure_feature_action, require_tab_action
from app.modules.p2p.pricing import mask_for
from app.db.session import get_db
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_catalog_item import VendorCatalogItem
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.p2p import info_records as svc
from app.modules.p2p.models.source_list import P2PSourceListEntry
from app.modules.p2p.schemas.mm_purchasing import InfoRecordLinkPayload, InfoRecordPayload, SourceListPayload
from app.modules.store.models.item import StoreItem

router = APIRouter(prefix="/p2p/info-records", tags=["P2P - Info records"])

_edit = require_tab_action("p2p", "vendors", "edit")


def _ensure_vendor_feature(user: User, feature: str, action: str) -> None:
    """A Procurement › Vendors feature (core/features/p2p.py). It governs the
    holders of Vendors › View; the Purchase desk and Accounts read the vendor
    master as a cross-module lookup (_lookup) and are not affected."""
    if can_view_tab(user, "p2p", "vendors"):
        ensure_feature_action(user, "p2p", "vendors", feature, action)


def _lookup(user: User = Depends(get_current_user)) -> User:
    """Read access: Procurement › Vendors view, or the Purchase desk (PO
    drafts and comparisons read prices from here)."""
    if can_view_tab(user, "p2p", "vendors") or "purchase" in set(user.get_apps()):
        return user
    raise HTTPException(status_code=403, detail=f"You don't have 'View' permission on Procurement › Vendors. {GRANT_HINT}")


def _audit(db: Session, rec_id: int, action: str, user: User, summary: str) -> None:
    db.add(AuditLog(entity_type="vendor_info_record", entity_id=rec_id, action=action, module_key="p2p", subtab_key="vendors",
                    performed_by_id=user.id, summary=summary))


def _item(db: Session, store_item_id: int | None) -> StoreItem:
    item = db.get(StoreItem, store_item_id) if store_item_id else None
    if item is None:
        raise HTTPException(status_code=422, detail="Pick the item from the Item Master — add it in Store › Item Master first if it's new.")
    return item


def _vendor(db: Session, vendor_id: int | None) -> Vendor:
    v = db.get(Vendor, vendor_id) if vendor_id else None
    if v is None:
        raise HTTPException(status_code=422, detail="Pick the vendor from the vendor master (Procurement › Vendors).")
    return v


def _validity(valid_from, valid_to) -> None:
    if valid_from and valid_to and valid_to < valid_from:
        raise HTTPException(status_code=422, detail="'Valid to' is before 'Valid from' — fix the validity dates.")


def _row(c: VendorCatalogItem, v: Vendor | None = None, item: StoreItem | None = None) -> dict:
    return {
        "id": c.id, "vendor_id": c.vendor_id, "vendor_name": v.name if v else None, "store_item_id": c.store_item_id,
        "item_code": item.item_code if item else None, "item_master_name": item.item_name if item else None,
        "item_name": c.item_name, "part_code": c.part_code, "make": c.make, "unit": c.unit, "unit_price": c.unit_price,
        "currency": c.currency, "lead_time_days": c.lead_time_days, "min_order_qty": c.min_order_qty,
        "valid_from": c.valid_from, "valid_to": c.valid_to, "last_po_id": c.last_po_id, "last_po_number": c.last_po_number,
        "last_po_date": c.last_po_date, "last_po_price": c.last_po_price, "remarks": c.remarks, "is_active": c.is_active,
        "linked": c.store_item_id is not None,
    }


@router.get("")
def list_info_records(store_item_id: int | None = None, vendor_id: int | None = None, unlinked: bool = False,
                      search: str | None = None, limit: int = Query(500, ge=1, le=2000),
                      db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    _ensure_vendor_feature(_user, "info_records", "view")
    rows = svc.search_info_records(db, store_item_id=store_item_id, vendor_id=vendor_id, unlinked=unlinked, search=search, limit=limit)
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({c.store_item_id for c, _ in rows if c.store_item_id})).all()} if rows else {}
    return mask_for(_user, "vendors", [_row(c, v, items.get(c.store_item_id)) for c, v in rows])


@router.post("", status_code=201)
def create_info_record(payload: InfoRecordPayload, db: Session = Depends(get_db), user: User = Depends(_edit)):
    ensure_feature_action(user, "p2p", "vendors", "info_records", "create")
    v = _vendor(db, payload.vendor_id)
    item = _item(db, payload.store_item_id)
    _validity(payload.valid_from, payload.valid_to)
    clash = db.query(VendorCatalogItem).filter(VendorCatalogItem.vendor_id == v.id, VendorCatalogItem.store_item_id == item.id,
                                               VendorCatalogItem.is_active.is_(True)).first()
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"{v.name} already has a saved rate for {item.item_code} {item.item_name} — edit that one.")
    c = VendorCatalogItem(vendor_id=v.id, store_item_id=item.id, item_name=item.item_name,
                          part_code=item.part_number or item.manufacturer_part_number, unit=item.uom, currency="INR", is_active=True)
    for f in ("unit_price", "lead_time_days", "min_order_qty", "valid_from", "valid_to", "make", "remarks"):
        if f in payload.model_fields_set:
            setattr(c, f, getattr(payload, f))
    db.add(c)
    db.flush()
    _audit(db, c.id, "created", user, f"{user.name or user.email} created the item rate {v.name} / {item.item_code} at {c.unit_price}.")
    db.commit()
    return _row(c, v, item)


@router.patch("/{record_id}")
def update_info_record(record_id: int, payload: InfoRecordPayload, db: Session = Depends(get_db), user: User = Depends(_edit)):
    ensure_feature_action(user, "p2p", "vendors", "info_records", "edit")
    c = db.get(VendorCatalogItem, record_id)
    if c is None:
        raise HTTPException(status_code=404, detail="That item rate no longer exists — refresh the page.")
    if "store_item_id" in payload.model_fields_set and payload.store_item_id != c.store_item_id:
        raise HTTPException(status_code=422, detail="A saved rate's item can't be changed here — use Link for an unlinked line, or create a new record.")
    if "vendor_id" in payload.model_fields_set and payload.vendor_id != c.vendor_id:
        raise HTTPException(status_code=422, detail="A saved rate's vendor can't be changed — create a record for the other vendor instead.")
    changed = []
    for f in ("unit_price", "lead_time_days", "min_order_qty", "valid_from", "valid_to", "make", "remarks", "is_active"):
        if f in payload.model_fields_set and getattr(payload, f) != getattr(c, f):
            changed.append(f"{f.replace('_', ' ')} {getattr(c, f)} → {getattr(payload, f)}")
            setattr(c, f, getattr(payload, f))
    _validity(c.valid_from, c.valid_to)
    if changed:
        _audit(db, c.id, "updated", user, f"{user.name or user.email} changed item rate #{c.id}: " + "; ".join(changed))
    db.commit()
    return _row(c, db.get(Vendor, c.vendor_id), db.get(StoreItem, c.store_item_id) if c.store_item_id else None)


@router.post("/{record_id}/link")
def link_info_record(record_id: int, payload: InfoRecordLinkPayload, db: Session = Depends(get_db), user: User = Depends(_edit)):
    """ME13 clean-up: a catalog line typed before lines were keyed to the
    Item Master is linked once, by a person, to its item. Never re-pointed."""
    ensure_feature_action(user, "p2p", "vendors", "info_records", "edit")
    c = db.get(VendorCatalogItem, record_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Catalog line not found — refresh the page.")
    if c.store_item_id:
        raise HTTPException(status_code=409, detail="This catalog line is already linked to an Item Master item — a link can't be changed.")
    item = _item(db, payload.store_item_id)
    clash = db.query(VendorCatalogItem).filter(VendorCatalogItem.vendor_id == c.vendor_id, VendorCatalogItem.store_item_id == item.id,
                                               VendorCatalogItem.is_active.is_(True), VendorCatalogItem.id != c.id).first()
    if clash is not None and c.is_active:
        raise HTTPException(status_code=409, detail=(
            f"This vendor already has a saved rate for {item.item_code} {item.item_name} (#{clash.id}). "
            "Deactivate one of them first, so the PO price comes from exactly one record."))
    c.store_item_id = item.id
    _audit(db, c.id, "linked", user, f"{user.name or user.email} linked catalog line '{c.item_name}' to {item.item_code} {item.item_name}.")
    db.commit()
    return _row(c, db.get(Vendor, c.vendor_id), item)


@router.get("/default-price")
def info_record_default_price(vendor_id: int, store_item_id: int, on: date | None = None,
                              db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    rec = svc.info_record(db, vendor_id, store_item_id, on)
    # Same "Prices & rates" switch as the item-rate list.
    return mask_for(_user, "vendors", {
        "vendor_id": vendor_id, "store_item_id": store_item_id, "info_record_id": rec.id if rec else None,
        "unit_price": svc.default_price(db, vendor_id, store_item_id, on), "lead_time_days": rec.lead_time_days if rec else None,
        "min_order_qty": rec.min_order_qty if rec else None})


@router.get("/price-history")
def item_price_history(store_item_id: int, vendor_id: int | None = None, db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    item = _item(db, store_item_id)
    rows = svc.price_history(db, item.id, vendor_id)
    prices = [r["unit_price"] for r in rows if r["unit_price"]]
    return mask_for(_user, "vendors", {
        "store_item_id": item.id, "item_code": item.item_code, "item_name": item.item_name, "rows": rows,
        "last_price": prices[0] if prices else None, "min_price": min(prices) if prices else None,
        "max_price": max(prices) if prices else None, "avg_price": round(sum(prices) / len(prices), 2) if prices else None})


@router.get("/for-item")
def vendors_for_item(store_item_id: int, db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    """Who can supply an item: its info records (cheapest first), source
    list and the last released PO price — by Item Master id only."""
    item = _item(db, store_item_id)
    recs = svc.search_info_records(db, store_item_id=item.id)
    today = date.today()
    out = [_row(c, v, item) | {"valid_today": c.is_active and (c.valid_from is None or c.valid_from <= today)
                                and (c.valid_to is None or c.valid_to >= today), "vendor_status": v.status} for c, v in recs]
    out.sort(key=lambda r: (not r["valid_today"], r["unit_price"] is None, r["unit_price"] or 0))
    return mask_for(_user, "vendors", {
        "store_item_id": item.id, "item_code": item.item_code, "item_name": item.item_name, "info_records": out,
        "source_list": svc.source_vendors(db, item.id), "last_po": svc.last_po_price(db, item.id)})


@router.get("/item-overview")
def item_overview(store_item_id: int, db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    """One lookup per item: every vendor who quoted or supplied it, with the
    last PO rate, last quoted rate, rate contract and approved-source flag —
    built from POs and quotations, nothing to type in first."""
    item = _item(db, store_item_id)
    return mask_for(_user, "vendors", {"store_item_id": item.id, "item_code": item.item_code, "item_name": item.item_name,
                                       "uom": item.uom, **svc.item_overview(db, item.id)})


@router.get("/source-list")
def list_source_list(store_item_id: int | None = None, vendor_id: int | None = None, db: Session = Depends(get_db),
                     _user: User = Depends(_lookup)):
    _ensure_vendor_feature(_user, "info_records", "view")
    if store_item_id:
        return svc.source_vendors(db, store_item_id)
    q = db.query(P2PSourceListEntry, Vendor, StoreItem).join(Vendor, Vendor.id == P2PSourceListEntry.vendor_id).join(
        StoreItem, StoreItem.id == P2PSourceListEntry.store_item_id)
    if vendor_id:
        q = q.filter(P2PSourceListEntry.vendor_id == vendor_id)
    return [{"id": e.id, "store_item_id": i.id, "item_code": i.item_code, "item_name": i.item_name, "vendor_id": v.id,
             "vendor_name": v.name, "valid_from": e.valid_from, "valid_to": e.valid_to, "is_fixed": e.is_fixed,
             "is_blocked": e.is_blocked, "remarks": e.remarks} for e, v, i in q.order_by(StoreItem.item_code, Vendor.name).limit(2000).all()]


def _clear_other_fixed(db: Session, entry: P2PSourceListEntry) -> None:
    if entry.is_fixed:
        for other in db.query(P2PSourceListEntry).filter(P2PSourceListEntry.store_item_id == entry.store_item_id,
                                                         P2PSourceListEntry.id != entry.id).all():
            other.is_fixed = False


@router.post("/source-list", status_code=201)
def add_source(payload: SourceListPayload, db: Session = Depends(get_db), user: User = Depends(_edit)):
    ensure_feature_action(user, "p2p", "vendors", "info_records", "create")
    item = _item(db, payload.store_item_id)
    v = _vendor(db, payload.vendor_id)
    _validity(payload.valid_from, payload.valid_to)
    if db.query(P2PSourceListEntry).filter(P2PSourceListEntry.store_item_id == item.id, P2PSourceListEntry.vendor_id == v.id).first():
        raise HTTPException(status_code=409, detail=f"{v.name} is already an approved vendor for {item.item_code} — edit that entry.")
    e = P2PSourceListEntry(store_item_id=item.id, vendor_id=v.id, valid_from=payload.valid_from, valid_to=payload.valid_to,
                           is_fixed=bool(payload.is_fixed), is_blocked=bool(payload.is_blocked), remarks=payload.remarks, created_by_id=user.id)
    db.add(e)
    db.flush()
    _clear_other_fixed(db, e)
    _audit(db, e.id, "source_added", user, f"{user.name or user.email} added {v.name} to the approved vendors of {item.item_code} {item.item_name}.")
    db.commit()
    return svc.source_vendors(db, item.id)


@router.patch("/source-list/{entry_id}")
def update_source(entry_id: int, payload: SourceListPayload, db: Session = Depends(get_db), user: User = Depends(_edit)):
    ensure_feature_action(user, "p2p", "vendors", "info_records", "edit")
    e = db.get(P2PSourceListEntry, entry_id)
    if e is None:
        raise HTTPException(status_code=404, detail="Source-list entry not found — refresh the page.")
    for f in ("valid_from", "valid_to", "is_fixed", "is_blocked", "remarks"):
        if f in payload.model_fields_set:
            val = getattr(payload, f)
            setattr(e, f, bool(val) if f in ("is_fixed", "is_blocked") else val)
    _validity(e.valid_from, e.valid_to)
    _clear_other_fixed(db, e)
    _audit(db, e.id, "source_updated", user, f"{user.name or user.email} changed source-list entry #{e.id}.")
    db.commit()
    return svc.source_vendors(db, e.store_item_id)


@router.delete("/source-list/{entry_id}")
def delete_source(entry_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    e = db.get(P2PSourceListEntry, entry_id)
    if e is None:
        raise HTTPException(status_code=404, detail="Source-list entry not found — refresh the page.")
    ensure_can_delete(user, e, "p2p", "vendors", "source-list entry")
    ensure_feature_action(user, "p2p", "vendors", "info_records", "delete")
    item_id = e.store_item_id
    _audit(db, e.id, "source_removed", user, f"{user.name or user.email} removed vendor #{e.vendor_id} from the approved vendors of item #{item_id}.")
    db.delete(e)
    db.commit()
    return svc.source_vendors(db, item_id)
