from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.customer_complaint import QualityCustomerComplaint
from app.modules.quality.models.rejection import QualityRejection
from app.modules.quality.models.quality_standard import QualityStandard
from app.modules.quality.schemas.dashboard import QualityDashboardKpis, QualityDashboardResponse

router = APIRouter(
    prefix="/quality/dashboard", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


@router.get("", response_model=QualityDashboardResponse)
async def get_dashboard(db: Session = Depends(get_db)):
    today = date.today()

    open_ncrs = db.query(QualityNcr).filter(
        QualityNcr.status.in_(["open", "under_review", "capa_assigned"])
    ).count()
    critical_ncrs = db.query(QualityNcr).filter(
        QualityNcr.status.notin_(["closed", "rejected", "cancelled"]),
        QualityNcr.severity == "critical",
    ).count()
    open_capas = db.query(QualityCapa).filter(
        QualityCapa.status.in_(["open", "in_progress", "pending_verification"])
    ).count()
    overdue_capas = db.query(QualityCapa).filter(
        QualityCapa.status != "closed",
        QualityCapa.due_date.isnot(None),
        QualityCapa.due_date < today,
    ).count()
    pending_inspections = db.query(QualityInspection).filter(
        QualityInspection.status.in_(["pending", "in_progress"])
    ).count()
    failed_inspections_30d = db.query(QualityInspection).filter(
        QualityInspection.status == "failed",
        QualityInspection.inspection_date >= today - timedelta(days=30),
    ).count()
    open_complaints = db.query(QualityCustomerComplaint).filter(
        QualityCustomerComplaint.status.in_(["open", "under_investigation", "capa_assigned"])
    ).count()
    open_rejections = db.query(QualityRejection).filter(
        QualityRejection.status.in_(["open", "in_progress"])
    ).count()
    active_standards = db.query(QualityStandard).filter(
        QualityStandard.status == "active"
    ).count()

    return QualityDashboardResponse(
        kpis=QualityDashboardKpis(
            open_ncrs=open_ncrs,
            critical_ncrs=critical_ncrs,
            open_capas=open_capas,
            overdue_capas=overdue_capas,
            pending_inspections=pending_inspections,
            failed_inspections_30d=failed_inspections_30d,
            open_complaints=open_complaints,
            open_rejections=open_rejections,
            active_standards=active_standards,
        )
    )
