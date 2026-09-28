from datetime import date as date_

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.phase import PmProjectPhase
from app.modules.projects.models.milestone import PmProjectMilestone, PM_MILESTONE_STATUSES
from app.modules.projects.schemas.milestone import PmProjectMilestoneCreate, PmProjectMilestoneUpdate, PmProjectMilestoneResponse

router = APIRouter(
    prefix="/projects/{project_id}/milestones", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="milestones",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_milestone_or_404(db: Session, project_id: int, milestone_id: int) -> PmProjectMilestone:
    milestone = db.query(PmProjectMilestone).filter(
        PmProjectMilestone.id == milestone_id, PmProjectMilestone.project_id == project_id
    ).first()
    if not milestone:
        raise HTTPException(status_code=404, detail=f"Milestone #{milestone_id} not found on project #{project_id}")
    return milestone


@router.get("", response_model=list[PmProjectMilestoneResponse])
async def list_milestones(
    project_id: int,
    phase_id: int | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project_id)
    if phase_id is not None:
        query = query.filter(PmProjectMilestone.phase_id == phase_id)
    if status_filter:
        query = query.filter(PmProjectMilestone.status == status_filter)
    milestones = query.order_by(PmProjectMilestone.target_date.asc()).all()
    return milestones


@router.post("", response_model=PmProjectMilestoneResponse)
async def create_milestone(
    project_id: int,
    payload: PmProjectMilestoneCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    if payload.phase_id is not None:
        if not db.query(PmProjectPhase).filter(PmProjectPhase.id == payload.phase_id, PmProjectPhase.project_id == project_id).first():
            raise HTTPException(status_code=404, detail=f"Phase #{payload.phase_id} not found on project #{project_id}")

    milestone = PmProjectMilestone(
        project_id=project_id,
        phase_id=payload.phase_id,
        title=payload.title,
        description=payload.description,
        target_date=payload.target_date,
        status="pending",
    )
    db.add(milestone)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Milestone '{milestone.title}' created by {user.name or user.email}.")

    db.commit()
    db.refresh(milestone)
    return milestone


@router.patch("/{milestone_id}", response_model=PmProjectMilestoneResponse)
async def update_milestone(
    project_id: int,
    milestone_id: int,
    payload: PmProjectMilestoneUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    milestone = _get_milestone_or_404(db, project_id, milestone_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in PM_MILESTONE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Must be one of {PM_MILESTONE_STATUSES}.")
    if new_status == "achieved" and "actual_date" not in updates:
        updates["actual_date"] = date_.today()
    if "phase_id" in updates and updates["phase_id"] is not None:
        if not db.query(PmProjectPhase).filter(PmProjectPhase.id == updates["phase_id"], PmProjectPhase.project_id == project_id).first():
            raise HTTPException(status_code=404, detail=f"Phase #{updates['phase_id']} not found on project #{project_id}")

    for field, val in updates.items():
        old_val = getattr(milestone, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(milestone, field, val)

    db.commit()
    db.refresh(milestone)
    return milestone


@router.delete("/{milestone_id}")
async def delete_milestone(
    project_id: int,
    milestone_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    milestone = _get_milestone_or_404(db, project_id, milestone_id)
    _write_audit(db, project_id, "deleted", user, summary=f"Milestone '{milestone.title}' deleted by {user.name or user.email}.")
    db.delete(milestone)
    db.commit()
    return {"message": "Milestone deleted"}
