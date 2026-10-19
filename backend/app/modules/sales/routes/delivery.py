"""Delivery confirmations against the SO schedule (VL01N / POD /
commissioning) and the billing due list (VF04).

    POST /sales/schedule/{sid}/confirm-delivery        Mark delivered (POD)
    POST /sales/schedule/{sid}/confirm-commissioning   Mark commissioned
    GET  /sales/orders/{so_id}/delivery-events         dispatch / delivery history
    POST /sales/delivery-events/{eid}/reverse          admin undo, with a reason
    GET  /sales/schedule/dispatchable                  open rows for the Store dispatch issue
    GET  /sales/billing-due                            billing due list (Sales + Finance)
    GET  /sales/orders/{so_id}/billing                 the order's milestones, billed / due
    POST /sales/billing/{bid}/request-invoice          Sales -> Accounts handoff
    POST /sales/billing/{bid}/mark-due                 drawing approval / inspection / other
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permission_registry import can_perform, can_view_tab, is_admin_user
from app.core.permissions import GRANT_HINT, ensure_feature_action, require_any_app_access, require_feature_action, require_tab_action
from app.db.session import get_db
from app.modules.accounts.services import billing
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.sales import delivery as dlv
from app.modules.sales import service as svc
from app.modules.sales import events as sales_events
from app.modules.sales.access import ensure_order, scoped_orders
from app.modules.sales.models.delivery import SalesDeliveryEvent
from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule, SalesBillingPlanLine
from app.modules.sales.schemas.delivery import (
    SalesDeliveryConfirmPayload, SalesCommissioningConfirmPayload, SalesDeliveryReversePayload, SalesMilestoneDuePayload,
    SalesDeliveryEventResponse,
)
from app.modules.sales.schemas.order import SalesOrderResponse
from app.modules.sales.views import sales_errors, get_order, order_response, prices_hidden

router = APIRouter(prefix="/sales", tags=["Sales"])


def _billing_viewer(user: User = Depends(get_current_user)) -> User:
    """Billing due list: Sales (orders) or Finance (sales invoices)."""
    if can_perform(user, "sales", "orders", "view") or can_perform(user, "accounts", "sales_invoices", "view"):
        return user
    raise HTTPException(status_code=403, detail="The billing due list needs 'View' on Sales › Sales Orders or on "
                                                f"Finance › Sales Invoices (sales:orders:view / accounts:sales_invoices:view). {GRANT_HINT}")


def _row(db: Session, sid: int, user: User, lock: bool = True) -> tuple[SalesOrder, SalesOrderSchedule]:
    row = db.query(SalesOrderSchedule).filter(SalesOrderSchedule.id == sid).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Delivery row #{sid} not found — reload the order.")
    if lock:
        db.query(SalesOrder.id).filter(SalesOrder.id == row.so_id).with_for_update().first()
    so = get_order(db, row.so_id)
    ensure_order(db, user, so)
    return so, next(r for r in so.schedules if r.id == sid)


def _audit(db: Session, so: SalesOrder, user: User, action: str, summary: str) -> None:
    from app.modules.main.models.audit_log import AuditLog
    db.add(AuditLog(entity_type="sales_order", entity_id=so.id, action=action, module_key="sales",
                    summary=summary[:500], performed_by_id=user.id))


def _event_responses(db: Session, so: SalesOrder, events: list[SalesDeliveryEvent]) -> list[SalesDeliveryEventResponse]:
    from app.modules.store.models.material_issue import StoreMaterialIssue
    rows = {r.id: r for r in so.schedules}
    names = svc.user_names(db, [e.created_by_id for e in events] + [e.reversed_by_id for e in events])
    issue_ids = {e.material_issue_id for e in events if e.material_issue_id}
    issues = dict(db.query(StoreMaterialIssue.id, StoreMaterialIssue.issue_number).filter(StoreMaterialIssue.id.in_(issue_ids)).all()) if issue_ids else {}
    out = []
    for e in events:
        r = SalesDeliveryEventResponse.model_validate(e)
        row = rows.get(e.schedule_id)
        r.row_label = dlv.row_label(so, row) if row else None
        r.material_issue_number = issues.get(e.material_issue_id)
        r.created_by_name, r.reversed_by_name = names.get(e.created_by_id), names.get(e.reversed_by_id)
        out.append(r)
    return out


# ---------------------------------------------------------------- delivery confirmations

@router.post("/schedule/{sid}/confirm-delivery", response_model=SalesOrderResponse)
async def confirm_delivery(sid: int, payload: SalesDeliveryConfirmPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("sales", "delivery", "approve"))):
    so, row = _row(db, sid, user)
    with sales_errors(db):
        dlv.mark_delivered(db, so, row, on=payload.delivered_on, reference=payload.reference, quantity=payload.quantity,
                           remarks=payload.remarks, user=user)
    _audit(db, so, user, "delivered", f"{user.name or user.email} confirmed delivery of {dlv.row_label(so, row)} on "
                                      f"{payload.delivered_on:%d-%m-%Y} (ref {payload.reference.strip()}).")
    sales_events.order_event(
        db, background_tasks, "delivery_confirmed", so, title=f"{so.display_number}: {dlv.row_label(so, row)} delivered",
        message=f"{user.name or user.email} confirmed delivery of {dlv.row_label(so, row)} to {so.customer_name or 'the customer'} on "
                f"{payload.delivered_on:%d-%m-%Y} (ref {payload.reference.strip()}).",
        actor=user,
    )
    db.commit()
    return order_response(db, get_order(db, so.id), user)


@router.post("/schedule/{sid}/confirm-commissioning", response_model=SalesOrderResponse)
async def confirm_commissioning(sid: int, payload: SalesCommissioningConfirmPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                                user: User = Depends(require_tab_action("sales", "delivery", "approve"))):
    so, row = _row(db, sid, user)
    with sales_errors(db):
        dlv.mark_commissioned(db, so, row, on=payload.commissioned_on, reference=payload.reference, remarks=payload.remarks, user=user)
    _audit(db, so, user, "commissioned", f"{user.name or user.email} confirmed commissioning of {dlv.row_label(so, row)} on "
                                         f"{payload.commissioned_on:%d-%m-%Y} (ref {payload.reference.strip()}).")
    sales_events.order_event(
        db, background_tasks, "delivery_confirmed", so, title=f"{so.display_number}: {dlv.row_label(so, row)} commissioned",
        message=f"{user.name or user.email} confirmed commissioning of {dlv.row_label(so, row)} at {so.customer_name or 'the customer'} on "
                f"{payload.commissioned_on:%d-%m-%Y} (ref {payload.reference.strip()}).",
        actor=user,
    )
    db.commit()
    return order_response(db, get_order(db, so.id), user)


@router.get("/orders/{so_id}/delivery-events", response_model=list[SalesDeliveryEventResponse])
async def delivery_events(so_id: int, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("sales", "delivery", "view"))):
    so = get_order(db, so_id)
    ensure_order(db, user, so)
    return _event_responses(db, so, dlv.events_of(db, so.id))


@router.post("/delivery-events/{eid}/reverse", response_model=SalesOrderResponse)
async def reverse_delivery_event(eid: int, payload: SalesDeliveryReversePayload, db: Session = Depends(get_db),
                                 user: User = Depends(require_tab_action("sales", "delivery", "approve"))):
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Only an admin can reverse a recorded dispatch / delivery / commissioning "
                                                    "(it moves the order status, LD and billing back). Ask an admin.")
    ev = db.query(SalesDeliveryEvent).filter(SalesDeliveryEvent.id == eid).first()
    if not ev:
        raise HTTPException(status_code=404, detail=f"Delivery event #{eid} not found — reload the order.")
    so, _row_ = _row(db, ev.schedule_id, user)
    with sales_errors(db):
        dlv.reverse_event(db, so, ev, reason=payload.reason, user=user)
    _audit(db, so, user, "delivery_reversed", f"{user.name or user.email} reversed the {ev.event} of {dlv.row_label(so, _row_)} "
                                              f"dated {ev.event_date:%d-%m-%Y}: {payload.reason.strip()}")
    db.commit()
    return order_response(db, get_order(db, so.id), user)


@router.get("/schedule/dispatchable")
async def dispatchable_rows(erp_project_id: int | None = None, so_id: int | None = None, db: Session = Depends(get_db),
                            _user: User = Depends(require_any_app_access("sales", "store"))):
    """Open delivery rows (not fully dispatched) of executing orders, for the
    Store dispatch issue's Sales Order / vehicle picker."""
    q = db.query(SalesOrder).options(selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules)).filter(
        SalesOrder.is_deleted == False, SalesOrder.status.in_(dlv.DISPATCH_STATUSES))  # noqa: E712
    if so_id:
        q = q.filter(SalesOrder.id == so_id)
    wanted = {r.id for r in dlv.rows_for_machine(db, erp_project_id)} if erp_project_id else None
    out = []
    for so in q.order_by(SalesOrder.id.desc()).limit(300).all():
        lines = {ln.id: ln for ln in so.lines}
        for r in so.schedules:
            open_qty = round(float(r.quantity or 0) - float(r.qty_dispatched or 0), 4)
            if r.status == "cancelled" or open_qty <= dlv.EPS or (wanted is not None and r.id not in wanted):
                continue
            ln = lines.get(r.so_line_id)
            out.append({"schedule_id": r.id, "so_id": so.id, "so_number": so.so_number, "customer_name": so.customer_name,
                        "label": dlv.row_label(so, r), "line_number": ln.line_number if ln else None,
                        "description": ln.description if ln else None, "store_item_id": ln.product_item_id if ln else None,
                        "open_qty": open_qty, "uom": ln.uom if ln else None, "consignee_name": r.consignee_name,
                        "current_delivery_date": r.current_delivery_date})
    return out


# ---------------------------------------------------------------- billing due list (VF04)

@router.get("/billing-due")
async def billing_due(customer_id: int | None = None, so_id: int | None = None,
                      show: str = Query("due", description="due / overdue / requested / all"),
                      db: Session = Depends(get_db), user: User = Depends(_billing_viewer)):
    q = db.query(SalesOrder).options(selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules),
                                     selectinload(SalesOrder.billing_lines)).filter(
        SalesOrder.is_deleted == False, SalesOrder.status.in_(billing.BILLABLE_ORDER_STATUSES))  # noqa: E712
    # Finance sees every customer's billing; a Sales user only the orders in their data scope.
    if not can_perform(user, "accounts", "sales_invoices", "view"):
        q = scoped_orders(q, user)
    if customer_id:
        q = q.filter(SalesOrder.customer_id == customer_id)
    if so_id:
        q = q.filter(SalesOrder.id == so_id)
    out = []
    for so in q.all():
        billing.sync_order(db, so)
        for v in billing.milestone_views(db, so):
            if show == "all":
                pass
            elif show == "overdue" and not v["overdue"]:
                continue
            elif show == "requested" and v["status"] != "invoice_requested":
                continue
            elif show in ("due", "overdue", "requested") and v["due_amount"] <= billing.TOL:
                continue
            out.append(v)
    db.commit()
    out.sort(key=lambda v: (v["due_date"] or v["triggered_on"] or svc.today_ist(), v["so_display"] or "", v["sequence"]))
    return out


@router.get("/orders/{so_id}/billing")
async def order_billing(so_id: int, db: Session = Depends(get_db), user: User = Depends(_billing_viewer)):
    so = get_order(db, so_id)
    finance = can_perform(user, "accounts", "sales_invoices", "view")
    if not finance:
        ensure_order(db, user, so)
        # Sales › Sales Orders users: the Billing Plan sub-tab, and its amounts
        # only with Prices & margins (Finance keeps the full view).
        if can_view_tab(user, "sales", "orders"):
            ensure_feature_action(user, "sales", "orders", "billing_plan", "view")
    billing.sync_order(db, so)
    db.commit()
    views = billing.milestone_views(db, get_order(db, so_id))
    if not finance and can_view_tab(user, "sales", "orders") and prices_hidden(user):
        views = _blank_amounts(views)
    return views


def _blank_amounts(value):
    """Copy of a milestone view with every amount / total set to None."""
    if isinstance(value, list):
        return [_blank_amounts(v) for v in value]
    if isinstance(value, dict):
        return {k: (None if ("amount" in k or "total" in k) and isinstance(v, (int, float)) and not isinstance(v, bool) else _blank_amounts(v))
                for k, v in value.items()}
    return value


def _milestone(db: Session, bid: int, user: User) -> tuple[SalesOrder, SalesBillingPlanLine]:
    b = db.query(SalesBillingPlanLine).filter(SalesBillingPlanLine.id == bid).first()
    if not b:
        raise HTTPException(status_code=404, detail=f"Billing milestone #{bid} not found — reload the order.")
    db.query(SalesOrder.id).filter(SalesOrder.id == b.so_id).with_for_update().first()
    so = get_order(db, b.so_id)
    ensure_order(db, user, so)
    return so, next(x for x in so.billing_lines if x.id == bid)


@router.post("/billing/{bid}/request-invoice", dependencies=[Depends(require_feature_action("sales", "orders", "billing_plan", "edit"))])
async def request_invoice(bid: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so, b = _milestone(db, bid, user)
    billing.sync_order(db, so)
    view = next(v for v in billing.milestone_views(db, so) if v["billing_line_id"] == b.id)
    if view["due_amount"] <= billing.TOL:
        why = "it isn't due yet" if b.status == "not_due" else "nothing is left to invoice on it right now"
        raise HTTPException(status_code=409, detail=f"Can't request an invoice for milestone {b.sequence} of {so.display_number}: {why}.")
    b.invoice_requested_at, b.invoice_requested_by_id = svc.now_utc(), user.id
    billing.sync_order(db, so)
    from app.utils.notifications import broadcast_notification
    broadcast_notification(db, f"Invoice requested: {so.display_number}",
                           f"{user.name or user.email} asks for the {b.percent:g}% {view['milestone_label'].lower()} invoice "
                           f"({svc.inr(view['due_amount'])}) to {so.customer_name}. Finance › Sales › Billing due.",
                           "sales_invoice_requested", entity_type="sales_order", entity_id=so.id,
                           exclude_user_id=user.id, app_name="accounts")
    _audit(db, so, user, "invoice_requested", f"{user.name or user.email} requested the invoice for milestone {b.sequence} "
                                              f"({b.percent:g}% {view['milestone_label'].lower()}).")
    sales_events.order_event(
        db, background_tasks, "milestone_due", so, title=f"Invoice requested: {so.display_number} milestone {b.sequence}",
        message=f"{user.name or user.email} asked Finance for the {b.percent:g}% {view['milestone_label'].lower()} invoice of "
                f"{so.display_number} ({so.customer_name or 'customer'}).",
        actor=user,
    )
    db.commit()
    return next(v for v in billing.milestone_views(db, get_order(db, so.id)) if v["billing_line_id"] == bid)


@router.post("/billing/{bid}/mark-due", dependencies=[Depends(require_feature_action("sales", "orders", "billing_plan", "edit"))])
async def mark_milestone_due(bid: int, payload: SalesMilestoneDuePayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                             user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so, b = _milestone(db, bid, user)
    if b.milestone_type not in billing.MANUAL_MILESTONES:
        how = {"advance": "on order confirmation", "retention_release": "when every unit's warranty has ended",
               "dispatch": "when a unit is dispatched", "delivery": "when a unit is delivered",
               "commissioning": "when a unit is commissioned"}.get(b.milestone_type, "on its event")
        raise HTTPException(status_code=409, detail=f"A {b.milestone_type.replace('_', ' ')} milestone falls due by itself {how} — "
                                                    f"it can't be marked due by hand.")
    if b.triggered_at:
        raise HTTPException(status_code=409, detail=f"Milestone {b.sequence} is already due (since {billing._d(b.triggered_at):%d-%m-%Y}).")
    if payload.on > svc.today_ist():
        raise HTTPException(status_code=422, detail="The date is in the future — mark it due on or after the day it happened.")
    if so.status not in billing.BILLABLE_ORDER_STATUSES:
        raise HTTPException(status_code=409, detail=f"{so.display_number} isn't confirmed — milestones fall due only on a confirmed order.")
    b.triggered_at = billing._as_dt(payload.on)
    billing.sync_order(db, so)
    ref = f" (ref {payload.reference.strip()})" if (payload.reference or "").strip() else ""
    _audit(db, so, user, "milestone_due", f"{user.name or user.email} marked milestone {b.sequence} ({b.percent:g}% "
                                          f"{b.milestone_type.replace('_', ' ')}) due on {payload.on:%d-%m-%Y}{ref}.")
    sales_events.order_event(
        db, background_tasks, "milestone_due", so, title=f"{so.display_number}: billing milestone {b.sequence} due",
        message=f"{user.name or user.email} marked the {b.percent:g}% {b.milestone_type.replace('_', ' ')} milestone of {so.display_number} "
                f"due on {payload.on:%d-%m-%Y}{ref}. Request its invoice from the Billing Plan tab.",
        actor=user,
    )
    db.commit()
    return next(v for v in billing.milestone_views(db, get_order(db, so.id)) if v["billing_line_id"] == bid)
