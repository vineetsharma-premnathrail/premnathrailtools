"""Cash position and liquidity forecast (SAP FF7A / FF7B) — read-only.

Starts from today's book balance of every active bank / cash account and
lays the expected cash flows into weekly buckets (13 weeks by default,
Monday-to-Sunday, the first week being the current one):

Inflows
  ar_open        posted sales invoices still due, at their due date
  so_billing     Sales Order billing milestones not yet invoiced
                 (amount - invoiced_amount): triggered ones at trigger date +
                 due days; advance at SO confirmation; dispatch / delivery /
                 commissioning at the earliest open delivery date (+ due
                 days); other milestones with no date go to "Not scheduled"
  planned_in     Finance's planned receipts (accounts_cash_forecast_items)
Outflows
  ap_open        posted vendor bills still due, at their due date (vendor
                 payment days when the bill has no due date) — except bills
                 already in a live payment run or a held payment voucher
  payment_runs   payment runs submitted / approved but not executed, at their
                 pay-by date
  held_payments  payment vouchers recorded and waiting for approval
  po_commitments issued POs not yet invoiced (qty x rate + GST, less every
                 recorded invoice) at expected delivery + vendor payment days
  planned_out    planned payments (salaries, GST, EMIs...)

Anything dated before the first week is "Overdue / past due" and is counted
into the opening of week 1 (it is expected to move as soon as possible);
anything after the horizon is "Later" and stays out of the running balance,
as do undated milestones.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.cash_forecast_item import CASH_FORECAST_CATEGORIES, CashForecastItem
from app.modules.accounts.models.payment_proposal import PaymentProposal
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice

ROWS: list[tuple[str, str, str]] = [
    ("ar_open", "in", "Open receivables (sales invoices)"),
    ("so_billing", "in", "SO billing milestones not yet invoiced"),
    ("planned_in", "in", "Planned receipts"),
    ("ap_open", "out", "Open payables (vendor bills)"),
    ("payment_runs", "out", "Payment runs awaiting execution"),
    ("held_payments", "out", "Payment vouchers awaiting approval"),
    ("po_commitments", "out", "Open PO commitments (not yet invoiced)"),
    ("planned_out", "out", "Planned payments"),
]
_IST = timezone(timedelta(hours=5, minutes=30))
_LIVE_RUN = ("submitted", "approved")
_COMMITTING_PO = ("issued", "acknowledged", "partially_fulfilled", "fulfilled")
_OPEN_BILLING = ("not_due", "due", "proforma_issued", "invoice_requested")
_ROW_MILESTONES = ("dispatch", "delivery", "commissioning")


def _r(x) -> float:
    return round(float(x or 0), 2)


def _d(dt) -> date | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_IST).date()
    return dt


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, monthrange(y, m)[1]))


def expand_item(item: CashForecastItem, until: date) -> list[date]:
    """Dates a planned item falls on up to `until` (inclusive)."""
    end = min(item.end_date or until, until)
    if item.recurrence == "none":
        return [item.expected_date] if item.expected_date <= until else [item.expected_date]
    out, n = [], 0
    d = item.expected_date
    while d <= end and n < 400:
        out.append(d)
        n += 1
        d = item.expected_date + timedelta(weeks=n) if item.recurrence == "weekly" else _add_months(item.expected_date, n)
    return out


def get_cash_position(db: Session, *, weeks: int = 13, as_of: date | None = None) -> dict:
    from app.modules.accounts.service import bank_book_balance

    if not 1 <= weeks <= 52:
        raise ValueError("The forecast horizon must be between 1 and 52 weeks.")
    today = as_of or date.today()
    start = today - timedelta(days=today.weekday())
    week_bounds = [(start + timedelta(weeks=i), start + timedelta(weeks=i, days=6)) for i in range(weeks)]
    horizon_end = week_bounds[-1][1]

    def bucket(d: date | None) -> str:
        if d is None:
            return "unscheduled"
        if d < start:
            return "overdue"
        if d > horizon_end:
            return "later"
        return f"w{(d - start).days // 7 + 1}"

    items: list[dict] = []

    def add(category: str, d: date | None, amount: float, reference: str | None, party: str | None, note: str | None = None):
        amount = _r(amount)
        if amount <= 0:
            return
        direction = next(r[1] for r in ROWS if r[0] == category)
        items.append({"category": category, "direction": direction, "bucket": bucket(d), "date": d, "reference": reference,
                      "party": party, "amount": amount, "note": note})

    # ── opening: bank & cash book balances ──
    banks = db.query(BankAccount).filter(BankAccount.status == "active").order_by(BankAccount.account_kind, BankAccount.bank_name).all()
    bank_rows = []
    for b in banks:
        bal = _r(bank_book_balance(db, b, today))
        bank_rows.append({"bank_account_id": b.id, "label": b.bank_name if b.account_kind == "cash" else
                          f"{b.bank_name}{f' — {b.account_no}' if b.account_no else ''}", "kind": b.account_kind, "balance": bal})
    opening = _r(sum(r["balance"] for r in bank_rows))

    from app.modules.crm.models.organization import Organization

    # ── AR ──
    ar = db.query(ARTransaction).filter(ARTransaction.status == "posted", ARTransaction.amount_due > 0).all()
    cust_ids = {t.customer_id for t in ar}
    # ── SO billing ──
    from app.modules.sales.models.order import SalesBillingPlanLine, SalesOrder, SalesOrderSchedule
    from app.modules.accounts.services.billing import BILLABLE_ORDER_STATUSES
    bl_rows = (db.query(SalesBillingPlanLine, SalesOrder).join(SalesOrder, SalesOrder.id == SalesBillingPlanLine.so_id)
               .filter(SalesBillingPlanLine.status.in_(_OPEN_BILLING), SalesOrder.status.in_(BILLABLE_ORDER_STATUSES))
               .all())
    cust_ids |= {so.customer_id for _bl, so in bl_rows}
    customers = {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_(cust_ids)).all()} if cust_ids else {}
    for t in ar:
        add("ar_open", t.due_date, t.amount_due, t.invoice_number, customers.get(t.customer_id))

    so_ids = {so.id for _bl, so in bl_rows}
    first_delivery: dict[int, date] = {}
    if so_ids:
        for s in db.query(SalesOrderSchedule).filter(SalesOrderSchedule.so_id.in_(so_ids), SalesOrderSchedule.status != "cancelled").all():
            d = s.current_delivery_date or s.contract_delivery_date
            if d and s.status not in ("delivered", "closed") and (s.so_id not in first_delivery or d < first_delivery[s.so_id]):
                first_delivery[s.so_id] = d
    for bl, so in bl_rows:
        open_amt = _r(float(bl.amount or 0) - float(bl.invoiced_amount or 0))
        if open_amt <= 0:
            continue
        lag = timedelta(days=int(bl.due_days or 0))
        trig = _d(bl.triggered_at)
        if trig is not None:
            when = trig + lag
        elif bl.milestone_type == "advance":
            c = _d(so.confirmed_at)
            when = (c + lag) if c else None
        elif bl.milestone_type in _ROW_MILESTONES and so.id in first_delivery:
            when = first_delivery[so.id] + lag
        else:
            when = None
        ref = f"{so.so_number or f'SO draft #{so.id}'} — {bl.description or bl.milestone_type.replace('_', ' ')}"
        add("so_billing", when, open_amt, ref, customers.get(so.customer_id),
            None if when else "No trigger date yet (raised on drawing approval / inspection / retention release).")

    # ── payment runs & held vouchers (and the bills they cover) ──
    covered_bills: set[int] = set()
    runs = db.query(PaymentProposal).options(selectinload(PaymentProposal.lines)).filter(PaymentProposal.status.in_(_LIVE_RUN)).all()
    for pp in runs:
        live = [l for l in pp.lines if not l.excluded]
        covered_bills |= {l.vendor_invoice_id for l in live}
        add("payment_runs", pp.pay_by_date, sum(float(l.amount or 0) for l in live), pp.proposal_number,
            f"{len({l.vendor_id for l in live})} vendor(s)", f"Status: {pp.status}")
    held = db.query(PaymentTransaction).filter(PaymentTransaction.status == "pending_approval",
                                               PaymentTransaction.payment_type.in_(("vendor", "expense", "contra"))).all()
    vendor_ids = {p.vendor_id for p in held if p.vendor_id}
    for p in held:
        if p.payment_type == "contra":
            continue  # bank-to-bank: no net effect on total cash
        covered_bills |= {a.get("target_id") for a in (p.pending_allocations or []) if a.get("target_type") == "vendor_invoice"}

    # ── AP ──
    ap = db.query(VendorInvoice).filter(VendorInvoice.status == "posted", VendorInvoice.amount_due > 0).all()
    vendor_ids |= {i.vendor_id for i in ap}
    # ── PO commitments ──
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    pos = (db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items))
           .filter(P2PPurchaseOrder.status.in_(_COMMITTING_PO)).all())
    vendor_ids |= {p.vendor_id for p in pos if p.vendor_id}
    vendors = {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()} if vendor_ids else {}

    for p in held:
        if p.payment_type == "contra":
            continue
        party = vendors[p.vendor_id].name if p.vendor_id in vendors else (p.narration or "Expense payment")
        add("held_payments", p.payment_date, p.amount, f"Held voucher #{p.id}", party)
    for inv in ap:
        if inv.id in covered_bills:
            continue
        v = vendors.get(inv.vendor_id)
        due = inv.due_date or (inv.invoice_date + timedelta(days=int((v.payment_days if v else 0) or 0)))
        add("ap_open", due, inv.amount_due, inv.invoice_number, v.name if v else None)

    if pos:
        from sqlalchemy import func
        invoiced = dict(
            db.query(VendorInvoice.purchase_order_id, func.coalesce(func.sum(VendorInvoice.invoice_total), 0))
            .filter(VendorInvoice.purchase_order_id.in_([p.id for p in pos]), VendorInvoice.status != "cancelled")
            .group_by(VendorInvoice.purchase_order_id).all())
        for po in pos:
            value = sum(float(i.quantity or 0) * float(i.unit_price or 0) * (1 + float(i.tax_rate or 0) / 100) for i in po.items)
            open_value = _r(value - float(invoiced.get(po.id, 0) or 0))
            if open_value <= 0:
                continue
            v = vendors.get(po.vendor_id) if po.vendor_id else None
            base = po.expected_delivery or po.po_date
            when = base + timedelta(days=int((v.payment_days if v else 0) or 0)) if base else None
            add("po_commitments", when, open_value, po.po_number, (v.name if v else None) or po.vendor_name,
                f"Expected delivery {po.expected_delivery:%d-%b-%Y}" if po.expected_delivery else "No expected delivery date — PO date used")

    # ── planned items ──
    for it in db.query(CashForecastItem).filter(CashForecastItem.is_active.is_(True)).all():
        for d in expand_item(it, horizon_end):
            if it.recurrence != "none" and d < start:
                continue  # past occurrences of a recurring plan are history, not overdue
            add("planned_in" if it.direction == "inflow" else "planned_out", d, it.amount, it.description,
                CASH_FORECAST_CATEGORIES.get(it.category, it.category), f"Planned ({it.recurrence})" if it.recurrence != "none" else "Planned")

    # ── aggregate ──
    keys = ["overdue"] + [f"w{i + 1}" for i in range(weeks)] + ["later", "unscheduled"]
    rows = []
    for cat, direction, label in ROWS:
        cells = {k: 0.0 for k in keys}
        for it in items:
            if it["category"] == cat:
                cells[it["bucket"]] += it["amount"]
        rows.append({"category": cat, "direction": direction, "label": label, "overdue": _r(cells["overdue"]),
                     "weeks": [_r(cells[f"w{i + 1}"]) for i in range(weeks)], "later": _r(cells["later"]),
                     "unscheduled": _r(cells["unscheduled"]),
                     "total": _r(sum(cells[k] for k in keys))})

    def col(direction: str, k: str) -> float:
        return _r(sum(it["amount"] for it in items if it["direction"] == direction and it["bucket"] == k))

    columns = []
    running = opening
    for k in ["overdue"] + [f"w{i + 1}" for i in range(weeks)]:
        inflow, outflow = col("in", k), col("out", k)
        net = _r(inflow - outflow)
        running = _r(running + net)
        columns.append({"key": k, "inflows": inflow, "outflows": outflow, "net": net, "closing_balance": running})
    week_meta = [{"key": f"w{i + 1}", "start": s, "end": e,
                  "label": f"Wk {i + 1} · {s:%d %b}"} for i, (s, e) in enumerate(week_bounds)]
    lowest = min(columns, key=lambda c: c["closing_balance"]) if columns else None
    items.sort(key=lambda x: (x["date"] or date.max, x["category"]))
    return {
        "as_of": today, "horizon_weeks": weeks, "horizon_end": horizon_end, "weeks": week_meta,
        "opening_balance": opening, "bank_balances": bank_rows, "rows": rows, "columns": columns,
        "later": {"inflows": col("in", "later"), "outflows": col("out", "later")},
        "unscheduled": {"inflows": col("in", "unscheduled"), "outflows": col("out", "unscheduled")},
        "lowest_balance": lowest["closing_balance"] if lowest else opening,
        "lowest_balance_key": lowest["key"] if lowest else None,
        "items": items,
    }
