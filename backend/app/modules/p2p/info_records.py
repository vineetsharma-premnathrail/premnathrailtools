"""ME11/ME13 purchasing info records, ME01 source list, ME1P price history.

An info record is a vendor catalog line (accounts VendorCatalogItem, the
shared vendor master's catalog) linked to its Item Master item by
store_item_id. Everything here is keyed by (vendor_id, store_item_id) — items
are never matched by name or part code (2026-10-11 rule)."""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_catalog_item import VendorCatalogItem
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.source_list import P2PSourceListEntry


def _valid_on(row, on: date) -> bool:
    return (row.valid_from is None or row.valid_from <= on) and (row.valid_to is None or row.valid_to >= on)


def info_record(db: Session, vendor_id: int | None, store_item_id: int | None, on: date | None = None) -> VendorCatalogItem | None:
    """The vendor's active info record for the item, valid on `on` (today)."""
    if not vendor_id or not store_item_id:
        return None
    on = on or date.today()
    rows = (db.query(VendorCatalogItem)
            .filter(VendorCatalogItem.vendor_id == vendor_id, VendorCatalogItem.store_item_id == store_item_id,
                    VendorCatalogItem.is_active.is_(True))
            .order_by(VendorCatalogItem.updated_at.desc(), VendorCatalogItem.id.desc()).all())
    return next((r for r in rows if _valid_on(r, on)), None)


def default_price(db: Session, vendor_id: int | None, store_item_id: int | None, on: date | None = None) -> float | None:
    """ME21N price proposal: the valid info record's price, else the last
    released PO price for this vendor + item (read from the POs themselves,
    so POs released before info records existed count too)."""
    rec = info_record(db, vendor_id, store_item_id, on)
    if rec is not None and rec.unit_price is not None:
        return rec.unit_price
    if not vendor_id or not store_item_id:
        return None
    last = price_history(db, store_item_id, vendor_id, limit=1)
    return last[0]["unit_price"] if last else (rec.last_po_price if rec is not None else None)


def upsert_from_po(db: Session, po: P2PPurchaseOrder) -> int:
    """On PO release (final approval) and on an approved amendment: record
    each line's price as the vendor + item info record's current price and
    last PO. Creates the info record when the vendor has none for the item.
    Returns the number of records touched."""
    if not po.vendor_id:
        return 0
    n = 0
    for line in po.items:
        if not line.store_item_id or not line.unit_price:
            continue
        rec = info_record(db, po.vendor_id, line.store_item_id, po.po_date)
        if rec is None:
            rec = VendorCatalogItem(vendor_id=po.vendor_id, store_item_id=line.store_item_id, item_name=line.item_name,
                                    part_code=line.part_code, make=line.make, unit=line.unit, currency="INR", is_active=True,
                                    remarks=f"Created from PO {po.po_number}")
            db.add(rec)
        rec.unit_price = line.unit_price
        rec.last_po_id = po.id
        rec.last_po_number = po.po_number
        rec.last_po_date = po.po_date
        rec.last_po_price = line.unit_price
        n += 1
    db.flush()
    return n


def ensure_source_allowed(db: Session, vendor_id: int | None, store_item_ids, on: date | None = None, vendor_name: str | None = None) -> None:
    """ME01: an item with a source list may only be ordered from a listed,
    unblocked vendor valid on the PO date. 409 naming the item otherwise."""
    from app.modules.store.models.item import StoreItem

    on = on or date.today()
    ids = {i for i in store_item_ids if i}
    if not ids:
        return
    rows = db.query(P2PSourceListEntry).filter(P2PSourceListEntry.store_item_id.in_(ids)).all()
    by_item: dict[int, list[P2PSourceListEntry]] = {}
    for r in rows:
        by_item.setdefault(r.store_item_id, []).append(r)
    who = vendor_name or (db.get(Vendor, vendor_id).name if vendor_id and db.get(Vendor, vendor_id) else "this vendor")
    for item_id, entries in by_item.items():
        ok = [e for e in entries if e.vendor_id == vendor_id and not e.is_blocked and _valid_on(e, on)]
        if ok:
            continue
        item = db.get(StoreItem, item_id)
        label = f"{item.item_code} {item.item_name}" if item else f"item #{item_id}"
        mine = next((e for e in entries if e.vendor_id == vendor_id), None)
        if mine is not None and mine.is_blocked:
            why = f"{who} is blocked on its source list"
        elif mine is not None:
            why = f"{who}'s source-list entry is not valid on {on.strftime('%d-%m-%Y')}"
        else:
            why = f"{who} is not on its source list"
        allowed = [db.get(Vendor, e.vendor_id) for e in entries if not e.is_blocked and _valid_on(e, on)]
        names = ", ".join(v.name for v in allowed if v) or "none valid today"
        raise HTTPException(status_code=409, detail=(
            f"{label} can't be ordered from {who}: {why}. Approved sources: {names}. "
            "Order from an approved source, or ask Procurement to add the vendor in Procurement › Info Records › Source list."))


def released_po_lines_query(db: Session):
    """PO lines whose PO is past approval (issued and not draft/cancelled),
    with their PO — the ME1P price history rows."""
    return (db.query(P2PPurchaseOrderItem, P2PPurchaseOrder)
            .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
            .filter(P2PPurchaseOrder.status.in_(("issued", "acknowledged", "partially_fulfilled", "fulfilled"))))


def price_history(db: Session, store_item_id: int, vendor_id: int | None = None, limit: int = 200) -> list[dict]:
    from app.modules.p2p.po_split import po_is_released

    q = released_po_lines_query(db).filter(P2PPurchaseOrderItem.store_item_id == store_item_id)
    if vendor_id:
        q = q.filter(P2PPurchaseOrder.vendor_id == vendor_id)
    rows = q.order_by(P2PPurchaseOrder.po_date.desc(), P2PPurchaseOrder.id.desc()).limit(limit * 2).all()
    out = []
    for line, po in rows:
        if not po_is_released(db, po):
            continue
        pr = db.get(P2PRequest, po.p2p_request_id) if po.p2p_request_id else None
        out.append({
            "po_id": po.id, "po_number": po.po_number, "po_date": po.po_date, "vendor_id": po.vendor_id,
            "vendor_name": po.vendor_name, "quantity": line.quantity, "unit": line.unit, "unit_price": line.unit_price,
            "tax_rate": line.tax_rate, "amendment_no": po.amendment_no or 0, "p2p_number": pr.p2p_number if pr else None,
        })
        if len(out) >= limit:
            break
    return out


def last_po_price(db: Session, store_item_id: int | None) -> dict | None:
    if not store_item_id:
        return None
    rows = price_history(db, store_item_id, limit=1)
    return rows[0] if rows else None


def source_vendors(db: Session, store_item_id: int, on: date | None = None) -> list[dict]:
    on = on or date.today()
    rows = (db.query(P2PSourceListEntry, Vendor).join(Vendor, Vendor.id == P2PSourceListEntry.vendor_id)
            .filter(P2PSourceListEntry.store_item_id == store_item_id)
            .order_by(P2PSourceListEntry.is_fixed.desc(), Vendor.name).all())
    return [{"id": e.id, "vendor_id": v.id, "vendor_name": v.name, "vendor_status": v.status, "valid_from": e.valid_from,
             "valid_to": e.valid_to, "is_fixed": e.is_fixed, "is_blocked": e.is_blocked, "remarks": e.remarks,
             "valid_today": (not e.is_blocked) and _valid_on(e, on)} for e, v in rows]


def search_info_records(db: Session, *, store_item_id: int | None = None, vendor_id: int | None = None,
                        unlinked: bool = False, search: str | None = None, limit: int = 500):
    q = db.query(VendorCatalogItem, Vendor).join(Vendor, Vendor.id == VendorCatalogItem.vendor_id)
    if store_item_id:
        q = q.filter(VendorCatalogItem.store_item_id == store_item_id)
    if vendor_id:
        q = q.filter(VendorCatalogItem.vendor_id == vendor_id)
    if unlinked:
        q = q.filter(VendorCatalogItem.store_item_id.is_(None))
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(VendorCatalogItem.item_name.ilike(like), VendorCatalogItem.part_code.ilike(like), Vendor.name.ilike(like)))
    return q.order_by(Vendor.name, VendorCatalogItem.item_name).limit(limit).all()


def _vendor_key(vendor_id: int | None, vendor_name: str | None) -> str:
    return f"id:{vendor_id}" if vendor_id else f"name:{(vendor_name or '').strip().lower()}"


def item_overview(db: Session, store_item_id: int) -> dict:
    """"Who supplies this item, at what rate, and what did we last pay" —
    built live from released POs, received quotations, rate contracts (info
    records) and the source list, so nothing has to be typed in first. One
    row per vendor, by vendor id (vendor name only for old name-only rows)."""
    from app.modules.p2p.models.rfq import RFQ
    from app.modules.p2p.models.vendor_quotation import VendorQuotation, VendorQuotationItem

    today = date.today()
    rows: dict[str, dict] = {}

    def row(vendor_id: int | None, vendor_name: str | None) -> dict:
        k = _vendor_key(vendor_id, vendor_name)
        if k not in rows:
            rows[k] = {"vendor_id": vendor_id, "vendor_name": vendor_name, "vendor_status": None, "last_po": None,
                       "po_count": 0, "last_quote": None, "contract": None, "record_id": None, "source": None}
        return rows[k]

    history = price_history(db, store_item_id, limit=500)
    for h in history:  # newest first
        r = row(h["vendor_id"], h["vendor_name"])
        r["po_count"] += 1
        if r["last_po"] is None:
            r["last_po"] = {k: h[k] for k in ("po_id", "po_number", "po_date", "unit_price", "quantity", "unit", "tax_rate")}

    quotes = (db.query(VendorQuotationItem, VendorQuotation, RFQ)
              .join(VendorQuotation, VendorQuotation.id == VendorQuotationItem.vendor_quotation_id)
              .join(RFQ, RFQ.id == VendorQuotation.rfq_id)
              .filter(VendorQuotationItem.store_item_id == store_item_id)
              .order_by(VendorQuotation.submitted_at.desc().nullslast(), VendorQuotation.id.desc()).all())
    for qi, vq, rfq in quotes:
        r = row(vq.vendor_id, vq.vendor_name)
        if r["last_quote"] is not None:
            continue
        net = qi.unit_price * (1 - (qi.discount_pct or 0) / 100) if qi.unit_price is not None else None
        r["last_quote"] = {"rfq_id": rfq.id, "rfq_number": rfq.rfq_number, "quote_date": vq.submitted_at or (vq.created_at.date() if vq.created_at else None),
                           "unit_price": qi.unit_price, "discount_pct": qi.discount_pct, "net_price": round(net, 2) if net is not None else None,
                           "delivery_days": qi.delivery_days, "valid_until": vq.valid_until,
                           "valid_today": vq.valid_until is None or vq.valid_until >= today, "is_awarded": qi.is_awarded}

    for c, v in search_info_records(db, store_item_id=store_item_id):
        if not c.is_active:
            continue
        r = row(v.id, v.name)
        r["record_id"] = c.id
        # Every PO release mirrors its rate into the info record (upsert_from_po);
        # that mirror is just "last PO", already shown. Only a rate someone set
        # (no PO behind it, a different price, validity, MOQ or lead time) is
        # a rate contract.
        mirror = (c.last_po_id is not None and c.unit_price == c.last_po_price and not c.valid_from and not c.valid_to
                  and not c.min_order_qty and not c.lead_time_days)
        if mirror:
            continue
        r["contract"] = {"id": c.id, "unit_price": c.unit_price, "lead_time_days": c.lead_time_days, "min_order_qty": c.min_order_qty,
                         "valid_from": c.valid_from, "valid_to": c.valid_to, "valid_today": _valid_on(c, today), "remarks": c.remarks}

    for s in source_vendors(db, store_item_id, today):
        r = row(s["vendor_id"], s["vendor_name"])
        r["source"] = {k: s[k] for k in ("id", "is_fixed", "is_blocked", "valid_today", "valid_from", "valid_to")}

    # Vendor master names/status win over the name typed on an old PO.
    ids = {r["vendor_id"] for r in rows.values() if r["vendor_id"]}
    for v in (db.query(Vendor).filter(Vendor.id.in_(ids)).all() if ids else []):
        r = rows[_vendor_key(v.id, None)]
        r["vendor_name"], r["vendor_status"] = v.name, v.status

    out = list(rows.values())
    for r in out:
        c, q = r["contract"], r["last_quote"]
        # What we'd pay this vendor today: a valid rate contract, else a valid
        # quote, else the last PO rate.
        if c and c["valid_today"] and c["unit_price"] is not None:
            r["current_rate"], r["current_rate_source"] = c["unit_price"], "contract"
        elif q and q["valid_today"] and q["net_price"] is not None:
            r["current_rate"], r["current_rate_source"] = q["net_price"], "quote"
        elif r["last_po"]:
            r["current_rate"], r["current_rate_source"] = r["last_po"]["unit_price"], "last_po"
        else:
            r["current_rate"], r["current_rate_source"] = None, None
        r["lead_time_days"] = (c or {}).get("lead_time_days") or (q or {}).get("delivery_days")
    blocked = lambda r: bool(r["source"] and r["source"]["is_blocked"])  # noqa: E731
    out.sort(key=lambda r: (blocked(r), r["current_rate"] is None, r["current_rate"] or 0, (r["vendor_name"] or "").lower()))

    po_prices = [h["unit_price"] for h in history if h["unit_price"]]
    last = history[0] if history else None
    live = [r for r in out if r["current_rate"] is not None and not blocked(r)]
    return {
        "vendors": out,
        "history": history,
        "summary": {
            "vendor_count": len(out),
            "last_po": {k: last[k] for k in ("po_id", "po_number", "po_date", "vendor_name", "unit_price", "quantity", "unit")} if last else None,
            "lowest_po_price": min(po_prices) if po_prices else None,
            "highest_po_price": max(po_prices) if po_prices else None,
            "avg_po_price": round(sum(po_prices) / len(po_prices), 2) if po_prices else None,
            "best_current": {"vendor_name": live[0]["vendor_name"], "rate": live[0]["current_rate"], "source": live[0]["current_rate_source"]} if live else None,
            "has_source_list": any(r["source"] for r in out),
        },
    }
