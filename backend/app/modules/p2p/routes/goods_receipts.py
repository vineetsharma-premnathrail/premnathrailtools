from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.schemas.goods_receipt import (
    P2PGoodsReceiptCreate,
    P2PGoodsReceiptInspectPayload,
    P2PGoodsReceiptResponse,
)
from app.modules.p2p.service import generate_grn_number
from app.modules.store.models.location import StoreLocation
from app.utils.notifications import notify_user

router = APIRouter(prefix="/p2p/goods-receipts", tags=["P2P"])

# PO statuses a GRN may still be raised against — not yet fully received,
# not draft (nothing to receive), not cancelled.
_RECEIVABLE_PO_STATUSES = ("issued", "acknowledged", "partially_fulfilled")


def _get_grn_or_404(db: Session, grn_id: int) -> P2PGoodsReceipt:
    grn = db.query(P2PGoodsReceipt).options(
        selectinload(P2PGoodsReceipt.items),
    ).filter(P2PGoodsReceipt.id == grn_id).first()
    if not grn:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    return grn


def _write_audit(db: Session, pr_id: int, action: str, user: User, summary: str) -> None:
    db.add(AuditLog(entity_type="p2p_request", entity_id=pr_id, action=action, performed_by_id=user.id, summary=summary))


def _to_response(db: Session, grn: P2PGoodsReceipt) -> P2PGoodsReceiptResponse:
    resp = P2PGoodsReceiptResponse.model_validate(grn)
    po = grn.purchase_order
    resp.po_number = po.po_number
    resp.p2p_request_id = po.p2p_request_id
    resp.vendor_name = po.vendor_name
    if po.p2p_request_id:
        pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first()
        if pr:
            resp.p2p_number = pr.p2p_number
    if grn.store_location_id:
        loc = db.query(StoreLocation).filter(StoreLocation.id == grn.store_location_id).first()
        if loc:
            resp.store_location_name = loc.name
    user_ids = {grn.received_by_id, grn.inspected_by_id} - {None}
    if user_ids:
        users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
        if grn.received_by_id and grn.received_by_id in users:
            resp.received_by_name = users[grn.received_by_id].name or users[grn.received_by_id].email
        if grn.inspected_by_id and grn.inspected_by_id in users:
            resp.inspected_by_name = users[grn.inspected_by_id].name or users[grn.inspected_by_id].email
    return resp


def _sync_po_and_pr_status(db: Session, po: P2PPurchaseOrder, user_id: int) -> None:
    """Rolls a PO's completed-GRN accepted quantities up into its fulfilment
    status, and mirrors that onto the parent P2PRequest's legacy
    receipt_status/received_quantity/status fields — those are what
    POST /p2p/requests/{id}/close still gates on, so this keeps that
    downstream flow working without duplicating the close logic here."""
    po_items = db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.purchase_order_id == po.id).all()
    ordered_total = sum(i.quantity for i in po_items)

    accepted_by_item: dict[int, float] = {}
    completed_grns = (
        db.query(P2PGoodsReceipt)
        .filter(P2PGoodsReceipt.purchase_order_id == po.id, P2PGoodsReceipt.status == "completed")
        .options(selectinload(P2PGoodsReceipt.items))
        .all()
    )
    for g in completed_grns:
        for it in g.items:
            accepted_by_item[it.po_item_id] = accepted_by_item.get(it.po_item_id, 0) + (it.accepted_quantity or 0)
    accepted_total = sum(accepted_by_item.values())

    if accepted_total <= 0:
        po.status = "issued" if po.status not in ("draft", "cancelled") else po.status
    elif ordered_total and accepted_total < ordered_total:
        po.status = "partially_fulfilled"
    else:
        po.status = "fulfilled"

    if not po.p2p_request_id:
        return
    pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first()
    if not pr:
        return
    old_status = pr.status
    pr.ordered_quantity = ordered_total
    pr.received_quantity = accepted_total
    latest_grn = max(completed_grns, key=lambda g: g.inspected_at or g.created_at, default=None)
    if latest_grn:
        pr.grn_number = latest_grn.grn_number
    if accepted_total <= 0:
        pr.receipt_status = "pending"
    elif ordered_total and accepted_total < ordered_total:
        pr.receipt_status = "partial"
        if pr.status in ("po_approved", "partially_received"):
            pr.status = "partially_received"
    else:
        pr.receipt_status = "received"
        if pr.status in ("po_approved", "partially_received"):
            pr.status = "received"
    if pr.status != old_status:
        db.add(AuditLog(
            entity_type="p2p_request", entity_id=pr.id, action="receipt_updated", performed_by_id=user_id,
            summary=f"Receipt status updated to '{pr.receipt_status}' ({accepted_total}/{ordered_total} accepted) for {pr.p2p_number}.",
            old_value=old_status, new_value=pr.status,
        ))


@router.get("", response_model=list[P2PGoodsReceiptResponse])
async def list_goods_receipts(
    purchase_order_id: int | None = Query(None),
    p2p_request_id: int | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    q = db.query(P2PGoodsReceipt).options(selectinload(P2PGoodsReceipt.items)).join(
        P2PPurchaseOrder, P2PGoodsReceipt.purchase_order_id == P2PPurchaseOrder.id
    )
    if purchase_order_id:
        q = q.filter(P2PGoodsReceipt.purchase_order_id == purchase_order_id)
    if p2p_request_id:
        q = q.filter(P2PPurchaseOrder.p2p_request_id == p2p_request_id)
    if status:
        q = q.filter(P2PGoodsReceipt.status == status)
    grns = q.order_by(P2PGoodsReceipt.created_at.desc()).all()
    return [_to_response(db, g) for g in grns]


@router.get("/pending-purchase-orders")
async def list_pending_purchase_orders(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    """POs that still have quantity outstanding to receive — feeds the
    "start a new GRN" picker on the frontend."""
    pos = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.status.in_(_RECEIVABLE_PO_STATUSES)
    ).order_by(P2PPurchaseOrder.po_date.desc()).all()
    result = []
    for po in pos:
        pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first() if po.p2p_request_id else None
        result.append({
            "id": po.id,
            "po_number": po.po_number,
            "vendor_name": po.vendor_name,
            "p2p_number": pr.p2p_number if pr else None,
            "status": po.status,
            "items": [
                {"id": i.id, "item_name": i.item_name, "unit": i.unit, "quantity": i.quantity}
                for i in po.items
            ],
        })
    return result


@router.get("/{grn_id}", response_model=P2PGoodsReceiptResponse)
async def get_goods_receipt(
    grn_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    return _to_response(db, _get_grn_or_404(db, grn_id))


@router.post("", response_model=P2PGoodsReceiptResponse)
async def create_goods_receipt(
    payload: P2PGoodsReceiptCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.id == payload.purchase_order_id
    ).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.status not in _RECEIVABLE_PO_STATUSES:
        raise HTTPException(status_code=409, detail=f"Cannot record a receipt against a PO with status '{po.status}'")
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")

    po_items_by_id = {i.id: i for i in po.items}

    # Already-received (draft or completed) quantity per PO item, so a new
    # GRN can't push the total past what was actually ordered.
    already_received: dict[int, float] = {}
    existing_grns = db.query(P2PGoodsReceipt).filter(P2PGoodsReceipt.purchase_order_id == po.id).options(
        selectinload(P2PGoodsReceipt.items)
    ).all()
    for g in existing_grns:
        for it in g.items:
            already_received[it.po_item_id] = already_received.get(it.po_item_id, 0) + it.received_quantity

    for item_payload in payload.items:
        po_item = po_items_by_id.get(item_payload.po_item_id)
        if not po_item:
            raise HTTPException(status_code=422, detail=f"PO item {item_payload.po_item_id} does not belong to this purchase order")
        if item_payload.received_quantity <= 0:
            raise HTTPException(status_code=422, detail=f"Received quantity for '{po_item.item_name}' must be greater than zero")
        prior = already_received.get(po_item.id, 0)
        if prior + item_payload.received_quantity > po_item.quantity + 1e-9:
            remaining = max(0.0, po_item.quantity - prior)
            raise HTTPException(
                status_code=409,
                detail=f"Received quantity for '{po_item.item_name}' exceeds what's still outstanding on the PO ({remaining} remaining)",
            )

    grn = P2PGoodsReceipt(
        grn_number=generate_grn_number(db),
        purchase_order_id=po.id,
        store_location_id=payload.store_location_id,
        status="draft",
        received_date=payload.received_date or date.today(),
        received_by_id=user.id,
        remarks=payload.remarks,
    )
    db.add(grn)
    db.flush()

    for item_payload in payload.items:
        po_item = po_items_by_id[item_payload.po_item_id]
        db.add(P2PGoodsReceiptItem(
            goods_receipt_id=grn.id,
            po_item_id=po_item.id,
            item_name=po_item.item_name,
            unit=po_item.unit,
            ordered_quantity=po_item.quantity,
            received_quantity=item_payload.received_quantity,
            quality_status="pending",
        ))

    if po.p2p_request_id:
        _write_audit(db, po.p2p_request_id, "grn_recorded", user,
                     summary=f"{user.name or user.email} recorded goods receipt '{grn.grn_number}' against PO '{po.po_number}'.")
        if po.created_by_id:
            notify_user(
                db, user_id=po.created_by_id,
                title="Goods Receipt Recorded",
                message=f"Goods receipt '{grn.grn_number}' was recorded against PO '{po.po_number}' — pending quality inspection.",
                notification_type="p2p_grn_recorded", entity_type="p2p_goods_receipt", entity_id=grn.id,
            )

    db.commit()
    db.refresh(grn)
    return _to_response(db, grn)


@router.post("/{grn_id}/inspect", response_model=P2PGoodsReceiptResponse)
async def inspect_goods_receipt(
    grn_id: int,
    payload: P2PGoodsReceiptInspectPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Records the quality-inspection result per line (accepted/rejected
    split) and completes the GRN once every item has been inspected — which
    then rolls up into the PO's fulfilment status and the PR's receipt
    status (see _sync_po_and_pr_status)."""
    grn = _get_grn_or_404(db, grn_id)
    if grn.status == "completed":
        raise HTTPException(status_code=409, detail="This goods receipt has already been completed")
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item inspection result is required")

    items_by_id = {i.id: i for i in grn.items}
    for entry in payload.items:
        item = items_by_id.get(entry.item_id)
        if not item:
            raise HTTPException(status_code=422, detail=f"Item {entry.item_id} does not belong to this goods receipt")
        if entry.accepted_quantity < 0 or entry.rejected_quantity < 0:
            raise HTTPException(status_code=422, detail=f"Accepted/rejected quantity for '{item.item_name}' cannot be negative")
        if entry.accepted_quantity + entry.rejected_quantity > item.received_quantity + 1e-9:
            raise HTTPException(
                status_code=422,
                detail=f"Accepted + rejected for '{item.item_name}' exceeds the {item.received_quantity} received",
            )
        item.accepted_quantity = entry.accepted_quantity
        item.rejected_quantity = entry.rejected_quantity
        item.quality_status = entry.quality_status
        item.rejection_reason = entry.rejection_reason
        item.remarks = entry.remarks

    if any(i.quality_status == "pending" for i in grn.items):
        raise HTTPException(status_code=422, detail="Every line item must be inspected before the goods receipt can be completed")

    grn.status = "completed"
    grn.inspected_by_id = user.id
    grn.inspected_at = datetime.now(timezone.utc)

    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == grn.purchase_order_id).first()
    _sync_po_and_pr_status(db, po, user.id)

    if po.p2p_request_id:
        _write_audit(db, po.p2p_request_id, "grn_inspected", user,
                     summary=f"{user.name or user.email} completed quality inspection for goods receipt '{grn.grn_number}'.")

    db.commit()
    db.refresh(grn)
    return _to_response(db, grn)
