from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.phase import PmProjectPhase, PM_PHASE_STATUSES
from app.modules.projects.schemas.phase import PmProjectPhaseCreate, PmProjectPhaseUpdate, PmProjectPhaseResponse

router = APIRouter(
    prefix="/projects/{project_id}/phases", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="planning",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_phase_or_404(db: Session, project_id: int, phase_id: int) -> PmProjectPhase:
    phase = db.query(PmProjectPhase).filter(
        PmProjectPhase.id == phase_id, PmProjectPhase.project_id == project_id
    ).first()
    if not phase:
        raise HTTPException(status_code=404, detail=f"Phase #{phase_id} not found on project #{project_id}")
    return phase


@router.get("", response_model=list[PmProjectPhaseResponse])
async def list_phases(project_id: int, db: Session = Depends(get_db)):
    _get_project_or_404(db, project_id)
    phases = db.query(PmProjectPhase).filter(
        PmProjectPhase.project_id == project_id
    ).order_by(PmProjectPhase.sort_order.asc(), PmProjectPhase.id.asc()).all()
    return phases


@router.post("", response_model=PmProjectPhaseResponse)
async def create_phase(
    project_id: int,
    payload: PmProjectPhaseCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    phase = PmProjectPhase(
        project_id=project_id,
        name=payload.name,
        planned_start=payload.planned_start,
        planned_end=payload.planned_end,
        actual_start=payload.actual_start,
        actual_end=payload.actual_end,
        sort_order=payload.sort_order,
        status="not_started",
    )
    db.add(phase)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Phase '{phase.name}' created by {user.name or user.email}.")

    db.commit()
    db.refresh(phase)
    return phase


@router.patch("/{phase_id}", response_model=PmProjectPhaseResponse)
async def update_phase(
    project_id: int,
    phase_id: int,
    payload: PmProjectPhaseUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    phase = _get_phase_or_404(db, project_id, phase_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in PM_PHASE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Must be one of {PM_PHASE_STATUSES}.")

    for field, val in updates.items():
        old_val = getattr(phase, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(phase, field, val)

    db.commit()
    db.refresh(phase)
    return phase


@router.delete("/{phase_id}")
async def delete_phase(
    project_id: int,
    phase_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    phase = _get_phase_or_404(db, project_id, phase_id)
    _write_audit(db, project_id, "deleted", user, summary=f"Phase '{phase.name}' deleted by {user.name or user.email}.")
    db.delete(phase)
    db.commit()
    return {"message": "Phase deleted"}
