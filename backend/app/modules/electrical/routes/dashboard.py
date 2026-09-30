from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.electrical.models.bom import ElectricalBomItem
from app.modules.electrical.models.drawing import ElectricalDrawing, ElectricalDrawingRevision
from app.modules.electrical.models.issue import ElectricalIssue, ELECTRICAL_OPEN_ISSUE_STATUSES
from app.modules.electrical.models.job import ElectricalJob, ELECTRICAL_PHASES
from app.modules.electrical.routes.jobs import _to_responses
from app.modules.electrical.schemas.insights import ElectricalDashboardResponse
from app.modules.electrical.service import ELECTRICAL_APP, OPEN_JOB_STATUSES, open_failure_ids
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import QualityInspection

router = APIRouter(
    prefix="/electrical/dashboard", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)


@router.get("", response_model=ElectricalDashboardResponse)
async def get_dashboard(
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access(ELECTRICAL_APP, "dashboard")),
):
    today = date.today()
    live = ElectricalJob.is_deleted == False  # noqa: E712
    counts = dict(db.query(ElectricalJob.status, func.count(ElectricalJob.id)).filter(live).group_by(ElectricalJob.status).all())

    open_jobs = db.query(ElectricalJob).options(selectinload(ElectricalJob.stages)).filter(
        live, ElectricalJob.status.in_(OPEN_JOB_STATUSES)
    ).all()
    open_ids = [j.id for j in open_jobs]
    active_ids = open_ids + [j.id for j in db.query(ElectricalJob.id).filter(live, ElectricalJob.status == "handed_over").all()]
    open_responses = _to_responses(db, open_jobs)

    pending_drawings = db.query(func.count(func.distinct(ElectricalDrawingRevision.drawing_id))).join(
        ElectricalDrawing, ElectricalDrawing.id == ElectricalDrawingRevision.drawing_id
    ).filter(
        ElectricalDrawingRevision.status == "submitted", ElectricalDrawingRevision.is_deleted == False,  # noqa: E712
        ElectricalDrawing.is_deleted == False, ElectricalDrawing.job_id.in_(active_ids),  # noqa: E712
    ).scalar() if active_ids else 0
    open_issue_rows = db.query(ElectricalIssue.severity).filter(
        ElectricalIssue.is_deleted == False, ElectricalIssue.status.in_(ELECTRICAL_OPEN_ISSUE_STATUSES),  # noqa: E712
        ElectricalIssue.job_id.in_(active_ids),
    ).all() if active_ids else []
    purchase_pending = db.query(ElectricalBomItem).filter(
        ElectricalBomItem.is_deleted == False, ElectricalBomItem.procurement_status == "required",  # noqa: E712
        ElectricalBomItem.job_id.in_(active_ids),
    ).count() if active_ids else 0
    inspection_ids = [j.quality_inspection_id for j in open_jobs if j.quality_inspection_id]
    awaiting_qc = db.query(QualityInspection).filter(
        QualityInspection.id.in_(inspection_ids), QualityInspection.is_deleted == False,  # noqa: E712
        QualityInspection.status.in_(("pending", "in_progress")),
    ).count() if inspection_ids else 0

    by_phase = [
        {"phase": key, "label": label, "jobs": sum(1 for r in open_responses if r.current_phase == key)}
        for key, label in ELECTRICAL_PHASES.items()
    ]
    recent = db.query(ElectricalJob).options(selectinload(ElectricalJob.stages)).filter(live).order_by(ElectricalJob.created_at.desc()).limit(8).all()
    due_soon = sorted(
        (r for r in open_responses if r.target_handover_date and r.target_handover_date <= today + timedelta(days=14)),
        key=lambda r: r.target_handover_date,
    )[:8]

    return {
        "kpis": {
            "draft": counts.get("draft", 0),
            "in_progress": counts.get("in_progress", 0),
            "on_hold": counts.get("on_hold", 0),
            "handed_over": counts.get("handed_over", 0),
            "overdue": sum(1 for r in open_responses if r.is_overdue),
            "drawings_pending_approval": pending_drawings or 0,
            "open_failures": len(open_failure_ids(db, active_ids)) if active_ids else 0,
            "open_issues": len(open_issue_rows),
            "critical_issues": sum(1 for (s,) in open_issue_rows if s == "critical"),
            "purchase_pending": purchase_pending,
            "awaiting_qc": awaiting_qc,
        },
        "by_phase": by_phase,
        "recent": _to_responses(db, recent),
        "due_soon": due_soon,
    }
