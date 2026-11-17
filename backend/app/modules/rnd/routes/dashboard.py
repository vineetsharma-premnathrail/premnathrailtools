from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.rnd.models.project import RndProject, RND_PROJECT_STAGES
from app.modules.rnd.models.requirement import RndRequirement
from app.modules.rnd.scope import apply_scope
from app.modules.rnd.service import user_names
from app.modules.rnd.services import requirement_access as ra

router = APIRouter(tags=["RnD Dashboard"], dependencies=[Depends(require_app_access("rnd"))])


@router.get("/dashboard")
async def rnd_dashboard(
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("rnd", "dashboard")),
):
    live_projects = apply_scope(db.query(RndProject), _tab, RndProject).filter(RndProject.is_deleted == False)  # noqa: E712
    by_stage = dict(
        live_projects.filter(RndProject.status != "cancelled")
        .with_entities(RndProject.stage, func.count(RndProject.id)).group_by(RndProject.stage).all()
    )
    by_status = dict(live_projects.with_entities(RndProject.status, func.count(RndProject.id)).group_by(RndProject.status).all())

    # Ongoing = being worked on now: active and not yet closed.
    ongoing = live_projects.filter(RndProject.status == "active", RndProject.stage != "closed")
    ongoing_count = ongoing.count()
    recent_projects = ongoing.order_by(RndProject.updated_at.desc()).limit(6).all()
    lead_names = user_names(db, [p.lead_id for p in recent_projects])

    # Requirement intake (R&D side only): how many sent requirements wait for review / came back.
    intake_counts = {"awaiting_review": None, "accepted": None, "returned": None}
    if ra.is_rnd_side(_tab):
        by_req = dict(db.query(RndRequirement.status, func.count(RndRequirement.id)).group_by(RndRequirement.status).all())
        intake_counts = {s: by_req.get(s, 0) for s in ("submitted", "accepted", "returned")}
        intake_counts = {"awaiting_review": intake_counts["submitted"], "accepted": intake_counts["accepted"], "returned": intake_counts["returned"]}

    return {
        "requirements": intake_counts,
        "projects": {
            "total": sum(by_status.values()),
            "active": by_status.get("active", 0),
            "ongoing": ongoing_count,
            "on_hold": by_status.get("on_hold", 0),
            "cancelled": by_status.get("cancelled", 0),
            "by_stage": {s: by_stage.get(s, 0) for s in RND_PROJECT_STAGES},
        },
        "recent_projects": [
            {
                "id": p.id, "project_number": p.project_number, "title": p.title, "stage": p.stage,
                "status": p.status, "priority": p.priority, "lead_name": lead_names.get(p.lead_id),
                "target_end_date": p.target_end_date,
            } for p in recent_projects
        ],
    }
