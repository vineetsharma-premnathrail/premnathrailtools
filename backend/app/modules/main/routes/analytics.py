"""Management cockpit (SAP SAC / BW equivalent): cross-module KPIs along the
core flow — enquiry → order intake → backlog → production WIP → QC holds →
dispatch → billing → collections → service SLA.

GET /analytics/cockpit. Who sees it: admins, Partners, and holders of
organization:cockpit:view. A KPI from a module the viewer can't access is
returned as `restricted` (admins / Partners see every KPI — organization
scope). Each KPI is computed on its own, so a module whose tables are
missing or changed shows `unavailable` with the real reason instead of
breaking the whole page. Results are cached in memory for 5 minutes per
viewer-visibility set."""
import logging
import time
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permission_registry import can_access_module, can_perform, is_admin_user
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["Analytics"])

CACHE_SECONDS = 300
_cache: dict[tuple, tuple[float, dict]] = {}

_CLOSED_SR = {"closed", "completed", "resolved", "cancelled", "canceled"}
_CLOSED_ENQ = {"Closed - Ordered", "Closed - Not Ordered", "Closed – Not Ordered", "Order Received", "Under Production"}


def can_view_cockpit(user: User) -> bool:
    return is_admin_user(user) or bool(getattr(user, "is_partner", False)) or \
        can_perform(user, "organization", "cockpit", "view")


def _today() -> date:
    return datetime.now(timezone.utc).astimezone().date()


def _month_bounds(d: date) -> tuple[date, date]:
    start = d.replace(day=1)
    nxt = (start + timedelta(days=32)).replace(day=1)
    return start, nxt


def _prev_month(d: date) -> date:
    return (d.replace(day=1) - timedelta(days=1)).replace(day=1)


def _months_back(d: date, n: int) -> list[date]:
    out, cur = [], d.replace(day=1)
    for _ in range(n):
        out.append(cur)
        cur = _prev_month(cur)
    return list(reversed(out))


def _f(x) -> float:
    return round(float(x or 0), 2)


# ---------------------------------------------------------------- KPIs

def _enquiries(db: Session, today: date) -> dict:
    from app.modules.crm.models.inquiry import Inquiry
    from app.modules.crm.models.tender import Tender

    open_inq = db.query(func.count(Inquiry.id)).filter(Inquiry.is_deleted.is_(False), Inquiry.status.notin_(_CLOSED_ENQ)).scalar()
    open_tnd = db.query(func.count(Tender.id)).filter(Tender.is_deleted.is_(False), Tender.status.notin_(_CLOSED_ENQ)).scalar()
    s, e = _month_bounds(today)
    ps, pe = _month_bounds(_prev_month(today))

    def new(a, b):
        return (db.query(func.count(Inquiry.id)).filter(Inquiry.is_deleted.is_(False), Inquiry.created_at >= a, Inquiry.created_at < b).scalar() or 0) + \
               (db.query(func.count(Tender.id)).filter(Tender.is_deleted.is_(False), Tender.created_at >= a, Tender.created_at < b).scalar() or 0)
    return {"value": (open_inq or 0) + (open_tnd or 0), "unit": "count",
            "secondary": f"{new(s, e)} new this month", "current": new(s, e), "previous": new(ps, pe)}


def _production(db: Session, today: date) -> dict:
    from app.modules.production.models.work_order import ProductionWorkOrder as WO

    base = db.query(WO).filter(WO.is_deleted.is_(False), WO.status.in_(("released", "in_progress")))
    wip = base.count()
    late = base.filter(WO.planned_end_date.isnot(None), WO.planned_end_date < today).count()
    return {"value": wip, "unit": "count", "secondary": f"{late} past planned end", "alert": late}


def _quality(db: Session, today: date) -> dict:
    from app.modules.quality.models.inspection_lot import QUALITY_LOT_OPEN_STATUSES, QualityInspectionLot
    from app.modules.quality.models.ncr import QUALITY_NCR_OPEN_STATUSES, QualityNcr

    lots = db.query(func.count(QualityInspectionLot.id)).filter(QualityInspectionLot.status.in_(QUALITY_LOT_OPEN_STATUSES)).scalar() or 0
    ncrs = db.query(func.count(QualityNcr.id)).filter(QualityNcr.is_deleted.is_(False),
                                                       QualityNcr.status.in_(QUALITY_NCR_OPEN_STATUSES)).scalar() or 0
    return {"value": lots, "unit": "count", "secondary": f"{ncrs} open NCR(s)", "alert": ncrs}


def _billing(db: Session, today: date) -> dict:
    from app.modules.accounts.models.ar_transaction import ARTransaction as AR

    def billed(a, b):
        return _f(db.query(func.coalesce(func.sum(AR.total_amount), 0)).filter(
            AR.status == "posted", AR.invoice_date >= a, AR.invoice_date < b).scalar())
    s, e = _month_bounds(today)
    ps, pe = _month_bounds(_prev_month(today))
    trend = []
    for m in _months_back(today, 12):
        a, b = _month_bounds(m)
        trend.append({"month": m.strftime("%Y-%m"), "value": billed(a, b)})
    cur = billed(s, e)
    return {"value": cur, "unit": "inr", "current": cur, "previous": billed(ps, pe), "trend": trend,
            "secondary": "Posted sales invoices this month (incl. GST)"}


def _collections(db: Session, today: date) -> dict:
    from app.modules.accounts.models.ar_transaction import ARTransaction as AR
    from app.modules.accounts.models.payment_transaction import PaymentTransaction as P

    def received(a, b):
        return _f(db.query(func.coalesce(func.sum(P.amount), 0)).filter(
            P.payment_type == "customer", P.status == "posted", P.payment_date >= a, P.payment_date < b).scalar())
    s, e = _month_bounds(today)
    ps, pe = _month_bounds(_prev_month(today))
    overdue = _f(db.query(func.coalesce(func.sum(AR.amount_due), 0)).filter(
        AR.status == "posted", AR.amount_due > 0, AR.due_date < today).scalar())
    over90 = _f(db.query(func.coalesce(func.sum(AR.amount_due), 0)).filter(
        AR.status == "posted", AR.amount_due > 0, AR.due_date < today - timedelta(days=90)).scalar())
    trend = []
    for m in _months_back(today, 12):
        a, b = _month_bounds(m)
        trend.append({"month": m.strftime("%Y-%m"), "value": received(a, b)})
    cur = received(s, e)
    return {"value": cur, "unit": "inr", "current": cur, "previous": received(ps, pe), "trend": trend,
            "secondary": f"Overdue receivables ₹{overdue:,.0f} (>90 days ₹{over90:,.0f})", "overdue": overdue,
            "overdue_90": over90, "alert": 1 if over90 > 0 else 0}


def _service(db: Session, today: date) -> dict:
    from app.modules.erp.models.service_request import ServiceRequest as SR

    rows = db.query(SR.status, SR.sla_resolution_due_at, SR.sla_resolution_met, SR.updated_at).filter(SR.is_deleted.is_(False)).all()
    now = datetime.now(timezone.utc)
    open_rows = [r for r in rows if (r[0] or "").strip().lower() not in _CLOSED_SR]
    breached = 0
    for r in open_rows:
        due = r[1]
        if due is not None:
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            if due < now:
                breached += 1
    judged = [r for r in rows if r[2] is not None]
    met_pct = round(100 * sum(1 for r in judged if r[2]) / len(judged), 1) if judged else None
    return {"value": len(open_rows), "unit": "count",
            "secondary": f"{breached} past SLA" + (f" · {met_pct}% resolved within SLA" if met_pct is not None else ""),
            "sla_met_pct": met_pct, "alert": breached}


# key, label, stage, module needed, drill-down page, function
KPIS = (
    ("enquiries", "Open enquiries & tenders", "Enquiry", "crm", "/dashboard/crm/inquiries", _enquiries),
    ("production_wip", "Production WIP (work orders)", "Production", "production", "/dashboard/production/work-orders", _production),
    ("qc_holds", "Lots in QC hold", "Quality", "quality", "/dashboard/quality/lots", _quality),
    ("billing", "Billing (month)", "Billing", "accounts", "/dashboard/finance/sales", _billing),
    ("collections", "Collections (month)", "Collections", "accounts", "/dashboard/finance/outstanding", _collections),
    ("service_sla", "Open service requests", "Service", "erp", "/dashboard/erp/service-requests", _service),
)


def compute_cockpit(db: Session, user: User) -> dict:
    full = is_admin_user(user) or bool(getattr(user, "is_partner", False))
    visible = tuple(k for k, _l, _s, mk, _h, _fn in KPIS if full or can_access_module(user, mk))
    key = (visible,)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    today = _today()
    out = []
    for k, label, stage, mk, href, fn in KPIS:
        item = {"key": k, "label": label, "stage": stage, "module": mk, "href": href}
        if k not in visible:
            item.update({"status": "restricted", "message": f"You don't have access to the {mk} module."})
        else:
            try:
                item.update({"status": "ok", **fn(db, today)})
            except Exception as exc:  # noqa: BLE001 — one module must not break the cockpit
                db.rollback()
                logger.warning("Cockpit KPI %s failed", k, exc_info=True)
                item.update({"status": "unavailable", "message": f"Could not compute: {type(exc).__name__}: {str(exc)[:200]}"})
        out.append(item)
    result = {"as_of": datetime.now(timezone.utc), "month": today.strftime("%Y-%m"), "kpis": out,
              "cache_seconds": CACHE_SECONDS}
    _cache[key] = (time.monotonic(), result)
    return result


@router.get("/cockpit")
async def cockpit(refresh: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not can_view_cockpit(user):
        raise HTTPException(
            status_code=403,
            detail="The Management Cockpit is for Partners and holders of Organization › Management Cockpit. "
                   "Ask an admin to add it to one of your roles.",
        )
    if refresh:
        _cache.clear()
    return compute_cockpit(db, user)
