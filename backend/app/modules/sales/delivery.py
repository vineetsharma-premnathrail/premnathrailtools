"""Dispatch / delivery / commissioning against the Sales Order schedule
(SAP VL01N + PGI, proof of delivery, commissioning certificate).

Three ways an event is recorded — all through record_event(), so the
validations (over-delivery, order status, date order) are the same:

  * Store dispatch material issue (store/routes/material_issues.py) —
    on_store_dispatch(), the PGI: stock leaves through the Store.
  * Production RRV Handover stage (production/service.py apply_rrv_handover)
    — on_rrv_handover(): the vehicle is dispatched + delivered on the
    handover date, and commissioned when a commissioning date is given.
  * Sales "Mark delivered / commissioned" (routes/schedule.py) — the
    consignee's receipt (R-note / POD) and the commissioning certificate.

The row's dispatched_on / delivered_on / commissioned_on, qty_dispatched /
qty_delivered, references and warranty dates are derived from its live
events (apply_row_events); then svc.refresh_order re-derives the row status,
the order status (partially_delivered / delivered), freezes LD at the
reckoning date and moves the billing milestones (billing_plan.py)."""
from __future__ import annotations

import calendar
import logging
from datetime import date

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.sales import service as svc
from app.modules.sales.models.delivery import SalesDeliveryEvent, SALES_DELIVERY_EVENTS
from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule

logger = logging.getLogger("sales")

EPS = 1e-6
# Dispatch needs an order being executed and not on hold; a POD / commissioning
# of goods already sent is still recorded on a held or delivered order.
DISPATCH_STATUSES = ("confirmed", "in_execution", "partially_delivered")
ACK_STATUSES = ("confirmed", "in_execution", "partially_delivered", "delivered", "on_hold", "short_closed", "closed")
EVENT_LABEL = {"dispatch": "Dispatch", "delivery": "Delivery", "commissioning": "Commissioning"}


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def events_of(db: Session, so_id: int, schedule_id: int | None = None) -> list[SalesDeliveryEvent]:
    q = db.query(SalesDeliveryEvent).filter(SalesDeliveryEvent.so_id == so_id)
    if schedule_id:
        q = q.filter(SalesDeliveryEvent.schedule_id == schedule_id)
    return q.order_by(SalesDeliveryEvent.event_date, SalesDeliveryEvent.id).all()


def _line(so: SalesOrder, row: SalesOrderSchedule):
    return next((ln for ln in so.lines if ln.id == row.so_line_id), None)


def row_label(so: SalesOrder, row: SalesOrderSchedule) -> str:
    ln = _line(so, row)
    if ln and ln.line_type == "rrv":
        return f"{so.display_number} vehicle {row.sequence}"
    return f"{so.display_number} line {ln.line_number if ln else '?'} lot {row.sequence}"


def warranty_dates(so: SalesOrder, row: SalesOrderSchedule) -> tuple[date | None, date | None]:
    """Warranty per the contract's rule. 'earlier_of' / 'later_of' compare
    the delivery-based and the commissioning-based end; while commissioning
    is pending the delivery-based end stands (provisional)."""
    rule = so.warranty_rule or "from_delivery"
    if rule == "not_applicable":
        return None, None
    md, mc = so.warranty_months_from_delivery, so.warranty_months_from_commissioning
    end_d = add_months(row.delivered_on, md) if row.delivered_on and md else None
    end_c = add_months(row.commissioned_on, mc) if row.commissioned_on and mc else None
    if rule == "from_delivery":
        return row.delivered_on, end_d
    if rule == "from_commissioning":
        return (row.commissioned_on, end_c) if row.commissioned_on else (None, None)
    ends = [e for e in (end_d, end_c) if e]
    if not ends:
        return row.delivered_on, None
    return row.delivered_on, (min(ends) if rule == "earlier_of" else max(ends))


def apply_row_events(so: SalesOrder, row: SalesOrderSchedule, events: list[SalesDeliveryEvent]) -> None:
    evs = [e for e in events if e.schedule_id == row.id]
    if not evs:
        return  # no event ever recorded — nothing to derive (keeps imported dates)
    live = [e for e in evs if e.reversed_at is None]
    qty = float(row.quantity or 0)

    def total(kind):
        rows = [e for e in live if e.event == kind]
        return rows, round(sum(float(e.quantity or 0) for e in rows), 4)

    disp, dq = total("dispatch")
    deliv, cq = total("delivery")
    comm, _ = total("commissioning")
    row.qty_dispatched = min(dq, qty)
    row.qty_delivered = min(cq, row.qty_dispatched)
    row.dispatched_on = max(e.event_date for e in disp) if disp and dq >= qty - EPS else None
    row.dispatch_reference = disp[-1].reference if disp else None
    row.delivered_on = max(e.event_date for e in deliv) if deliv and cq >= qty - EPS else None
    row.delivery_reference = deliv[-1].reference if deliv else None
    row.commissioned_on = max(e.event_date for e in comm) if comm and row.delivered_on else None
    row.commissioning_reference = comm[-1].reference if comm else None
    row.warranty_start, row.warranty_end = warranty_dates(so, row)


def _machine_id(db: Session, row: SalesOrderSchedule) -> int | None:
    if row.erp_project_id:
        return row.erp_project_id
    build = svc._build(db, row.rrv_build_id)
    return build.erp_project_id if build else None


def _sync_machine(db: Session, so: SalesOrder, row: SalesOrderSchedule) -> None:
    """Fill the ERP machine's delivery / commissioning / warranty dates where
    they are still empty (Production's handover writes them itself)."""
    pid = _machine_id(db, row)
    if not pid:
        return
    from app.modules.erp.models.project import Project
    m = db.query(Project).filter(Project.id == pid).first()
    if not m:
        return
    if row.delivered_on and not m.delivery_date:
        m.delivery_date = row.delivered_on
    if row.commissioned_on and not m.commissioning_date:
        m.commissioning_date = row.commissioned_on
    if row.warranty_start and not m.warranty_start_date:
        m.warranty_start_date = row.warranty_start
    if row.warranty_end and not m.warranty_end_date:
        m.warranty_end_date = row.warranty_end


def refresh_rows(db: Session, so: SalesOrder) -> None:
    events = events_of(db, so.id)
    for row in so.schedules:
        apply_row_events(so, row, events)


def record_event(db: Session, so: SalesOrder, row: SalesOrderSchedule, event: str, *, on: date, quantity: float | None = None,
                 reference: str | None = None, remarks: str | None = None, source: str = "manual", user: User | None = None,
                 material_issue_id: int | None = None, rrv_build_id: int | None = None, strict: bool = True) -> SalesDeliveryEvent:
    """Validates and books one event, then re-derives the row and the order."""
    if event not in SALES_DELIVERY_EVENTS:
        raise svc.SalesError(422, f"Unknown delivery event '{event}' — use one of: {', '.join(SALES_DELIVERY_EVENTS)}.")
    label = row_label(so, row)
    if row.so_id != so.id:
        raise svc.SalesError(422, f"Delivery row #{row.id} isn't on {so.display_number} — pick the row again.")
    if row.status == "cancelled":
        raise svc.SalesError(409, f"{label} is cancelled — nothing can be dispatched or delivered against it.")
    allowed = DISPATCH_STATUSES if event == "dispatch" else ACK_STATUSES
    if strict and so.status not in allowed:
        hint = " Resume the order first." if so.status == "on_hold" else ""
        raise svc.SalesError(409, f"Can't record a {event} on {so.display_number}: it's {svc.STATUS_LABEL.get(so.status, so.status)}.{hint}")
    if not on:
        raise svc.SalesError(422, f"Enter the {event} date.")
    if on > svc.today_ist():
        raise svc.SalesError(422, f"The {event} date {on:%d-%m-%Y} is in the future — record it on or after the day it happens.")
    if strict and so.customer_po_date and on < so.customer_po_date:
        raise svc.SalesError(422, f"The {event} date {on:%d-%m-%Y} is before the customer's PO date {so.customer_po_date:%d-%m-%Y}.")
    refresh_rows(db, so)
    row_qty = float(row.quantity or 0)
    dispatched, delivered = float(row.qty_dispatched or 0), float(row.qty_delivered or 0)
    if event == "dispatch":
        open_qty = round(row_qty - dispatched, 4)
        qty = open_qty if quantity is None else float(quantity)
        if open_qty <= EPS:
            raise svc.SalesError(409, f"{label} is already fully dispatched ({dispatched:g} of {row_qty:g}).")
        if qty <= 0 or qty > open_qty + EPS:
            raise svc.SalesError(422, f"{label}: {qty:g} can't be dispatched — only {open_qty:g} of {row_qty:g} is still open "
                                      f"(over-delivery against the order isn't allowed; an extra quantity needs an amendment).")
    elif event == "delivery":
        open_qty = round(dispatched - delivered, 4)
        qty = open_qty if quantity is None else float(quantity)
        if open_qty <= EPS:
            what = "already fully delivered" if delivered >= row_qty - EPS else "not dispatched yet — post the Store dispatch issue first"
            raise svc.SalesError(409, f"{label} is {what}.")
        if qty <= 0 or qty > open_qty + EPS:
            raise svc.SalesError(422, f"{label}: {qty:g} can't be confirmed as delivered — {open_qty:g} is dispatched and not yet delivered.")
        last_dispatch = max((e.event_date for e in events_of(db, so.id, row.id)
                             if e.event == "dispatch" and e.reversed_at is None), default=None)
        if last_dispatch and on < last_dispatch:
            raise svc.SalesError(422, f"Delivery date {on:%d-%m-%Y} is before the dispatch on {last_dispatch:%d-%m-%Y}.")
    else:
        qty = row_qty
        if not row.delivered_on:
            raise svc.SalesError(409, f"{label} isn't fully delivered yet — confirm the delivery before commissioning.")
        if row.commissioned_on:
            raise svc.SalesError(409, f"{label} was already commissioned on {row.commissioned_on:%d-%m-%Y}.")
        if on < row.delivered_on:
            raise svc.SalesError(422, f"Commissioning date {on:%d-%m-%Y} is before the delivery on {row.delivered_on:%d-%m-%Y}.")
    ev = SalesDeliveryEvent(
        so_id=so.id, schedule_id=row.id, so_line_id=row.so_line_id, event=event, quantity=round(qty, 4), event_date=on,
        reference=(reference or "").strip()[:150] or None, remarks=(remarks or "").strip() or None, source=source,
        material_issue_id=material_issue_id, rrv_build_id=rrv_build_id, created_by_id=user.id if user else None,
    )
    db.add(ev)
    db.flush()
    after_change(db, so)
    return ev


def after_change(db: Session, so: SalesOrder) -> None:
    refresh_rows(db, so)
    svc.refresh_order(db, so)
    for row in so.schedules:
        _sync_machine(db, so, row)
    # Project units follow the delivery events (dispatched / delivered).
    from app.modules.projects.so_projects import refresh_order_project
    refresh_order_project(db, so)
    db.flush()


def mark_delivered(db: Session, so: SalesOrder, row: SalesOrderSchedule, *, on: date, reference: str | None,
                   quantity: float | None = None, remarks: str | None = None, user: User) -> None:
    """Sales "Mark delivered" (POD). A vehicle handed over without a Store
    dispatch is dispatched on the same date; a spares lot must have gone
    through the Store dispatch issue first (that is what relieves stock)."""
    if not (reference or "").strip():
        raise svc.SalesError(422, "Enter the delivery reference — the consignee's receipt / R-note / POD number.")
    refresh_rows(db, so)
    ln = _line(so, row)
    open_dispatch = round(float(row.quantity or 0) - float(row.qty_dispatched or 0), 4)
    if ln and ln.line_type == "rrv" and open_dispatch > EPS:
        record_event(db, so, row, "dispatch", on=on, quantity=open_dispatch, reference=reference, remarks=remarks,
                     source="manual", user=user)
    record_event(db, so, row, "delivery", on=on, quantity=quantity, reference=reference, remarks=remarks, source="manual", user=user)


def mark_commissioned(db: Session, so: SalesOrder, row: SalesOrderSchedule, *, on: date, reference: str | None,
                      remarks: str | None = None, user: User) -> None:
    if not (reference or "").strip():
        raise svc.SalesError(422, "Enter the commissioning reference — the commissioning certificate / report number.")
    record_event(db, so, row, "commissioning", on=on, reference=reference, remarks=remarks, source="manual", user=user)


def reverse_event(db: Session, so: SalesOrder, ev: SalesDeliveryEvent, *, reason: str, user: User) -> None:
    """Admin undo with a reason. Later steps must be undone first, and a
    delivery that was already invoiced can't be undone."""
    if ev.reversed_at:
        raise svc.SalesError(409, "This event is already reversed.")
    if not (reason or "").strip():
        raise svc.SalesError(422, "Give the reason for reversing it — it's kept on the order's delivery history.")
    later = {"dispatch": ("delivery", "commissioning"), "delivery": ("commissioning",), "commissioning": ()}[ev.event]
    row = next((r for r in so.schedules if r.id == ev.schedule_id), None)
    others = [e for e in events_of(db, so.id, ev.schedule_id) if e.reversed_at is None and e.id != ev.id]
    remaining_kind = round(sum(float(e.quantity or 0) for e in others if e.event == ev.event), 4)
    for k in later:
        need = round(sum(float(e.quantity or 0) for e in others if e.event == k), 4)
        if k == "commissioning" and need:
            need = float(row.quantity or 0) if row else need
        if need > remaining_kind + EPS:
            raise svc.SalesError(409, f"Reverse the {k} of this row first — it depends on this {ev.event}.")
    from app.modules.accounts.services import billing
    billed = billing.invoiced_units_for_row(db, ev.schedule_id, ev.event)
    if billed > remaining_kind + EPS:
        raise svc.SalesError(409, f"{billed:g} unit(s) of this {ev.event} are already invoiced — cancel the draft invoice or "
                                  f"raise a credit note in Finance first, then reverse it.")
    ev.reversed_at, ev.reversed_by_id, ev.reverse_reason = svc.now_utc(), user.id, reason.strip()
    db.flush()
    after_change(db, so)


# ---------------------------------------------------------------- hooks from Store / Production

def _order_for_update(db: Session, so_id: int) -> SalesOrder:
    from app.modules.sales.views import get_order
    db.query(SalesOrder.id).filter(SalesOrder.id == so_id).with_for_update().first()
    return get_order(db, so_id)


def rows_for_machine(db: Session, erp_project_id: int) -> list[SalesOrderSchedule]:
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    build_ids = [b for (b,) in db.query(ProductionRrvBuild.id).filter(ProductionRrvBuild.erp_project_id == erp_project_id).all()]
    q = db.query(SalesOrderSchedule).filter(SalesOrderSchedule.status != "cancelled")
    rows = q.filter(SalesOrderSchedule.erp_project_id == erp_project_id).all()
    if build_ids:
        rows += [r for r in q.filter(SalesOrderSchedule.rrv_build_id.in_(build_ids)).all() if r not in rows]
    return rows


def on_store_dispatch(db: Session, issue, items: list[dict], *, sales_order_id: int | None, user: User) -> list[str]:
    """PGI: a Store dispatch issue posts the dispatch on the SO schedule.
    Each item may name its delivery row (sales_schedule_id); without any, an
    issue against a machine that sits on exactly one open delivery row is
    booked to that row. Returns notes for the issue's response."""
    from app.modules.store.models.item import StoreItem
    linked = [it for it in items if it.get("sales_schedule_id")]
    reference = issue.challan_number or issue.issue_number
    notes = []
    if not linked:
        if sales_order_id:
            raise svc.SalesError(422, "Pick the delivery row (vehicle / lot) of the sales order on each dispatched item.")
        if not issue.erp_project_id:
            return notes
        rows = [r for r in rows_for_machine(db, issue.erp_project_id)
                if float(r.quantity or 0) - float(r.qty_dispatched or 0) > EPS]
        if len(rows) != 1:
            return notes
        so = _order_for_update(db, rows[0].so_id)
        if so.status not in DISPATCH_STATUSES:
            return notes
        row = next(r for r in so.schedules if r.id == rows[0].id)
        record_event(db, so, row, "dispatch", on=issue.issue_date, reference=reference, source="store_issue", user=user,
                     material_issue_id=issue.id)
        return [f"Dispatch booked on {row_label(so, row)}."]
    per_row: dict[int, float] = {}
    for it in linked:
        per_row[int(it["sales_schedule_id"])] = per_row.get(int(it["sales_schedule_id"]), 0.0) + float(it.get("quantity") or 0)
    items_by_row: dict[int, set[int]] = {}
    for it in linked:
        items_by_row.setdefault(int(it["sales_schedule_id"]), set()).add(int(it["item_id"]))
    for sid, qty in sorted(per_row.items()):
        row0 = db.query(SalesOrderSchedule).filter(SalesOrderSchedule.id == sid).first()
        if not row0:
            raise svc.SalesError(404, f"Delivery row #{sid} doesn't exist — reload the sales order and pick the row again.")
        if sales_order_id and row0.so_id != sales_order_id:
            raise svc.SalesError(422, f"Delivery row #{sid} belongs to a different sales order than the one picked on the issue.")
        so = _order_for_update(db, row0.so_id)
        row = next(r for r in so.schedules if r.id == sid)
        ln = _line(so, row)
        if ln and ln.product_item_id and items_by_row[sid] != {ln.product_item_id}:
            want = db.query(StoreItem).filter(StoreItem.id == ln.product_item_id).first()
            raise svc.SalesError(422, f"{row_label(so, row)} is for {want.item_name if want else 'another item'} — "
                                      f"dispatch that item against it (order line {ln.line_number}).")
        record_event(db, so, row, "dispatch", on=issue.issue_date, quantity=qty, reference=reference, source="store_issue",
                     user=user, material_issue_id=issue.id)
        notes.append(f"Dispatch of {qty:g} booked on {row_label(so, row)}.")
    return notes


def on_rrv_handover(db: Session, build, user: User | None = None) -> None:
    """Production's Handover stage = the vehicle is dispatched and delivered on
    the handover date (and commissioned, when a commissioning date is given).
    Never blocks the handover: a problem is logged and Sales records it by hand."""
    row0 = db.query(SalesOrderSchedule).filter(SalesOrderSchedule.rrv_build_id == build.id,
                                                SalesOrderSchedule.status != "cancelled").first()
    if not row0 or not build.handover_date:
        return
    try:
        so = _order_for_update(db, row0.so_id)
        if so.status in ("draft", "pending_approval", "cancelled"):
            return
        row = next(r for r in so.schedules if r.id == row0.id)
        if user is None and build.handed_over_by_id:
            user = db.query(User).filter(User.id == build.handed_over_by_id).first()
        ref = f"Handover {build.build_number}" + (f" to {build.handed_over_to_name}" if getattr(build, "handed_over_to_name", None) else "")
        refresh_rows(db, so)
        if float(row.quantity or 0) - float(row.qty_dispatched or 0) > EPS:
            record_event(db, so, row, "dispatch", on=build.handover_date, reference=ref, source="rrv_handover", user=user,
                         rrv_build_id=build.id, strict=False)
        if float(row.qty_dispatched or 0) - float(row.qty_delivered or 0) > EPS:
            record_event(db, so, row, "delivery", on=build.handover_date, reference=ref, source="rrv_handover", user=user,
                         rrv_build_id=build.id, strict=False)
        if build.commissioning_date and not row.commissioned_on and build.commissioning_date >= (row.delivered_on or build.handover_date):
            record_event(db, so, row, "commissioning", on=min(build.commissioning_date, svc.today_ist()),
                         reference=f"Commissioning {build.build_number}", source="rrv_handover", user=user,
                         rrv_build_id=build.id, strict=False)
    except svc.SalesError as e:
        logger.warning("RRV handover %s not booked on the sales order: %s", build.build_number, e.detail)
