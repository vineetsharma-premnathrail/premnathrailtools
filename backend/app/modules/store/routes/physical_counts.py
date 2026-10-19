"""Physical stock count (SAP MI01 → MI04 → MI07).

Create snapshots book stock and freezes the counted items at that store
(stock_ledger refuses movements for them) → counters enter quantities (blind
by default; recounts keep the first count) → submit sends every difference as
ONE Stock Adjustment through the existing Store Manager approval, which posts
the stock. The count closes when that adjustment is approved; a rejected /
returned adjustment reopens it for a recount (see stock_adjustments.py)."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core import assignee_rules
from app.core.permission_registry import can_perform
from app.core.notification_events import notify_event
from app.core.permissions import require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.physical_count import StorePhysicalCount, StorePhysicalCountItem
from app.modules.store.models.stock_adjustment import StoreStockAdjustment, StoreStockAdjustmentItem
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.schemas.physical_count import (
    StorePhysicalCountAddItemPayload, StorePhysicalCountCancelPayload, StorePhysicalCountCountsPayload,
    StorePhysicalCountCreate, StorePhysicalCountResponse, StorePhysicalCountSubmitPayload,
)
from app.modules.store.service import generate_physical_count_number, generate_stock_adjustment_number
from app.modules.store.services.approvals import ADJUSTMENT_KEY
from app.modules.store.services.plant_access import ensure_location_allowed, visible_location_ids

router = APIRouter(prefix="/store/physical-counts", tags=["Store"])
APPROVER_RULE_KEY = "store:adjustments.cycle_count"  # core/assignee_rules.PICKERS

_OPEN = ("counting", "submitted")


def _sees_book(user: User, count: StorePhysicalCount) -> bool:
    """Blind count: book stock is hidden from counters while counting — only
    people who approve adjustments see it before the count is submitted."""
    return not (count.blind and count.status == "counting") or can_perform(user, "store", "adjustments", "approve")


def _to_response(db: Session, count: StorePhysicalCount, user: User) -> StorePhysicalCountResponse:
    resp = StorePhysicalCountResponse.model_validate(count)
    show = _sees_book(user, count)
    resp.book_hidden = not show
    loc = db.get(StoreLocation, count.location_id)
    resp.location_name = loc.name if loc else None
    if count.bin_id:
        from app.modules.store.models.bin import StoreBin
        b = db.get(StoreBin, count.bin_id)
        resp.bin_code = b.code if b else None
    names = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(
        {count.created_by_id} | {l.counted_by_id for l in count.items} - {None})).all()}
    resp.created_by_name = names.get(count.created_by_id)
    if count.adjustment_id:
        adj = db.get(StoreStockAdjustment, count.adjustment_id)
        if adj:
            resp.adjustment_number, resp.adjustment_status = adj.adjustment_number, adj.status
    for line, out in zip(count.items, resp.items):
        out.item_code, out.item_name, out.uom = line.item.item_code, line.item.item_name, line.item.uom
        out.counted_by_name = names.get(line.counted_by_id)
        if not show:
            out.book_quantity, out.difference = None, None
    resp.lines_total = len(count.items)
    resp.lines_counted = sum(1 for l in count.items if l.counted_quantity is not None)
    resp.lines_with_difference = sum(1 for l in count.items if l.difference) if show else None
    return resp


def _get(db: Session, count_id: int, user: User, for_update: bool = False) -> StorePhysicalCount:
    q = db.query(StorePhysicalCount).options(selectinload(StorePhysicalCount.items)).filter(StorePhysicalCount.id == count_id)
    count = (q.with_for_update() if for_update else q).first()
    if not count:
        raise HTTPException(status_code=404, detail=f"Physical count #{count_id} not found.")
    ensure_location_allowed(db, user, count.location_id)
    return count


def _require_counting(count: StorePhysicalCount, action: str) -> None:
    if count.status != "counting":
        raise HTTPException(status_code=409, detail=f"Count {count.count_number} is {count.status}, so you can't {action}.")


@router.get("", response_model=list[StorePhysicalCountResponse])
async def list_counts(
    status: str | None = Query(None), location_id: int | None = Query(None),
    db: Session = Depends(get_db), user: User = Depends(require_feature_action("store", "adjustments", "cycle_count", "view")),
):
    q = db.query(StorePhysicalCount).options(selectinload(StorePhysicalCount.items))
    allowed = visible_location_ids(db, user)
    if allowed is not None:
        q = q.filter(StorePhysicalCount.location_id.in_(allowed or {-1}))
    if status:
        q = q.filter(StorePhysicalCount.status == status)
    if location_id:
        q = q.filter(StorePhysicalCount.location_id == location_id)
    return [_to_response(db, c, user) for c in q.order_by(StorePhysicalCount.id.desc()).limit(300).all()]


@router.get("/{count_id}", response_model=StorePhysicalCountResponse)
async def get_count(count_id: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("store", "adjustments", "cycle_count", "view"))):
    return _to_response(db, _get(db, count_id, user), user)


@router.post("", response_model=StorePhysicalCountResponse, status_code=201)
async def create_count(payload: StorePhysicalCountCreate, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("store", "adjustments", "cycle_count", "create"))):
    location = db.get(StoreLocation, payload.location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Store not found — pick one from the list.")
    ensure_location_allowed(db, user, payload.location_id)
    if payload.bin_id is not None:
        return _create_bin_count(db, payload, location, user)

    q = db.query(StoreStockBalance, StoreItem).join(StoreItem, StoreItem.id == StoreStockBalance.item_id).filter(
        StoreStockBalance.location_id == location.id)
    if payload.item_ids:
        q = q.filter(StoreStockBalance.item_id.in_(payload.item_ids))
        scope = f"{len(set(payload.item_ids))} chosen item(s)"
    else:
        q = q.filter(StoreStockBalance.on_hand_qty > 0)
        if payload.category:
            q = q.filter(StoreItem.category == payload.category)
            scope = f"Category: {payload.category}"
        else:
            scope = "All stocked items"
    rows = q.order_by(StoreItem.item_code).all()
    # Chosen items with no balance row yet still get counted (book 0).
    have = {b.item_id for b, _ in rows}
    extra = [i for i in db.query(StoreItem).filter(StoreItem.id.in_(set(payload.item_ids) - have)).all()] if payload.item_ids else []
    if payload.item_ids and len(have) + len(extra) < len(set(payload.item_ids)):
        raise HTTPException(status_code=422, detail="Some chosen items don't exist in the Item Master — reload the page and pick again.")
    item_ids = list(have) + [i.id for i in extra]
    if not item_ids:
        raise HTTPException(status_code=422, detail=f"Nothing to count — {location.name} has no Free stock{' in that category' if payload.category else ''}. "
                                                    "Pick items instead, or another store / category.")
    clash = db.query(StorePhysicalCount.count_number).join(StorePhysicalCountItem).filter(
        StorePhysicalCount.location_id == location.id, StorePhysicalCount.status.in_(_OPEN),
        StorePhysicalCountItem.item_id.in_(item_ids)).first()
    if clash:
        raise HTTPException(status_code=409, detail=f"Count {clash[0]} is still open at {location.name} for some of these items — "
                                                    "finish or cancel it first.")

    count = StorePhysicalCount(
        count_number=generate_physical_count_number(db), location_id=location.id, count_date=date.today(), scope=scope,
        blind=payload.blind, status="counting", remarks=(payload.remarks or "").strip() or None, created_by_id=user.id,
    )
    db.add(count)
    db.flush()
    for b, _ in rows:
        count.items.append(StorePhysicalCountItem(item_id=b.item_id, book_quantity=b.on_hand_qty or 0))
    for i in extra:
        count.items.append(StorePhysicalCountItem(item_id=i.id, book_quantity=0))
    db.commit()
    return _to_response(db, _get(db, count.id, user), user)


def _create_bin_count(db: Session, payload: StorePhysicalCountCreate, location: StoreLocation, user: User):
    """Bin-wise count (WM): the items in one bin, book stock = the bin's
    stock (services/bins.py). Differences post to that bin."""
    from app.modules.store.services.bins import BinError, bin_quantities, validate_bin
    try:
        bin_ = validate_bin(db, payload.bin_id, location.id, what="the count")
    except BinError as e:
        raise HTTPException(status_code=422, detail=str(e))
    book = {k[0]: v for k, v in bin_quantities(db, location_id=location.id, bin_id=bin_.id).items() if abs(v) > 1e-9}
    wanted = set(payload.item_ids) or set(book)
    if not wanted:
        raise HTTPException(status_code=422, detail=f"Nothing to count — bin '{bin_.code}' holds no stock in the books. "
                                                    "Pick the items found in it instead.")
    if payload.item_ids and db.query(StoreItem).filter(StoreItem.id.in_(wanted)).count() < len(wanted):
        raise HTTPException(status_code=422, detail="Some chosen items don't exist in the Item Master — reload the page and pick again.")
    clash = db.query(StorePhysicalCount.count_number).join(StorePhysicalCountItem).filter(
        StorePhysicalCount.location_id == location.id, StorePhysicalCount.status.in_(_OPEN),
        StorePhysicalCountItem.item_id.in_(wanted)).first()
    if clash:
        raise HTTPException(status_code=409, detail=f"Count {clash[0]} is still open at {location.name} for some of these items — "
                                                    "finish or cancel it first.")
    count = StorePhysicalCount(
        count_number=generate_physical_count_number(db), location_id=location.id, count_date=date.today(),
        scope=f"Bin {bin_.code}" + (f" ({len(wanted)} chosen item(s))" if payload.item_ids else ""), bin_id=bin_.id,
        blind=payload.blind, status="counting", remarks=(payload.remarks or "").strip() or None, created_by_id=user.id,
    )
    db.add(count)
    db.flush()
    for iid in sorted(wanted):
        count.items.append(StorePhysicalCountItem(item_id=iid, book_quantity=book.get(iid, 0.0)))
    db.commit()
    return _to_response(db, _get(db, count.id, user), user)


@router.put("/{count_id}/counts", response_model=StorePhysicalCountResponse)
async def enter_counts(count_id: int, payload: StorePhysicalCountCountsPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("store", "adjustments", "cycle_count", "edit"))):
    count = _get(db, count_id, user, for_update=True)
    _require_counting(count, "enter counts")
    lines = {l.id: l for l in count.items}
    for p in payload.lines:
        line = lines.get(p.line_id)
        if line is None:
            raise HTTPException(status_code=422, detail=f"Line #{p.line_id} isn't on count {count.count_number}.")
        if p.counted_quantity < 0:
            raise HTTPException(status_code=422, detail=f"'{line.item.item_name}': counted quantity can't be negative.")
        if line.counted_quantity is not None and abs(line.counted_quantity - p.counted_quantity) < 1e-9 and (p.remarks or None) == line.remarks:
            continue
        if line.first_counted_quantity is None:
            line.first_counted_quantity = p.counted_quantity
        line.counted_quantity = p.counted_quantity
        line.count_rounds = (line.count_rounds or 0) + 1
        line.counted_by_id = user.id
        line.remarks = (p.remarks or "").strip() or None
    db.commit()
    return _to_response(db, _get(db, count.id, user), user)


@router.post("/{count_id}/items", response_model=StorePhysicalCountResponse)
async def add_item(count_id: int, payload: StorePhysicalCountAddItemPayload, db: Session = Depends(get_db),
                   user: User = Depends(require_feature_action("store", "adjustments", "cycle_count", "edit"))):
    """An item found on the shelf that wasn't on the count list (book stock
    may be 0) — added so it is counted and corrected too."""
    count = _get(db, count_id, user, for_update=True)
    _require_counting(count, "add items")
    item = db.get(StoreItem, payload.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in the Item Master.")
    if any(l.item_id == item.id for l in count.items):
        raise HTTPException(status_code=409, detail=f"{item.item_code} {item.item_name} is already on this count.")
    bal = db.query(StoreStockBalance).filter(StoreStockBalance.item_id == item.id, StoreStockBalance.location_id == count.location_id).first()
    book = (bal.on_hand_qty if bal else 0) or 0
    if count.bin_id:
        from app.modules.store.services.bins import bin_qty
        book = bin_qty(db, item.id, count.location_id, count.bin_id)
    count.items.append(StorePhysicalCountItem(item_id=item.id, book_quantity=book))
    db.commit()
    return _to_response(db, _get(db, count.id, user), user)


@router.post("/{count_id}/submit", response_model=StorePhysicalCountResponse)
async def submit_count(count_id: int, payload: StorePhysicalCountSubmitPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("store", "adjustments", "cycle_count", "submit"))):
    count = _get(db, count_id, user, for_update=True)
    _require_counting(count, "submit it")
    pending = [f"{l.item.item_code} {l.item.item_name}" for l in count.items if l.counted_quantity is None]
    if pending:
        raise HTTPException(status_code=422, detail=f"{len(pending)} line(s) aren't counted yet: {', '.join(pending[:6])}"
                                                    f"{' …' if len(pending) > 6 else ''}. Enter 0 for anything not found on the shelf.")
    location = db.get(StoreLocation, count.location_id)
    now = datetime.now(timezone.utc)
    diffs = [l for l in count.items if l.difference]
    count.submitted_by_id, count.submitted_at = user.id, now
    if not diffs:
        count.status, count.closed_at = "posted", now
        db.commit()
        return _to_response(db, _get(db, count.id, user), user)

    # Differences go through the Store Manager approval as one adjustment
    # (same rules as Store › Adjustments: a Store Manager, never yourself).
    if payload.approver_id == user.id:
        raise HTTPException(status_code=400, detail="You can't approve your own count differences — pick a different Store Manager.")
    approver = db.query(User).filter(User.id == payload.approver_id, User.is_active == True).first()  # noqa: E712
    if not approver:
        raise HTTPException(status_code=400, detail="The selected approver was not found or is no longer active — pick another user.")
    if not (approver.is_store_manager or (location.manager_user_id and location.manager_user_id == approver.id)):
        raise HTTPException(status_code=400, detail=f"{approver.name or approver.email} isn't a Store Manager, so they can't approve stock corrections — "
                                                    f"pick a Store Manager (or {location.name}'s own manager).")
    # The role's assign-to rule (Role & Permissions › Store › Adjustments › Physical / cycle count).
    assignee_rules.ensure_allowed(db, user, APPROVER_RULE_KEY, approver)
    adjustment = StoreStockAdjustment(
        adjustment_number=generate_stock_adjustment_number(db), location_id=count.location_id, adjustment_date=date.today(),
        reason=(payload.reason or "").strip() or f"Physical count {count.count_number}", approved_by_id=approver.id,
        created_by_id=user.id, remarks=f"Differences from physical count {count.count_number} ({count.scope or 'count'}).",
        status="pending_approval",
    )
    db.add(adjustment)
    db.flush()
    for l in diffs:
        db.add(StoreStockAdjustmentItem(
            adjustment_id=adjustment.id, item_id=l.item_id, existing_quantity=l.book_quantity, actual_quantity=l.counted_quantity,
            difference=l.difference, remarks=l.remarks, bin_id=count.bin_id,
        ))
    db.flush()
    count.adjustment_id, count.status = adjustment.id, "submitted"
    try:
        req = engine.submit(db, ADJUSTMENT_KEY, entity_id=adjustment.id, requester=user,
                            title=f"Physical count {count.count_number} — {location.name}: {len(diffs)} difference(s)",
                            reference=adjustment.adjustment_number, context={"approver_id": approver.id}, branch_id=location.branch_id)
    except HTTPException:
        db.rollback()
        raise
    if req.status == "pending":
        from app.modules.store.services.store_events import location_opener, pending_approvers
        notify_event(
            db, background_tasks, "store", "count_submitted",
            title=f"Physical count {count.count_number} — {len(diffs)} difference(s) to approve",
            message=f"{user.name or user.email} submitted physical count {count.count_number} at {location.name}: {len(diffs)} "
                    f"difference(s) went for approval as stock adjustment {adjustment.adjustment_number}. Stock changes once it is approved "
                    "(Store › Adjustments).",
            entity_type="stock_adjustment", entity_id=adjustment.id, actor=user,
            can_open=location_opener(db, location.id), skip_user_ids=pending_approvers(req),
        )
    db.commit()
    return _to_response(db, _get(db, count.id, user), user)


@router.post("/{count_id}/cancel", response_model=StorePhysicalCountResponse)
async def cancel_count(count_id: int, payload: StorePhysicalCountCancelPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("store", "adjustments", "cycle_count", "cancel"))):
    count = _get(db, count_id, user, for_update=True)
    _require_counting(count, "cancel it")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say why the count is being cancelled — it is kept on the record.")
    count.status, count.cancel_reason, count.closed_at = "cancelled", reason, datetime.now(timezone.utc)
    db.commit()
    return _to_response(db, _get(db, count.id, user), user)
