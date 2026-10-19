"""Profitability analysis (SAP CO-PA KE30 report / KE24 line items):
contribution margin per sales order, machine, product and customer.

Revenue (taxable value, net of posted credit notes, posted invoices only):
  • sales invoices billed from a sales order — sales_invoice_links rows
    (order, order line, delivery row → machine / RRV build);
  • service invoices raised from a service request (machine = the SR's
    machine, business line service);
  • any other posted sales invoice → its customer only ("not linked").
Cost:
  • production: every work order of an RRV build (or tagged to a machine)
    — material issued − returned + labour (production/costing.py cost lines
    and time logs). A sub-assembly order's output received into stock is
    taken off, because it reaches the main order again as an issue;
  • direct material issued from Store to a machine (issue tagged to the
    machine, not via a work order or a service request);
  • service: spares consumed on the machine's service requests at their
    issue cost (ServiceRequest.material_cost_actual).
Quoted vs actual (sales-order rows): quoted revenue = the order's taxable
total; planned cost = Σ order lines × the product's standard price valid on
the order date (CK24 released estimate), so quoted margin is what the order
was priced to earn and the deviation is what execution changed.

Dates: with no range everything is life-to-date (an ETO order's whole
margin). With a range, revenue by invoice date and cost by posting /
log / issue date inside it (a period view). Read-only."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

GROUPS = ("sales_order", "machine", "product", "customer")
_EPS = 1e-9


def _r(x) -> float:
    return round(float(x or 0), 2)


def _in(d: date | None, frm: date | None, to: date | None) -> bool:
    if d is None:
        return frm is None and to is None
    return (frm is None or d >= frm) and (to is None or d <= to)


class _Acc:
    def __init__(self):
        self.rows: list[dict] = []

    def add(self, kind: str, amount: float, *, source: str, ref: str, so_id=None, so_line_id=None, machine_id=None,
            customer_id=None, product_key=None, on: date | None = None):
        if abs(amount) < 0.005:
            return
        self.rows.append(dict(kind=kind, amount=float(amount), source=source, ref=ref, so_id=so_id, so_line_id=so_line_id,
                              machine_id=machine_id, customer_id=customer_id, product_key=product_key, date=on))


def _credit_factors(db: Session, invoices) -> dict[int, float]:
    from app.modules.accounts.models.party_note import PartyNote
    ids = [i.id for i in invoices]
    if not ids:
        return {}
    credited: dict[int, float] = {}
    for n in db.query(PartyNote).filter(PartyNote.note_type == "credit_note", PartyNote.status == "posted",
                                        PartyNote.ar_transaction_id.in_(ids)).all():
        credited[n.ar_transaction_id] = credited.get(n.ar_transaction_id, 0.0) + float(n.taxable_amount or 0)
    out = {}
    for i in invoices:
        base = float(i.invoice_amount or 0)
        out[i.id] = max(0.0, 1 - credited.get(i.id, 0.0) / base) if base else 1.0
    return out


def _wo_costs(db: Session, wo_ids: list[int], frm: date | None, to: date | None) -> dict[int, dict]:
    """material, labour, relieved per work order inside the dates."""
    from app.modules.production.costing import _log_rates
    from app.modules.production.models.work_order import (
        ProductionOrderCostPosting as P, ProductionTimeLog as T, ProductionWorkOrderOperation as Op,
    )
    out = {i: {"material": 0.0, "labour": 0.0, "overhead": 0.0, "relieved": 0.0} for i in wo_ids}
    if not wo_ids:
        return out
    q = db.query(P.work_order_id, P.posting_type, func.coalesce(func.sum(P.amount), 0.0)).filter(P.work_order_id.in_(wo_ids))
    if frm:
        q = q.filter(P.posting_date >= frm)
    if to:
        q = q.filter(P.posting_date <= to)
    for wo_id, ptype, amount in q.group_by(P.work_order_id, P.posting_type).all():
        if ptype == "material_issue":
            out[wo_id]["material"] += float(amount)
        elif ptype == "material_return":
            out[wo_id]["material"] -= float(amount)
        elif ptype == "goods_receipt":
            out[wo_id]["relieved"] += float(amount)
        elif ptype == "overhead":       # period-end overhead run (co_overhead.py)
            out[wo_id]["overhead"] += float(amount)
        elif ptype == "overhead_reversal":
            out[wo_id]["overhead"] -= float(amount)
    lq = db.query(T).filter(T.work_order_id.in_(wo_ids))
    if frm:
        lq = lq.filter(T.log_date >= frm)
    if to:
        lq = lq.filter(T.log_date <= to)
    logs = lq.all()
    op_ws = {o.id: o.workstation_id for o in db.query(Op).filter(Op.work_order_id.in_(wo_ids)).all()}
    rates = _log_rates(db, logs, op_ws)
    for log in logs:
        out[log.work_order_id]["labour"] += float(log.hours or 0) * rates[log.id]
    return out


def _collect(db: Session, frm: date | None, to: date | None) -> tuple[_Acc, dict]:
    from app.modules.accounts.models.ar_transaction import ARTransaction, ARTransactionLine
    from app.modules.erp.models.project import Project
    from app.modules.erp.models.service_request import ServiceRequest
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    from app.modules.production.models.work_order import ProductionWorkOrder
    from app.modules.sales.models.delivery import SalesInvoiceLink
    from app.modules.sales.models.order import SalesOrder, SalesOrderLine, SalesOrderSchedule
    from app.modules.store.models.material_issue import StoreMaterialIssue
    from app.modules.store.models.stock_transaction import StoreStockTransaction

    acc = _Acc()
    machines: dict[int, Project | None] = {}

    def machine(mid):
        if mid and mid not in machines:
            machines[mid] = db.get(Project, mid)
        return machines.get(mid) if mid else None

    def product_key(machine_id=None, so_line: SalesOrderLine | None = None, item_id=None):
        m = machine(machine_id)
        if m is not None and m.product_id:
            return f"p{m.product_id}"
        if so_line is not None and so_line.product_item_id:
            return f"i{so_line.product_item_id}"
        if item_id:
            return f"i{item_id}"
        return None

    # Machine → its sales order (first live delivery row tagged with it).
    so_of_machine: dict[int, tuple[int, int]] = {}
    for sch in db.query(SalesOrderSchedule).filter(SalesOrderSchedule.erp_project_id.isnot(None)).all():
        so_of_machine.setdefault(sch.erp_project_id, (sch.so_id, sch.so_line_id))
    sos = {s.id: s for s in db.query(SalesOrder).all()}
    so_lines = {l.id: l for l in db.query(SalesOrderLine).all()}
    builds = {b.id: b for b in db.query(ProductionRrvBuild).filter(ProductionRrvBuild.is_deleted == False).all()}  # noqa: E712
    for b in builds.values():
        if b.erp_project_id and b.sales_order_id:
            so_of_machine.setdefault(b.erp_project_id, (b.sales_order_id, b.sales_order_line_id))

    # ── Revenue ─────────────────────────────────────────────────────────
    invq = db.query(ARTransaction).filter(ARTransaction.status == "posted")
    if frm:
        invq = invq.filter(ARTransaction.invoice_date >= frm)
    if to:
        invq = invq.filter(ARTransaction.invoice_date <= to)
    invoices = invq.all()
    factor = _credit_factors(db, invoices)
    inv_ids = [i.id for i in invoices]
    links_by_inv: dict[int, list] = {}
    if inv_ids:
        for ln in db.query(SalesInvoiceLink).filter(SalesInvoiceLink.ar_transaction_id.in_(inv_ids)).all():
            links_by_inv.setdefault(ln.ar_transaction_id, []).append(ln)
    schedules = {s.id: s for s in db.query(SalesOrderSchedule).all()}
    srs_billed: set[int] = set()
    for inv in invoices:
        f = factor.get(inv.id, 1.0)
        links = links_by_inv.get(inv.id)
        if links:
            for ln in links:
                sch = schedules.get(ln.schedule_id) if ln.schedule_id else None
                mid = sch.erp_project_id if sch else None
                if mid is None and sch is not None and sch.rrv_build_id in builds:
                    mid = builds[sch.rrv_build_id].erp_project_id
                so = sos.get(ln.so_id)
                acc.add("revenue", float(ln.taxable_amount or 0) * f, source="sales_invoice", ref=inv.invoice_number,
                        so_id=ln.so_id, so_line_id=ln.so_line_id, machine_id=mid,
                        customer_id=so.customer_id if so else inv.customer_id,
                        product_key=product_key(mid, so_lines.get(ln.so_line_id)), on=inv.invoice_date)
            continue
        taxable = sum(float(l.taxable_amount or 0) for l in db.query(ARTransactionLine).filter(
            ARTransactionLine.ar_transaction_id == inv.id).all()) or float(inv.invoice_amount or 0)
        if inv.reference_type == "service_request" and inv.reference_id:
            sr = db.get(ServiceRequest, inv.reference_id)
            mid = sr.project_id if sr else None
            if sr:
                srs_billed.add(sr.id)
            so_id, so_line_id = so_of_machine.get(mid, (None, None)) if mid else (None, None)
            acc.add("revenue", taxable * f, source="service_invoice", ref=inv.invoice_number, machine_id=mid,
                    customer_id=inv.customer_id, product_key=product_key(mid), on=inv.invoice_date,
                    so_id=None, so_line_id=None)
            continue
        so_id = inv.reference_id if inv.reference_type == "sales_order" else None
        acc.add("revenue", taxable * f, source="sales_invoice_unlinked", ref=inv.invoice_number, so_id=so_id,
                customer_id=inv.customer_id, on=inv.invoice_date)

    # ── Production cost ─────────────────────────────────────────────────
    wos = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.is_deleted == False, ProductionWorkOrder.status != "cancelled",  # noqa: E712
        (ProductionWorkOrder.rrv_build_id.isnot(None)) | (ProductionWorkOrder.erp_project_id.isnot(None)),
    ).all()
    costs = _wo_costs(db, [w.id for w in wos], frm, to)
    for wo in wos:
        c = costs[wo.id]
        b = builds.get(wo.rrv_build_id) if wo.rrv_build_id else None
        cost = c["material"] + c["labour"] + c["overhead"]
        # A sub-assembly's output comes back to the main order as an issue.
        if b is not None and wo.build_role != "main":
            cost -= c["relieved"]
        mid = (b.erp_project_id if b else None) or wo.erp_project_id
        so_id = b.sales_order_id if b else None
        so_line_id = b.sales_order_line_id if b else None
        if so_id is None and mid in so_of_machine:
            so_id, so_line_id = so_of_machine[mid]
        so = sos.get(so_id) if so_id else None
        m = machine(mid)
        cust = (b.customer_id if b else None) or (so.customer_id if so else None) or (m.customer_id if m else None)
        acc.add("production_cost", cost, source="work_order", ref=wo.wo_number, so_id=so_id, so_line_id=so_line_id,
                machine_id=mid, customer_id=cust,
                product_key=product_key(mid, so_lines.get(so_line_id) if so_line_id else None, wo.product_item_id))

    # ── Direct material to a machine ────────────────────────────────────
    iq = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.erp_project_id.isnot(None),
                                             StoreMaterialIssue.service_request_id.is_(None))
    if frm:
        iq = iq.filter(StoreMaterialIssue.issue_date >= frm)
    if to:
        iq = iq.filter(StoreMaterialIssue.issue_date <= to)
    for iss in iq.all():
        if (iss.issue_type or "") == "job_work":
            continue
        value = db.query(func.coalesce(func.sum(func.abs(StoreStockTransaction.value)), 0.0)).filter(
            StoreStockTransaction.reference_type == "material_issue", StoreStockTransaction.reference_number == iss.issue_number,
            StoreStockTransaction.transaction_type == "issue").scalar() or 0.0
        mid = iss.erp_project_id
        so_id, so_line_id = so_of_machine.get(mid, (None, None))
        m = machine(mid)
        acc.add("direct_cost", float(value), source="material_issue", ref=iss.issue_number, so_id=so_id, so_line_id=so_line_id,
                machine_id=mid, customer_id=(m.customer_id if m else None) or iss.customer_id, product_key=product_key(mid),
                on=iss.issue_date)

    # ── Service cost ────────────────────────────────────────────────────
    for sr in db.query(ServiceRequest).filter(ServiceRequest.is_deleted == False, ServiceRequest.material_cost_actual > 0).all():  # noqa: E712
        on = sr.created_at.date() if sr.created_at else None
        if sr.id not in srs_billed and (frm or to) and not _in(on, frm, to):
            continue
        m = machine(sr.project_id)
        acc.add("service_cost", float(sr.material_cost_actual or 0), source="service_request",
                ref=getattr(sr, "sr_number", None) or f"SR #{sr.id}", machine_id=sr.project_id,
                customer_id=m.customer_id if m else None, product_key=product_key(sr.project_id), on=on)

    return acc, {"sos": sos, "so_lines": so_lines, "machines": machines, "machine": machine}


def _labels(db: Session, group_by: str, keys: set, ctx: dict) -> dict:
    from app.modules.crm.models.organization import Organization
    from app.modules.products.models.product import FinishedProduct
    from app.modules.store.models.item import StoreItem
    keys = {k for k in keys if k is not None}
    if group_by == "sales_order":
        out = {}
        for k in keys:
            so = ctx["sos"].get(k)
            out[k] = so.display_number if so else f"SO #{k}"
        return out
    if group_by == "customer":
        return {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_(keys)).all()} if keys else {}
    if group_by == "machine":
        out = {}
        for k in keys:
            m = ctx["machine"](k)
            out[k] = (f"{m.serial_number} — {m.model_name or m.machine_type or ''}".rstrip(" —")) if m else f"Machine #{k}"
        return out
    pids = {int(k[1:]) for k in keys if k.startswith("p")}
    iids = {int(k[1:]) for k in keys if k.startswith("i")}
    out = {}
    for p in (db.query(FinishedProduct).filter(FinishedProduct.id.in_(pids)).all() if pids else []):
        out[f"p{p.id}"] = f"{p.code} — {p.name}"
    for i in (db.query(StoreItem).filter(StoreItem.id.in_(iids)).all() if iids else []):
        out[f"i{i.id}"] = f"{i.item_code} — {i.item_name}"
    return out


def order_profitability(db: Session, *, group_by: str = "sales_order", from_date: date | None = None,
                        to_date: date | None = None) -> dict:
    if group_by not in GROUPS:
        raise ValueError(f"Group by must be one of: {', '.join(GROUPS)}.")
    if from_date and to_date and from_date > to_date:
        raise ValueError("The 'from' date is after the 'to' date.")
    acc, ctx = _collect(db, from_date, to_date)
    field = {"sales_order": "so_id", "machine": "machine_id", "product": "product_key", "customer": "customer_id"}[group_by]
    buckets: dict = {}
    for r in acc.rows:
        k = r[field]
        b = buckets.setdefault(k, {"revenue": 0.0, "production_cost": 0.0, "direct_cost": 0.0, "service_cost": 0.0,
                                   "lines": 0})
        b[r["kind"]] += r["amount"]
        b["lines"] += 1
    labels = _labels(db, group_by, set(buckets), ctx)
    rows = []
    for k, b in buckets.items():
        cost = b["production_cost"] + b["direct_cost"] + b["service_cost"]
        margin = b["revenue"] - cost
        row = {
            "key": k, "label": labels.get(k) if k is not None else "Not linked", "revenue": _r(b["revenue"]),
            "production_cost": _r(b["production_cost"]), "direct_cost": _r(b["direct_cost"]),
            "service_cost": _r(b["service_cost"]), "total_cost": _r(cost), "contribution_margin": _r(margin),
            "margin_pct": _r(margin / b["revenue"] * 100) if abs(b["revenue"]) > _EPS else None,
        }
        if group_by == "sales_order" and k is not None:
            row.update(_quoted(db, ctx["sos"].get(k), ctx["so_lines"], row))
        rows.append(row)
    rows.sort(key=lambda r: (r["key"] is None, -(r["revenue"] or 0)))
    tot_rev = sum(r["revenue"] for r in rows)
    tot_cost = sum(r["total_cost"] for r in rows)
    return {
        "group_by": group_by, "from_date": from_date, "to_date": to_date, "rows": rows,
        "total_revenue": _r(tot_rev), "total_cost": _r(tot_cost), "total_margin": _r(tot_rev - tot_cost),
        "total_margin_pct": _r((tot_rev - tot_cost) / tot_rev * 100) if abs(tot_rev) > _EPS else None,
    }


def _quoted(db: Session, so, so_lines: dict, row: dict) -> dict:
    from app.modules.production.cost_estimating import standard_price_on
    if so is None:
        return {}
    on = so.confirmed_at.date() if so.confirmed_at else (so.created_at.date() if so.created_at else date.today())
    planned, unknown = 0.0, []
    for l in (x for x in so_lines.values() if x.so_id == so.id):
        if l.line_type == "freight":
            continue
        price = standard_price_on(db, l.product_item_id, on) if l.product_item_id else None
        if price is None:
            unknown.append(l.description[:60])
            continue
        planned += price * float(l.quantity or 0)
    quoted_rev = float(so.taxable_total or 0)
    q_margin = quoted_rev - planned
    return {
        "customer_id": so.customer_id, "so_status": so.status, "quoted_revenue": _r(quoted_rev), "planned_cost": _r(planned),
        "quoted_margin": _r(q_margin), "quoted_margin_pct": _r(q_margin / quoted_rev * 100) if quoted_rev > _EPS else None,
        "margin_pct_deviation": (_r(row["margin_pct"] - q_margin / quoted_rev * 100)
                                 if row.get("margin_pct") is not None and quoted_rev > _EPS else None),
        "lines_without_standard_price": unknown,
    }


def profitability_line_items(db: Session, *, group_by: str, key: str | None, from_date: date | None = None,
                             to_date: date | None = None) -> dict:
    """KE24: the revenue and cost items behind one report row."""
    if group_by not in GROUPS:
        raise ValueError(f"Group by must be one of: {', '.join(GROUPS)}.")
    acc, _ctx = _collect(db, from_date, to_date)
    field = {"sales_order": "so_id", "machine": "machine_id", "product": "product_key", "customer": "customer_id"}[group_by]

    def norm(v):
        return None if v in (None, "", "null", "none") else str(v)
    want = norm(key)
    items = [{**r, "amount": _r(r["amount"])} for r in acc.rows if norm(r[field]) == want]
    items.sort(key=lambda r: (r["kind"] != "revenue", r["date"] or date.min, r["ref"]))
    return {"group_by": group_by, "key": key, "items": items}
