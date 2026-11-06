"""Before-PO receipts (goods that arrive before their purchase order) and the
PO line quantity floor.

A Store user records the receipt (store/routes/pre_po_receipts.py); Procurement
turns it into a PO (p2p/routes/pre_po_receipts.py).

Since 2026-11-06 (owner) the receipt PUTS THE GOODS INTO STOCK the moment it is
saved (post_receipt_stock): Free stock, or Quality stock + an incoming
inspection lot for an item flagged 'Quality check on receipt'. The GRN on the
PO made from it then SETTLES that quantity instead of posting it again
(settle_plan / grn_posting.settle_line); cancelling the receipt takes the stock
back out (reverse_receipt_stock). Receipts recorded before that change
(stock_posted False) keep the old behaviour: nothing is posted until the GRN.

This module also holds the shared number generator, the PO close hook and the
quantity-floor rule."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session, object_session, selectinload

from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.service import _lock_number_series
from app.modules.store.models.pre_po_receipt import (
    STORE_PRE_PO_ATTACHMENT_TYPES, StorePrePoReceipt, StorePrePoReceiptAttachment,
)


def generate_receipt_number(db: Session) -> str:
    """BPO-[YEAR]-[NUMBER], sequence scoped per year."""
    prefix = f"BPO-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StorePrePoReceipt.receipt_number)).filter(
        StorePrePoReceipt.receipt_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{(int(last.rsplit('-', 1)[-1]) + 1) if last else 1:04d}"


def po_line_min_quantity(item: P2PPurchaseOrderItem, db: Session | None = None, lock: bool = False) -> float | None:
    """The least a PO line may be ordered for: what its requisition line still
    asks for (quantity less what Store issued from stock and less what was
    short-closed) minus what the other live POs already order of the same line,
    never below 0 and never above this PO line's own quantity. A line that doesn't
    name its requisition line can't be raised from a known floor, so its current
    quantity is the floor."""
    db = db or object_session(item)
    if db is None:
        return None
    if not item.pr_item_id:
        return item.quantity
    # lock=True (draft PATCH): serialise concurrent edits of the same requisition line.
    if lock and db.get_bind().dialect.name == "postgresql":
        pr_item = db.query(P2PRequestItem).filter(P2PRequestItem.id == item.pr_item_id).with_for_update().first()
    else:
        pr_item = db.get(P2PRequestItem, item.pr_item_id)
    if pr_item is None:
        return item.quantity
    # What the line still asks for: quantity less stock issued and less what the buyer short-closed.
    still_to_buy = (pr_item.quantity or 0) - (pr_item.issued_qty or 0) - (getattr(pr_item, "short_closed_qty", 0) or 0)
    others = (db.query(func.coalesce(func.sum(P2PPurchaseOrderItem.quantity), 0))
              .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
              .filter(P2PPurchaseOrderItem.pr_item_id == item.pr_item_id,
                      P2PPurchaseOrder.status != "cancelled",
                      P2PPurchaseOrderItem.purchase_order_id != item.purchase_order_id).scalar() or 0)
    # Never above this PO line's own quantity (a PO made for part of the line, e.g. one vendor's
    # award, must stay editable) and never below 0 (the other POs may already cover the line).
    return max(0.0, min(round(item.quantity or 0, 6), round(still_to_buy - others, 6)))


def po_line_floor_reason(item: P2PPurchaseOrderItem, db: Session, floor: float) -> str:
    """Why `floor` is the least a draft PO line may be ordered for, in words for the buyer: the
    quantity awarded to the vendor and uploaded on this PO, or - when the other POs of the line already
    cover part of it - what the requisition still asks for after them."""
    from app.modules.p2p.models.vendor_quotation import VendorQuotationItem

    own = round(item.quantity or 0, 6)
    if floor < own - 1e-9:
        return (f"the requisition line still asks for {floor:g} after the quantity already on the other POs of this line "
                f"({own:g} is on this one)")
    if item.vendor_quotation_item_id:
        qi = db.get(VendorQuotationItem, item.vendor_quotation_item_id)
        vendor = qi.vendor_quotation.vendor_name if qi is not None and qi.vendor_quotation is not None else None
        awarded = f"{qi.awarded_qty:g}" if qi is not None and qi.awarded_qty else f"{own:g}"
        return (f"that is the quantity uploaded on this PO from the {awarded} awarded to {vendor}" if vendor
                else f"that is the quantity uploaded on this PO ({own:g} awarded)")
    return f"that is the quantity already uploaded on this PO ({own:g}), which the requisition asks for"


def close_receipt_if_po_received(db: Session, po: P2PPurchaseOrder) -> None:
    """D7: when the PO behind a Before-PO receipt is fully received (its
    status rolled up to 'fulfilled'), the receipt closes. Flushes nothing else."""
    if po.status != "fulfilled":
        return
    receipt = (db.query(StorePrePoReceipt)
               .filter(StorePrePoReceipt.purchase_order_id == po.id, StorePrePoReceipt.status == "po_created").first())
    if receipt is not None:
        receipt.status = "closed"


# ------------------------------------------------------- stock posting (2026-11-06)

_EPS = 1e-9


def _posting_failed(db: Session, status: int, detail: str):
    """Rolls the request back (nothing of the receipt is kept) and returns the HTTPException to raise."""
    from fastapi import HTTPException
    db.rollback()
    return HTTPException(status_code=status, detail=detail)


def post_receipt_stock(db: Session, receipt: StorePrePoReceipt, user) -> None:
    """Puts every line of a just-created receipt into stock at the receipt's store, in
    valuation.ledger_sort_key order: Free stock (type 'receipt', valued at the typed rate or the
    average) for an ordinary item, Quality stock + an incoming inspection lot for an item flagged
    'Quality check on receipt'. Any refusal (closed period, count in progress, inactive store, a
    Quality lot that can't be raised) rolls the whole receipt back with the real reason. Flushes;
    the caller commits."""
    from app.modules.quality.services import first_article
    from app.modules.quality.services.lots import LotError, create_lot, needs_inspection_on_receipt
    from app.modules.store.models.item import StoreItem
    from app.modules.store.services.stock_ledger import post_stock_transaction
    from app.modules.store.services.valuation import ledger_sort_key

    if not receipt.store_location_id:
        raise _posting_failed(db, 422, "Pick the store the goods are held in - the receipt puts them into that store's stock.")
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([l.store_item_id for l in receipt.items] or [-1])).all()}
    for line in sorted(receipt.items, key=lambda l: ledger_sort_key(l.store_item_id, receipt.store_location_id)):
        item = items.get(line.store_item_id)
        try:
            if item is not None and needs_inspection_on_receipt(db, item, "incoming"):
                lot_type, fai = first_article.start_for_receipt(
                    db, item=item, vendor_name=receipt.vendor_name, base_type="incoming", source_type="pre_po_receipt",
                    source_reference=receipt.receipt_number, user_id=user.id)
                lot = create_lot(
                    db, inspection_type=lot_type, source_type="pre_po_receipt", item=item, quantity=line.quantity,
                    location_id=receipt.store_location_id, user_id=user.id, source_id=receipt.id,
                    source_reference=receipt.receipt_number, vendor_name=receipt.vendor_name, receive_into_quality=True,
                    lot_date=receipt.received_date, unit_cost=line.unit_rate,
                    remarks=f"First article {fai.fai_number} - full drawing check" if fai else None)
                first_article.link_lot(fai, lot)
                line.receipt_posting = "quality"
                line.inspection_lot_id = lot.id
            else:
                post_stock_transaction(
                    db, item_id=line.store_item_id, location_id=receipt.store_location_id, transaction_type="receipt",
                    quantity=line.quantity, reference_type="pre_po_receipt", reference_number=receipt.receipt_number,
                    transaction_date=receipt.received_date, vendor_name=receipt.vendor_name, created_by_id=user.id,
                    remarks=f"Before-PO receipt {receipt.receipt_number} - goods in stock before their PO, straight to Free stock",
                    unit_cost=line.unit_rate, cost_source="pre_po_rate" if line.unit_rate else None)
                line.receipt_posting = "free"
        except LotError as e:
            raise _posting_failed(db, e.status, f"'{line.item_name}' can't be received into Quality stock, so the receipt was not saved: {e}")
        except ValueError as e:
            raise _posting_failed(db, 409, f"'{line.item_name}' can't be put into stock, so the receipt was not saved: {e}")
    receipt.stock_posted = True
    db.flush()


def posted_unit_cost(db: Session, receipt: StorePrePoReceipt, line) -> float | None:
    """The rate the receipt's stock of this line went in at (ledger row), or None when it went in unvalued
    / valuation was off."""
    from app.modules.quality.models.inspection_lot import QualityInspectionLot
    from app.modules.store.models.stock_transaction import StoreStockTransaction

    if line.receipt_posting == "quality" and line.inspection_lot_id:
        lot = db.get(QualityInspectionLot, line.inspection_lot_id)
        ref_type, ref_no, ttype = "inspection_lot", lot.lot_number if lot is not None else None, "quality_in"
    else:
        ref_type, ref_no, ttype = "pre_po_receipt", receipt.receipt_number, "receipt"
    if ref_no is None:
        return None
    row = (db.query(StoreStockTransaction.unit_cost)
           .filter(StoreStockTransaction.item_id == line.store_item_id, StoreStockTransaction.reference_type == ref_type,
                   StoreStockTransaction.reference_number == ref_no, StoreStockTransaction.transaction_type == ttype)
           .order_by(StoreStockTransaction.id.asc()).first())
    return float(row[0]) if row is not None and row[0] is not None else None


def reverse_receipt_stock(db: Session, receipt: StorePrePoReceipt, user, reason: str) -> None:
    """Cancelling a receipt that put goods into stock takes them back out. Free line: the quantity leaves
    Free stock (refused with who/what when part of it was already issued). Quality line: refused until
    Quality has decided the lot; then the accepted part leaves Free stock and the rejected part Blocked
    stock. Refused when a GRN already settled part of it. Flushes; the caller commits."""
    from datetime import date as _date

    from app.modules.quality.models.inspection_lot import QualityInspectionLot
    from app.modules.store.services.stock_ledger import post_stock_transaction
    from app.modules.store.services.valuation import ledger_sort_key

    if not receipt.stock_posted:
        return
    for line in receipt.items:
        if (line.settled_qty or 0) > _EPS:
            raise _posting_failed(db, 409, (
                f"{line.settled_qty:g} of '{line.item_name}' was already received on a GRN against the PO, so receipt "
                f"{receipt.receipt_number} can't be cancelled. Ask Procurement to reverse that GRN first."))
    lots: dict[int, QualityInspectionLot] = {}
    for line in receipt.items:
        if line.receipt_posting == "quality":
            lot = db.get(QualityInspectionLot, line.inspection_lot_id) if line.inspection_lot_id else None
            if lot is None or lot.decision is None:
                raise _posting_failed(db, 409, (
                    f"Quality must decide lot {lot.lot_number if lot is not None else '(not found)'} ('{line.item_name}') first - "
                    f"the receipt's goods are in Quality stock waiting for inspection, so receipt {receipt.receipt_number} can't be "
                    "cancelled yet. Ask Quality for the usage decision (Quality > Inspection Lots), then cancel."))
            lots[line.id] = lot
    for line in sorted(receipt.items, key=lambda l: ledger_sort_key(l.store_item_id, receipt.store_location_id)):
        if not line.receipt_posting or not receipt.store_location_id:
            continue
        rate = posted_unit_cost(db, receipt, line)
        remarks = f"Before-PO receipt {receipt.receipt_number} cancelled - {reason}"
        common = dict(item_id=line.store_item_id, location_id=receipt.store_location_id, reference_type="pre_po_receipt_cancelled",
                      reference_number=receipt.receipt_number, transaction_date=_date.today(), remarks=remarks,
                      created_by_id=user.id, vendor_name=receipt.vendor_name, unit_cost=rate, cost_source="pre_po_rate" if rate else None)
        lot = lots.get(line.id)
        accepted = (lot.accepted_qty or 0) if lot is not None else line.quantity
        rejected = (lot.rejected_qty or 0) if lot is not None else 0.0
        try:
            if accepted > _EPS:
                post_stock_transaction(db, transaction_type="return_out", quantity=accepted, **common)
            if rejected > _EPS:
                post_stock_transaction(db, transaction_type="quarantine_out", quantity=rejected, **common)
        except ValueError as e:
            raise _posting_failed(db, 409, (
                f"Can't take '{line.item_name}' ({line.quantity:g} {line.unit or ''}) back out of stock, so receipt {receipt.receipt_number} "
                f"was not cancelled: {e} Some of it has probably been issued already - get it returned to store first, then cancel."))
    db.flush()


def receipt_for_po(db: Session, po: P2PPurchaseOrder, lock: bool = False) -> StorePrePoReceipt | None:
    """The receipt that already put its goods into stock and whose PO this is (open or closed)."""
    q = (db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items))
         .filter(StorePrePoReceipt.purchase_order_id == po.id, StorePrePoReceipt.stock_posted.is_(True),
                 StorePrePoReceipt.status.in_(("po_created", "closed"))))
    return (q.with_for_update() if lock else q).first()


def line_settleable_qty(db: Session, line) -> float:
    """How much of a receipt line a GRN can still settle: what went into stock less what earlier GRNs
    settled. A Quality line whose lot is decided settles only the accepted quantity (rejected goods are
    never 'received' - a replacement comes on a GRN of its own)."""
    from app.modules.quality.models.inspection_lot import QualityInspectionLot

    if not line.receipt_posting:
        return 0.0
    qty = line.quantity or 0.0
    if line.receipt_posting == "quality" and line.inspection_lot_id:
        lot = db.get(QualityInspectionLot, line.inspection_lot_id)
        if lot is not None and lot.decision is not None:
            qty = lot.accepted_qty or 0.0
    return max(0.0, qty - (line.settled_qty or 0.0))


def settleable_by_item(db: Session, receipt: StorePrePoReceipt | None) -> dict[int, tuple[object, float]]:
    """{store_item_id: (receipt line, quantity a GRN can still settle)} for a stock-posting receipt."""
    if receipt is None:
        return {}
    return {l.store_item_id: (l, line_settleable_qty(db, l)) for l in receipt.items}


def grn_settlement_plan(db: Session, receipt: StorePrePoReceipt | None, wants: list[tuple[object, int | None, float]],
                        store_location_id: int | None) -> dict[object, float]:
    """For GRN lines [(key, store_item_id, received quantity)] in order, how much of each is settled by the
    receipt's stock (no new posting): up to the receipt's unsettled quantity of the same store_item_id,
    shared out in line order. Refuses (422) when something would be settled but the GRN names another store
    than the one the receipt put the goods into. Nothing is changed here."""
    from fastapi import HTTPException

    from app.modules.quality.models.inspection_lot import QualityInspectionLot

    plan: dict[object, float] = {}
    settleable = settleable_by_item(db, receipt)
    left = {item_id: qty for item_id, (_l, qty) in settleable.items()}
    # Goods still in Quality stock under the receipt's own lot can't be settled (nor posted again: that would
    # double the stock) until Quality has made the usage decision.
    for _key, item_id, qty in wants:
        entry = settleable.get(item_id) if item_id and qty > _EPS else None
        if entry is None or entry[1] <= _EPS or entry[0].receipt_posting != "quality" or not entry[0].inspection_lot_id:
            continue
        lot = db.get(QualityInspectionLot, entry[0].inspection_lot_id)
        if lot is not None and lot.decision is None:
            raise HTTPException(status_code=409, detail=(
                f"Lot {lot.lot_number} of '{entry[0].item_name}' from Before-PO receipt {receipt.receipt_number} is still with Quality - "
                "ask Quality for the usage decision, then record the GRN."))
    for key, item_id, qty in wants:
        take = min(qty, left.get(item_id, 0.0)) if item_id else 0.0
        if take > _EPS:
            plan[key] = take
            left[item_id] -= take
    if plan and receipt is not None and store_location_id != receipt.store_location_id:
        from app.modules.store.models.location import StoreLocation
        held = db.get(StoreLocation, receipt.store_location_id) if receipt.store_location_id else None
        raise HTTPException(status_code=422, detail=(
            f"Before-PO receipt {receipt.receipt_number} already put these goods into stock at "
            f"{held.name if held else 'its store'}, so this GRN must be received into the same store - the GRN settles that stock "
            "instead of adding it again. Pick that store in the GRN's receiving store field."))
    return plan


def unsettled_for_receipt(db: Session, po: P2PPurchaseOrder, receipt: StorePrePoReceipt | None) -> tuple[str | None, dict[int, float]]:
    """(receipt number, {po_item.id: quantity a GRN would settle}) for the GRN form; line order, capped at
    each line's quantity. `receipt` is the PO's stock-posting receipt (receipt_for_po / a prefetched one)."""
    if receipt is None:
        return None, {}
    left = {item_id: qty for item_id, (_l, qty) in settleable_by_item(db, receipt).items()}
    out: dict[int, float] = {}
    for i in po.items:
        if i.category != "stock" or not i.store_item_id:
            continue
        take = min(i.quantity or 0.0, left.get(i.store_item_id, 0.0))
        if take > _EPS:
            out[i.id] = take
            left[i.store_item_id] -= take
    return receipt.receipt_number, out


def unsettled_by_po_line(db: Session, po: P2PPurchaseOrder) -> tuple[str | None, dict[int, float]]:
    return unsettled_for_receipt(db, po, receipt_for_po(db, po))


def receipts_for_pos(db: Session, po_ids: list[int]) -> dict[int, StorePrePoReceipt]:
    """{po id: its stock-posting receipt} in one query, with the receipt lines and their Quality lots loaded
    (so the GRN form's per-line numbers cost no further queries)."""
    from app.modules.quality.models.inspection_lot import QualityInspectionLot

    if not po_ids:
        return {}
    rows = (db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items))
            .filter(StorePrePoReceipt.purchase_order_id.in_(po_ids), StorePrePoReceipt.stock_posted.is_(True),
                    StorePrePoReceipt.status.in_(("po_created", "closed"))).all())
    lot_ids = {l.inspection_lot_id for r in rows for l in r.items} - {None}
    if lot_ids:
        db.query(QualityInspectionLot).filter(QualityInspectionLot.id.in_(lot_ids)).all()  # into the identity map: db.get() is then free
    return {r.purchase_order_id: r for r in rows}


def receipt_to_response(db: Session, receipt: StorePrePoReceipt):
    """PrePoReceiptResponse with the display names filled in."""
    from app.modules.main.models.user import User
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.quality.models.inspection_lot import QualityInspectionLot
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.schemas.pre_po_receipt import (
        PrePoReceiptAttachmentResponse, PrePoReceiptItemResponse, PrePoReceiptResponse,
    )

    location = db.get(StoreLocation, receipt.store_location_id) if receipt.store_location_id else None
    pr = db.get(P2PRequest, receipt.p2p_request_id) if receipt.p2p_request_id else None
    po = db.get(P2PPurchaseOrder, receipt.purchase_order_id) if receipt.purchase_order_id else None
    creator = db.get(User, receipt.created_by_id) if receipt.created_by_id else None
    uploader_ids = {a.uploaded_by_id for a in receipt.attachments} - {None}
    uploaders = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(uploader_ids)).all()} if uploader_ids else {}
    codes = {i.id: i.item_code for i in db.query(StoreItem.id, StoreItem.item_code)
             .filter(StoreItem.id.in_([l.store_item_id for l in receipt.items] or [-1])).all()}
    lot_ids = {l.inspection_lot_id for l in receipt.items} - {None}
    lot_numbers = ({lt.id: lt.lot_number for lt in db.query(QualityInspectionLot).filter(QualityInspectionLot.id.in_(lot_ids)).all()}
                   if lot_ids else {})
    return PrePoReceiptResponse(
        id=receipt.id, receipt_number=receipt.receipt_number, vendor_id=receipt.vendor_id, vendor_name=receipt.vendor_name,
        received_date=receipt.received_date, store_location_id=receipt.store_location_id,
        store_location_name=location.name if location else None,
        delivery_challan_number=receipt.delivery_challan_number, vendor_invoice_number=receipt.vendor_invoice_number, vendor_invoice_date=receipt.vendor_invoice_date,
        remarks=receipt.remarks, status=receipt.status, p2p_request_id=receipt.p2p_request_id,
        p2p_number=pr.p2p_number if pr else None, purchase_order_id=receipt.purchase_order_id,
        po_number=po.po_number if po else None, po_status=po.status if po else None,
        created_by_id=receipt.created_by_id, created_by_name=(creator.name or creator.email) if creator else None,
        created_at=receipt.created_at, cancel_reason=receipt.cancel_reason, stock_posted=bool(receipt.stock_posted),
        items=[PrePoReceiptItemResponse(
            id=l.id, store_item_id=l.store_item_id, item_code=codes.get(l.store_item_id), item_name=l.item_name,
            unit=l.unit, quantity=l.quantity, remarks=l.remarks, unit_rate=l.unit_rate, receipt_posting=l.receipt_posting,
            inspection_lot_id=l.inspection_lot_id, inspection_lot_number=lot_numbers.get(l.inspection_lot_id),
            settled_qty=l.settled_qty or 0.0) for l in receipt.items],
        attachments=[PrePoReceiptAttachmentResponse(
            id=a.id, doc_type=a.doc_type, filename=a.filename, content_type=a.content_type, size=a.size,
            uploaded_by_id=a.uploaded_by_id, uploaded_by_name=uploaders.get(a.uploaded_by_id), created_at=a.created_at)
            for a in receipt.attachments],
    )


def qty_raised_lines(db: Session, po: P2PPurchaseOrder) -> int:
    """Number of PO lines ordered above what their requisition line asks for
    (the buyer raised the quantity). Shown to the PO approvers."""
    n = 0
    for item in po.items:
        if not item.pr_item_id:
            continue
        pr_item = db.get(P2PRequestItem, item.pr_item_id)
        asks = (pr_item.quantity or 0) - (pr_item.issued_qty or 0) - (getattr(pr_item, "short_closed_qty", 0) or 0) if pr_item is not None else 0
        if pr_item is not None and (item.quantity or 0) - asks > 1e-9:
            n += 1
    return n


def reopen_receipt_for_cancelled_po(db: Session, po: P2PPurchaseOrder, actor) -> None:
    """A PO made from a Before-PO receipt was cancelled or rejected: the goods
    are still in store, so the receipt goes back to 'pending_po' (Procurement can
    make a new PO) and the links to the dead PO / requisition are cleared."""
    from app.modules.main.models.audit_log import AuditLog

    receipt = (db.query(StorePrePoReceipt)
               .filter(StorePrePoReceipt.purchase_order_id == po.id, StorePrePoReceipt.status == "po_created").first())
    if receipt is None:
        return
    # A PO with a live GRN that settled this receipt's stock must not die: the receipt would lose its PO while its goods
    # count as received on it. (Cancelling a requisition / PO is already blocked once goods are booked; this is the net.)
    if receipt.stock_posted and any((l.settled_qty or 0) > _EPS for l in receipt.items):
        from fastapi import HTTPException
        from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
        live = (db.query(P2PGoodsReceipt.grn_number)
                .filter(P2PGoodsReceipt.purchase_order_id == po.id, P2PGoodsReceipt.status != "reversed").all())
        if live:
            raise HTTPException(status_code=409, detail=(
                f"PO '{po.po_number}' can't be cancelled: GRN {', '.join(g for (g,) in live)} already received goods that Before-PO receipt "
                f"{receipt.receipt_number} had put into stock. Reverse that GRN first (Store > GRN > Reverse), then cancel the PO."))
    pr_id = receipt.p2p_request_id
    receipt.status = "pending_po"
    receipt.purchase_order_id = None
    receipt.p2p_request_id = None
    if pr_id:
        db.add(AuditLog(
            entity_type="p2p_request", entity_id=pr_id, action="pre_po_receipt_reopened", performed_by_id=getattr(actor, "id", None),
            summary=f"PO '{po.po_number}' was cancelled, so Before-PO receipt {receipt.receipt_number} is waiting for a new PO again."))


# ---------------------------------------------------------------- notification

BEFORE_PO_LINK = "/dashboard/p2p/purchase-orders?view=before_po"


def notify_receipt_recorded(db: Session, receipt: StorePrePoReceipt, actor) -> None:
    """Bell notice to Procurement that goods arrived before their PO (event
    p2p.pre_po_receipt_recorded: holders of Purchase Orders > create), and
    directly to the buyers of the lines' item types - never twice. Bell only.
    Frontend opens entity_type 'store_pre_po_receipt' at BEFORE_PO_LINK. Caller commits."""
    from app.core.notification_events import notify_event
    from app.core.permission_registry import can_perform, is_admin_user
    from app.modules.main.models.user import User
    from app.modules.p2p.models.p2p_request import resolve_line_buyer_id
    from app.modules.store.models.item import StoreItem
    from app.utils.notifications import notify_user

    names = ", ".join(f"{l.item_name} x {l.quantity:g}" for l in receipt.items[:5]) + (" ..." if len(receipt.items) > 5 else "")
    title = f"Material received before PO: {receipt.receipt_number} from {receipt.vendor_name} - make its PO"
    in_stock = " (already in stock)" if receipt.stock_posted else ""
    message = (f"Store received {len(receipt.items)} item(s) from {receipt.vendor_name} on {receipt.received_date:%d-%b-%Y} "
               f"before a PO existed{in_stock}: {names}. Open Procurement > Purchase Orders > Before PO and create the PO.")

    def _can_open(user: User) -> bool:
        return is_admin_user(user) or can_perform(user, "p2p", "purchase_orders", "view")

    reached = notify_event(db, None, "p2p", "pre_po_receipt_recorded", title=title, message=message,
                           entity_type="store_pre_po_receipt", entity_id=receipt.id, actor=actor, can_open=_can_open)
    types = {i.id: i.item_type for i in db.query(StoreItem.id, StoreItem.item_type)
             .filter(StoreItem.id.in_([l.store_item_id for l in receipt.items] or [-1])).all()}
    buyers = {resolve_line_buyer_id(db, types.get(l.store_item_id)) for l in receipt.items} - {None}
    skip = set(reached) | ({actor.id} if actor is not None else set())
    for uid in sorted(buyers - skip):
        notify_user(db, user_id=uid, title=title, message=message, notification_type="p2p_ev_pre_po_receipt_recorded",
                    entity_type="store_pre_po_receipt", entity_id=receipt.id)


# ----------------------------------------------------------------- attachments

def ensure_attachable(receipt: StorePrePoReceipt) -> None:
    from fastapi import HTTPException
    if receipt.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"Receipt {receipt.receipt_number} is cancelled, so files can't be added to it. "
                                                    "Record a new Before-PO receipt if the goods did arrive.")


async def save_attachment(db: Session, receipt: StorePrePoReceipt, user, file, doc_type: str) -> StorePrePoReceiptAttachment:
    """Uploads one file to SharePoint (size / type checks, filename sanitising
    live in utils/sharepoint.py, same as PR attachments) and records it."""
    from fastapi import HTTPException
    from app.core.config import settings
    from app.utils.sharepoint import build_sharepoint_folder_path, upload_file_to_sharepoint

    ensure_attachable(receipt)
    if doc_type not in STORE_PRE_PO_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"File type '{doc_type}' isn't valid - choose one of: {', '.join(STORE_PRE_PO_ATTACHMENT_TYPES)}.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint is not configured on this server, so files can't be stored. Ask an admin to set it up.")
    folder = build_sharepoint_folder_path(user.name or user.email or "", "before-po", receipt.receipt_number)
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, file)
    att = StorePrePoReceiptAttachment(
        receipt_id=receipt.id, doc_type=doc_type, filename=result["name"], content_type=file.content_type, size=result["size"],
        sharepoint_path=result["path"], sharepoint_url=result.get("webUrl"), uploaded_by_id=user.id)
    db.add(att)
    db.flush()
    return att


async def attachment_content_response(receipt: StorePrePoReceipt, attachment_id: int):
    from fastapi import HTTPException
    from fastapi.responses import Response
    from app.core.config import settings
    from app.utils.sharepoint import download_file_content

    att = next((a for a in receipt.attachments if a.id == attachment_id), None)
    if att is None:
        raise HTTPException(status_code=404, detail="That file is not on this receipt - reload the receipt and try again.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint is not configured on this server, so files can't be opened. Ask an admin to set it up.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, att.sharepoint_path or "")
    return Response(content=content, media_type=att.content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{att.filename}"'})
