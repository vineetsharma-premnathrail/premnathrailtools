"""Delivery schedule board (all open vehicles across orders), the RRV build
link per vehicle, and delivery-period (DP) extensions."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_any_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.sales import service as svc
from app.modules.sales.access import ensure_order, scoped_orders
from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule, SALES_SCHEDULE_UNDELIVERED
from app.modules.sales.models.extension import SalesDeliveryExtension, SALES_EXTENSION_REASONS
from app.modules.sales.schemas.order import (
    SalesOrderScheduleResponse, SalesOrderScheduleUpdate, SalesOrderScheduleLinkPayload, SalesOrderResponse,
)
from app.modules.sales.schemas.extension import (
    SalesDeliveryExtensionCreate, SalesDeliveryExtensionGrantPayload, SalesDeliveryExtensionRefusePayload,
    SalesDeliveryExtensionResponse,
)
from app.modules.sales.views import sales_errors, get_order, order_response, schedule_rows

router = APIRouter(prefix="/sales", tags=["Sales"])
_SALES = Depends(require_app_access("sales"))
_EXEC_STATUSES = ("confirmed", "in_execution", "partially_delivered", "on_hold")


def _row(db: Session, sid: int, user: User) -> tuple[SalesOrder, SalesOrderSchedule]:
    row = db.query(SalesOrderSchedule).filter(SalesOrderSchedule.id == sid).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Delivery row #{sid} not found.")
    so = get_order(db, row.so_id)
    ensure_order(db, user, so)
    row = next(r for r in so.schedules if r.id == sid)
    return so, row


def board_rows(db: Session, *, user: User | None = None, status: str | None = None, month: str | None = None, risk: str | None = None,
               customer_id: int | None = None, include_delivered: bool = False) -> list[SalesOrderScheduleResponse]:
    """Delivery rows of executing orders — limited to `user`'s data scope (None = system caller)."""
    q = db.query(SalesOrder).options(selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules)).filter(
        SalesOrder.is_deleted == False, SalesOrder.status.in_(_EXEC_STATUSES + (("delivered", "closed") if include_delivered else ())))  # noqa: E712
    q = scoped_orders(q, user)
    if customer_id:
        q = q.filter(SalesOrder.customer_id == customer_id)
    out = []
    for so in q.all():
        rows = [r for r in so.schedules if r.status != "cancelled"
                and (include_delivered or r.status in SALES_SCHEDULE_UNDELIVERED)]
        if status:
            rows = [r for r in rows if r.status == status]
        if month:
            rows = [r for r in rows if r.current_delivery_date and r.current_delivery_date.strftime("%Y-%m") == month]
        out += schedule_rows(db, so, rows)
    if risk:
        out = [r for r in out if (r.risk is not None if risk == "any" else r.risk == risk)]
    out.sort(key=lambda r: (r.current_delivery_date or date.max, r.so_display or "", r.sequence))
    return out


@router.get("/schedule", response_model=list[SalesOrderScheduleResponse])
async def schedule_board(status: str | None = None, month: str | None = None, risk: str | None = Query(None, description="at_risk / overdue / any"),
                         customer_id: int | None = None, db: Session = Depends(get_db), _app: User = _SALES,
                         user: User = Depends(require_tab_access("sales", "delivery"))):
    return board_rows(db, user=user, status=status, month=month, risk=risk, customer_id=customer_id)


@router.get("/schedule/by-build/{build_id}")
async def schedule_by_build(build_id: int, db: Session = Depends(get_db),
                            _user: User = Depends(require_any_app_access("sales", "production"))):
    """Read-only for the Production build header: the SO, due date and LD rate."""
    row = db.query(SalesOrderSchedule).filter(SalesOrderSchedule.rrv_build_id == build_id,
                                              SalesOrderSchedule.status != "cancelled").first()
    if not row:
        return {"link": None}
    so = db.query(SalesOrder).filter(SalesOrder.id == row.so_id, SalesOrder.is_deleted == False).first()  # noqa: E712
    if not so:
        return {"link": None}
    return {"link": {
        "so_id": so.id, "so_number": so.display_number, "customer_name": so.customer_name, "vehicle": row.sequence,
        "contract_delivery_date": row.contract_delivery_date, "current_delivery_date": row.current_delivery_date,
        "ld_rate_percent": so.ld_rate_percent if so.ld_applicable else None, "ld_rate_period": so.ld_rate_period,
    }}


@router.patch("/schedule/{sid}", response_model=SalesOrderScheduleResponse)
async def update_schedule_row(sid: int, payload: SalesOrderScheduleUpdate, db: Session = Depends(get_db), _app: User = _SALES,
                              user: User = Depends(require_tab_action("sales", "delivery", "edit"))):
    so, row = _row(db, sid, user)
    if so.status in ("draft", "cancelled", "closed", "short_closed"):
        raise HTTPException(status_code=409, detail=f"{so.display_number} is {svc.STATUS_LABEL[so.status]} — "
                                                    f"{'edit the draft schedule on the order instead' if so.status == 'draft' else 'its schedule is locked'}.")
    data = payload.model_dump(exclude_unset=True)
    if "committed_date" in data and row.rrv_build_id:
        raise HTTPException(status_code=409, detail="This vehicle's committed date comes from its RRV build's target handover date — "
                                                    "ask Production to change the build's target.")
    for k, v in data.items():
        setattr(row, k, v.strip() if isinstance(v, str) else v)
    svc.refresh_order(db, so)
    db.commit()
    return schedule_rows(db, so, [row])[0]


@router.post("/schedule/{sid}/link-build", response_model=SalesOrderResponse)
async def link_build(sid: int, payload: SalesOrderScheduleLinkPayload, db: Session = Depends(get_db), _app: User = _SALES,
                     user: User = Depends(require_tab_action("sales", "delivery", "edit"))):
    so, row = _row(db, sid, user)
    with sales_errors(db):
        svc.link_build(db, so, row, payload.build_id)
        svc.refresh_order(db, so)
    db.commit()
    return order_response(db, get_order(db, so.id), user)


@router.post("/schedule/{sid}/unlink-build", response_model=SalesOrderResponse)
async def unlink_build(sid: int, db: Session = Depends(get_db), _app: User = _SALES,
                       user: User = Depends(require_tab_action("sales", "delivery", "edit"))):
    so, row = _row(db, sid, user)
    if not row.rrv_build_id:
        raise HTTPException(status_code=409, detail="This vehicle has no build linked.")
    with sales_errors(db):
        svc.unlink_build(db, row)
        svc.refresh_order(db, so)
    db.commit()
    return order_response(db, get_order(db, so.id), user)


# ---------------------------------------------------------------- DP extensions

def _ext_response(db: Session, e: SalesDeliveryExtension, so: SalesOrder | None = None) -> SalesDeliveryExtensionResponse:
    resp = SalesDeliveryExtensionResponse.model_validate(e)
    so = so or get_order(db, e.so_id)
    resp.so_display, resp.customer_name = so.display_number, so.customer_name
    lines = {ln.id: ln for ln in so.lines}
    resp.vehicles = [f"Line {lines[r.so_line_id].line_number} / {r.sequence}" for r in so.schedules
                     if r.id in (e.schedule_ids or []) and r.so_line_id in lines]
    names = svc.user_names(db, [e.created_by_id, e.decided_by_id])
    resp.created_by_name, resp.decided_by_name = names.get(e.created_by_id), names.get(e.decided_by_id)
    resp.status_label = ext_status_label(e)
    return resp


# Prefix orders._close_followups writes when an order ends with the request still pending.
AUTO_CLOSED_REMARK = "Closed without a decision"


def ext_status_label(e: SalesDeliveryExtension) -> str:
    """Display label. Requests auto-closed when their order ended are stored as
    'refused' (no 'withdrawn'/'lapsed' status yet) but were NOT refused by the
    customer — label them so lists and filters don't read as customer refusals."""
    if e.status == "refused" and (e.decision_remarks or "").startswith(AUTO_CLOSED_REMARK):
        return "Closed (order ended)"
    return {"requested": "Requested", "granted": "Granted", "refused": "Refused by customer"}.get(e.status, e.status)


_DEAD_STATUSES = ("cancelled", "short_closed", "closed")


def _require_live(so: SalesOrder) -> None:
    if so.status in _DEAD_STATUSES:
        raise HTTPException(status_code=409, detail=f"{so.display_number} is {svc.STATUS_LABEL[so.status]} — this extension no longer applies; "
                                                    f"it was left open when the order was closed. Nothing to decide.")


def _ext(db: Session, eid: int) -> SalesDeliveryExtension:
    e = db.query(SalesDeliveryExtension).filter(SalesDeliveryExtension.id == eid).first()
    if not e:
        raise HTTPException(status_code=404, detail=f"DP extension #{eid} not found.")
    return e


def _ext_locked(db: Session, eid: int) -> SalesDeliveryExtension:
    """Row-locks the order, then the extension (SELECT … FOR UPDATE), and re-reads
    the extension — the same order-then-child order cancel / short-close / close
    and the amendments take — so a grant or refusal racing an order cancel waits,
    then sees the request already closed instead of overwriting it."""
    so_id = db.query(SalesDeliveryExtension.so_id).filter(SalesDeliveryExtension.id == eid).scalar()
    if so_id:
        db.query(SalesOrder.id).filter(SalesOrder.id == so_id).with_for_update().first()
        db.query(SalesDeliveryExtension.id).filter(SalesDeliveryExtension.id == eid).with_for_update().first()
    e = db.query(SalesDeliveryExtension).populate_existing().filter(SalesDeliveryExtension.id == eid).first()
    if not e:
        raise HTTPException(status_code=404, detail=f"DP extension #{eid} not found.")
    return e


@router.get("/extensions", response_model=list[SalesDeliveryExtensionResponse])
async def list_all_extensions(status: str | None = None, db: Session = Depends(get_db), _app: User = _SALES,
                              user: User = Depends(require_tab_access("sales", "delivery"))):
    q = db.query(SalesDeliveryExtension).filter(
        SalesDeliveryExtension.so_id.in_(scoped_orders(db.query(SalesOrder.id), user)))
    if status:
        q = q.filter(SalesDeliveryExtension.status == status)
    return [_ext_response(db, e) for e in q.order_by(SalesDeliveryExtension.id.desc()).all()]


@router.get("/orders/{so_id}/extensions", response_model=list[SalesDeliveryExtensionResponse])
async def list_extensions(so_id: int, db: Session = Depends(get_db), _app: User = _SALES,
                          user: User = Depends(require_tab_access("sales", "delivery"))):
    so = get_order(db, so_id)
    ensure_order(db, user, so)
    rows = db.query(SalesDeliveryExtension).filter(SalesDeliveryExtension.so_id == so.id).order_by(SalesDeliveryExtension.id.desc()).all()
    return [_ext_response(db, e, so) for e in rows]


@router.post("/orders/{so_id}/extensions", response_model=SalesDeliveryExtensionResponse)
async def request_extension(so_id: int, payload: SalesDeliveryExtensionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), _app: User = _SALES,
                            user: User = Depends(require_tab_action("sales", "delivery", "create"))):
    so = get_order(db, so_id)
    ensure_order(db, user, so)
    if so.status not in _EXEC_STATUSES:
        raise HTTPException(status_code=409, detail=f"DP extensions are for confirmed orders — {so.display_number} is {svc.STATUS_LABEL[so.status]}.")
    if payload.reason_category not in SALES_EXTENSION_REASONS:
        raise HTTPException(status_code=422, detail=f"Reason category must be one of: {', '.join(SALES_EXTENSION_REASONS)}.")
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail="Describe why the extension is needed (e.g. drawing approval received late).")
    if not payload.schedule_ids:
        raise HTTPException(status_code=422, detail="Pick the vehicles / lots the extension is for.")
    rows = {r.id: r for r in so.schedules}
    for sid in payload.schedule_ids:
        r = rows.get(sid)
        if not r:
            raise HTTPException(status_code=422, detail=f"Delivery row #{sid} isn't on {so.display_number}.")
        if r.status not in SALES_SCHEDULE_UNDELIVERED:
            raise HTTPException(status_code=409, detail=f"Vehicle / lot {r.sequence} is {r.status} — only undelivered rows can be extended.")
        if r.current_delivery_date and payload.requested_new_date <= r.current_delivery_date:
            raise HTTPException(status_code=422, detail=f"The requested date must be after vehicle {r.sequence}'s current date "
                                                        f"({r.current_delivery_date:%d-%m-%Y}).")
    e = SalesDeliveryExtension(
        so_id=so.id, schedule_ids=list(dict.fromkeys(payload.schedule_ids)), requested_on=svc.today_ist(),
        requested_new_date=payload.requested_new_date, reason_category=payload.reason_category, reason=payload.reason.strip(),
        customer_letter_ref=payload.customer_letter_ref, customer_letter_date=payload.customer_letter_date,
        status="requested", created_by_id=user.id,
    )
    db.add(e)
    db.flush()
    from app.modules.sales import events as sales_events
    sales_events.order_event(
        db, background_tasks, "extension_requested", so, entity_type="sales_extension", entity_id=e.id,
        title=f"DP extension requested on {so.display_number}",
        message=f"{user.name or user.email} asks to move {len(e.schedule_ids)} vehicle(s) / lot(s) of {so.display_number} "
                f"({so.customer_name or 'customer'}) to {payload.requested_new_date:%d-%m-%Y}: {e.reason}. Grant or refuse it in Sales › Delivery.",
        actor=user,
    )
    db.commit()
    db.refresh(e)
    return _ext_response(db, e, so)


@router.post("/extensions/{eid}/grant", response_model=SalesDeliveryExtensionResponse)
async def grant_extension(eid: int, payload: SalesDeliveryExtensionGrantPayload, db: Session = Depends(get_db), _app: User = _SALES,
                          user: User = Depends(require_tab_action("sales", "delivery", "approve"))):
    e = _ext_locked(db, eid)
    if e.status != "requested":
        raise HTTPException(status_code=409, detail=f"This DP extension is already decided ({ext_status_label(e)}) — reload the order to see the outcome; record a new request if the customer asks again.")
    if not payload.customer_letter_ref.strip():
        raise HTTPException(status_code=422, detail="Enter the customer's letter reference — the grant is recorded against their letter "
                                                    "(it's the evidence if an LD deduction is disputed later).")
    so = get_order(db, e.so_id)
    ensure_order(db, user, so)
    _require_live(so)
    rows = [r for r in so.schedules if r.id in (e.schedule_ids or [])]
    for r in rows:
        if r.current_delivery_date and payload.granted_new_date < r.current_delivery_date:
            raise HTTPException(status_code=422, detail=f"The granted date is before vehicle {r.sequence}'s current date "
                                                        f"({r.current_delivery_date:%d-%m-%Y}) — an extension can't bring a date forward.")
    for r in rows:
        if r.status in SALES_SCHEDULE_UNDELIVERED:
            r.current_delivery_date = payload.granted_new_date
            r.ld_waived = not payload.with_ld
    e.status = "granted"
    e.granted_new_date, e.with_ld = payload.granted_new_date, payload.with_ld
    e.token_penalty_amount = payload.token_penalty_amount
    e.customer_letter_ref = payload.customer_letter_ref.strip()
    e.customer_letter_date = payload.customer_letter_date or e.customer_letter_date
    e.decision_remarks = payload.remarks
    e.decided_at, e.decided_by_id = svc.now_utc(), user.id
    svc.refresh_order(db, so)
    svc.notify_bell(db, [e.created_by_id, so.sales_owner_id], f"DP extension granted on {so.display_number}",
                    f"New date {payload.granted_new_date:%d-%m-%Y}, {'with' if payload.with_ld else 'without'} LD.",
                    "sales_extension_granted", "sales_order", so.id, exclude_user_id=user.id)
    db.commit()
    db.refresh(e)
    return _ext_response(db, e, so)


@router.post("/extensions/{eid}/refuse", response_model=SalesDeliveryExtensionResponse)
async def refuse_extension(eid: int, payload: SalesDeliveryExtensionRefusePayload, db: Session = Depends(get_db), _app: User = _SALES,
                           user: User = Depends(require_tab_action("sales", "delivery", "approve"))):
    e = _ext_locked(db, eid)
    if e.status != "requested":
        raise HTTPException(status_code=409, detail=f"This DP extension is already decided ({ext_status_label(e)}) — reload the order to see the outcome; record a new request if the customer asks again.")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=422, detail="Record why the customer refused (quote their letter).")
    so = get_order(db, e.so_id)
    ensure_order(db, user, so)
    _require_live(so)
    e.status = "refused"
    e.decision_remarks = payload.reason.strip()
    e.decided_at, e.decided_by_id = svc.now_utc(), user.id
    svc.notify_bell(db, [e.created_by_id, so.sales_owner_id], f"DP extension refused on {so.display_number}", e.decision_remarks,
                    "sales_extension_refused", "sales_order", so.id, exclude_user_id=user.id)
    db.commit()
    db.refresh(e)
    return _ext_response(db, e, so)
