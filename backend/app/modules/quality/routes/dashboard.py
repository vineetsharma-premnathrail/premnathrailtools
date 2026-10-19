from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.customer_complaint import QualityCustomerComplaint
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.inspection_lot import QualityInspectionLot, QUALITY_LOT_OPEN_STATUSES
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.schemas.dashboard import QualityDashboardKpis, QualityDashboardResponse
from app.modules.quality.services.settings import get_setting

router = APIRouter(
    prefix="/quality/dashboard", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


@router.get("", response_model=QualityDashboardResponse)
async def get_dashboard(db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    """KPIs over the records inside the user's data scope."""
    today = date.today()
    waiting_days = int(get_setting(db, "lot_waiting_days"))

    def q(model):
        return apply_scope(db.query(model), user, model)

    open_lots = q(QualityInspectionLot).filter(QualityInspectionLot.status.in_(QUALITY_LOT_OPEN_STATUSES))
    lots_waiting = open_lots.count()
    lots_overdue = open_lots.filter(QualityInspectionLot.lot_date < today - timedelta(days=waiting_days)).count()

    live_ncrs = q(QualityNcr).filter(QualityNcr.is_deleted == False, QualityNcr.status.notin_(("closed", "cancelled")))  # noqa: E712
    by_sev = dict(live_ncrs.with_entities(QualityNcr.severity, func.count(QualityNcr.id)).group_by(QualityNcr.severity).all())
    awaiting = live_ncrs.filter(QualityNcr.disposition_status == "pending_approval").count()

    from app.modules.quality.models.capa import QUALITY_CAPA_OPEN_STATUSES
    from app.modules.quality.models.customer_complaint import QUALITY_COMPLAINT_OPEN_STATUSES
    from app.modules.quality.services.capa import is_overdue
    live_capas = q(QualityCapa).filter(
        QualityCapa.is_deleted == False, QualityCapa.status.in_(QUALITY_CAPA_OPEN_STATUSES)  # noqa: E712
    ).all()
    open_capas = len(live_capas)
    overdue_capas = sum(1 for c in live_capas if is_overdue(c, today))
    open_complaints = q(QualityCustomerComplaint).filter(
        QualityCustomerComplaint.is_deleted == False,  # noqa: E712
        QualityCustomerComplaint.status.in_(QUALITY_COMPLAINT_OPEN_STATUSES),
    ).count()
    # Legacy free-text gate inspections still open + Phase 2 in-process lots.
    gate_pending = q(QualityInspection).filter(
        QualityInspection.is_deleted == False, QualityInspection.status.in_(["pending", "in_progress"])  # noqa: E712
    ).count() + open_lots.filter(QualityInspectionLot.inspection_type == "in_process").count()
    from app.modules.quality.models.first_article import QualityFirstArticle
    from app.modules.quality.models.inspection_call import QualityInspectionCall
    open_fais = q(QualityFirstArticle).filter(QualityFirstArticle.status == "open").count()
    calls_next_7 = q(QualityInspectionCall).filter(
        QualityInspectionCall.status == "scheduled", QualityInspectionCall.call_date.isnot(None),
        QualityInspectionCall.call_date <= today + timedelta(days=7),
    ).count()

    month_start = today.replace(day=1)
    decided = q(QualityInspectionLot).filter(
        QualityInspectionLot.decision.isnot(None), QualityInspectionLot.lot_date >= month_start,
        QualityInspectionLot.source_type != "ncr",
    ).all()
    received = sum(l.quantity for l in decided)
    rejected = sum(l.rejected_qty or 0 for l in decided)

    from app.modules.quality.models.supplier_quality import QualityApprovedVendor
    avl = q(QualityApprovedVendor).with_entities(
        QualityApprovedVendor.vendor_key, QualityApprovedVendor.status, QualityApprovedVendor.pending_action).all()
    vendors_on_watch = len({k for k, s, _ in avl if s == "on_watch"})
    vendors_blocked = len({k for k, s, _ in avl if s == "blocked"})
    blocks_pending = sum(1 for _, _, p in avl if p)

    return QualityDashboardResponse(kpis=QualityDashboardKpis(
        vendors_on_watch=vendors_on_watch, vendors_blocked=vendors_blocked, vendor_blocks_pending=blocks_pending,
        lots_waiting=lots_waiting, lots_overdue=lots_overdue, lot_waiting_days=waiting_days,
        open_ncrs=sum(by_sev.values()), critical_ncrs=by_sev.get("critical", 0), major_ncrs=by_sev.get("major", 0),
        minor_ncrs=by_sev.get("minor", 0), ncrs_awaiting_approval=awaiting, open_capas=open_capas,
        overdue_capas=overdue_capas, open_complaints=open_complaints, gate_inspections_pending=gate_pending,
        open_first_articles=open_fais, inspection_calls_next_7_days=calls_next_7,
        month_lots_decided=len(decided), month_received_qty=received, month_rejected_qty=rejected,
        month_rejection_rate=round(rejected * 100 / received, 2) if received else 0,
    ))
