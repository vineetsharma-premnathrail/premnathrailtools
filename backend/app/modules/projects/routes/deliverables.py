from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.deliverable import PmDeliverable, PM_DELIVERABLE_STATUSES
from app.modules.projects.schemas.deliverable import PmDeliverableCreate, PmDeliverableUpdate, PmDeliverableResponse

router = APIRouter(
    prefix="/projects/{project_id}/deliverables", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="deliverables",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_deliverable_or_404(db: Session, project_id: int, deliverable_id: int) -> PmDeliverable:
    deliverable = db.query(PmDeliverable).filter(
        PmDeliverable.id == deliverable_id, PmDeliverable.project_id == project_id
    ).first()
    if not deliverable:
        raise HTTPException(status_code=404, detail=f"Deliverable #{deliverable_id} not found on project #{project_id}")
    return deliverable


def _to_response(db: Session, deliverable: PmDeliverable) -> PmDeliverableResponse:
    resp = PmDeliverableResponse.model_validate(deliverable)
    if deliverable.owner_id:
        owner = db.query(User).filter(User.id == deliverable.owner_id).first()
        if owner:
            resp.owner_name = owner.name or owner.email
    if deliverable.milestone_id:
        milestone = db.query(PmProjectMilestone).filter(PmProjectMilestone.id == deliverable.milestone_id).first()
        if milestone:
            resp.milestone_title = milestone.title
    return resp


@router.get("", response_model=list[PmDeliverableResponse])
async def list_deliverables(
    project_id: int,
    milestone_id: int | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmDeliverable).filter(PmDeliverable.project_id == project_id)
    if milestone_id is not None:
        query = query.filter(PmDeliverable.milestone_id == milestone_id)
    if status_filter:
        query = query.filter(PmDeliverable.status == status_filter)
    deliverables = query.order_by(PmDeliverable.id.asc()).all()
    return [_to_response(db, d) for d in deliverables]


@router.post("", response_model=PmDeliverableResponse)
async def create_deliverable(
    project_id: int,
    payload: PmDeliverableCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    if payload.milestone_id is not None:
        if not db.query(PmProjectMilestone).filter(
            PmProjectMilestone.id == payload.milestone_id, PmProjectMilestone.project_id == project_id
        ).first():
            raise HTTPException(status_code=404, detail=f"Milestone #{payload.milestone_id} not found on project #{project_id}")
    if payload.owner_id is not None:
        if not db.query(User).filter(User.id == payload.owner_id).first():
            raise HTTPException(status_code=404, detail=f"User #{payload.owner_id} not found")

    deliverable = PmDeliverable(
        project_id=project_id,
        milestone_id=payload.milestone_id,
        name=payload.name,
        description=payload.description,
        owner_id=payload.owner_id,
        due_date=payload.due_date,
        status="not_started",
    )
    db.add(deliverable)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Deliverable '{deliverable.name}' created by {user.name or user.email}.")

    db.commit()
    db.refresh(deliverable)
    return _to_response(db, deliverable)


@router.patch("/{deliverable_id}", response_model=PmDeliverableResponse)
async def update_deliverable(
    project_id: int,
    deliverable_id: int,
    payload: PmDeliverableUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    deliverable = _get_deliverable_or_404(db, project_id, deliverable_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in PM_DELIVERABLE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Must be one of {PM_DELIVERABLE_STATUSES}.")
    if "milestone_id" in updates and updates["milestone_id"] is not None:
        if not db.query(PmProjectMilestone).filter(
            PmProjectMilestone.id == updates["milestone_id"], PmProjectMilestone.project_id == project_id
        ).first():
            raise HTTPException(status_code=404, detail=f"Milestone #{updates['milestone_id']} not found on project #{project_id}")
    if "owner_id" in updates and updates["owner_id"] is not None:
        if not db.query(User).filter(User.id == updates["owner_id"]).first():
            raise HTTPException(status_code=404, detail=f"User #{updates['owner_id']} not found")

    for field, val in updates.items():
        old_val = getattr(deliverable, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(deliverable, field, val)

    db.commit()
    db.refresh(deliverable)
    return _to_response(db, deliverable)


@router.delete("/{deliverable_id}")
async def delete_deliverable(
    project_id: int,
    deliverable_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    deliverable = _get_deliverable_or_404(db, project_id, deliverable_id)

    _write_audit(db, project_id, "deleted", user, summary=f"Deliverable '{deliverable.name}' deleted by {user.name or user.email}.")
    db.delete(deliverable)
    db.commit()
    return {"message": "Deliverable deleted"}
