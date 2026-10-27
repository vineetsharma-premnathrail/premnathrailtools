"""Before-PO receipts (goods that arrive before their purchase order) and the
PO line quantity floor.

A Store user records the receipt (store/routes/pre_po_receipts.py); Procurement
turns it into a PO (p2p/routes/pre_po_receipts.py). Stock is NOT posted by the
receipt - only the GRN against the approved PO posts it - so this module holds
the shared number generator, the PO close hook and the quantity-floor rule."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session, object_session

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
    asks for (quantity less what Store issued from stock) minus what the other
    live POs already order of the same line, never below 0. A line that doesn't
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
    still_to_buy = (pr_item.quantity or 0) - (pr_item.issued_qty or 0)
    others = (db.query(func.coalesce(func.sum(P2PPurchaseOrderItem.quantity), 0))
              .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
              .filter(P2PPurchaseOrderItem.pr_item_id == item.pr_item_id,
                      P2PPurchaseOrder.status != "cancelled",
                      P2PPurchaseOrderItem.purchase_order_id != item.purchase_order_id).scalar() or 0)
    return max(0.0, round(still_to_buy - others, 6))


def close_receipt_if_po_received(db: Session, po: P2PPurchaseOrder) -> None:
    """D7: when the PO behind a Before-PO receipt is fully received (its
    status rolled up to 'fulfilled'), the receipt closes. Flushes nothing else."""
    if po.status != "fulfilled":
        return
    receipt = (db.query(StorePrePoReceipt)
               .filter(StorePrePoReceipt.purchase_order_id == po.id, StorePrePoReceipt.status == "po_created").first())
    if receipt is not None:
        receipt.status = "closed"


def receipt_to_response(db: Session, receipt: StorePrePoReceipt):
    """PrePoReceiptResponse with the display names filled in."""
    from app.modules.main.models.user import User
    from app.modules.p2p.models.p2p_request import P2PRequest
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
    return PrePoReceiptResponse(
        id=receipt.id, receipt_number=receipt.receipt_number, vendor_id=receipt.vendor_id, vendor_name=receipt.vendor_name,
        received_date=receipt.received_date, store_location_id=receipt.store_location_id,
        store_location_name=location.name if location else None,
        delivery_challan_number=receipt.delivery_challan_number, vendor_invoice_number=receipt.vendor_invoice_number,
        remarks=receipt.remarks, status=receipt.status, p2p_request_id=receipt.p2p_request_id,
        p2p_number=pr.p2p_number if pr else None, purchase_order_id=receipt.purchase_order_id,
        po_number=po.po_number if po else None, po_status=po.status if po else None,
        created_by_id=receipt.created_by_id, created_by_name=(creator.name or creator.email) if creator else None,
        created_at=receipt.created_at, cancel_reason=receipt.cancel_reason,
        items=[PrePoReceiptItemResponse(
            id=l.id, store_item_id=l.store_item_id, item_code=codes.get(l.store_item_id), item_name=l.item_name,
            unit=l.unit, quantity=l.quantity, remarks=l.remarks) for l in receipt.items],
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
        if pr_item is not None and (item.quantity or 0) - ((pr_item.quantity or 0) - (pr_item.issued_qty or 0)) > 1e-9:
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
    message = (f"Store received {len(receipt.items)} item(s) from {receipt.vendor_name} on {receipt.received_date:%d-%b-%Y} "
               f"before a PO existed: {names}. Open Procurement > Purchase Orders > Before PO and create the PO.")

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
