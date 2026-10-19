"""Response builders shared by the Sales routers (loading, display fields,
"what can this user do" flags) and the SalesError → HTTP mapping."""
from __future__ import annotations

from contextlib import contextmanager

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.core.permission_registry import can_feature, can_perform, can_view_tab, is_admin_user
from app.modules.main.models.user import User
from app.modules.sales import service as svc
from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule
from app.modules.sales.models.amendment import SalesOrderAmendment, SALES_AMENDMENT_OPEN_STATUSES
from app.modules.sales.models.approval import SalesApproval
from app.modules.sales.schemas.order import SalesOrderResponse, SalesOrderScheduleResponse, SalesApprovalResponse
from app.modules.sales.schemas.amendment import SalesOrderAmendmentResponse


@contextmanager
def sales_errors(db: Session | None = None):
    try:
        yield
    except svc.SalesError as e:
        if db is not None:
            db.rollback()
        raise HTTPException(status_code=e.status_code, detail=e.detail)


def get_order(db: Session, so_id: int) -> SalesOrder:
    so = (
        db.query(SalesOrder)
        .options(selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules), selectinload(SalesOrder.billing_lines))
        .filter(SalesOrder.id == so_id, SalesOrder.is_deleted == False)  # noqa: E712
        .first()
    )
    if not so:
        raise HTTPException(status_code=404, detail=f"Sales order #{so_id} not found — it may have been deleted.")
    return so


def require_status(so: SalesOrder, allowed: tuple[str, ...], action: str, hint: str = "") -> None:
    if so.status not in allowed:
        allowed_txt = " / ".join(svc.STATUS_LABEL[s] for s in allowed)
        raise HTTPException(
            status_code=409,
            detail=f"Can't {action} {so.display_number}: it's {svc.STATUS_LABEL.get(so.status, so.status)}, and this needs {allowed_txt}."
                   f"{(' ' + hint) if hint else ''}",
        )


def _builds(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    from app.modules.production.models.rrv_build import ProductionRrvBuild, ProductionRrvBuildStage, PRODUCTION_RRV_STAGES
    labels = {k: label for k, label, _p, _n in PRODUCTION_RRV_STAGES}
    builds = {b.id: b for b in db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id.in_(ids)).all()}
    stage_now: dict[int, str] = {}
    for st in db.query(ProductionRrvBuildStage).filter(ProductionRrvBuildStage.build_id.in_(ids)).order_by(
            ProductionRrvBuildStage.build_id, ProductionRrvBuildStage.sequence).all():
        if st.build_id not in stage_now and st.status not in ("completed", "not_applicable"):
            stage_now[st.build_id] = labels.get(st.stage_key, st.stage_key)
    return {i: (b, stage_now.get(i)) for i, b in builds.items()}


def schedule_rows(db: Session, so: SalesOrder, rows: list[SalesOrderSchedule] | None = None) -> list[SalesOrderScheduleResponse]:
    rows = so.schedules if rows is None else rows
    as_of = svc.today_ist()
    window = int(svc.get_setting(db, "at_risk_reminder_days"))
    builds = _builds(db, [r.rrv_build_id for r in rows])
    lines = {ln.id: ln for ln in so.lines}
    out = []
    for r in rows:
        # Live derivation (the daily job / write paths persist the same values).
        b = builds.get(r.rrv_build_id)
        if b and b[0].target_handover_date:
            r.committed_date = b[0].target_handover_date
        r.status = svc.derive_row_status(db, r)
        resp = SalesOrderScheduleResponse.model_validate(r)
        ln = lines.get(r.so_line_id)
        if ln:
            resp.line_number, resp.line_description, resp.rrv_model = ln.line_number, ln.description, ln.rrv_model
        resp.unit_value = svc.unit_value(so, r)
        b = builds.get(r.rrv_build_id)
        if b:
            resp.build_number, resp.build_status = b[0].build_number, b[0].status
            resp.build_stage = b[1] or ("Done" if b[0].status in ("completed", "handed_over") else None)
        resp.ld_weeks, resp.ld_amount = svc.ld_accrued(so, r, as_of)  # live, not the daily snapshot
        resp.ld_forecast_periods, resp.ld_forecast_amount = svc.ld_forecast(so, r)
        resp.risk = svc.risk_of(db, so, r, as_of, window)
        resp.so_number, resp.so_display, resp.customer_name = so.so_number, so.display_number, so.customer_name
        out.append(resp)
    return out


def _approval_responses(db: Session, rows: list[SalesApproval]) -> list[SalesApprovalResponse]:
    names = svc.user_names(db, [a.approver_id for a in rows])
    out = []
    for a in rows:
        r = SalesApprovalResponse.model_validate(a)
        r.approver_name = names.get(a.approver_id)
        out.append(r)
    return out


def prices_hidden(user: User) -> bool:
    """True when money must be blanked for `user`: their roles lack Sales ›
    Sales Orders › Prices & margins and they can't edit order lines (whoever
    enters the prices sees them)."""
    return not (can_feature(user, "sales", "orders", "prices", "view") or can_feature(user, "sales", "orders", "lines", "edit"))


_LINE_MONEY = ("unit_price", "discount_amount", "taxable_amount", "gst_amount", "line_total", "list_price")
_ORDER_MONEY = ("subtotal", "discount_total", "taxable_total", "gst_total", "grand_total", "ld_accrued", "ld_forecast")


def _mask_prices(resp: SalesOrderResponse) -> None:
    """Blank every amount on an order response (Prices & margins) — the
    fields stay (None), so the response shape is unchanged."""
    for f in _ORDER_MONEY:
        setattr(resp, f, None)
    resp.credit = None
    for line in resp.lines:
        for f in _LINE_MONEY:
            setattr(line, f, None)
    for r in resp.schedules:
        r.unit_value = r.ld_amount = r.ld_forecast_amount = None
    for b in resp.billing_lines:
        b.amount = b.invoiced_amount = None
    resp.prices_hidden = True


def _mask_sections(resp: SalesOrderResponse, user: User) -> None:
    """Leave out the sub-tabs this user's roles don't include."""
    if not can_feature(user, "sales", "orders", "lines", "view"):
        resp.lines = []
    if not can_feature(user, "sales", "orders", "schedule", "view"):
        resp.schedules = []
    if not can_feature(user, "sales", "orders", "billing_plan", "view"):
        resp.billing_lines = []
    if not can_feature(user, "sales", "orders", "approvals", "view"):
        resp.approvals = []


def order_response(db: Session, so: SalesOrder, user: User, *, light: bool = False) -> SalesOrderResponse:
    resp = _order_response(db, so, user, light=light)
    # The Sales Orders features govern people who work on Sales › Sales Orders.
    # Someone reaching an order only through Sales › Delivery (confirm
    # delivery, link a build) keeps the full response, as before features.
    if can_view_tab(user, "sales", "orders"):
        if not light:
            _mask_sections(resp, user)
        if prices_hidden(user):
            _mask_prices(resp)
    return resp


def _order_response(db: Session, so: SalesOrder, user: User, *, light: bool = False) -> SalesOrderResponse:
    resp = SalesOrderResponse.model_validate(so)
    resp.display_number = so.display_number
    names = svc.user_names(db, [so.sales_owner_id, so.submitted_by_id, so.confirmed_by_id, so.created_by_id])
    resp.sales_owner_name = names.get(so.sales_owner_id)
    resp.submitted_by_name = names.get(so.submitted_by_id)
    resp.confirmed_by_name = names.get(so.confirmed_by_id)
    resp.created_by_name = names.get(so.created_by_id)
    if not so.customer_name:
        from app.modules.crm.models.organization import Organization
        resp.customer_name = db.query(Organization.name).filter(Organization.id == so.customer_id).scalar()
    resp.source_label = _source_label(db, so)
    rows = schedule_rows(db, so)
    live = [r for r in rows if r.status != "cancelled"]
    resp.units_total = int(sum(r.quantity for r in live))
    resp.units_delivered = int(sum(r.quantity for r in live if r.status in ("delivered", "commissioned")))
    resp.units_overdue = sum(1 for r in live if r.risk == "overdue")
    resp.units_at_risk = sum(1 for r in live if r.risk == "at_risk")
    open_dates = [r.current_delivery_date for r in live if r.current_delivery_date and r.status in svc.SALES_SCHEDULE_UNDELIVERED]
    resp.next_due_date = min(open_dates) if open_dates else None
    # Rows keep their own amounts; the order total respects the contract-value cap (svc.order_ld_cap).
    resp.ld_accrued = svc.clamp_order_ld(so, sum(r.ld_amount or 0 for r in live))
    resp.ld_forecast = svc.clamp_order_ld(so, sum(r.ld_forecast_amount or 0 for r in live))
    from app.modules.sales.approvals import ORDER_ENTITY, engine_state
    resp.approval_via_engine, resp.approval_stage, engine_names = engine_state(db, ORDER_ENTITY, so.id)
    if resp.approval_via_engine:
        resp.next_approvers = engine_names
    elif so.status == "pending_approval" and so.required_approval_level:
        lvl = svc.next_level(db, "sales_order", so.id, so.approval_round, so.required_approval_level)
        resp.next_approval_level = lvl
        if lvl:
            resp.next_approvers = [u.name or u.email for u in svc.level_holders(db, lvl) if u.id != so.submitted_by_id]
    if light:
        resp.lines, resp.schedules, resp.billing_lines = [], [], []
        return resp
    resp.schedules = rows
    if so.customer_contact_id:
        from app.modules.crm.models.organization import OrgContact
        resp.customer_contact_name = db.query(OrgContact.name).filter(OrgContact.id == so.customer_contact_id).scalar()
    if so.branch_id:
        from app.modules.organization.models.branch import Branch
        resp.branch_name = db.query(Branch.name).filter(Branch.id == so.branch_id).scalar()
    resp.approvals = _approval_responses(db, db.query(SalesApproval).filter(
        SalesApproval.entity_type == "sales_order", SalesApproval.entity_id == so.id).order_by(SalesApproval.id).all())
    resp.credit = svc.credit_position(db, so) if so.status in ("draft", "pending_approval") else None
    amend = db.query(SalesOrderAmendment.id).filter(
        SalesOrderAmendment.so_id == so.id, SalesOrderAmendment.status.in_(SALES_AMENDMENT_OPEN_STATUSES)).first()
    resp.open_amendment_id = amend[0] if amend else None
    from app.modules.sales.order_projects import project_for_order
    op = project_for_order(db, so.id)
    resp.order_project = {"id": op.id, "op_number": op.op_number, "status": op.status} if op else None
    resp.can = can_flags(db, so, user, via_engine=resp.approval_via_engine)
    return resp


def can_flags(db: Session, so: SalesOrder, user: User, via_engine: bool = False) -> dict:
    perm = lambda tab, act: can_perform(user, "sales", tab, act)  # noqa: E731
    head = svc.is_sales_head(db, user)
    is_maker = user.id in (so.created_by_id, so.submitted_by_id, so.sales_owner_id) or user.role == "admin"
    # Engine-routed orders are decided in <ApprovalPanel>; `approve` drives only the
    # old level-by-level buttons of orders submitted before the move.
    pending_level = (svc.next_level(db, "sales_order", so.id, so.approval_round, so.required_approval_level)
                     if so.status == "pending_approval" and so.required_approval_level and not via_engine else None)
    return {
        "edit": so.status == "draft" and perm("orders", "edit"),
        # Company delete rule: 'Delete' on Orders AND the creator (admins always).
        "delete": so.status == "draft" and perm("orders", "delete")
                  and (is_admin_user(user) or so.created_by_id in (None, user.id)),
        "submit": so.status == "draft" and perm("orders", "submit"),
        "approve": bool(pending_level) and perm("orders", "approve") and user.id != so.submitted_by_id
                   and (svc.holds_level(db, user, pending_level) or user.role == "admin"),
        "cancel": (so.status in ("draft", "pending_approval") and is_maker and perm("orders", "cancel"))
                  or (so.status == "confirmed" and head and perm("orders", "approve") and perm("orders", "cancel")),
        "hold": so.status in ("confirmed", "in_execution", "partially_delivered") and perm("orders", "edit"),
        "resume": so.status == "on_hold" and perm("orders", "edit"),
        "short_close": so.status in ("in_execution", "partially_delivered") and head and perm("orders", "approve"),
        "close": so.status == "delivered" and head and perm("orders", "approve"),
        "amend": so.status in ("confirmed", "in_execution", "partially_delivered", "on_hold") and perm("orders", "create")
                 and can_feature(user, "sales", "orders", "amendments", "create"),
        "issue_oa": bool(so.so_number) and so.status not in ("cancelled",) and perm("orders", "edit"),
        "link_build": so.status in ("confirmed", "in_execution", "partially_delivered", "on_hold") and perm("delivery", "edit"),
        "edit_schedule_contact": so.status not in ("draft", "cancelled", "closed", "short_closed") and perm("delivery", "edit"),
        "request_extension": so.status in ("confirmed", "in_execution", "partially_delivered", "on_hold") and perm("delivery", "create"),
        "decide_extension": perm("delivery", "approve"),
        # Mark delivered / commissioned (POD, commissioning certificate) — the delivery approver.
        "confirm_delivery": so.status in ("confirmed", "in_execution", "partially_delivered", "delivered", "on_hold", "short_closed", "closed")
                            and perm("delivery", "approve"),
        "reverse_delivery": is_admin_user(user),
        "request_invoice": so.status not in ("draft", "pending_approval", "cancelled") and perm("orders", "edit")
                           and can_feature(user, "sales", "orders", "billing_plan", "edit"),
        "mark_milestone_due": so.status not in ("draft", "pending_approval", "cancelled") and perm("orders", "edit")
                              and can_feature(user, "sales", "orders", "billing_plan", "edit"),
        "raise_invoice": so.status not in ("draft", "pending_approval", "cancelled")
                         and can_perform(user, "accounts", "sales_invoices", "create"),
    }


def _source_label(db: Session, so: SalesOrder) -> str | None:
    if so.source_inquiry_id:
        from app.modules.crm.models.inquiry import Inquiry
        uid = db.query(Inquiry.universal_id).filter(Inquiry.id == so.source_inquiry_id).scalar()
        return f"Inquiry {uid}" if uid else f"Inquiry #{so.source_inquiry_id}"
    if so.source_tender_id:
        from app.modules.crm.models.tender import Tender
        t = db.query(Tender).filter(Tender.id == so.source_tender_id).first()
        return f"Tender {t.tender_number or t.universal_id}" if t else f"Tender #{so.source_tender_id}"
    return "Direct order"


def amendment_response(db: Session, a: SalesOrderAmendment, so: SalesOrder | None = None, user: User | None = None) -> SalesOrderAmendmentResponse:
    """`user` given (read endpoints): amounts are blanked when they lack
    Sales › Sales Orders › Prices & margins (see prices_hidden)."""
    resp = _amendment_response(db, a, so)
    if user is not None and prices_hidden(user):
        resp.value_change = resp.new_grand_total = None
        proposed = dict(resp.proposed or {})
        if isinstance(proposed.get("lines"), list):
            proposed["lines"] = [{**ln, **{f: None for f in ("unit_price", "list_price", "discount_percent") if f in ln}} if isinstance(ln, dict) else ln
                                 for ln in proposed["lines"]]
        resp.proposed = proposed
    return resp


def _amendment_response(db: Session, a: SalesOrderAmendment, so: SalesOrder | None = None) -> SalesOrderAmendmentResponse:
    resp = SalesOrderAmendmentResponse.model_validate(a)
    so = so or db.query(SalesOrder).filter(SalesOrder.id == a.so_id).first()
    resp.so_display = so.display_number if so else None
    names = svc.user_names(db, [a.submitted_by_id, a.created_by_id])
    resp.submitted_by_name, resp.created_by_name = names.get(a.submitted_by_id), names.get(a.created_by_id)
    from app.modules.sales.approvals import AMENDMENT_ENTITY, engine_state
    resp.approval_via_engine, resp.approval_stage, _names = engine_state(db, AMENDMENT_ENTITY, a.id)
    if not resp.approval_via_engine and a.status == "pending_approval" and a.required_approval_level:
        resp.next_approval_level = svc.next_level(db, "sales_amendment", a.id, a.approval_round, a.required_approval_level)
    resp.approvals = _approval_responses(db, db.query(SalesApproval).filter(
        SalesApproval.entity_type == "sales_amendment", SalesApproval.entity_id == a.id).order_by(SalesApproval.id).all())
    return resp
