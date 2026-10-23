"""Return to Vendor (RTV) — goods sent back against a GRN (SAP movement 122).

Accepted material leaves Free stock at the PO rate, the PO's received
quantity drops (the vendor owes a replacement) and, when the vendor's invoice
already covers the goods, a pending debit note is raised for Finance to post.
Rejected material that never entered stock is recorded for the gate pass.
Material rejected by a Quality lot sits in Blocked stock under an NCR — it
goes back through that NCR's "return to vendor" disposition, which records
an RTV here through record_ncr_return()."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import ensure_in_scope
from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.vendor_return import (
    P2P_RETURN_REASONS, P2P_RETURN_SOURCES, P2PVendorReturn, P2PVendorReturnItem,
)
from app.modules.p2p.routes.goods_receipts import (
    _DECIDED_LINE_STATUSES, _get_grn_or_404, _grn_store_scope, _grn_tab, _po_rate, _sync_po_and_pr_status, _write_audit,
    net_accepted,
)
from app.modules.store.services.plant_access import ensure_location_allowed
from app.modules.p2p.schemas.vendor_return import P2PVendorReturnCreate, P2PVendorReturnResponse
from app.modules.p2p.service import generate_rtv_number
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.store.services.valuation import ledger_sort_key

router = APIRouter(prefix="/p2p/vendor-returns", tags=["P2P"])


def _to_response(db: Session, rtv: P2PVendorReturn) -> P2PVendorReturnResponse:
    from app.modules.accounts.models.party_note import PartyNote

    resp = P2PVendorReturnResponse.model_validate(rtv)
    resp.reason_label = P2P_RETURN_REASONS.get(rtv.reason, rtv.reason)
    grn = db.get(P2PGoodsReceipt, rtv.goods_receipt_id)
    resp.grn_number = grn.grn_number if grn else None
    po = db.get(P2PPurchaseOrder, rtv.purchase_order_id)
    resp.po_number = po.po_number if po else None
    if rtv.store_location_id:
        loc = db.get(StoreLocation, rtv.store_location_id)
        resp.store_location_name = loc.name if loc else None
    if rtv.debit_note_id:
        note = db.get(PartyNote, rtv.debit_note_id)
        if note:
            resp.debit_note_number, resp.debit_note_status = note.note_number, note.status
    if rtv.created_by_id:
        u = db.get(User, rtv.created_by_id)
        resp.created_by_name = (u.name or u.email) if u else None
    return resp


def _has_quality_lot(db: Session, line: P2PGoodsReceiptItem) -> str | None:
    from app.modules.quality.models.inspection_lot import QualityInspectionLot
    row = db.query(QualityInspectionLot.lot_number).filter(QualityInspectionLot.grn_item_id == line.id).first()
    return row[0] if row else None


def _raise_debit_note(db: Session, rtv: P2PVendorReturn, po: P2PPurchaseOrder, user: User) -> None:
    """Pending debit note for the part of the returned goods the vendor has
    already invoiced: invoiced qty on the PO beyond what stays received after
    this return. Never blocks the return — when no note can be raised, the
    reason is kept on the RTV (debit_note_message) for Finance."""
    from app.modules.accounts.models.vendor_invoice import VendorInvoice
    from app.modules.accounts.services.notes import create_party_note

    accepted_lines = [l for l in rtv.items if l.source == "accepted"]
    if not accepted_lines:
        return
    invoices = db.query(VendorInvoice).filter(VendorInvoice.purchase_order_id == po.id, VendorInvoice.status != "cancelled").all()
    invoiced_qty = sum(i.qty_invoice or 0 for i in invoices)
    if invoiced_qty <= 0:
        rtv.debit_note_message = "Not invoiced yet — no debit note needed. The vendor's invoice can only be booked for the quantity still received."
        return
    grns = db.query(P2PGoodsReceipt).filter(P2PGoodsReceipt.purchase_order_id == po.id, P2PGoodsReceipt.status == "completed") \
        .options(selectinload(P2PGoodsReceipt.items)).all()
    still_received = sum(net_accepted(it) for g in grns for it in g.items)
    to_debit = min(sum(l.quantity for l in accepted_lines), invoiced_qty - still_received)
    if to_debit <= 1e-9:
        rtv.debit_note_message = "The vendor's invoice doesn't cover the returned goods — no debit note needed."
        return
    posted = sorted((i for i in invoices if i.status == "posted"), key=lambda i: (i.invoice_date, i.id), reverse=True)
    if not posted:
        rtv.debit_note_message = (f"Invoice(s) {', '.join(i.invoice_number or str(i.id) for i in invoices)} on PO {po.po_number} aren't posted yet — "
                                  f"Finance must book them only for the quantity still received ({still_received:g}), or raise a debit note after posting.")
        return
    lines, left = [], to_debit
    for l in accepted_lines:
        q = min(l.quantity, left)
        if q <= 1e-9:
            break
        left -= q
        item = db.get(StoreItem, l.store_item_id) if l.store_item_id else None
        lines.append({"description": f"Return {rtv.rtv_number} — {l.item_name}", "store_item_id": l.store_item_id,
                      "hsn_sac_code": item.hsn_sac_code if item else None, "quantity": q, "uom": l.unit,
                      "rate": l.unit_rate or 0, "gst_rate": l.tax_rate or 0})
    try:
        note = create_party_note(db, note_type="debit_note", note_date=rtv.return_date, lines=lines, created_by_id=user.id,
                                 vendor_invoice_id=posted[0].id, reason="return",
                                 narration=f"Goods returned to vendor on {rtv.rtv_number} (GRN / PO {po.po_number}).")
    except ValueError as e:
        rtv.debit_note_message = f"Debit note couldn't be raised automatically: {e} Finance must raise it by hand (Finance › Purchase › Debit notes)."
        return
    rtv.debit_note_id = note.id
    rtv.debit_note_message = f"Debit note {note.note_number} raised against invoice {posted[0].invoice_number} — pending; Finance reviews and posts it."


def _ensure_grn_plant(db: Session, user: User, grn: P2PGoodsReceipt) -> None:
    """Store keepers work only on their own plant's receipts (same rule as
    opening a GRN) — a return takes the goods out of that store's stock."""
    scope = _grn_store_scope(db, user)
    if scope is not None:
        ensure_location_allowed(db, user, grn.store_location_id, allowed=scope)


@router.get("", response_model=list[P2PVendorReturnResponse])
async def list_vendor_returns(
    goods_receipt_id: int | None = Query(None),
    purchase_order_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(_grn_tab("view")),
):
    q = db.query(P2PVendorReturn).options(selectinload(P2PVendorReturn.items))
    if goods_receipt_id:
        _get_grn_or_404(db, goods_receipt_id, user=user)
        q = q.filter(P2PVendorReturn.goods_receipt_id == goods_receipt_id)
    if purchase_order_id:
        q = q.filter(P2PVendorReturn.purchase_order_id == purchase_order_id)
    rows = []
    for rtv in q.order_by(P2PVendorReturn.id.desc()).limit(500).all():
        grn = db.get(P2PGoodsReceipt, rtv.goods_receipt_id)
        try:
            ensure_in_scope(db, user, grn)
            _ensure_grn_plant(db, user, grn)
        except HTTPException:
            continue
        rows.append(_to_response(db, rtv))
    return rows


@router.get("/{rtv_id}", response_model=P2PVendorReturnResponse)
async def get_vendor_return(rtv_id: int, db: Session = Depends(get_db), user: User = Depends(_grn_tab("view"))):
    rtv = db.query(P2PVendorReturn).options(selectinload(P2PVendorReturn.items)).filter(P2PVendorReturn.id == rtv_id).first()
    if not rtv:
        raise HTTPException(status_code=404, detail=f"Return to Vendor #{rtv_id} not found.")
    _ensure_grn_plant(db, user, _get_grn_or_404(db, rtv.goods_receipt_id, user=user))
    return _to_response(db, rtv)


@router.post("", response_model=P2PVendorReturnResponse, status_code=201)
async def create_vendor_return(payload: P2PVendorReturnCreate, db: Session = Depends(get_db), user: User = Depends(_grn_tab("view"))):
    ensure_feature_action(user, "store", "grn", "return_to_vendor", "create")
    if payload.reason not in P2P_RETURN_REASONS:
        raise HTTPException(status_code=422, detail=f"Pick why the goods are going back: {', '.join(P2P_RETURN_REASONS.values())}.")
    remarks = (payload.remarks or "").strip() or None
    if payload.reason == "other" and not remarks:
        raise HTTPException(status_code=422, detail="Reason is 'Other' — write in the remarks why the goods are going back.")
    if not payload.items:
        raise HTTPException(status_code=422, detail="Enter the quantity to return on at least one line.")
    grn = _get_grn_or_404(db, payload.goods_receipt_id, for_update=True, user=user)
    _ensure_grn_plant(db, user, grn)
    if grn.status == "reversed":
        raise HTTPException(status_code=409, detail=f"GRN {grn.grn_number} was reversed — nothing on it can be returned.")
    po = db.get(P2PPurchaseOrder, grn.purchase_order_id)
    lines_by_id = {i.id: i for i in grn.items}
    return_date = payload.return_date or date.today()
    if return_date > date.today():
        raise HTTPException(status_code=422, detail=f"Return date {return_date.isoformat()} is in the future — record the return on the day the goods leave (today or earlier).")
    if return_date < grn.received_date:
        raise HTTPException(status_code=422, detail=f"The return date can't be before the goods were received ({grn.received_date:%d-%m-%Y}).")
    from app.modules.store.services.posting_period import stock_posting_block_reason
    period_block = stock_posting_block_reason(db, return_date)
    if period_block:
        raise HTTPException(status_code=409, detail=period_block)

    planned: list[tuple[P2PGoodsReceiptItem, str, float]] = []
    planned_serials: dict[tuple[int, str], list[str]] = {}
    seen: set[tuple[int, str]] = set()
    for p in payload.items:
        line = lines_by_id.get(p.grn_item_id)
        if line is None:
            raise HTTPException(status_code=422, detail=f"Line #{p.grn_item_id} isn't on GRN {grn.grn_number}.")
        if p.source not in P2P_RETURN_SOURCES:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}': return either accepted or rejected quantity.")
        if (line.id, p.source) in seen:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}' ({p.source}) is entered twice — put the total on one row.")
        seen.add((line.id, p.source))
        if p.quantity <= 0:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}': return quantity must be more than 0.")
        if line.quality_status not in _DECIDED_LINE_STATUSES:
            raise HTTPException(status_code=409, detail=f"'{line.item_name}' hasn't been inspected yet — returns are made after the accept / reject decision.")
        if p.source == "accepted":
            available = net_accepted(line)
            if p.quantity > available + 1e-9:
                raise HTTPException(status_code=422, detail=f"'{line.item_name}': only {available:g} {line.unit or ''} accepted is left to return (accepted {line.accepted_quantity or 0:g}, already returned {line.returned_quantity or 0:g}).")
            if not line.store_item_id or not grn.store_location_id:
                raise HTTPException(status_code=409, detail=f"'{line.item_name}' wasn't posted to a store item / store on this GRN, so it can't be taken out of stock here. Ask Store to post a stock entry instead.")
        else:
            lot = _has_quality_lot(db, line)
            if lot:
                raise HTTPException(status_code=409, detail=f"'{line.item_name}' was rejected by Quality lot {lot} — that material is in Blocked stock under its NCR and goes back through the NCR's 'Return to vendor' disposition (Quality › NCR).")
            available = max((line.rejected_quantity or 0) - (line.rejected_returned_quantity or 0), 0.0)
            if p.quantity > available + 1e-9:
                raise HTTPException(status_code=422, detail=f"'{line.item_name}': only {available:g} {line.unit or ''} rejected is left to return.")
        planned.append((line, p.source, p.quantity))
        if line.serial_numbers:
            planned_serials[(line.id, p.source)] = p.serials

    rtv = P2PVendorReturn(
        rtv_number=generate_rtv_number(db), purchase_order_id=po.id, goods_receipt_id=grn.id, vendor_id=po.vendor_id,
        vendor_name=po.vendor_name, store_location_id=grn.store_location_id, return_date=return_date, reason=payload.reason,
        remarks=remarks, vehicle_number=(payload.vehicle_number or "").strip() or None, stock_posted=True, created_by_id=user.id,
    )
    db.add(rtv)
    db.flush()
    total = 0.0
    for line, source, qty in planned:
        # The debit note is at the vendor's PO price; planned delivery costs
        # (landed rate) are not the vendor's to refund.
        rate = float(line.po_item.unit_price) if line.po_item is not None and line.po_item.unit_price else None
        value = round(qty * rate, 2) if rate else None
        total += value or 0
        rtv.items.append(P2PVendorReturnItem(
            grn_item_id=line.id, store_item_id=line.store_item_id, item_name=line.item_name, unit=line.unit, source=source,
            quantity=qty, unit_rate=rate, tax_rate=line.po_item.tax_rate if line.po_item else None, value=value,
        ))
        if source == "accepted":
            line.returned_quantity = (line.returned_quantity or 0) + qty
        else:
            line.rejected_returned_quantity = (line.rejected_returned_quantity or 0) + qty
    rtv.total_value = round(total, 2)

    # Accepted goods leave Free stock at the PO rate they came in at.
    from app.modules.store.services.bins import bin_if_covered
    reason_text = P2P_RETURN_REASONS[payload.reason]
    for line, source, qty in sorted((x for x in planned if x[1] == "accepted"), key=lambda x: ledger_sort_key(x[0].store_item_id, grn.store_location_id)):
        rate = _po_rate(line.po_item)
        try:
            post_stock_transaction(
                db, item_id=line.store_item_id, location_id=grn.store_location_id, transaction_type="return_out", quantity=qty,
                bin_id=bin_if_covered(db, line.store_item_id, grn.store_location_id, line.bin_id, qty),
                reference_type="vendor_return", reference_number=rtv.rtv_number, transaction_date=return_date,
                remarks=f"Returned to vendor — {reason_text} (GRN {grn.grn_number})" + (f": {remarks}" if remarks else ""),
                created_by_id=user.id, vendor_name=po.vendor_name, unit_cost=rate, cost_source="po_rate" if rate else None,
            )
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Can't send '{line.item_name}' back: {e}")
    # Rejected goods of a line received into Quality stock sit in Blocked
    # stock since the GRN inspection — they leave it now (SAP 122 from blocked).
    from app.modules.p2p.grn_posting import return_rejected_to_vendor
    for line, source, qty in planned:
        if source != "rejected" or line.receipt_posting != "quality":
            continue
        try:
            return_rejected_to_vendor(db, grn, line, qty, user.id, rtv.rtv_number, return_date,
                                      f"Rejected goods returned to vendor — {reason_text} (GRN {grn.grn_number})" + (f": {remarks}" if remarks else ""))
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Can't send rejected '{line.item_name}' back: {e}")
    # Serialised units (IQ01) leave the books as "returned to vendor".
    if planned_serials:
        from app.modules.store.models.item import StoreItem
        from app.modules.store.services.serials import SerialError, return_to_vendor
        for line, source, qty in planned:
            if (line.id, source) not in planned_serials:
                continue
            try:
                return_to_vendor(db, line=line, item=db.get(StoreItem, line.store_item_id), source=source, qty=qty,
                                 serials=planned_serials[(line.id, source)], rtv_number=rtv.rtv_number, user_id=user.id,
                                 return_date=return_date)
            except SerialError as e:
                db.rollback()
                raise HTTPException(status_code=422, detail=str(e))
    db.flush()
    _sync_po_and_pr_status(db, po, user.id)
    _raise_debit_note(db, rtv, po, user)
    if po.p2p_request_id:
        _write_audit(db, po.p2p_request_id, "vendor_return", user,
                     summary=f"{user.name or user.email} returned goods to {po.vendor_name or 'the vendor'} on {rtv.rtv_number} "
                             f"(GRN '{grn.grn_number}', {reason_text}). {rtv.debit_note_message or ''}".strip())
    db.commit()
    db.refresh(rtv)
    return _to_response(db, rtv)


def record_ncr_return(db: Session, ncr, user: User) -> P2PVendorReturn | None:
    """Quality hook (NCR disposition 'return to vendor'): the NCR has already
    moved the Blocked stock out; this records the RTV document against the
    GRN line the rejected lot came from. None when the NCR isn't from a GRN.
    Flushes only — the caller commits."""
    from app.modules.quality.models.inspection_lot import QualityInspectionLot

    lot = db.get(QualityInspectionLot, ncr.lot_id) if getattr(ncr, "lot_id", None) else None
    line = db.get(P2PGoodsReceiptItem, lot.grn_item_id) if lot and lot.grn_item_id else None
    if line is None or not ncr.quantity:
        return None
    grn = db.get(P2PGoodsReceipt, line.goods_receipt_id)
    po = db.get(P2PPurchaseOrder, grn.purchase_order_id)
    qty = min(float(ncr.quantity), max((line.rejected_quantity or 0) - (line.rejected_returned_quantity or 0), 0.0)) or float(ncr.quantity)
    rate = _po_rate(line.po_item)
    rtv = P2PVendorReturn(
        rtv_number=generate_rtv_number(db), purchase_order_id=po.id, goods_receipt_id=grn.id, vendor_id=po.vendor_id,
        vendor_name=po.vendor_name, store_location_id=grn.store_location_id, return_date=date.today(), reason="quality_rejection",
        remarks=f"From {ncr.ncr_number} (Quality lot {lot.lot_number})", ncr_id=ncr.id, stock_posted=False, created_by_id=user.id,
        total_value=round(qty * rate, 2) if rate else None,
        debit_note_message="Rejected in inspection — never accepted, so it isn't payable; no debit note needed.",
    )
    rtv.items.append(P2PVendorReturnItem(
        grn_item_id=line.id, store_item_id=line.store_item_id, item_name=line.item_name, unit=line.unit, source="rejected",
        quantity=qty, unit_rate=rate, tax_rate=line.po_item.tax_rate if line.po_item else None,
        value=round(qty * rate, 2) if rate else None,
    ))
    line.rejected_returned_quantity = (line.rejected_returned_quantity or 0) + qty
    db.add(rtv)
    db.flush()
    return rtv
