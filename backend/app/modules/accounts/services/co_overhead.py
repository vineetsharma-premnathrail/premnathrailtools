"""CO overhead calculation (SAP KGI2 / KGI4) — costing sheet maintenance,
the period-end overhead run on work orders, and the overhead a product
cost estimate carries.

Costing sheet lookup for a plant on a date: the plant's own row valid on
the date, else the company-wide row (no plant) valid on the date, else no
overhead.

Period-end run for a month: every work order (not cancelled or deleted)
with material or labour booked in the month gets
    overhead = month's net material x material % + month's labour x labour %
written as one 'overhead' cost posting dated the month end. One posted run
per month; reversing writes 'overhead_reversal' postings on the same date
(blocked once Finance has closed the period)."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.accounts.models.co_overhead import CoCostingSheetRate, CoOverheadRun, CoOverheadRunLine
from app.modules.accounts.services import fiscal


def _r(x) -> float:
    return round(float(x or 0), 2)


def _d(x: date | None) -> str:
    return x.strftime("%d-%b-%Y") if x else "open-ended"


# ── Costing sheet ─────────────────────────────────────────────────────────

def validate_sheet_rate(db: Session, data: dict, *, rate_id: int | None = None) -> dict:
    from app.modules.organization.models.branch import Branch

    out = dict(data)
    if out.get("branch_id") and not db.query(Branch.id).filter(Branch.id == out["branch_id"]).first():
        raise ValueError(f"Plant #{out['branch_id']} doesn't exist — pick it again from the list.")
    vf, vt = out.get("valid_from"), out.get("valid_to")
    if not vf:
        raise ValueError("Give the date the overhead rates apply from.")
    if vt and vt < vf:
        raise ValueError(f"'Valid to' ({_d(vt)}) is before 'valid from' ({_d(vf)}) — swap them.")
    for k, label in (("material_overhead_pct", "Material overhead"), ("labour_overhead_pct", "Labour overhead")):
        v = float(out.get(k) or 0)
        if v < 0 or v > 500:
            raise ValueError(f"{label} % must be between 0 and 500.")
        out[k] = round(v, 3)
    q = db.query(CoCostingSheetRate).filter(
        CoCostingSheetRate.branch_id == out.get("branch_id") if out.get("branch_id") else CoCostingSheetRate.branch_id.is_(None))
    if rate_id:
        q = q.filter(CoCostingSheetRate.id != rate_id)
    end = vt or date.max
    for other in q.all():
        if other.valid_from <= end and vf <= (other.valid_to or date.max):
            raise ValueError(f"This overlaps the existing costing-sheet row valid {_d(other.valid_from)} to {_d(other.valid_to)} "
                             f"for the same plant. End that row the day before {_d(vf)}, or change these dates.")
    return out


def sheet_for(db: Session, branch_id: int | None, on: date) -> CoCostingSheetRate | None:
    base = db.query(CoCostingSheetRate).filter(
        CoCostingSheetRate.valid_from <= on, or_(CoCostingSheetRate.valid_to.is_(None), CoCostingSheetRate.valid_to >= on))
    if branch_id:
        own = base.filter(CoCostingSheetRate.branch_id == branch_id).first()
        if own:
            return own
    return base.filter(CoCostingSheetRate.branch_id.is_(None)).first()


def overhead_for(db: Session, branch_id: int | None, on: date | None, material: float, labour: float) -> dict:
    """Overhead the costing sheet puts on `material` and `labour` — used by
    work-order costing and product cost estimates (CK11N)."""
    sheet = sheet_for(db, branch_id, on or date.today())
    mp = float(sheet.material_overhead_pct or 0) if sheet else 0.0
    lp = float(sheet.labour_overhead_pct or 0) if sheet else 0.0
    mo, lo = _r(float(material or 0) * mp / 100), _r(float(labour or 0) * lp / 100)
    return {"costing_sheet_rate_id": sheet.id if sheet else None, "material_overhead_pct": mp, "labour_overhead_pct": lp,
            "material_overhead": mo, "labour_overhead": lo, "overhead": _r(mo + lo)}


def sheet_rows(db: Session) -> list[dict]:
    from app.modules.organization.models.branch import Branch

    rows = db.query(CoCostingSheetRate).order_by(CoCostingSheetRate.branch_id.asc(), CoCostingSheetRate.valid_from.desc()).all()
    names = dict(db.query(Branch.id, Branch.name).filter(Branch.id.in_({r.branch_id for r in rows if r.branch_id})).all()) if rows else {}
    return [{
        "id": r.id, "branch_id": r.branch_id, "branch_name": names.get(r.branch_id) if r.branch_id else "All plants",
        "valid_from": r.valid_from, "valid_to": r.valid_to, "material_overhead_pct": float(r.material_overhead_pct or 0),
        "labour_overhead_pct": float(r.labour_overhead_pct or 0), "notes": r.notes,
    } for r in rows]


# ── Period-end run on work orders ────────────────────────────────────────

def _period_bases(db: Session, start: date, end: date) -> dict[int, dict]:
    """{wo_id: {material, labour}} booked on work orders inside the month."""
    from app.modules.production.costing import _log_rates
    from app.modules.production.models.work_order import (
        ProductionOrderCostPosting, ProductionTimeLog, ProductionWorkOrder,
    )

    out: dict[int, dict] = {}
    for wo_id, ptype, amount in db.query(
        ProductionOrderCostPosting.work_order_id, ProductionOrderCostPosting.posting_type,
        func.coalesce(func.sum(ProductionOrderCostPosting.amount), 0.0),
    ).filter(
        ProductionOrderCostPosting.posting_date >= start, ProductionOrderCostPosting.posting_date <= end,
        ProductionOrderCostPosting.posting_type.in_(("material_issue", "material_return")),
    ).group_by(ProductionOrderCostPosting.work_order_id, ProductionOrderCostPosting.posting_type).all():
        b = out.setdefault(wo_id, {"material": 0.0, "labour": 0.0})
        b["material"] += float(amount) if ptype == "material_issue" else -float(amount)
    logs = db.query(ProductionTimeLog).filter(ProductionTimeLog.log_date >= start, ProductionTimeLog.log_date <= end).all()
    if logs:
        orders = {o.id: o for o in db.query(ProductionWorkOrder).filter(
            ProductionWorkOrder.id.in_({l.work_order_id for l in logs})).all()}
        op_ws = {op.id: op.workstation_id for o in orders.values() for op in o.operations}
        rates = _log_rates(db, logs, op_ws)
        for log in logs:
            b = out.setdefault(log.work_order_id, {"material": 0.0, "labour": 0.0})
            b["labour"] += log.hours * rates[log.id]
    return out


def compute_run(db: Session, period: str) -> dict:
    from app.modules.production.models.work_order import ProductionWorkOrder

    start, end = fiscal.period_bounds(period)
    bases = _period_bases(db, start, end)
    orders = {o.id: o for o in db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.id.in_(list(bases)), ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status != "cancelled").all()} if bases else {}
    rows, no_sheet = [], 0
    for wo_id, b in bases.items():
        wo = orders.get(wo_id)
        if wo is None:
            continue
        mat, lab = _r(max(b["material"], 0.0)), _r(b["labour"])
        oh = overhead_for(db, wo.branch_id, end, mat, lab)
        if oh["costing_sheet_rate_id"] is None:
            no_sheet += 1
        if oh["overhead"] <= 0:
            continue
        rows.append({"work_order_id": wo.id, "wo_number": wo.wo_number, "branch_id": wo.branch_id, "status": wo.status,
                     "material_base": mat, "labour_base": lab, **oh, "amount": oh["overhead"]})
    rows.sort(key=lambda r: r["wo_number"])
    messages = []
    if no_sheet:
        messages.append(f"{no_sheet} work order(s) with cost in {period} have no costing-sheet row for their plant on "
                        f"{_d(end)} — they get no overhead. Add a row under Overhead › Costing sheet.")
    return {"period": period, "posting_date": end, "rows": rows, "messages": messages,
            "total_overhead": _r(sum(r["amount"] for r in rows))}


def run_overhead(db: Session, period: str, *, test_run: bool = True, user_id: int | None = None) -> dict:
    from app.modules.production.models.work_order import ProductionOrderCostPosting

    existing = db.query(CoOverheadRun).filter(CoOverheadRun.accounting_period == period, CoOverheadRun.status == "posted").first()
    if existing and not test_run:
        raise ValueError(f"Overhead is already applied for {period} (run #{existing.id}). Reverse that run first if the "
                         f"month's costs or the costing sheet changed, then run it again.")
    result = compute_run(db, period)
    result["already_posted_run_id"] = existing.id if existing else None
    if test_run:
        result["test_run"] = True
        return result
    if not result["rows"]:
        raise ValueError(f"No overhead to apply for {period}: no work order has material or labour in that month with a "
                         f"costing-sheet row. " + " ".join(result["messages"]))
    run = CoOverheadRun(accounting_period=period, status="posted", total_overhead=result["total_overhead"], run_by_id=user_id)
    db.add(run)
    db.flush()
    for r in result["rows"]:
        posting = ProductionOrderCostPosting(
            work_order_id=r["work_order_id"], posting_type="overhead", posting_date=result["posting_date"], quantity=0.0,
            unit_cost=0.0, amount=r["amount"], cost_source="costing_sheet", created_by_id=user_id,
            remarks=f"Overhead {period}: {r['material_overhead_pct']:g}% on material {r['material_base']:,.2f} + "
                    f"{r['labour_overhead_pct']:g}% on labour {r['labour_base']:,.2f}",
        )
        db.add(posting)
        db.flush()
        db.add(CoOverheadRunLine(
            run_id=run.id, work_order_id=r["work_order_id"], branch_id=r["branch_id"], costing_sheet_rate_id=r["costing_sheet_rate_id"],
            material_base=r["material_base"], labour_base=r["labour_base"], material_overhead_pct=r["material_overhead_pct"],
            labour_overhead_pct=r["labour_overhead_pct"], material_overhead=r["material_overhead"],
            labour_overhead=r["labour_overhead"], amount=r["amount"], cost_posting_id=posting.id,
        ))
    db.flush()
    result.update({"test_run": False, "run_id": run.id})
    return result


def reverse_overhead_run(db: Session, run_id: int, *, reason: str, user_id: int | None = None) -> CoOverheadRun:
    from app.modules.accounts.models.period_close import PeriodClose
    from app.modules.production.models.work_order import ProductionOrderCostPosting

    run = db.query(CoOverheadRun).filter(CoOverheadRun.id == run_id).first()
    if not run:
        raise ValueError("Overhead run not found — reload the list.")
    if run.status != "posted":
        raise ValueError(f"Overhead run #{run.id} is already reversed.")
    if not reason or not reason.strip():
        raise ValueError("Give a reason for reversing the overhead run — it goes on the audit trail.")
    pc = db.query(PeriodClose).filter(PeriodClose.accounting_period == run.accounting_period).first()
    if pc and pc.status == "closed":
        raise ValueError(f"Period {run.accounting_period} is closed, and its closing stock (WIP) already includes this "
                         f"overhead. Reopen the period first (Finance › Journals › Period Close) if it really must change.")
    _, end = fiscal.period_bounds(run.accounting_period)
    for line in run.lines:
        rev = ProductionOrderCostPosting(
            work_order_id=line.work_order_id, posting_type="overhead_reversal", posting_date=end, quantity=0.0, unit_cost=0.0,
            amount=line.amount, cost_source="costing_sheet", created_by_id=user_id,
            remarks=f"Reversal of overhead {run.accounting_period}: {reason.strip()}"[:500],
        )
        db.add(rev)
        db.flush()
        line.reversal_posting_id = rev.id
    run.status, run.reversed_by_id = "reversed", user_id
    run.reversed_at, run.reversal_reason = datetime.now(timezone.utc), reason.strip()
    db.flush()
    return run


def overhead_runs(db: Session) -> list[dict]:
    runs = db.query(CoOverheadRun).order_by(CoOverheadRun.accounting_period.desc(), CoOverheadRun.id.desc()).all()
    return [{"id": r.id, "accounting_period": r.accounting_period, "status": r.status, "total_overhead": _r(r.total_overhead),
             "order_count": len(r.lines), "run_by_id": r.run_by_id, "created_at": r.created_at, "reversed_at": r.reversed_at,
             "reversal_reason": r.reversal_reason} for r in runs]


def overhead_run_detail(db: Session, run_id: int) -> dict:
    from app.modules.production.models.work_order import ProductionWorkOrder

    run = db.query(CoOverheadRun).filter(CoOverheadRun.id == run_id).first()
    if not run:
        raise ValueError("Overhead run not found — reload the list.")
    numbers = dict(db.query(ProductionWorkOrder.id, ProductionWorkOrder.wo_number).filter(
        ProductionWorkOrder.id.in_({l.work_order_id for l in run.lines})).all()) if run.lines else {}
    return {**next(r for r in overhead_runs(db) if r["id"] == run.id), "lines": [{
        "work_order_id": l.work_order_id, "wo_number": numbers.get(l.work_order_id), "material_base": _r(l.material_base),
        "labour_base": _r(l.labour_base), "material_overhead_pct": float(l.material_overhead_pct or 0),
        "labour_overhead_pct": float(l.labour_overhead_pct or 0), "material_overhead": _r(l.material_overhead),
        "labour_overhead": _r(l.labour_overhead), "amount": _r(l.amount),
    } for l in run.lines]}


def applied_overhead(db: Session, wo_id: int, as_of: date | None = None) -> float:
    """Net overhead applied to a work order (overhead - reversals)."""
    from app.modules.production.models.work_order import ProductionOrderCostPosting

    q = db.query(ProductionOrderCostPosting.posting_type, func.coalesce(func.sum(ProductionOrderCostPosting.amount), 0.0)).filter(
        ProductionOrderCostPosting.work_order_id == wo_id,
        ProductionOrderCostPosting.posting_type.in_(("overhead", "overhead_reversal")))
    if as_of is not None:
        q = q.filter(ProductionOrderCostPosting.posting_date <= as_of)
    t = dict(q.group_by(ProductionOrderCostPosting.posting_type).all())
    return _r(float(t.get("overhead", 0)) - float(t.get("overhead_reversal", 0)))
