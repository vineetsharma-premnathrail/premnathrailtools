"""Stock transfers between stores — transfer order → approval → dispatch →
receipt (two-step, like SAP's 303/305 movement).

  create    raises the transfer (pending_approval); nothing moves yet, the
            source availability is checked so an impossible transfer is
            refused up front
  approve   central approval engine, workflow "store.stock_transfer"
            (default: the sending store's manager; four-eyes)
  dispatch  the sending store posts transfer_out per line and records the
            vehicle / transporter — the Stock Transfer Note goes with the
            material; stock is now in transit (on neither store's balance)
  receive   the receiving store confirms the full quantity arrived and
            transfer_in is posted at the value it left with. A shortage /
            damage is received in full and corrected with a Stock Adjustment
            at the receiving store (that has its own approval) — stock is
            never written off silently here.
  cancel    the raiser withdraws it before dispatch

The Stock Transfer Note is a managed Word document (Save & Edit in Word;
PDF secondary) available from approval on.
"""
from datetime import date, datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permission_registry import can_feature, can_perform
from app.core.permissions import require_feature_action, require_tab_access, require_tab_action
from app.modules.store.services.stock_values import sees_stock_values
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.models.branch import Branch
from app.modules.organization.services import approval_engine as engine
from app.modules.store.services.approvals import TRANSFER_ENTITY, TRANSFER_KEY, transfer_default_stages
from app.modules.store.services.plant_access import ensure_location_allowed
from app.modules.store.services.stock_ledger import get_locked_balance, post_stock_transaction
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transfer import StoreStockTransfer, StoreStockTransferItem
from app.modules.store.schemas.stock_transfer import (
    StoreStockTransferCreate, StoreStockTransferDispatch, StoreStockTransferReceive, StoreStockTransferResponse,
)
from app.modules.store.service import generate_stock_transfer_number
from app.utils.notifications import notify_user
from app.core.notification_events import notify_event
from app.modules.store.services.store_events import location_opener, pending_approvers
try:  # managed Word documents framework (main/services/managed_documents.py)
    from app.modules.main.services import managed_documents
except ImportError:  # pragma: no cover — deployed without it: PDF only
    managed_documents = None

router = APIRouter(prefix="/store/stock-transfers", tags=["Store"])

STATUS_LABELS = {
    "pending_approval": "Pending approval", "approved": "Approved — to dispatch", "in_transit": "In transit",
    "received": "Received", "rejected": "Rejected", "cancelled": "Cancelled",
}
NOTE_ENTITY = "store_stock_transfer_note"


def _load(db: Session, transfer_id: int, lock: bool = False) -> StoreStockTransfer:
    q = db.query(StoreStockTransfer).options(selectinload(StoreStockTransfer.items)).filter(StoreStockTransfer.id == transfer_id)
    transfer = (q.with_for_update() if lock else q).first()
    if not transfer:
        raise HTTPException(status_code=404, detail=f"Stock transfer #{transfer_id} not found — it may have been removed. Go back to Store › Transfers and reload.")
    return transfer


def _user_name(users: dict, uid: int | None) -> str | None:
    u = users.get(uid) if uid else None
    return (u.name or u.email) if u else None


def _to_response(db: Session, transfer: StoreStockTransfer, user: User | None = None) -> StoreStockTransferResponse:
    locs = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_([transfer.from_location_id, transfer.to_location_id])).all()}
    uids = {transfer.transferred_by_id, transfer.approved_by_id, transfer.dispatched_by_id, transfer.received_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([it.item_id for it in transfer.items])).all()} if transfer.items else {}

    resp = StoreStockTransferResponse.model_validate(transfer)
    resp.from_location_name = locs[transfer.from_location_id].name if transfer.from_location_id in locs else None
    resp.to_location_name = locs[transfer.to_location_id].name if transfer.to_location_id in locs else None
    resp.transferred_by_name = _user_name(users, transfer.transferred_by_id)
    resp.approved_by_name = _user_name(users, transfer.approved_by_id)
    resp.dispatched_by_name = _user_name(users, transfer.dispatched_by_id)
    resp.received_by_name = _user_name(users, transfer.received_by_id)
    resp.status_label = STATUS_LABELS.get(transfer.status, transfer.status)
    from app.modules.store.models.bin import StoreBin
    bin_ids = {l.from_bin_id for l in transfer.items} | {l.to_bin_id for l in transfer.items} - {None}
    bin_codes = {b.id: b.code for b in db.query(StoreBin).filter(StoreBin.id.in_(bin_ids - {None})).all()} if bin_ids - {None} else {}
    for line, item_resp in zip(transfer.items, resp.items):
        item = items_by_id.get(line.item_id)
        item_resp.from_bin_code = bin_codes.get(line.from_bin_id)
        item_resp.to_bin_code = bin_codes.get(line.to_bin_id)
        item_resp.item_code = item.item_code if item else None
        item_resp.item_name = item.item_name if item else None
        item_resp.uom = item.uom if item else None
    if user is not None:
        resp.can_dispatch = transfer.status == "approved" and can_feature(user, "store", "transfers", "dispatch", "edit")
        resp.can_receive = transfer.status == "in_transit" and can_feature(user, "store", "transfers", "receive", "edit")
        if not sees_stock_values(user):
            # Store › Items › Stock value & rates (sensitive): the dispatch
            # value is the stock valuation. The GST tax-invoice rate / values
            # stay — the sender enters the transfer rate.
            for item_resp in resp.items:
                item_resp.dispatch_value = None
        resp.can_cancel = transfer.status in ("pending_approval", "approved") and (
            transfer.transferred_by_id == user.id or can_perform(user, "store", "transfers", "delete"))
    return resp


def _check_availability(db: Session, transfer_from: int, totals: dict[int, float]) -> None:
    """Refuse an item the source store can't cover right now (free stock less
    reservations), with the real numbers — dispatch re-checks it."""
    for item_id, qty in sorted(totals.items()):
        bal = get_locked_balance(db, item_id, transfer_from)
        available = (bal.on_hand_qty or 0) - (bal.reserved_qty or 0)
        if qty - available > 1e-9:
            item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
            loc = db.query(StoreLocation.name).filter(StoreLocation.id == transfer_from).scalar()
            raise HTTPException(status_code=409, detail=(
                f"Only {available:g} {item.uom or ''} of '{item.item_name}' is available in {loc} "
                f"({bal.on_hand_qty or 0:g} on hand, {bal.reserved_qty or 0:g} reserved), {qty:g} requested. "
                "Lower the quantity, or free reserved stock in Store › Reservations first."))


# ── Central approval engine ─────────────────────────────────────────────────

def _transfer_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    transfer = db.query(StoreStockTransfer).filter(StoreStockTransfer.id == req.entity_id).first()
    if transfer is None or transfer.status != "pending_approval":
        return
    now = datetime.now(timezone.utc)
    if outcome == "approved":
        transfer.status, transfer.approved_by_id, transfer.decided_at = "approved", actor.id, now
        if transfer.transferred_by_id:
            notify_user(
                db, user_id=transfer.transferred_by_id, title="Stock Transfer Approved",
                message=f"Stock transfer {transfer.transfer_number} was approved by {actor.name or actor.email} — "
                        "dispatch it from the sending store and print the Stock Transfer Note.",
                notification_type="stock_transfer_approved", entity_type="stock_transfer", entity_id=transfer.id,
            )
    elif outcome in ("rejected", "returned"):
        decided = [s for s in req.steps if s.decided_at and s.comment]
        comment = decided[-1].comment if decided else None
        prefix = "Returned for changes" if outcome == "returned" else None
        transfer.status, transfer.approved_by_id, transfer.decided_at = "rejected", actor.id, now
        transfer.rejected_reason = ": ".join(x for x in (prefix, comment) if x) or None
        _release_serials(db, transfer)
    elif outcome == "cancelled":
        transfer.status, transfer.decided_at = "cancelled", now
        _release_serials(db, transfer)


def _release_serials(db: Session, transfer: StoreStockTransfer) -> None:
    """A transfer that won't move frees the serial numbers booked on it."""
    from app.modules.store.services.serials import release_transfer
    for line in transfer.items:
        if line.serial_numbers:
            release_transfer(db, line)


engine.register_transaction(engine.TransactionType(
    key=TRANSFER_KEY, module_key="store", subtab_key="transfers", label="Stock transfer",
    entity_type=TRANSFER_ENTITY, url="/dashboard/store/transfers/{id}",
    description="Moving stock from one store to another. Nothing moves until it is approved and dispatched.",
    context_fields={
        "from_manager_id": {"label": "Manager of the sending store", "type": "user"},
        "to_manager_id": {"label": "Manager of the receiving store", "type": "user"},
        "inter_plant": {"label": "Between two plants", "type": "bool"},
    },
    default_stages=transfer_default_stages(),
    require_permission=True, allow_self_approval=False,
    on_decided=_transfer_decided,
))


# ── Read ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[StoreStockTransferResponse])
async def list_stock_transfers(
    from_location_id: int | None = Query(None),
    to_location_id: int | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "transfers")),
):
    # Data scope: a plant-scoped user sees transfers sent from OR received
    # into their plants (see store/access.py).
    query = apply_scope(db.query(StoreStockTransfer).options(selectinload(StoreStockTransfer.items)), user, StoreStockTransfer)
    if from_location_id is not None:
        query = query.filter(StoreStockTransfer.from_location_id == from_location_id)
    if to_location_id is not None:
        query = query.filter(StoreStockTransfer.to_location_id == to_location_id)
    if status:
        query = query.filter(StoreStockTransfer.status == status)
    transfers = query.order_by(StoreStockTransfer.created_at.desc()).all()
    return [_to_response(db, t, user) for t in transfers]


@router.get("/{transfer_id}", response_model=StoreStockTransferResponse)
async def get_stock_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "transfers")),
):
    transfer = _load(db, transfer_id)
    if not engine.can_act_on_entity(db, user, TRANSFER_ENTITY, transfer.id):
        ensure_in_scope(db, user, transfer)
    return _to_response(db, transfer, user)


# ── Create ──────────────────────────────────────────────────────────────────

@router.post("", response_model=StoreStockTransferResponse)
async def create_stock_transfer(
    payload: StoreStockTransferCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "transfers", "create")),
):
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")
    if payload.transfer_date and payload.transfer_date > date.today():
        raise HTTPException(status_code=422, detail=f"Transfer date {payload.transfer_date.isoformat()} is in the future — raise the transfer on the day it is needed (today or earlier).")
    if payload.from_location_id == payload.to_location_id:
        raise HTTPException(status_code=422, detail="Source and destination store must be different")
    from_loc = db.query(StoreLocation).filter(StoreLocation.id == payload.from_location_id).first()
    if not from_loc:
        raise HTTPException(status_code=404, detail="Source store not found")
    # Only the sending side needs plant access — the destination may be
    # another plant's store (inter-unit transfer).
    ensure_location_allowed(db, user, payload.from_location_id)
    to_loc = db.query(StoreLocation).filter(StoreLocation.id == payload.to_location_id).first()
    if not to_loc:
        raise HTTPException(status_code=404, detail="Destination store not found")
    if to_loc.is_active is False:
        raise HTTPException(status_code=422, detail=f"Store '{to_loc.name}' is inactive, so it can't receive stock — reactivate it under Store → Settings → Stores, or pick another store.")

    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([p.item_id for p in payload.items])).all()}
    seen: set[tuple[int, str]] = set()
    for p in payload.items:
        if p.item_id not in items_by_id:
            raise HTTPException(status_code=422, detail=f"Item {p.item_id} not found")
        if p.quantity <= 0:
            raise HTTPException(status_code=422, detail=f"Quantity for '{items_by_id[p.item_id].item_name}' must be greater than zero")
        key = (p.item_id, (p.batch_number or "").strip())
        if key in seen:
            raise HTTPException(status_code=422, detail=f"'{items_by_id[p.item_id].item_name}' is listed twice{' for batch ' + key[1] if key[1] else ''} — put the total quantity on one line.")
        seen.add(key)
    # Total per item (several batches of one item) against what's available.
    totals: dict[int, float] = {}
    for p in payload.items:
        totals[p.item_id] = totals.get(p.item_id, 0) + p.quantity
    _check_availability(db, payload.from_location_id, totals)
    # WM bin + serial numbers (IQ01) at the sending store.
    from app.modules.store.services.bins import BinError, ensure_pick_possible, validate_bin
    from app.modules.store.services import serials as serial_svc
    picked_units: list[list] = []
    taken_ids: set[int] = set()
    try:
        for p in payload.items:
            it = items_by_id[p.item_id]
            validate_bin(db, p.from_bin_id, payload.from_location_id, what=f"'{it.item_name}'")
            ensure_pick_possible(db, item=it, location_id=payload.from_location_id, qty=p.quantity, bin_id=p.from_bin_id,
                                 batch_number=(p.batch_number or "").strip() or None)
            units = serial_svc.pick(db, it, payload.from_location_id, p.quantity, p.serials, bin_id=p.from_bin_id,
                                    exclude_ids=taken_ids, action="transferred")
            taken_ids |= {u.id for u in units}
            picked_units.append(units)
    except (BinError, serial_svc.SerialError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    transfer = StoreStockTransfer(
        transfer_number=generate_stock_transfer_number(db),
        from_location_id=payload.from_location_id,
        to_location_id=payload.to_location_id,
        transfer_date=payload.transfer_date or date.today(),
        reason=payload.reason,
        transferred_by_id=user.id,
        remarks=payload.remarks,
        status="pending_approval",
    )
    db.add(transfer)
    db.flush()
    for p, units in zip(payload.items, picked_units):
        line = StoreStockTransferItem(
            transfer_id=transfer.id, item_id=p.item_id, quantity=p.quantity,
            batch_number=(p.batch_number or "").strip() or None, remarks=p.remarks,
            from_bin_id=p.from_bin_id, serial_numbers=[u.serial_no for u in units] or None,
        )
        db.add(line)
        if units:
            db.flush()
            serial_svc.book_on_transfer(db, units, line.id)
    db.flush()
    try:
        req = engine.submit(
            db, TRANSFER_KEY, entity_id=transfer.id, requester=user,
            title=f"Stock transfer {transfer.transfer_number} — {from_loc.name} → {to_loc.name}",
            reference=transfer.transfer_number,
            context={"from_manager_id": from_loc.manager_user_id, "to_manager_id": to_loc.manager_user_id,
                     "inter_plant": bool(from_loc.branch_id and to_loc.branch_id and from_loc.branch_id != to_loc.branch_id)},
            branch_id=from_loc.branch_id,
        )
    except HTTPException:
        db.rollback()
        raise
    if req.status == "pending":
        notify_event(
            db, background_tasks, "store", "transfer_submitted",
            title=f"Stock transfer {transfer.transfer_number} waiting for approval",
            message=f"{user.name or user.email} raised stock transfer {transfer.transfer_number}: {from_loc.name} → {to_loc.name} "
                    f"({len(payload.items)} line(s)). It can be dispatched once approved — open it in Store › Transfers.",
            entity_type="stock_transfer", entity_id=transfer.id, actor=user,
            can_open=location_opener(db, from_loc.id), skip_user_ids=pending_approvers(req),
        )
    db.commit()
    return _to_response(db, _load(db, transfer.id), user)


@router.post("/{transfer_id}/cancel", response_model=StoreStockTransferResponse)
async def cancel_stock_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "transfers")),
):
    transfer = _load(db, transfer_id, lock=True)
    ensure_in_scope(db, user, transfer)
    if transfer.status not in ("pending_approval", "approved"):
        raise HTTPException(status_code=409, detail=f"Transfer {transfer.transfer_number} is {STATUS_LABELS.get(transfer.status, transfer.status).lower()} — only a transfer that hasn't been dispatched can be cancelled.")
    if transfer.transferred_by_id != user.id and not can_perform(user, "store", "transfers", "delete"):
        raise HTTPException(status_code=403, detail=f"Only the person who raised {transfer.transfer_number}, or someone with Store › Transfers › Delete, can cancel it.")
    engine.cancel_for_entity(db, TRANSFER_ENTITY, transfer.id, user, "Transfer cancelled")
    transfer.status, transfer.decided_at = "cancelled", datetime.now(timezone.utc)
    _release_serials(db, transfer)
    db.commit()
    return _to_response(db, _load(db, transfer.id), user)


# ── Dispatch / receive ──────────────────────────────────────────────────────

def _post_lines(db: Session, transfer: StoreStockTransfer, location_id: int, txn_type: str, user: User) -> None:
    # One global (item, line) order so balance/valuation rows lock in the same
    # sequence across concurrent transfers.
    for line in sorted(transfer.items, key=lambda l: (l.item_id, l.id)):
        txn = post_stock_transaction(
            db, item_id=line.item_id, location_id=location_id, transaction_type=txn_type,
            bin_id=line.from_bin_id if txn_type == "transfer_out" else line.to_bin_id,
            quantity=line.quantity, batch_number=line.batch_number, reference_type="stock_transfer",
            reference_number=transfer.transfer_number, transaction_date=date.today(), created_by_id=user.id,
            value=line.dispatch_value if txn_type == "transfer_in" else None,
        )
        if txn_type == "transfer_out":
            line.dispatch_value = txn.value
        if line.serial_numbers:
            from app.modules.store.services import serials as serial_svc
            if txn_type == "transfer_out":
                serial_svc.dispatch_transfer(db, line, transfer.transfer_number, user.id)
            else:
                serial_svc.receive_transfer(db, line, location_id, line.to_bin_id, transfer.transfer_number, user.id)


@router.post("/{transfer_id}/dispatch", response_model=StoreStockTransferResponse)
async def dispatch_stock_transfer(
    transfer_id: int,
    payload: StoreStockTransferDispatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("store", "transfers", "dispatch", "edit")),
):
    transfer = _load(db, transfer_id, lock=True)
    ensure_in_scope(db, user, transfer)
    if transfer.status != "approved":
        raise HTTPException(status_code=409, detail=f"Transfer {transfer.transfer_number} is {STATUS_LABELS.get(transfer.status, transfer.status).lower()} — only an approved transfer can be dispatched.")
    ensure_location_allowed(db, user, transfer.from_location_id)
    # The pick bin must still hold the quantity (it may have been issued from since).
    from app.modules.store.services.bins import BinError, ensure_pick_possible
    try:
        for line in transfer.items:
            if line.from_bin_id:
                ensure_pick_possible(db, item=db.get(StoreItem, line.item_id), location_id=transfer.from_location_id,
                                     qty=line.quantity, bin_id=line.from_bin_id, batch_number=line.batch_number)
    except BinError as e:
        raise HTTPException(status_code=409, detail=f"Transfer {transfer.transfer_number} can't be dispatched: {e}")
    # GST between plants: delivery challan or tax invoice, e-way bill when the
    # goods cross a state border (services/transfer_gst.py).
    from app.modules.store.services import transfer_gst
    try:
        gst_cls = transfer_gst.classify(db, transfer)
        eway = transfer_gst.validate_eway(payload.eway_bill_number, gst_cls["inter_state"], gst_cls)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=f"Transfer {transfer.transfer_number} can't be dispatched: {e}")
    try:
        _post_lines(db, transfer, transfer.from_location_id, "transfer_out", user)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Transfer {transfer.transfer_number} can't be dispatched: {e}")
    transfer.status = "in_transit"
    transfer.dispatched_by_id, transfer.dispatched_at = user.id, datetime.now(timezone.utc)
    transfer.vehicle_number = (payload.vehicle_number or "").strip().upper() or None
    transfer.transporter_name = (payload.transporter_name or "").strip() or None
    transfer.driver_name = (payload.driver_name or "").strip() or None
    transfer.driver_phone = (payload.driver_phone or "").strip() or None
    transfer.eway_bill_number = eway
    try:
        transfer_gst.apply_tax(db, transfer, gst_cls, {r.line_id: r.transfer_rate for r in (payload.lines or []) if r.transfer_rate is not None})
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Transfer {transfer.transfer_number} can't be dispatched: {e}")
    to_loc = db.query(StoreLocation).filter(StoreLocation.id == transfer.to_location_id).first()
    if to_loc and to_loc.manager_user_id and to_loc.manager_user_id != user.id:
        notify_user(
            db, user_id=to_loc.manager_user_id, title="Stock Transfer Dispatched to Your Store",
            message=f"Stock transfer {transfer.transfer_number} was dispatched to {to_loc.name}"
                    f"{' by vehicle ' + transfer.vehicle_number if transfer.vehicle_number else ''}. Confirm receipt when it arrives.",
            notification_type="stock_transfer_dispatched", entity_type="stock_transfer", entity_id=transfer.id,
        )
    from_loc = db.get(StoreLocation, transfer.from_location_id)
    notify_event(
        db, background_tasks, "store", "transfer_dispatched",
        title=f"Stock transfer {transfer.transfer_number} dispatched to {to_loc.name if to_loc else 'your store'}",
        message=f"Stock transfer {transfer.transfer_number} left {from_loc.name if from_loc else 'the sending store'} for "
                f"{to_loc.name if to_loc else 'your store'}{' by vehicle ' + transfer.vehicle_number if transfer.vehicle_number else ''}. "
                "Confirm receipt in Store › Transfers when it arrives (pick the bins there).",
        entity_type="stock_transfer", entity_id=transfer.id, actor=user,
        can_open=location_opener(db, transfer.to_location_id), skip_user_ids={to_loc.manager_user_id} - {None} if to_loc else None,
    )
    db.commit()
    return _to_response(db, _load(db, transfer.id), user)


@router.post("/{transfer_id}/receive", response_model=StoreStockTransferResponse)
async def receive_stock_transfer(
    transfer_id: int,
    payload: StoreStockTransferReceive,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("store", "transfers", "receive", "edit")),
):
    transfer = _load(db, transfer_id, lock=True)
    ensure_in_scope(db, user, transfer)
    if transfer.status != "in_transit":
        raise HTTPException(status_code=409, detail=f"Transfer {transfer.transfer_number} is {STATUS_LABELS.get(transfer.status, transfer.status).lower()} — only a dispatched (in transit) transfer can be received.")
    ensure_location_allowed(db, user, transfer.to_location_id)
    # WM putaway at the receiving store: the bin per line, if given.
    from app.modules.store.services.bins import BinError, validate_bin
    lines_by_id = {l.id: l for l in transfer.items}
    try:
        for b in payload.bins:
            line = lines_by_id.get(b.line_id)
            if line is None:
                raise HTTPException(status_code=422, detail=f"Line #{b.line_id} isn't on transfer {transfer.transfer_number} — reload the page.")
            validate_bin(db, b.bin_id, transfer.to_location_id, what=f"line #{b.line_id}")
            line.to_bin_id = b.bin_id
    except BinError as e:
        raise HTTPException(status_code=422, detail=str(e))
    try:
        _post_lines(db, transfer, transfer.to_location_id, "transfer_in", user)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Transfer {transfer.transfer_number} can't be received: {e}")
    transfer.status = "received"
    transfer.received_by_id, transfer.received_at = user.id, datetime.now(timezone.utc)
    transfer.receipt_remarks = (payload.remarks or "").strip() or None
    if transfer.transferred_by_id and transfer.transferred_by_id != user.id:
        notify_user(
            db, user_id=transfer.transferred_by_id, title="Stock Transfer Received",
            message=f"Stock transfer {transfer.transfer_number} was received by {user.name or user.email}.",
            notification_type="stock_transfer_received", entity_type="stock_transfer", entity_id=transfer.id,
        )
    to_loc = db.get(StoreLocation, transfer.to_location_id)
    notify_event(
        db, background_tasks, "store", "transfer_received",
        title=f"Stock transfer {transfer.transfer_number} received",
        message=f"Stock transfer {transfer.transfer_number} was received at {to_loc.name if to_loc else 'the destination store'} by "
                f"{user.name or user.email} — the stock is now on that store's balance.",
        entity_type="stock_transfer", entity_id=transfer.id, actor=user,
        can_open=location_opener(db, transfer.from_location_id, transfer.to_location_id),
        skip_user_ids={transfer.transferred_by_id} - {None},
    )
    db.commit()
    return _to_response(db, _load(db, transfer.id), user)


# ── Stock Transfer Note (managed Word document; PDF secondary) ──────────────

def _note_revision(transfer: StoreStockTransfer) -> int:
    # Dispatch adds the vehicle details, receipt the acknowledgement — each
    # makes a fresh note so the printed copy always matches the record.
    return {"in_transit": 1, "received": 2}.get(transfer.status, 0)


def _note_spec(db: Session, transfer: StoreStockTransfer) -> dict:
    if transfer.status not in ("approved", "in_transit", "received"):
        raise HTTPException(status_code=409, detail=(
            f"Transfer {transfer.transfer_number} is {STATUS_LABELS.get(transfer.status, transfer.status).lower()} — "
            "the Stock Transfer Note is generated once the transfer is approved."))
    r = _to_response(db, transfer)
    locs = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_([transfer.from_location_id, transfer.to_location_id])).all()}

    def place(lid: int) -> str:
        loc = locs.get(lid)
        if not loc:
            return "—"
        branch = db.get(Branch, loc.branch_id) if loc.branch_id else None
        bits = [loc.name + (f" ({loc.code})" if loc.code else ""), branch.name if branch else None, loc.address]
        return ", ".join(b for b in bits if b)

    def dt(v) -> str | None:
        return v.strftime("%d-%m-%Y %H:%M") if v else None

    show_value = any(i.dispatch_value is not None for i in transfer.items)
    rows = []
    for n, (line, it) in enumerate(zip(transfer.items, r.items), 1):
        row = [str(n), it.item_code or "", it.item_name or "", f"{line.quantity:g}", it.uom or "", line.batch_number or "", line.remarks or ""]
        if show_value:
            row.insert(6, f"{line.dispatch_value:,.2f}" if line.dispatch_value is not None else "—")
        rows.append(row)
    cols = ["#", "Item code", "Description", "Qty", "UoM", "Batch", "Remarks"]
    widths = [0.3, 1.1, 2.4, 0.6, 0.5, 0.9, 1.3]
    if show_value:
        cols.insert(6, "Value (₹)")
        widths = [0.3, 1.0, 2.0, 0.55, 0.45, 0.8, 0.9, 1.1]

    facts = [
        ("From store", place(transfer.from_location_id)), ("To store", place(transfer.to_location_id)),
        ("Transfer date", transfer.transfer_date.strftime("%d-%m-%Y")), ("Status", r.status_label),
        ("Reason", transfer.reason), ("Raised by", r.transferred_by_name),
        ("Approved by", f"{r.approved_by_name or '—'}, {dt(transfer.decided_at) or '—'}"),
        ("Dispatched", f"{r.dispatched_by_name}, {dt(transfer.dispatched_at)}" if transfer.dispatched_at else "Not yet"),
        ("Vehicle no.", transfer.vehicle_number), ("Transporter", transfer.transporter_name),
        ("Driver", " · ".join(x for x in (transfer.driver_name, transfer.driver_phone) if x) or None),
        ("E-way bill no.", transfer.eway_bill_number),
    ]
    if transfer.status == "received":
        facts += [("Received", f"{r.received_by_name}, {dt(transfer.received_at)}"), ("Receipt remarks", transfer.receipt_remarks)]
    spec = {
        "title": "STOCK TRANSFER NOTE", "number": transfer.transfer_number,
        "intro": "Material moved between our own stores — not a sale. This note travels with the material and is "
                 "signed by the receiving store on arrival.",
        "facts": facts,
        "sections": [{"heading": "Material", "columns": cols, "rows": rows, "widths": widths}],
        "statement": f"Total {len(rows)} line(s)." + (f" Total value ₹ {sum(i.dispatch_value or 0 for i in transfer.items):,.2f} (at cost)." if show_value else ""),
        "remarks": transfer.remarks,
        "signatures": [("Issued by (sending store)", r.dispatched_by_name), ("Approved by", r.approved_by_name),
                       ("Received by (receiving store)", r.received_by_name)],
    }
    # Between plants: titled and laid out as the GST document it is.
    from app.modules.store.services.transfer_gst import decorate_note
    return decorate_note(db, transfer, spec)


def _note_loader(db: Session, entity_id: int, user: User, modify: bool):
    transfer = _load(db, entity_id)
    ensure_in_scope(db, user, transfer)
    action = "edit" if modify else "view"
    if not can_perform(user, "store", "transfers", action):
        raise HTTPException(status_code=403, detail=f"You don't have '{action}' permission on Store › Transfers. Ask an admin to grant it in Organization › Role & Permissions.")
    spec = _note_spec(db, transfer)
    from app.modules.quality.reports.render import render_docx
    return managed_documents.DocumentTarget(
        entity_id=entity_id, revision=_note_revision(transfer), title=f"Stock Transfer Note {transfer.transfer_number}",
        folder=managed_documents.sharepoint_folder("Store", "Stock-Transfer-Note", transfer.transfer_number),
        filename_stem=managed_documents.safe_filename(f"Stock-Transfer-Note-{transfer.transfer_number}-r{_note_revision(transfer)}"),
        build_docx=lambda: render_docx(spec),
    )


if managed_documents:
    managed_documents.register(managed_documents.DocumentAdapter(entity_type=NOTE_ENTITY, app="store", load=_note_loader))


@router.get("/{transfer_id}/transfer-note.pdf")
async def transfer_note_pdf(
    transfer_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "transfers")),
):
    transfer = _load(db, transfer_id)
    ensure_in_scope(db, user, transfer)
    spec = _note_spec(db, transfer)
    from app.modules.quality.reports.render import render_pdf

    def render() -> bytes:
        try:
            return render_pdf(spec, f"Generated {datetime.now():%d-%m-%Y %H:%M} by {user.name or user.email} from the Premnath Rail portal.")
        except Exception as e:  # noqa: BLE001 — surface the real reason
            raise HTTPException(status_code=500, detail=f"Couldn't build the Stock Transfer Note PDF: {e}")

    rev = _note_revision(transfer)
    pdf = await managed_documents.pdf_of_record(db, NOTE_ENTITY, transfer.id, rev, render=render) if managed_documents else render()
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="Stock-Transfer-Note-{transfer.transfer_number}.pdf"'})
