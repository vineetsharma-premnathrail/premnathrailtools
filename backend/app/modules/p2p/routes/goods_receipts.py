from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_feature_action, ensure_tab_action, require_any_app_access
import app.modules.p2p.access  # noqa: F401 — registers the data scopes (GRN: Store module scope)
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.p2p.models.p2p_request import P2PRequest, P2P_ROLE_LABELS
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem, P2P_GRN_QUALITY_STATUSES
from app.modules.p2p.schemas.goods_receipt import (
    P2PGoodsReceiptCreate,
    P2PGoodsReceiptInspectPayload,
    P2PGoodsReceiptResponse,
    P2PGoodsReceiptReversePayload,
)
from app.modules.p2p.service import generate_grn_number
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.plant_access import ensure_location_allowed, filter_by_location, visible_location_ids
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.store.services.posting_period import stock_posting_block_reason
from app.modules.p2p.grn_posting import post_quality_inspection, receive_into_quality, reverse_quality_line
from app.modules.store.services.valuation import ledger_sort_key
from app.utils.notifications import notify_user
from app.modules.quality.services.lots import needs_inspection_on_receipt, create_lot_for_grn_line, LotError
from app.modules.store.services.batches import (
    apply_line_inspection, batches_for_lines, create_grn_batches, grn_line_splits, line_batches, validate_grn_line_batches,
)

router = APIRouter(prefix="/p2p/goods-receipts", tags=["P2P"])


def _grn_tab(action: str):
    """GRNs are worked from Store › GRN & Inspection: keep the old Purchase-or-
    Store module gate and add the matching action on store:grn."""
    module_dep = require_any_app_access("purchase", "store")

    def _dependency(user: User = Depends(module_dep)) -> User:
        ensure_tab_action(user, "store", "grn", action)
        return user

    return _dependency

# PO statuses a GRN may still be raised against — not yet fully received,
# not draft (nothing to receive), not cancelled.
_RECEIVABLE_PO_STATUSES = ("issued", "acknowledged", "partially_fulfilled")

# A PO's status alone reaches "issued" as soon as it's raised, before the
# Purchase Head -> Director -> Partner PO approval chain (see p2p_requests.py
# approve-po) has completed. Receiving must also gate on the parent PR
# having cleared that chain, or a PO could be received against before it's
# financially approved.
_PO_APPROVED_PR_STATUSES = ("po_approved", "partially_received")


def _po_approval_block_reason(db: Session, po: P2PPurchaseOrder) -> str | None:
    """Why goods can't be received against this PO yet, or None if they
    can. Checks the PO approval (engine status, or the old Purchase Head /
    Director / Partner stamps of POs approved before it),
    not just a status string, and refuses a PO with no parent PR at all —
    such a PO never went through any approval chain."""
    from app.modules.p2p.po_split import EXTERNAL_PO_SOURCES
    if po.source in EXTERNAL_PO_SOURCES:
        return None  # approved in Tally and uploaded — no portal approval to wait for
    pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first() if po.p2p_request_id else None
    if not pr:
        return f"PO '{po.po_number}' isn't linked to a purchase requisition, so it never went through PO approval — goods can't be received against it."
    # ME21N split: a PR with several POs is still 'PO raised' while another of
    # its POs is in approval — this PO's own final approval is what counts.
    from app.modules.p2p.po_split import live_pos, po_is_released
    if pr.status in ("po_drafted", "po_raised", "po_approved", "partially_received", "received") and len(live_pos(db, pr.id)) > 1:
        if po_is_released(db, po):
            return None
        return f"PO '{po.po_number}' has not completed its approval yet — goods can be received once its approvers and a Partner have signed it."
    if pr.status not in _PO_APPROVED_PR_STATUSES or pr.pending_po_approval_roles:
        pending = ", ".join(P2P_ROLE_LABELS.get(r, r) for r in pr.pending_po_approval_roles)
        pending_note = f" Still waiting on: {pending}." if pending else ""
        return f"PO '{po.po_number}' has not completed its approval yet (request status: {pr.status}).{pending_note}"
    return None


def _received_by_po_item(db: Session, po_id: int) -> dict[int, float]:
    """Quantity already received per PO item, i.e. what's no longer pending
    from the vendor. A completed GRN's rejected quantity doesn't count — the
    vendor still owes a replacement for it, so only its accepted quantity is
    "used up". A draft GRN hasn't been inspected yet, so its full
    received_quantity counts until that's resolved."""
    received: dict[int, float] = {}
    grns = db.query(P2PGoodsReceipt).filter(
        P2PGoodsReceipt.purchase_order_id == po_id, P2PGoodsReceipt.status != "reversed",
    ).options(selectinload(P2PGoodsReceipt.items)).all()
    for g in grns:
        for it in g.items:
            # Per line: once a line has its accept/reject split (GRN inspection
            # or a Quality lot decision), only the accepted part is used up —
            # less anything returned to the vendor (a replacement is owed).
            qty = (net_accepted(it) if it.quality_status in _DECIDED_LINE_STATUSES else it.received_quantity)
            received[it.po_item_id] = received.get(it.po_item_id, 0) + (qty or 0)
    return received


_DECIDED_LINE_STATUSES = ("passed", "failed", "partial")


def net_accepted(it: P2PGoodsReceiptItem) -> float:
    """Accepted quantity still with us — accepted minus what went back to
    the vendor on a Return to Vendor."""
    return max((it.accepted_quantity or 0) - (it.returned_quantity or 0), 0.0)


def _po_rate(po_item) -> float | None:
    """Receipts are valued at the PO line's unit price (excl. GST) — the
    price agreed with the vendor — not at whatever the item's average is —
    plus the PO's planned delivery costs per unit (p2p/landed_cost.py)."""
    from app.modules.p2p.landed_cost import landed_rate
    return landed_rate(po_item)


def _fmt_qty(q: float) -> str:
    return f"{q:g}"


def _grn_store_scope(db: Session, user: User) -> set[int] | None:
    """Stores whose GRNs this user may see/record, or None for all.

    Purchase-team users (and admins) work across plants — a central buyer
    receives into any store, so Store → Plant Access does not apply to them.
    Store-only users are held to their plant's stores, the same as every
    other Store document (issues, returns, transfers …)."""
    if "purchase" in user.get_apps():
        return None
    return visible_location_ids(db, user)


def _get_grn_or_404(db: Session, grn_id: int, for_update: bool = False, user: User | None = None) -> P2PGoodsReceipt:
    """The GRN (404 if missing); with `user`, also 403 when it is outside their
    Store data scope (registered in p2p/access.py)."""
    q = db.query(P2PGoodsReceipt).options(
        selectinload(P2PGoodsReceipt.items),
    ).filter(P2PGoodsReceipt.id == grn_id)
    grn = (q.with_for_update() if for_update else q).first()
    if not grn:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    if user is not None:
        ensure_in_scope(db, user, grn)
    return grn


def _write_audit(db: Session, pr_id: int, action: str, user: User, summary: str) -> None:
    db.add(AuditLog(entity_type="p2p_request", entity_id=pr_id, action=action, performed_by_id=user.id, summary=summary))


def _sync_stock_for_grn(db: Session, grn: P2PGoodsReceipt, user_id: int, items: list | None = None) -> list[str]:
    """Posts each accepted line onto the Store stock ledger at
    grn.store_location_id, against the line's Item Master id (copied PR → PO
    → GRN) and valued at the PO unit price. Returns notes for any line that
    could NOT be posted (no store location on this GRN) so the Store team
    knows exactly what to fix; never raises — a stock-sync gap must not block
    completing the quality inspection itself."""
    notes: list[str] = []
    lines = grn.items if items is None else items
    if not grn.store_location_id:
        return [f"'{it.item_name}': GRN has no store location set — stock was not updated." for it in lines if (it.accepted_quantity or 0) > 0]

    for it in sorted(lines, key=lambda l: ledger_sort_key(l.store_item_id, grn.store_location_id)):
        if it.receipt_posting == "none":
            if (it.accepted_quantity or 0) > 0:
                notes.append(f"'{it.item_name}' is an asset line — it is not taken into store stock; Finance capitalises it "
                             "under Finance › Fixed Assets when the vendor's invoice is booked.")
            continue
        if it.receipt_posting == "quality":
            # Already in Quality stock since the GRN was recorded: release / block it.
            post_quality_inspection(db, grn, it, user_id)
            continue
        qty = it.accepted_quantity or 0
        if qty <= 0:
            continue
        if not it.store_item_id:
            notes.append(f"'{it.item_name}': this older GRN line isn't linked to an Item Master item, so stock was not "
                         "updated — post it with a Store stock entry for this GRN.")
            continue
        # Batch-tracked line: one receipt row per heat (Store batches).
        for batch_no, part in grn_line_splits(db, it, qty):
            post_stock_transaction(
                db, item_id=it.store_item_id, location_id=grn.store_location_id, transaction_type="receipt",
                quantity=part, batch_number=batch_no, reference_type="grn", reference_number=grn.grn_number,
                transaction_date=grn.received_date, remarks=f"GRN {grn.grn_number} quality-passed receipt",
                created_by_id=user_id, vendor_name=grn.purchase_order.vendor_name if grn.purchase_order else None,
                unit_cost=_po_rate(it.po_item), cost_source="po_rate" if _po_rate(it.po_item) else None,
            )
    return notes


def _post_grn_stock_or_409(db: Session, grn: P2PGoodsReceipt, user_id: int, items: list) -> list[str]:
    """_sync_stock_for_grn for the inspection endpoint: when the ledger refuses
    the receipt (store made inactive, items frozen by a physical count, a
    receipt needing a rate) the whole inspection is rolled back and the real
    reason returned — never a half-completed GRN or a server error."""
    try:
        return _sync_stock_for_grn(db, grn, user_id, items)
    except ValueError as e:
        number = grn.grn_number
        db.rollback()
        raise HTTPException(status_code=409, detail=f"GRN {number} can't be put into stock, so the inspection was not saved: {e}")


def _to_response(db: Session, grn: P2PGoodsReceipt) -> P2PGoodsReceiptResponse:
    resp = P2PGoodsReceiptResponse.model_validate(grn)
    po = grn.purchase_order
    resp.po_number = po.po_number
    resp.po_date = po.po_date
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
    user_ids = {grn.received_by_id, grn.inspected_by_id, grn.reversed_by_id} - {None}
    if user_ids:
        users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
        if grn.received_by_id and grn.received_by_id in users:
            resp.received_by_name = users[grn.received_by_id].name or users[grn.received_by_id].email
        if grn.inspected_by_id and grn.inspected_by_id in users:
            resp.inspected_by_name = users[grn.inspected_by_id].name or users[grn.inspected_by_id].email
        if grn.reversed_by_id and grn.reversed_by_id in users:
            resp.reversed_by_name = users[grn.reversed_by_id].name or users[grn.reversed_by_id].email
    batches = batches_for_lines(db, [i.id for i in resp.items])
    from app.modules.store.models.bin import StoreBin
    bin_ids = {it.bin_id for it in resp.items} - {None}
    bin_codes = {b.id: b.code for b in db.query(StoreBin).filter(StoreBin.id.in_(bin_ids)).all()} if bin_ids else {}
    for it in resp.items:
        it.batches = batches.get(it.id, [])
        it.bin_code = bin_codes.get(it.bin_id)
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
            accepted_by_item[it.po_item_id] = accepted_by_item.get(it.po_item_id, 0) + net_accepted(it)
    # Service lines are "received" by accepted service entries, not GRNs.
    from app.modules.p2p.service import accepted_service_qty_by_po_item
    for po_item_id, qty in accepted_service_qty_by_po_item(db, po.id).items():
        accepted_by_item[po_item_id] = accepted_by_item.get(po_item_id, 0) + qty
    accepted_total = sum(accepted_by_item.values())

    if accepted_total <= 0:
        po.status = "issued" if po.status not in ("draft", "cancelled") else po.status
    elif ordered_total and accepted_total < ordered_total:
        po.status = "partially_fulfilled"
    else:
        po.status = "fulfilled"
    # A Before-PO receipt closes once its PO is received in full.
    from app.modules.p2p.pre_po import close_receipt_if_po_received
    close_receipt_if_po_received(db, po)

    if not po.p2p_request_id:
        return
    pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first()
    if not pr:
        return
    old_status = pr.status
    pr.ordered_quantity = ordered_total
    pr.received_quantity = accepted_total
    # inspected_at is a naive (timestamp-without-tz) column, but
    # inspect_goods_receipt assigns an aware datetime — and the session's
    # identity map hands the just-inspected GRN back with that aware value
    # while earlier GRNs load naive, so a mixed max() would raise TypeError
    # on the second GRN of a PO. Both represent UTC; strip tzinfo to compare.
    def _grn_ts(g: P2PGoodsReceipt) -> datetime:
        ts = g.inspected_at or g.created_at
        return ts.replace(tzinfo=None) if ts.tzinfo else ts

    latest_grn = max(completed_grns, key=_grn_ts, default=None)
    if latest_grn:
        pr.grn_number = latest_grn.grn_number
    if accepted_total <= 0:
        pr.receipt_status = "pending"
        # Everything received was reversed / returned — back to awaiting goods.
        if pr.status in ("partially_received", "received"):
            pr.status = "po_approved"
    elif ordered_total and accepted_total < ordered_total:
        pr.receipt_status = "partial"
        # "received" too: a Return to Vendor / GRN reversal reopens it.
        if pr.status in ("po_approved", "partially_received", "received"):
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
    # ME21N split: with several POs (or lines still to order) the PR's
    # status and quantities come from all its POs, not just this one.
    from app.modules.p2p.po_split import rollup_pr_status
    rollup_pr_status(db, pr, user_id)


@router.get("", response_model=list[P2PGoodsReceiptResponse])
async def list_goods_receipts(
    purchase_order_id: int | None = Query(None),
    p2p_request_id: int | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(_grn_tab("view")),
):
    q = db.query(P2PGoodsReceipt).options(selectinload(P2PGoodsReceipt.items)).join(
        P2PPurchaseOrder, P2PGoodsReceipt.purchase_order_id == P2PPurchaseOrder.id
    )
    q = filter_by_location(q, P2PGoodsReceipt.store_location_id, _grn_store_scope(db, user))
    q = apply_scope(q, user, P2PGoodsReceipt)
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
    _user: User = Depends(_grn_tab("view")),
):
    """POs that still have quantity outstanding to receive — feeds the
    "start a new GRN" picker on the frontend."""
    pos = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.status.in_(_RECEIVABLE_PO_STATUSES)
    ).order_by(P2PPurchaseOrder.po_date.desc()).all()
    result = []
    for po in pos:
        if _po_approval_block_reason(db, po):
            continue
        if all(i.category == "service" for i in po.items):
            continue  # a services-only PO has nothing to receive on a GRN
        pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first()
        received = _received_by_po_item(db, po.id)
        result.append({
            "id": po.id,
            "po_number": po.po_number,
            "vendor_name": po.vendor_name,
            "p2p_number": pr.p2p_number if pr else None,
            "status": po.status,
            "po_date": po.po_date,
            "expected_delivery": po.expected_delivery,
            "items": [
                {"id": i.id, "item_name": i.item_name, "unit": i.unit, "quantity": i.quantity,
                 "received_quantity": received.get(i.id, 0), "pending_quantity": max(0.0, i.quantity - received.get(i.id, 0)),
                 "category": i.category,
                 # Batch-tracked items need the vendor's heat(s) + mill TC on the GRN.
                 "store_item_id": i.store_item_id,
                 "batch_controlled": bool(i.store_item is not None and i.store_item.batch_controlled),
                 "expiry_controlled": bool(i.store_item is not None and i.store_item.expiry_controlled),
                 # Serialised items need one serial number per unit (IQ01).
                 "serial_controlled": bool(i.store_item is not None and i.store_item.serial_controlled),
                 # Order Project vehicle / lot the line is bought for (Store tags the stock with it).
                 "order_project_id": i.order_project_id, "order_project_element_id": i.order_project_element_id,
                 "order_project_number": i.order_project_number, "order_project_element_no": i.order_project_element_no,
                 "order_project_element_label": i.order_project_element_label}
                # Service lines are confirmed on a service entry, never on a GRN.
                for i in po.items if i.category != "service"
            ],
        })
    return result


@router.get("/{grn_id}", response_model=P2PGoodsReceiptResponse)
async def get_goods_receipt(
    grn_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_grn_tab("view")),
):
    grn = _get_grn_or_404(db, grn_id, user=user)
    scope = _grn_store_scope(db, user)
    if scope is not None:
        ensure_location_allowed(db, user, grn.store_location_id, allowed=scope)
    return _to_response(db, grn)


@router.post("", response_model=P2PGoodsReceiptResponse)
async def create_goods_receipt(
    payload: P2PGoodsReceiptCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_grn_tab("create")),
):
    # Locks the PO row for the rest of this transaction — without it, two
    # concurrent (or double-submitted) requests against the same PO each
    # compute `already_received` from the same pre-commit snapshot and can
    # both pass the "still outstanding" check below, over-receiving the PO
    # with two separate GRN rows. A second request now blocks here until the
    # first commits or rolls back, so its own already_received query is
    # guaranteed to see that first GRN.
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.id == payload.purchase_order_id
    ).with_for_update().first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    # Every GRN posts stock at once (SAP 101), so it must name the store the
    # goods physically went into — no store = no stock, which is never right.
    if not payload.store_location_id:
        raise HTTPException(status_code=422, detail="Pick the store the goods were received into — the GRN puts them into that store's stock.")
    # Store keepers record GRNs too (plan §16 #3) — only into their own plant's
    # stores. Purchase-team users are cross-plant and skip the plant check.
    scope = _grn_store_scope(db, user)
    if scope is not None:
        ensure_location_allowed(db, user, payload.store_location_id, allowed=scope)
    if payload.store_location_id:
        loc = db.get(StoreLocation, payload.store_location_id)
        if not loc:
            raise HTTPException(status_code=404, detail="The store picked for this GRN no longer exists — reload the page and pick another store.")
        if loc.is_active is False:
            raise HTTPException(status_code=422, detail=f"Store '{loc.name}' is inactive, so goods can't be received into it — reactivate it under Store → Settings → Stores, or pick another store.")
    if po.status not in _RECEIVABLE_PO_STATUSES:
        raise HTTPException(status_code=409, detail=f"Cannot record a receipt against a PO with status '{po.status}'")
    block_reason = _po_approval_block_reason(db, po)
    if block_reason:
        raise HTTPException(status_code=409, detail=block_reason)
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")

    po_items_by_id = {i.id: i for i in po.items}

    # Already-received quantity per PO item, so a new GRN can't push the
    # total past what was actually ordered.
    already_received = _received_by_po_item(db, po.id)

    if payload.received_date and payload.received_date > date.today():
        raise HTTPException(status_code=422, detail=f"Received date {payload.received_date.isoformat()} is in the future — record the GRN on the day the goods arrive (today or earlier).")
    if payload.received_date and po.po_date and payload.received_date < po.po_date:
        raise HTTPException(status_code=422, detail=f"Received date {payload.received_date.isoformat()} is before PO {po.po_number}'s date ({po.po_date.isoformat()}) — goods can't be received against a PO before it was raised. Check the date.")
    # MM posting period: not into a period Finance has closed.
    period_block = stock_posting_block_reason(db, payload.received_date or date.today())
    if period_block:
        raise HTTPException(status_code=409, detail=period_block)
    # Gate entry + vendor invoice / challan / e-way bill / vehicle (grn_documents.py).
    from app.modules.p2p.grn_documents import validate_grn_documents, validate_grn_line_extras
    grn_docs = validate_grn_documents(db, po, payload)
    line_serials: list[list[str]] = []
    serials_seen: dict[int, set[str]] = {}

    # Same PO line twice on one GRN: count both, or the open-quantity check
    # below sees each half alone and lets the PO be over-received.
    in_this_grn: dict[int, float] = {}
    for item_payload in payload.items:
        po_item = po_items_by_id.get(item_payload.po_item_id)
        if not po_item:
            raise HTTPException(status_code=422, detail=f"PO item {item_payload.po_item_id} does not belong to this purchase order")
        if not po_item.store_item_id:
            raise HTTPException(
                status_code=409,
                detail=f"PO line '{po_item.item_name}' isn't linked to an Item Master item, so the receipt can't go into stock. "
                       f"Open PO {po.po_number} and use 'Link to Item Master' on that line, then record the GRN.",
            )
        if po_item.category == "service":
            raise HTTPException(
                status_code=422,
                detail=f"'{po_item.item_name}' is a service line — a service is not received into stock on a GRN. "
                       f"Confirm it on a service entry under the PO's Service Entries (Procurement › Purchase Orders › {po.po_number}).",
            )
        if item_payload.received_quantity <= 0:
            raise HTTPException(status_code=422, detail=f"Received quantity for '{po_item.item_name}' must be greater than zero")
        validate_grn_line_batches(db.get(StoreItem, po_item.store_item_id), item_payload.received_quantity, item_payload.batches)
        serials = validate_grn_line_extras(db, db.get(StoreItem, po_item.store_item_id), item_payload, payload.store_location_id)
        twice = serials_seen.setdefault(po_item.store_item_id, set()) & set(serials)
        if twice:
            raise HTTPException(status_code=422, detail=f"Serial number {', '.join(sorted(twice))} of '{po_item.item_name}' is on two lines of this GRN — each unit has its own serial.")
        serials_seen[po_item.store_item_id] |= set(serials)
        line_serials.append(serials)
        prior = already_received.get(po_item.id, 0) + in_this_grn.get(po_item.id, 0)
        in_this_grn[po_item.id] = in_this_grn.get(po_item.id, 0) + item_payload.received_quantity
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
        **grn_docs,
    )
    db.add(grn)
    db.flush()

    new_lines = []
    for item_payload in payload.items:
        po_item = po_items_by_id[item_payload.po_item_id]
        new_lines.append((item_payload, P2PGoodsReceiptItem(
            goods_receipt_id=grn.id,
            po_item_id=po_item.id,
            store_item_id=po_item.store_item_id,
            item_name=po_item.item_name,
            unit=po_item.unit,
            ordered_quantity=po_item.quantity,
            received_quantity=item_payload.received_quantity,
            invoice_quantity=item_payload.invoice_quantity,
            bin_id=item_payload.bin_id,
            serial_numbers=line_serials[len(new_lines)] or None,
            quality_status="pending",
        )))
        db.add(new_lines[-1][1])
    db.flush()
    # Batch-tracked items: one batch per vendor heat, with its mill TC number.
    for item_payload, line in new_lines:
        if item_payload.batches:
            create_grn_batches(db, grn=grn, line=line, item=db.get(StoreItem, line.store_item_id), vendor_id=po.vendor_id,
                               vendor_name=po.vendor_name, batches=item_payload.batches, user_id=user.id)
        # Serialised items (IQ01): one serial record per unit, in Quality stock.
        if line.serial_numbers:
            from app.modules.store.services.serials import receive_on_grn
            receive_on_grn(db, grn=grn, line=line, item=db.get(StoreItem, line.store_item_id), serials=line.serial_numbers,
                           vendor_name=po.vendor_name, user_id=user.id, warranty_until=item_payload.vendor_warranty_until)

    # Items flagged "inspection on receipt" in the Item Master go to QUALITY
    # stock now and get an incoming inspection lot; Quality's usage decision
    # later writes the accepted/rejected split back onto the line
    # (apply_quality_decision below) — the lot is the single source of truth.
    for line in db.query(P2PGoodsReceiptItem).filter(P2PGoodsReceiptItem.goods_receipt_id == grn.id).all():
        store_item = db.get(StoreItem, line.store_item_id)
        if po_items_by_id[line.po_item_id].category == "asset":
            # Asset (item category A): received and inspected on the GRN, but
            # capitalised by Finance — never store stock quantity or value.
            line.receipt_posting = "none"
            continue
        if needs_inspection_on_receipt(db, store_item, "incoming"):
            line.receipt_posting = "lot"
            try:
                # Batch-tracked: one lot per heat, so each heat's TC and result stay with it.
                heats = line_batches(db, line.id) or [None]
                lots = [create_lot_for_grn_line(db, grn, line, store_item, po.vendor_name, user.id,
                                                unit_cost=_po_rate(po_items_by_id[line.po_item_id]),
                                                quantity=b.received_qty if b else None, batch_number=b.batch_number if b else None,
                                                tc_reference=b.tc_number if b else None) for b in heats]
            except LotError as e:
                raise HTTPException(status_code=e.status, detail=str(e))
            line.quality_status = "in_quality"
            line.remarks = ("Incoming inspection lot " if len(lots) == 1 else "Incoming inspection lots ") + ", ".join(l.lot_number for l in lots)
        else:
            # SAP 101: into Quality stock now, so the goods show in Store at
            # once; the GRN inspection releases / blocks them (grn_posting.py).
            try:
                receive_into_quality(db, grn, line, user.id)
            except ValueError as e:
                db.rollback()
                raise HTTPException(status_code=409, detail=f"'{line.item_name}' can't be received into stock, so the GRN was not saved: {e}")

    if po.p2p_request_id:
        _write_audit(db, po.p2p_request_id, "grn_recorded", user,
                     summary=f"{user.name or user.email} recorded goods receipt '{grn.grn_number}' against PO '{po.po_number}'.")
        # Short receipt: tell Purchase what the vendor still owes on this PO,
        # so they can follow up — the PO stays open for the balance.
        db.flush()
        received_now = _received_by_po_item(db, po.id)
        short_lines = [
            f"{i.item_name}: {_fmt_qty(i.quantity - received_now.get(i.id, 0))} {i.unit or ''}".strip()
            for i in po.items if i.category != "service" and i.quantity - received_now.get(i.id, 0) > 1e-9
        ]
        if short_lines:
            _write_audit(db, po.p2p_request_id, "grn_short_receipt", user,
                         summary=f"GRN '{grn.grn_number}' received less than ordered on PO '{po.po_number}'. Pending from {po.vendor_name or 'vendor'}: " + "; ".join(short_lines) + ".")
        if po.created_by_id:
            pending_note = (f" Received less than ordered — still pending from {po.vendor_name or 'the vendor'}: " + "; ".join(short_lines) + ".") if short_lines else ""
            notify_user(
                db, user_id=po.created_by_id,
                title="Goods Receipt Recorded — Short Supply" if short_lines else "Goods Receipt Recorded",
                message=f"Goods receipt '{grn.grn_number}' was recorded against PO '{po.po_number}' — pending quality inspection.{pending_note}",
                notification_type="p2p_grn_recorded", entity_type="p2p_goods_receipt", entity_id=grn.id,
            )

    # Store role event: lines waiting for the GRN inspection decision.
    waiting = [i.item_name for i in grn.items if i.quality_status == "pending"]
    if waiting:
        from app.core.notification_events import notify_event
        from app.modules.store.services.store_events import location_opener
        notify_event(
            db, None, "store", "grn_awaiting_inspection",
            title=f"GRN {grn.grn_number} waiting for inspection",
            message=f"{user.name or user.email} received goods on GRN {grn.grn_number} (PO {po.po_number}, {po.vendor_name or 'vendor'}): "
                    f"{', '.join(waiting[:5])}{' …' if len(waiting) > 5 else ''}. They sit in Quality stock until the inspection is "
                    "completed in Store › GRN & Inspection.",
            entity_type="p2p_goods_receipt", entity_id=grn.id, actor=user,
            can_open=location_opener(db, grn.store_location_id), skip_user_ids={po.created_by_id} - {None},
        )

    db.commit()
    db.refresh(grn)
    return _to_response(db, grn)


@router.post("/{grn_id}/inspect", response_model=P2PGoodsReceiptResponse)
async def inspect_goods_receipt(
    grn_id: int,
    payload: P2PGoodsReceiptInspectPayload,
    db: Session = Depends(get_db),
    # Recording the accept/reject inspection is the GRN's approval step —
    # no named approver: Store › GRN & Inspection › Quality inspection
    # decision › Approve decides it (inherits the tab's Approve).
    user: User = Depends(_grn_tab("view")),
):
    """Records the quality-inspection result per line (accepted/rejected
    split) and completes the GRN once every item has been inspected — which
    then rolls up into the PO's fulfilment status and the PR's receipt
    status (see _sync_po_and_pr_status).

    Who may inspect is decided by the Permission Matrix alone ('Approve' on
    Store › GRN & Inspection) — a store keeper given that action completes a
    non-QC receipt himself; items needing a Quality lot are decided in Quality."""
    ensure_feature_action(user, "store", "grn", "inspection", "approve")
    # Locked so a double-submitted inspection can't see 'draft' twice and
    # post the same receipt to stock twice.
    grn = _get_grn_or_404(db, grn_id, for_update=True, user=user)
    # Store keepers inspect only their own plant's receipts (same rule as
    # opening or creating a GRN) — inspecting posts the stock.
    scope = _grn_store_scope(db, user)
    if scope is not None:
        ensure_location_allowed(db, user, grn.store_location_id, allowed=scope)
    if grn.status == "completed":
        raise HTTPException(status_code=409, detail="This goods receipt has already been completed")
    if grn.status == "reversed":
        raise HTTPException(status_code=409, detail=f"GRN {grn.grn_number} was reversed, so it can't be inspected.")
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item inspection result is required")

    items_by_id = {i.id: i for i in grn.items}
    inspected_now = []
    for entry in payload.items:
        item = items_by_id.get(entry.item_id)
        if not item:
            raise HTTPException(status_code=422, detail=f"Item {entry.item_id} does not belong to this goods receipt")
        if item.quality_status == "in_quality":
            raise HTTPException(status_code=409, detail=f"'{item.item_name}' is under Quality inspection ({item.remarks or 'inspection lot'}) — its accepted/rejected split comes from the lot's usage decision in Quality → Inspection Lots, not from the GRN.")
        if item.quality_status in _DECIDED_LINE_STATUSES:
            raise HTTPException(status_code=409, detail=f"'{item.item_name}' was already inspected on this GRN — it can't be inspected twice.")
        if entry.quality_status not in _DECIDED_LINE_STATUSES:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid quality_status '{entry.quality_status}' — must be one of {_DECIDED_LINE_STATUSES}",
            )
        if entry.accepted_quantity < 0 or entry.rejected_quantity < 0:
            raise HTTPException(status_code=422, detail=f"Accepted/rejected quantity for '{item.item_name}' cannot be negative")
        # Every received unit must end up accepted or rejected — otherwise the
        # gap disappears from both stock and the vendor's pending balance.
        if abs(entry.accepted_quantity + entry.rejected_quantity - item.received_quantity) > 1e-9:
            raise HTTPException(
                status_code=422,
                detail=f"Accepted ({entry.accepted_quantity:g}) + rejected ({entry.rejected_quantity:g}) for '{item.item_name}' must equal the {item.received_quantity:g} received — adjust the split.",
            )
        if entry.quality_status == "passed" and entry.rejected_quantity > 1e-9:
            raise HTTPException(status_code=422, detail=f"'{item.item_name}' is marked Passed but has {entry.rejected_quantity:g} rejected — choose Partial, or set rejected to 0.")
        if entry.quality_status == "failed" and entry.accepted_quantity > 1e-9:
            raise HTTPException(status_code=422, detail=f"'{item.item_name}' is marked Failed but has {entry.accepted_quantity:g} accepted — choose Partial, or set accepted to 0.")
        if entry.quality_status == "partial" and (entry.accepted_quantity <= 1e-9 or entry.rejected_quantity <= 1e-9):
            raise HTTPException(status_code=422, detail=f"'{item.item_name}' is marked Partial — it needs both an accepted and a rejected quantity. Otherwise choose Passed or Failed.")
        item.accepted_quantity = entry.accepted_quantity
        item.rejected_quantity = entry.rejected_quantity
        item.quality_status = entry.quality_status
        item.rejection_reason = entry.rejection_reason
        item.remarks = entry.remarks
        try:
            apply_line_inspection(db, item, entry.batches)
        except HTTPException:
            db.rollback()  # nothing of this inspection is kept
            raise
        if item.serial_numbers:
            from app.modules.store.services.serials import SerialError, inspect_grn_line
            try:
                inspect_grn_line(db, grn=grn, line=item, item=db.get(StoreItem, item.store_item_id),
                                 rejected_serials=entry.rejected_serials, user_id=user.id)
            except SerialError as e:
                db.rollback()
                raise HTTPException(status_code=422, detail=str(e))
        inspected_now.append(item)

    pending = [i.item_name for i in grn.items if i.quality_status == "pending"]
    if pending:
        raise HTTPException(status_code=422, detail="Every line item must be inspected before the goods receipt can be completed — still pending: " + ", ".join(pending))

    in_quality = [i for i in grn.items if i.quality_status == "in_quality"]
    if in_quality:
        # Lines with a Quality lot complete the GRN later, when their lot
        # gets its usage decision. Post the store-inspected lines now.
        stock_sync_notes = _post_grn_stock_or_409(db, grn, user.id, inspected_now)
        db.commit()
        db.refresh(grn)
        resp = _to_response(db, grn)
        resp.stock_sync_notes = stock_sync_notes + [
            f"'{i.item_name}' is in Quality stock under {i.remarks or 'an inspection lot'} — the GRN completes once Quality decides it."
            for i in in_quality]
        return resp

    grn.status = "completed"
    grn.inspected_by_id = user.id
    grn.inspected_at = datetime.now(timezone.utc)
    # SessionLocal runs with autoflush=False, and _sync_po_and_pr_status
    # re-queries completed GRNs from the DB — without this flush the GRN
    # completed just above is invisible to that rollup, so the PO/PR status
    # would always lag one GRN behind and the PR could never reach
    # 'received' (blocking /close).
    db.flush()

    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == grn.purchase_order_id).first()
    _sync_po_and_pr_status(db, po, user.id)
    stock_sync_notes = _post_grn_stock_or_409(db, grn, user.id, inspected_now)

    if po.p2p_request_id:
        _write_audit(db, po.p2p_request_id, "grn_inspected", user,
                     summary=f"{user.name or user.email} completed quality inspection for goods receipt '{grn.grn_number}'.")

    # Store role event: inspection done (accepted → Free stock, rejected → Blocked).
    from app.core.notification_events import notify_event
    from app.modules.store.services.store_events import location_opener
    rejected = [i for i in grn.items if (i.rejected_quantity or 0) > 0]
    notify_event(
        db, None, "store", "grn_inspected",
        title=f"GRN {grn.grn_number} inspected" + (f" — {len(rejected)} line(s) rejected" if rejected else " — all accepted"),
        message=f"{user.name or user.email} completed the inspection of GRN {grn.grn_number} (PO {po.po_number if po else ''}). "
                + ("Rejected: " + "; ".join(f"{i.rejected_quantity:g} {i.unit or ''} {i.item_name}".replace("  ", " ") for i in rejected[:5])
                   + " — in Blocked stock until it goes back to the vendor (Return to Vendor)." if rejected
                   else "Everything accepted is now in Free stock."),
        entity_type="p2p_goods_receipt", entity_id=grn.id, actor=user,
        can_open=location_opener(db, grn.store_location_id),
    )

    db.commit()
    db.refresh(grn)
    resp = _to_response(db, grn)
    resp.stock_sync_notes = stock_sync_notes
    return resp


def apply_quality_decision(db: Session, *, grn_item_id: int, accepted: float, rejected: float, user_id: int, reason: str) -> None:
    """Hook called by Quality (services/lots.decide) when an incoming
    inspection lot raised from this GRN line gets its usage decision: writes
    the accepted/rejected split onto the line (stock was already moved
    QUALITY->FREE/BLOCKED by the lot) and completes the GRN — rolling up the
    PO / PR receipt status — once no line is waiting any more. Flushes only;
    the caller commits."""
    line = db.query(P2PGoodsReceiptItem).filter(P2PGoodsReceiptItem.id == grn_item_id).first()
    if not line:
        return
    # A batch-tracked line has one lot per heat: the line is decided once
    # every lot is, with the lots' accepted / rejected added up.
    from app.modules.quality.models.inspection_lot import QualityInspectionLot
    lots = db.query(QualityInspectionLot).filter(QualityInspectionLot.grn_item_id == grn_item_id,
                                                 QualityInspectionLot.status != "cancelled").all()
    if len(lots) > 1:
        if any(lt.decision is None for lt in lots):
            return
        accepted = sum(lt.accepted_qty or 0 for lt in lots)
        rejected = sum(lt.rejected_qty or 0 for lt in lots)
        heats = {b.batch_number: b for b in line_batches(db, grn_item_id)}
        for lt in lots:
            if lt.batch_number in heats:
                heats[lt.batch_number].accepted_qty = lt.accepted_qty or 0
    line.accepted_quantity = accepted
    line.rejected_quantity = rejected
    line.quality_status = "passed" if rejected <= 1e-9 else "failed" if accepted <= 1e-9 else "partial"
    line.rejection_reason = reason if rejected > 1e-9 else None
    line.remarks = reason
    if line.serial_numbers:
        from app.modules.store.services.serials import lot_decided
        lot_decided(db, line=line, accepted=accepted, rejected=rejected, user_id=user_id, reason=reason)
    db.flush()
    grn = _get_grn_or_404(db, line.goods_receipt_id)
    if grn.status == "completed" or any(i.quality_status in ("pending", "in_quality") for i in grn.items):
        return
    grn.status = "completed"
    grn.inspected_by_id = user_id
    grn.inspected_at = datetime.now(timezone.utc)
    db.flush()
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == grn.purchase_order_id).first()
    _sync_po_and_pr_status(db, po, user_id)
    if po.p2p_request_id:
        db.add(AuditLog(entity_type="p2p_request", entity_id=po.p2p_request_id, action="grn_inspected", performed_by_id=user_id,
                        summary=f"Goods receipt '{grn.grn_number}' completed by Quality inspection lot decisions."))


@router.post("/{grn_id}/reverse", response_model=P2PGoodsReceiptResponse)
async def reverse_goods_receipt(
    grn_id: int,
    payload: P2PGoodsReceiptReversePayload,
    db: Session = Depends(get_db),
    user: User = Depends(_grn_tab("view")),
):
    """Cancels a wrongly entered GRN as a whole (SAP movement 102): the
    accepted stock is taken back out at the same PO rate it came in at, and
    the GRN stops counting as received on the PO / PR. Allowed only while the
    receipt is untouched downstream — not invoiced, nothing returned, not in a
    Quality lot. Goods that were genuinely received but must go back use
    Return to Vendor instead."""
    ensure_feature_action(user, "store", "grn", "reverse", "approve")
    from app.modules.accounts.models.vendor_invoice import VendorInvoice
    from app.modules.quality.models.inspection_lot import QualityInspectionLot

    if "purchase" not in user.get_apps():
        raise HTTPException(status_code=403, detail="Only the Purchase team can reverse a GRN — ask them, or ask an admin to give you the Purchase module.")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say why this GRN is being reversed (e.g. 'entered against the wrong PO') — it is kept on the GRN and the PO history.")
    grn = _get_grn_or_404(db, grn_id, for_update=True, user=user)
    if grn.status == "reversed":
        raise HTTPException(status_code=409, detail=f"GRN {grn.grn_number} is already reversed.")
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == grn.purchase_order_id).first()

    line_ids = [i.id for i in grn.items]
    lot_numbers = [n for (n,) in db.query(QualityInspectionLot.lot_number).filter(QualityInspectionLot.grn_item_id.in_(line_ids or [-1])).all()]
    if lot_numbers:
        raise HTTPException(status_code=409, detail=f"GRN {grn.grn_number} went through Quality inspection ({', '.join(lot_numbers)}), so it can't be reversed. "
                                                    "Rejected material is sent back through its NCR; accepted material through Return to Vendor.")
    returned = [i.item_name for i in grn.items if (i.returned_quantity or 0) > 0 or (i.rejected_returned_quantity or 0) > 0]
    if returned:
        raise HTTPException(status_code=409, detail=f"Goods from GRN {grn.grn_number} were already returned to the vendor ({', '.join(returned)}), so it can't be reversed as a whole.")

    # Not if the vendor's invoice already covers these goods: invoiced quantity
    # on the PO must still be covered by what stays received after reversal.
    invoiced_qty = sum(q or 0 for (q,) in db.query(VendorInvoice.qty_invoice).filter(
        VendorInvoice.purchase_order_id == po.id, VendorInvoice.status != "cancelled").all())
    if invoiced_qty > 0 and grn.status == "completed":
        others = db.query(P2PGoodsReceipt).filter(P2PGoodsReceipt.purchase_order_id == po.id, P2PGoodsReceipt.status == "completed",
                                                  P2PGoodsReceipt.id != grn.id).options(selectinload(P2PGoodsReceipt.items)).all()
        remaining = sum(net_accepted(it) for g in others for it in g.items)
        if invoiced_qty > remaining + 1e-9:
            raise HTTPException(status_code=409, detail=(
                f"The vendor's invoice on PO {po.po_number} already covers these goods ({invoiced_qty:g} invoiced; only {remaining:g} would stay received). "
                "Reversing would leave goods paid for but not received. Use Return to Vendor instead — it raises the debit note for Finance."))

    # Take the accepted stock back out, at the PO rate it was received at.
    if grn.store_location_id:
        posted = [i for i in grn.items if i.quality_status in _DECIDED_LINE_STATUSES and (i.accepted_quantity or 0) > 0 and i.store_item_id
                  and i.receipt_posting != "none"]
        for it in sorted(posted, key=lambda l: ledger_sort_key(l.store_item_id, grn.store_location_id)):
            rate = _po_rate(it.po_item)
            try:
                for batch_no, part in grn_line_splits(db, it, it.accepted_quantity):
                    from app.modules.store.services.bins import bin_if_covered
                    post_stock_transaction(
                        db, item_id=it.store_item_id, location_id=grn.store_location_id, transaction_type="return_out",
                        bin_id=bin_if_covered(db, it.store_item_id, grn.store_location_id, it.bin_id, part),
                        quantity=part, batch_number=batch_no, reference_type="grn_reversal", reference_number=grn.grn_number,
                        transaction_date=date.today(), remarks=f"GRN {grn.grn_number} reversed — {reason}",
                        created_by_id=user.id, vendor_name=po.vendor_name, unit_cost=rate, cost_source="po_rate" if rate else None,
                    )
            except ValueError as e:
                db.rollback()
                raise HTTPException(status_code=409, detail=(
                    f"Can't take '{it.item_name}' ({it.accepted_quantity:g} {it.unit or ''}) back out of stock: {e} "
                    "Some of it has probably been issued already — get it returned to store first, or use Return to Vendor for what is left."))
        # Lines received into Quality stock: what is still in Quality (not
        # inspected) or Blocked (rejected, not yet returned) comes out too.
        for it in sorted((i for i in grn.items if i.receipt_posting == "quality" and i.store_item_id),
                         key=lambda l: ledger_sort_key(l.store_item_id, grn.store_location_id)):
            try:
                reverse_quality_line(db, grn, it, user.id, date.today(), reason)
            except ValueError as e:
                db.rollback()
                raise HTTPException(status_code=409, detail=f"Can't take '{it.item_name}' back out of Quality / Blocked stock: {e}")

    # Serialised units still in the store are cancelled with the GRN; an
    # issued unit blocks the reversal (it would leave the machine untraced).
    from app.modules.store.services.serials import line_units, reverse_grn_line
    gone = [u.serial_no for it in grn.items if it.serial_numbers for u in line_units(db, it.id, ("issued", "in_transit"))]
    if gone:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Serial number(s) {', '.join(gone)} from GRN {grn.grn_number} are already issued / in transit — "
                                                    "get them returned to store first, or use Return to Vendor for what is left.")
    for it in grn.items:
        if it.serial_numbers:
            reverse_grn_line(db, grn=grn, line=it, user_id=user.id, reason=reason)
    grn.status = "reversed"
    grn.reversed_by_id = user.id
    grn.reversed_at = datetime.now(timezone.utc)
    grn.reversal_reason = reason
    db.flush()
    _sync_po_and_pr_status(db, po, user.id)
    if po.p2p_request_id:
        _write_audit(db, po.p2p_request_id, "grn_reversed", user,
                     summary=f"{user.name or user.email} reversed goods receipt '{grn.grn_number}' against PO '{po.po_number}'. Reason: {reason}")
    db.commit()
    db.refresh(grn)
    return _to_response(db, grn)
