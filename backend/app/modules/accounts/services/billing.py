"""Sales Order billing (SAP VF01 / VF04): the AR sales invoice raised with
reference to a Sales Order billing milestone, and the billing due list.

  * create_invoice_from_so() copies customer, GSTIN, place of supply, the
    customer PO and the SO lines (store item, HSN, UOM, net rate, GST rate)
    into a draft sales invoice through the normal create_ar_transaction —
    numbering, GST split, approval and GL posting stay in accounts/service.py.
    Each invoice line is linked to its SO line + milestone (+ delivery row)
    in sales_invoice_links.
  * Quantity / amount caps: an order-level milestone (advance, drawing
    approval, inspection, retention, other) bills at most its amount; a
    delivery-linked milestone (dispatch, delivery, commissioning) bills only
    units that reached that event and were not billed yet for it
    (delivered − invoiced), at the milestone percent of the net unit price.
  * sync_order() re-derives SalesOrderLine.qty_invoiced and
    SalesBillingPlanLine.invoiced_amount / triggered_at / status from the
    live links: drafts reserve the cap, posted invoices count (net of posted
    credit notes against them), cancelled ones drop out. It runs on every
    sales refresh_order and from the AR post / cancel and credit-note hooks.

Milestone triggers (VF04): advance on SO confirmation; dispatch / delivery /
commissioning when a delivery row reaches it (sales/delivery.py events);
retention_release when every unit's warranty has ended; inspection when a
third-party inspection call on the order's machine is accepted (Quality
hook, trigger_event); drawing_approval / other through Sales "Mark due".
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

logger = logging.getLogger("sales")

ROW_MILESTONES = ("dispatch", "delivery", "commissioning")
MANUAL_MILESTONES = ("drawing_approval", "inspection", "other")
BILLABLE_ORDER_STATUSES = ("confirmed", "in_execution", "partially_delivered", "delivered", "on_hold", "short_closed", "closed")
TOL = 0.5  # rupees: paisa rounding of per-line GST against the milestone amount
MILESTONE_LABEL = {
    "advance": "Advance", "drawing_approval": "On drawing approval", "inspection": "On inspection", "dispatch": "On dispatch",
    "delivery": "On delivery", "commissioning": "On commissioning", "retention_release": "Retention release", "other": "Milestone",
}
_IST = timezone(timedelta(hours=5, minutes=30))


class BillingError(ValueError):
    """A business-rule failure; the message is shown to the user as is."""


def _as_dt(d: date) -> datetime:
    return datetime.combine(d, time(12, 0), tzinfo=_IST)


def _d(dt: datetime | None) -> date | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_IST).date()


def net_unit(line) -> float:
    q = float(line.quantity or 0)
    return float(line.taxable_amount or 0) / q if q else 0.0


# ---------------------------------------------------------------- links

def _links(db: Session, so_id: int):
    """[(link, invoice)] of the order, cancelled invoices included."""
    from app.modules.accounts.models.ar_transaction import ARTransaction
    from app.modules.sales.models.delivery import SalesInvoiceLink
    rows = db.query(SalesInvoiceLink, ARTransaction).join(ARTransaction, ARTransaction.id == SalesInvoiceLink.ar_transaction_id) \
        .filter(SalesInvoiceLink.so_id == so_id).all()
    return rows


def _credit_factor(db: Session, invoices) -> dict[int, float]:
    """Share of each posted invoice's taxable value still standing after the
    posted credit notes against it (1.0 = none)."""
    from app.modules.accounts.models.party_note import PartyNote
    ids = [i.id for i in invoices if i.status == "posted"]
    if not ids:
        return {}
    credited: dict[int, float] = {}
    for n in db.query(PartyNote).filter(PartyNote.note_type == "credit_note", PartyNote.status == "posted",
                                        PartyNote.ar_transaction_id.in_(ids)).all():
        credited[n.ar_transaction_id] = credited.get(n.ar_transaction_id, 0.0) + float(n.taxable_amount or 0)
    out = {}
    for i in invoices:
        if i.id in ids:
            base = float(i.invoice_amount or 0)
            out[i.id] = max(0.0, 1 - credited.get(i.id, 0.0) / base) if base else 1.0
    return out


def milestones_with_invoices(db: Session, billing_line_ids) -> set[int]:
    from app.modules.accounts.models.ar_transaction import ARTransaction
    from app.modules.sales.models.delivery import SalesInvoiceLink
    ids = [i for i in billing_line_ids if i]
    if not ids:
        return set()
    return {b for (b,) in db.query(SalesInvoiceLink.billing_plan_line_id).join(
        ARTransaction, ARTransaction.id == SalesInvoiceLink.ar_transaction_id).filter(
        SalesInvoiceLink.billing_plan_line_id.in_(ids), ARTransaction.status != "cancelled").distinct().all()}


def invoiced_units_for_row(db: Session, schedule_id: int, event: str) -> float:
    """Units of a delivery row billed (draft or posted) on a milestone of the
    event's type — a dispatch / delivery / commissioning can't be undone below it."""
    from app.modules.accounts.models.ar_transaction import ARTransaction
    from app.modules.sales.models.delivery import SalesInvoiceLink
    from app.modules.sales.models.order import SalesBillingPlanLine
    rows = db.query(SalesInvoiceLink.quantity).join(ARTransaction, ARTransaction.id == SalesInvoiceLink.ar_transaction_id) \
        .join(SalesBillingPlanLine, SalesBillingPlanLine.id == SalesInvoiceLink.billing_plan_line_id) \
        .filter(SalesInvoiceLink.schedule_id == schedule_id, ARTransaction.status != "cancelled",
                SalesBillingPlanLine.milestone_type == event).all()
    return round(sum(float(q or 0) for (q,) in rows), 4)


# ---------------------------------------------------------------- what each milestone can bill

def _events(db: Session, so_id: int):
    from app.modules.sales.models.delivery import SalesDeliveryEvent
    return db.query(SalesDeliveryEvent).filter(SalesDeliveryEvent.so_id == so_id, SalesDeliveryEvent.reversed_at.is_(None)).all()


def reached(row, kind: str, events) -> tuple[float, date | None]:
    """(units of the row that reached dispatch / delivery / commissioning, first date)."""
    evs = [e for e in events if e.schedule_id == row.id and e.event == kind]
    if evs:
        q = min(sum(float(e.quantity or 0) for e in evs), float(row.quantity or 0))
        if kind == "commissioning":
            q = float(row.quantity or 0)
        return round(q, 4), min(e.event_date for e in evs)
    d = {"dispatch": row.dispatched_on, "delivery": row.delivered_on, "commissioning": row.commissioned_on}[kind]
    return (float(row.quantity or 0), d) if d else (0.0, None)


def _row_label(so, row, lines) -> str:
    ln = lines.get(row.so_line_id)
    if ln and ln.line_type == "rrv":
        return f"Vehicle {row.sequence}"
    return f"Line {ln.line_number if ln else '?'} lot {row.sequence}"


def milestone_views(db: Session, so, *, as_of: date | None = None) -> list[dict]:
    """Per live milestone: amounts invoiced (posted) / reserved (drafts), when
    it fell due, what can be billed now (per delivery row for the
    delivery-linked ones)."""
    from app.modules.sales.legacy import today_ist
    as_of = as_of or today_ist()
    lines = {ln.id: ln for ln in so.lines}
    events = _events(db, so.id)
    links = _links(db, so.id)
    factors = _credit_factor(db, {inv.id: inv for _l, inv in links}.values())
    out = []
    live_rows = [r for r in so.schedules if r.status != "cancelled"]
    for b in so.billing_lines:
        if b.status == "cancelled":
            continue
        pct = float(b.percent or 0) / 100
        mine = [(l, inv) for l, inv in links if l.billing_plan_line_id == b.id and inv.status != "cancelled"]
        invoiced = sum((float(l.taxable_amount) + float(l.gst_amount)) * factors.get(inv.id, 1.0)
                       for l, inv in mine if inv.status == "posted")
        reserved = sum(float(l.taxable_amount) + float(l.gst_amount) for l, inv in mine if inv.status == "pending")
        view = {
            "billing_line_id": b.id, "so_id": so.id, "so_number": so.so_number, "so_display": so.display_number,
            "customer_id": so.customer_id, "customer_name": so.customer_name, "sequence": b.sequence,
            "milestone_type": b.milestone_type, "milestone_label": b.description or MILESTONE_LABEL.get(b.milestone_type, b.milestone_type),
            "percent": float(b.percent or 0), "amount": float(b.amount or 0), "invoiced_amount": round(invoiced, 2),
            "reserved_amount": round(reserved, 2), "status": b.status, "triggered_on": _d(b.triggered_at),
            "due_days": b.due_days, "due_date": None, "overdue": False, "due_amount": 0.0, "rows": [],
            "recovers_advance_percent": b.recovers_advance_percent, "row_linked": b.milestone_type in ROW_MILESTONES,
            "invoice_requested_at": b.invoice_requested_at,
            "invoices": sorted({(inv.id, inv.invoice_number, inv.status) for _l, inv in mine}),
        }
        if b.milestone_type in ROW_MILESTONES:
            due = 0.0
            for r in live_rows:
                units, on = reached(r, b.milestone_type, events)
                billed = round(sum(float(l.quantity or 0) for l, _inv in mine if l.schedule_id == r.id), 4)
                ln = lines.get(r.so_line_id)
                if not ln or not units:
                    continue
                billable = round(max(units - billed, 0.0), 4)
                amt = round(billable * net_unit(ln) * pct * (1 + float(ln.gst_rate or 0) / 100), 2)
                due += amt
                view["rows"].append({"schedule_id": r.id, "label": _row_label(so, r, lines), "line_number": ln.line_number,
                                     "event_date": on, "units_reached": units, "units_billed": billed,
                                     "billable_units": billable, "billable_amount": amt})
            # Never more than what is left of the milestone.
            view["due_amount"] = round(max(min(due, float(b.amount or 0) - invoiced - reserved), 0.0), 2)
        elif b.triggered_at:
            view["due_amount"] = round(max(float(b.amount or 0) - invoiced - reserved, 0.0), 2)
        if view["triggered_on"]:
            dd = view["triggered_on"] + timedelta(days=int(b.due_days or 0))
            view["due_date"] = dd
            view["overdue"] = view["due_amount"] > TOL and dd < as_of
        out.append(view)
    return out


# ---------------------------------------------------------------- sync (triggers + invoiced amounts + status)

def _trigger_date(so, b, events, as_of: date) -> date | None:
    t = b.milestone_type
    if t == "advance":
        return _d(so.confirmed_at)
    if t in ROW_MILESTONES:
        dates = [reached(r, t, events)[1] for r in so.schedules if r.status != "cancelled"]
        dates = [d for d in dates if d]
        return min(dates) if dates else None
    if t == "retention_release":
        live = [r for r in so.schedules if r.status != "cancelled"]
        ends = [r.warranty_end for r in live]
        if live and all(ends) and max(ends) <= as_of:
            return max(ends)
        return None
    return _d(b.triggered_at)  # manual / hook-driven: keep what was set


def sync_order(db: Session, so, as_of: date | None = None) -> None:
    from app.modules.sales.legacy import today_ist
    if so.status in ("draft", "pending_approval", "cancelled"):
        return
    as_of = as_of or today_ist()
    events = _events(db, so.id)
    links = _links(db, so.id)
    factors = _credit_factor(db, {inv.id: inv for _l, inv in links}.values())
    # Order line billed quantity (value-equivalent units on posted invoices, net of credit notes).
    for ln in so.lines:
        nu = net_unit(ln)
        billed = sum(float(l.taxable_amount) * factors.get(inv.id, 1.0) for l, inv in links
                     if l.so_line_id == ln.id and inv.status == "posted")
        ln.qty_invoiced = round(billed / nu, 4) if nu else 0
    newly_due = []
    for b in so.billing_lines:
        if b.status == "cancelled":
            continue
        on = _trigger_date(so, b, events, as_of)
        mine = [(l, inv) for l, inv in links if l.billing_plan_line_id == b.id and inv.status != "cancelled"]
        if on:
            if not b.triggered_at or _d(b.triggered_at) != on:
                b.triggered_at = _as_dt(on)
        elif b.milestone_type not in MANUAL_MILESTONES and not mine:
            b.triggered_at = None  # e.g. a reversed dispatch
        posted = [(l, inv) for l, inv in mine if inv.status == "posted"]
        b.invoiced_amount = round(sum((float(l.taxable_amount) + float(l.gst_amount)) * factors.get(inv.id, 1.0)
                                      for l, inv in posted), 2)
        old = b.status
        remaining = float(b.amount or 0) - float(b.invoiced_amount or 0)
        if float(b.amount or 0) > 0 and remaining <= TOL:
            settled = posted and all(float(inv.amount_due or 0) <= 0.005 for _l, inv in posted)
            b.status = "settled" if settled else "invoiced"
        elif not b.triggered_at:
            b.status = "not_due"
        elif b.invoice_requested_at:
            b.status = "invoice_requested"
        else:
            b.status = "due"
        if old == "not_due" and b.status in ("due", "invoice_requested"):
            newly_due.append(b)
    live = [b for b in so.billing_lines if b.status != "cancelled"]
    if so.status == "delivered" and live and all(b.status == "settled" for b in live):
        so.status = "closed"
        so.close_reason = "Closed automatically — every unit delivered and every billing milestone invoiced and collected."
    db.flush()
    if newly_due:
        _notify_due(db, so, newly_due)


def _notify_due(db: Session, so, milestones) -> None:
    from app.utils.notifications import broadcast_notification
    names = ", ".join(f"{b.percent:g}% {MILESTONE_LABEL.get(b.milestone_type, b.milestone_type).lower()}" for b in milestones)
    try:
        broadcast_notification(
            db, f"Billing due: {so.display_number}", f"{so.customer_name or 'Customer'} — {names} can be invoiced "
            f"(Finance › Sales › Billing due).", "sales_billing_due", entity_type="sales_order", entity_id=so.id,
            app_name="accounts")
    except Exception:  # pragma: no cover — a notification never blocks billing
        logger.exception("Failed to notify billing due for %s", so.display_number)


def trigger_event(db: Session, so, milestone_type: str, *, on: date, user_id: int | None = None) -> list:
    """Marks the order-level milestones of a type due (drawing approval,
    inspection, other). Used by Sales "Mark due" and the Quality hook."""
    hit = []
    for b in so.billing_lines:
        if b.milestone_type == milestone_type and b.status != "cancelled" and not b.triggered_at:
            b.triggered_at = _as_dt(on)
            hit.append(b)
    if hit:
        sync_order(db, so)
    return hit


def on_inspection_accepted(db: Session, *, erp_project_id: int | None, on: date | None) -> None:
    """Quality hook: an accepted (or partly accepted) third-party inspection
    call on a machine makes the 'inspection' milestone of its order due."""
    if not erp_project_id:
        return
    from app.modules.sales.legacy import rows_for_machine
    from app.modules.sales.legacy import get_order
    from app.modules.sales.legacy import today_ist
    for so_id in {r.so_id for r in rows_for_machine(db, erp_project_id)}:
        try:
            so = get_order(db, so_id)
        except Exception:
            continue
        if so.status in BILLABLE_ORDER_STATUSES:
            trigger_event(db, so, "inspection", on=on or today_ist())


def on_ar_changed(db: Session, ar_transaction_id: int | None) -> None:
    """Accounts hook: an SO invoice was posted / cancelled, or a credit note
    against it was posted — re-derive the order's billed amounts."""
    if not ar_transaction_id:
        return
    from app.modules.sales.models.delivery import SalesInvoiceLink
    from app.modules.sales.models.order import SalesOrder
    for (so_id,) in db.query(SalesInvoiceLink.so_id).filter(SalesInvoiceLink.ar_transaction_id == ar_transaction_id).distinct().all():
        so = db.query(SalesOrder).filter(SalesOrder.id == so_id).first()
        if so:
            sync_order(db, so)
    # FI down-payment clearing (F-39): a posted milestone invoice that
    # recovers advance adjusts the SO's open customer advance against itself.
    from app.modules.accounts.services.vouchers import apply_so_advance_recovery
    apply_so_advance_recovery(db, ar_transaction_id=ar_transaction_id)


def open_billing_problems(db: Session, so) -> list[str]:
    """What still stands between a delivered order and closing it."""
    out = []
    for v in milestone_views(db, so):
        if v["status"] not in ("invoiced", "settled"):
            left = v["amount"] - v["invoiced_amount"]
            out.append(f"milestone {v['sequence']} ({v['percent']:g}% {v['milestone_label'].lower()}) has ₹{left:,.2f} not invoiced")
    return out


# ---------------------------------------------------------------- create the invoice (VF01)

def advance_adjustment_hook(db: Session, so, milestone, invoice) -> None:
    """Hook for the advance-recovery set-off (Finance › receipts & advances):
    a milestone with recovers_advance_percent should adjust that share of the
    customer's unallocated advance against `invoice`. The invoice is still a
    draft here, so the set-off itself runs when it is posted (on_ar_changed
    -> vouchers.apply_so_advance_recovery); a posted invoice is set off now."""
    if getattr(invoice, "status", None) == "posted":
        from app.modules.accounts.services.vouchers import apply_so_advance_recovery
        apply_so_advance_recovery(db, ar_transaction_id=invoice.id)
    return None


def create_invoice_from_so(db: Session, *, so_id: int, billing_plan_line_id: int, schedule_ids: list[int] | None = None,
                           invoice_date: date, created_by_id: int, narration: str | None = None, round_off: float = 0,
                           eway_bill_no: str | None = None, eway_bill_date: date | None = None, vehicle_no: str | None = None):
    from app.modules.accounts.models.ar_transaction import ARTransactionLine
    from app.modules.accounts.service import create_ar_transaction
    from app.modules.sales.models.delivery import SalesInvoiceLink
    from app.modules.sales.models.order import SalesOrder
    from app.modules.sales.legacy import get_order

    db.query(SalesOrder.id).filter(SalesOrder.id == so_id).with_for_update().first()
    so = get_order(db, so_id)
    if so.status not in BILLABLE_ORDER_STATUSES:
        raise BillingError(f"{so.display_number} is {so.status.replace('_', ' ')} — only a confirmed order is invoiced.")
    b = next((x for x in so.billing_lines if x.id == billing_plan_line_id), None)
    if not b:
        raise BillingError(f"Billing milestone #{billing_plan_line_id} isn't on {so.display_number} — reload the order and pick it again.")
    if b.status == "cancelled":
        raise BillingError(f"Milestone {b.sequence} of {so.display_number} is cancelled.")
    sync_order(db, so)
    view = next(v for v in milestone_views(db, so) if v["billing_line_id"] == b.id)
    label = view["milestone_label"]
    pct = float(b.percent or 0) / 100
    lines_by_id = {ln.id: ln for ln in so.lines}
    left = round(float(b.amount or 0) - view["invoiced_amount"] - view["reserved_amount"], 2)
    if left <= TOL:
        drafts = [n for _i, n, s in view["invoices"] if s == "pending"]
        raise BillingError(f"Milestone {b.sequence} ({b.percent:g}% {label.lower()}) of {so.display_number} is already fully invoiced"
                           + (f" — a draft invoice is waiting for approval ({', '.join(drafts)})." if drafts else "."))
    if not b.triggered_at:
        why = {"advance": "the order isn't confirmed", "retention_release": "the warranty of every unit hasn't ended yet",
               "drawing_approval": "the customer's drawing approval hasn't been marked (Sales › order › Billing › Mark due)",
               "inspection": "no inspection call on this order was accepted yet",
               "other": "it hasn't been marked due on the order"}.get(b.milestone_type, "its event hasn't happened")
        raise BillingError(f"Milestone {b.sequence} ({b.percent:g}% {label.lower()}) isn't due yet: {why}.")

    meta: list[dict] = []
    payload: list[dict] = []

    def add_line(ln, qty: float, rate: float, desc: str, schedule_id: int | None, units: float):
        if not (ln.hsn_sac_code or "").strip():
            raise BillingError(f"Order line {ln.line_number} ({ln.description[:40]}) has no HSN/SAC code — a tax invoice needs it. "
                               f"Add it to the order through an amendment, then raise the invoice.")
        payload.append({"description": desc[:300], "store_item_id": ln.product_item_id, "hsn_sac_code": ln.hsn_sac_code,
                        "quantity": qty, "uom": ln.uom, "rate": rate, "discount_amount": 0, "gst_rate": float(ln.gst_rate or 0)})
        meta.append({"so_line_id": ln.id, "schedule_id": schedule_id, "quantity": units})

    shipping = None
    if b.milestone_type in ROW_MILESTONES:
        rows = {r["schedule_id"]: r for r in view["rows"] if r["billable_units"] > 0}
        wanted = schedule_ids or list(rows)
        if not wanted:
            raise BillingError(f"Nothing to bill on milestone {b.sequence} ({b.percent:g}% {label.lower()}): no unit has reached "
                               f"{b.milestone_type} without being invoiced for it already.")
        sched = {r.id: r for r in so.schedules}
        for sid in wanted:
            if sid not in rows:
                r = sched.get(sid)
                what = f"{_row_label(so, r, lines_by_id)}" if r else f"Delivery row #{sid}"
                raise BillingError(f"{what} has nothing to bill on this milestone — it hasn't reached {b.milestone_type} "
                                   f"or it is already invoiced for it.")
            r, info = sched[sid], rows[sid]
            ln = lines_by_id[r.so_line_id]
            add_line(ln, info["billable_units"], round(net_unit(ln) * pct, 4),
                     f"{ln.description} — {info['label']} — {b.percent:g}% {label.lower()} (SO {so.so_number})", sid, info["billable_units"])
            shipping = shipping or ", ".join(p for p in (r.consignee_name, r.consignee_address) if p) or None
    else:
        share = left / float(b.amount) if float(b.amount or 0) else 0
        for ln in so.lines:
            if float(ln.taxable_amount or 0) <= 0:
                continue
            add_line(ln, float(ln.quantity), round(net_unit(ln) * pct * share, 4),
                     f"{ln.description} — {b.percent:g}% {label.lower()}{'' if share > 0.9999 else ' (balance)'} (SO {so.so_number})",
                     None, round(float(ln.quantity) * pct * share, 4))
    if not payload:
        raise BillingError(f"{so.display_number} has no priced line to invoice.")
    note = narration or f"Against {so.so_number}, customer PO {so.customer_po_number or '—'} — milestone {b.sequence}: {b.percent:g}% {label.lower()}."
    if b.recovers_advance_percent:
        note += f" Recovers {b.recovers_advance_percent:g}% of the advance — adjust the customer's advance against this invoice."
    try:
        txn = create_ar_transaction(
            db, customer_id=so.customer_id, invoice_date=invoice_date, created_by_id=created_by_id, lines=payload,
            round_off=round_off, place_of_supply_state_code=(so.place_of_supply_state_code or None),
            billing_address=so.billing_address, shipping_address=shipping, customer_po_number=so.customer_po_number,
            customer_po_date=so.customer_po_date, narration=note, eway_bill_no=eway_bill_no, eway_bill_date=eway_bill_date,
            vehicle_no=vehicle_no, reference_type="sales_order", reference_id=so.id,
        )
    except ValueError as e:
        raise BillingError(str(e))
    total = float(txn.total_amount or 0) - float(txn.round_off or 0)
    if total > left + 1.0:
        raise BillingError(f"This invoice ({total:,.2f}) would bill more than what is left of milestone {b.sequence} ({left:,.2f}).")
    ar_lines = db.query(ARTransactionLine).filter(ARTransactionLine.ar_transaction_id == txn.id).order_by(ARTransactionLine.line_number).all()
    for al, m in zip(ar_lines, meta):
        db.add(SalesInvoiceLink(
            ar_transaction_id=txn.id, ar_transaction_line_id=al.id, so_id=so.id, so_line_id=m["so_line_id"],
            billing_plan_line_id=b.id, schedule_id=m["schedule_id"], quantity=m["quantity"],
            taxable_amount=al.taxable_amount, gst_amount=round(float(al.cgst_amount) + float(al.sgst_amount) + float(al.igst_amount), 2),
            created_by_id=created_by_id,
        ))
    b.invoice_requested_at = None
    b.invoice_requested_by_id = None
    db.flush()
    advance_adjustment_hook(db, so, b, txn)
    sync_order(db, so)
    return txn
