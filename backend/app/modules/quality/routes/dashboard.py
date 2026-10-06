from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
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
async def get_dashboard(db: Session = Depends(get_db)):
    today = date.today()
    waiting_days = int(get_setting(db, "lot_waiting_days"))

    open_lots = db.query(QualityInspectionLot).filter(QualityInspectionLot.status.in_(QUALITY_LOT_OPEN_STATUSES))
    lots_waiting = open_lots.count()
    lots_overdue = open_lots.filter(QualityInspectionLot.lot_date < today - timedelta(days=waiting_days)).count()

    live_ncrs = db.query(QualityNcr).filter(QualityNcr.is_deleted == False, QualityNcr.status.notin_(("closed", "cancelled")))  # noqa: E712
    by_sev = dict(live_ncrs.with_entities(QualityNcr.severity, func.count(QualityNcr.id)).group_by(QualityNcr.severity).all())
    awaiting = live_ncrs.filter(QualityNcr.disposition_status == "pending_approval").count()

    open_capas = db.query(QualityCapa).filter(
        QualityCapa.is_deleted == False, QualityCapa.status.in_(["open", "in_progress", "pending_verification"])  # noqa: E712
    ).count()
    overdue_capas = db.query(QualityCapa).filter(
        QualityCapa.is_deleted == False, QualityCapa.status != "closed",  # noqa: E712
        QualityCapa.due_date.isnot(None), QualityCapa.due_date < today,
    ).count()
    open_complaints = db.query(QualityCustomerComplaint).filter(
        QualityCustomerComplaint.is_deleted == False,  # noqa: E712
        QualityCustomerComplaint.status.in_(["open", "under_investigation", "capa_assigned"]),
    ).count()
    gate_pending = db.query(QualityInspection).filter(
        QualityInspection.is_deleted == False, QualityInspection.status.in_(["pending", "in_progress"])  # noqa: E712
    ).count()

    month_start = today.replace(day=1)
    decided = db.query(QualityInspectionLot).filter(
        QualityInspectionLot.decision.isnot(None), QualityInspectionLot.lot_date >= month_start,
        QualityInspectionLot.source_type != "ncr",
    ).all()
    received = sum(l.quantity for l in decided)
    rejected = sum(l.rejected_qty or 0 for l in decided)

    return QualityDashboardResponse(kpis=QualityDashboardKpis(
        lots_waiting=lots_waiting, lots_overdue=lots_overdue, lot_waiting_days=waiting_days,
        open_ncrs=sum(by_sev.values()), critical_ncrs=by_sev.get("critical", 0), major_ncrs=by_sev.get("major", 0),
        minor_ncrs=by_sev.get("minor", 0), ncrs_awaiting_approval=awaiting, open_capas=open_capas,
        overdue_capas=overdue_capas, open_complaints=open_complaints, gate_inspections_pending=gate_pending,
        month_lots_decided=len(decided), month_received_qty=received, month_rejected_qty=rejected,
        month_rejection_rate=round(rejected * 100 / received, 2) if received else 0,
    ))
