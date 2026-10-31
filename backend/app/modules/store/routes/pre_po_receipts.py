"""Store > Inward > Before PO: goods that arrived before their purchase order.

Recording one does NOT post stock - the goods are held in store until
Procurement makes the PO (p2p/routes/pre_po_receipts.py) and the GRN against
that approved PO posts stock at the PO rate, with QC. Gate: Store tab `grn`
(view for reads, create for record/cancel), then the Store data scope."""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope, register_scoped
from app.core.permission_registry import is_admin_user
from app.core.permissions import require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.user import User
from app.modules.p2p.pre_po import (
    attachment_content_response, ensure_attachable, generate_receipt_number, notify_receipt_recorded, receipt_to_response,
    save_attachment,
)
from app.modules.store.access import store_plant_column
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.pre_po_receipt import STORE_PRE_PO_STATUSES, StorePrePoReceipt, StorePrePoReceiptItem
from app.modules.store.schemas.pre_po_receipt import PrePoReceiptCancel, PrePoReceiptCreate, PrePoReceiptResponse
from app.modules.store.services.plant_access import ensure_location_allowed, visible_location_ids

router = APIRouter(prefix="/store/pre-po-receipts", tags=["Store"])

# Plant = the holding store's plant (same pattern as goods receipts).
if not hasattr(StorePrePoReceipt, "plant_id"):
    StorePrePoReceipt.plant_id = store_plant_column(StorePrePoReceipt.store_location_id)
register_scoped(StorePrePoReceipt, "store", owner=("created_by_id",), branch="plant_id", label="Before-PO receipt")

_CANCEL_WHY = {
    "po_created": "Procurement has already made a PO for it - ask Procurement to cancel that PO; the receipt then returns to the waiting list and you can cancel it.",
    "closed": "its PO was received in full, so it is closed.",
    "cancelled": "it is already cancelled.",
}


def _load(db: Session, receipt_id: int, user: User, lock: bool = False) -> StorePrePoReceipt:
    q = db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items)).filter(StorePrePoReceipt.id == receipt_id)
    receipt = (q.with_for_update() if lock else q).first()
    if receipt is None:
        raise HTTPException(status_code=404, detail="Before-PO receipt not found - it may have been removed. Go back to the list and reopen it.")
    ensure_in_scope(db, user, receipt)
    if receipt.store_location_id:
        ensure_location_allowed(db, user, receipt.store_location_id)
    return receipt


def _own_store_id(db: Session, user: User, picked: int | None) -> int | None:
    """A store person books goods into their own store only (owner, 2026-10-28).
    Admins pick any store (optional). Everyone else: the active stores they
    manage, else the active stores of their Store data scope; one store is
    used whatever was sent, several must be picked from, none is refused."""
    if is_admin_user(user):
        return picked
    allowed = visible_location_ids(db, user)
    q = db.query(StoreLocation).filter(StoreLocation.is_active.is_(True))
    if allowed is not None:
        q = q.filter(StoreLocation.id.in_(allowed or {-1}))
    stores = q.all()
    own = [s for s in stores if s.manager_user_id == user.id] or stores
    if not own:
        raise HTTPException(status_code=403, detail="No store is linked to you, so goods can't be booked. Ask an admin to make you the manager "
                                                    "of your store in Store > Settings > Stores, or to set your plant in Organization > Branches.")
    if len(own) == 1:
        return own[0].id
    if picked in {s.id for s in own}:
        return picked
    names = ", ".join(sorted(s.name for s in own))
    raise HTTPException(status_code=422, detail=f"Pick the store the goods are held in - one of your stores: {names}.")


@router.get("", response_model=list[PrePoReceiptResponse])
async def list_pre_po_receipts(
    status: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "grn")),
):
    if status and status not in STORE_PRE_PO_STATUSES:
        raise HTTPException(status_code=400, detail=f"Unknown status '{status}'. Use one of: {', '.join(STORE_PRE_PO_STATUSES)}.")
    q = apply_scope(db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items)), user, StorePrePoReceipt)
    if status:
        q = q.filter(StorePrePoReceipt.status == status)
    allowed = visible_location_ids(db, user)
    if allowed is not None:
        q = q.filter((StorePrePoReceipt.store_location_id.is_(None)) | (StorePrePoReceipt.store_location_id.in_(allowed or {-1})))
    return [receipt_to_response(db, r) for r in q.order_by(StorePrePoReceipt.receipt_number.asc()).limit(limit).all()]


@router.post("", response_model=PrePoReceiptResponse)
async def create_pre_po_receipt(
    payload: PrePoReceiptCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "grn", "create")),
):
    if payload.received_date > date.today():
        raise HTTPException(status_code=422, detail=f"Received date {payload.received_date:%d-%b-%Y} is in the future - goods can only be booked "
                                                    "once they have arrived. Enter today's date or an earlier one.")
    vendor = db.get(Vendor, payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=400, detail="That vendor is not in the vendor master - pick the vendor from the list, "
                                                    "or ask Procurement to add it in Procurement > Vendors.")
    if vendor.status != "active":
        raise HTTPException(status_code=409, detail=f"Vendor {vendor.name} is {vendor.status} in the vendor master, so goods can't be booked against it. "
                                                    "Ask Procurement or Finance to set it Active in Procurement > Vendors, or pick another vendor.")
    location_id = _own_store_id(db, user, payload.store_location_id)
    if location_id:
        location = db.get(StoreLocation, location_id)
        if location is None or not location.is_active:
            raise HTTPException(status_code=400, detail="That store location doesn't exist or is inactive - pick an active store location.")
        ensure_location_allowed(db, user, location_id)

    ids = [i.store_item_id for i in payload.items]
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(ids)).all()}
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        names = ", ".join(items[d].item_name if d in items else f"#{d}" for d in dupes)
        raise HTTPException(status_code=422, detail=f"{names} is on the receipt more than once - put each item on one line and add the quantities together.")
    missing = [i for i in ids if i not in items]
    if missing:
        raise HTTPException(status_code=400, detail=f"Item(s) {', '.join(map(str, missing))} are not in the Item Master - pick every item from the Item Master list.")
    from app.modules.p2p.purpose import item_type_problem
    for line in payload.items:
        item = items[line.store_item_id]
        if item.status != "active":
            raise HTTPException(status_code=409, detail=f"{item.item_code} {item.item_name} is {item.status} in the Item Master - activate it or pick another item.")
        problem = item_type_problem("stock", "This line", item.item_code, item.item_name, item.item_type, db)
        if problem:
            raise HTTPException(status_code=422, detail=problem)

    receipt = StorePrePoReceipt(
        receipt_number=generate_receipt_number(db), vendor_id=vendor.id, vendor_name=vendor.name,
        received_date=payload.received_date, store_location_id=location_id,
        delivery_challan_number=(payload.delivery_challan_number or "").strip() or None,
        vendor_invoice_number=(payload.vendor_invoice_number or "").strip() or None,
        remarks=(payload.remarks or "").strip() or None, status="pending_po", created_by_id=user.id,
    )
    for line in payload.items:
        item = items[line.store_item_id]
        receipt.items.append(StorePrePoReceiptItem(
            store_item_id=item.id, item_name=item.item_name, unit=item.uom, quantity=line.quantity,
            remarks=(line.remarks or "").strip() or None))
    db.add(receipt)
    db.flush()
    notify_receipt_recorded(db, receipt, user)
    db.commit()
    db.refresh(receipt)
    return receipt_to_response(db, receipt)


@router.get("/{receipt_id}", response_model=PrePoReceiptResponse)
async def get_pre_po_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "grn")),
):
    return receipt_to_response(db, _load(db, receipt_id, user))


@router.post("/{receipt_id}/cancel", response_model=PrePoReceiptResponse)
async def cancel_pre_po_receipt(
    receipt_id: int,
    payload: PrePoReceiptCancel,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "grn", "create")),
):
    receipt = _load(db, receipt_id, user, lock=True)
    if receipt.status != "pending_po":
        raise HTTPException(status_code=409, detail=f"Receipt {receipt.receipt_number} can only be cancelled while it is waiting for a PO: "
                                                    f"{_CANCEL_WHY.get(receipt.status, 'its status no longer allows it.')}")
    receipt.status = "cancelled"
    receipt.cancelled_by_id = user.id
    receipt.cancelled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    receipt.cancel_reason = payload.reason
    # Its requisition (if any, and no PO raised yet) has no purpose any more: cancel it with the reason.
    from app.modules.p2p.routes.pre_po_receipts import cancel_requisition_for_receipt
    cancel_requisition_for_receipt(db, receipt, user, payload.reason)
    db.commit()
    db.refresh(receipt)
    return receipt_to_response(db, receipt)


@router.post("/{receipt_id}/attachments", response_model=PrePoReceiptResponse)
async def attach_file_to_pre_po_receipt(
    receipt_id: int,
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "grn", "create")),
):
    """Attach the vendor invoice / delivery challan (doc_type invoice | challan | other)."""
    receipt = _load(db, receipt_id, user)
    await save_attachment(db, receipt, user, file, doc_type)
    db.commit()
    db.refresh(receipt)
    return receipt_to_response(db, receipt)


@router.get("/{receipt_id}/attachments/{attachment_id}/content")
async def get_pre_po_receipt_attachment(
    receipt_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "grn")),
):
    return await attachment_content_response(_load(db, receipt_id, user), attachment_id)


@router.delete("/{receipt_id}/attachments/{attachment_id}", response_model=PrePoReceiptResponse)
async def delete_pre_po_receipt_attachment(
    receipt_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "grn", "create")),
):
    """Only the person who uploaded a file (or an admin) can remove it, and only
    while the receipt is waiting for a PO or has one in progress."""
    receipt = _load(db, receipt_id, user)
    ensure_attachable(receipt)
    if receipt.status not in ("pending_po", "po_created"):
        raise HTTPException(status_code=409, detail=f"Receipt {receipt.receipt_number} is {receipt.status}, so its files are locked.")
    att = next((a for a in receipt.attachments if a.id == attachment_id), None)
    if att is None:
        raise HTTPException(status_code=404, detail="That file is not on this receipt - reload the receipt and try again.")
    if att.uploaded_by_id != user.id and not is_admin_user(user):
        raise HTTPException(status_code=403, detail="You can only remove a file you uploaded yourself. Ask the person who attached it, or an admin.")
    receipt.attachments.remove(att)
    db.commit()
    db.refresh(receipt)
    return receipt_to_response(db, receipt)
