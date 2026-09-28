from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.change_request import PmChangeRequest, PM_CHANGE_STATUSES
from app.modules.projects.schemas.change_request import PmChangeRequestCreate, PmChangeRequestUpdate, PmChangeRequestResponse

router = APIRouter(
    prefix="/projects/{project_id}/changes", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="changes",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_change_or_404(db: Session, project_id: int, change_id: int) -> PmChangeRequest:
    change = db.query(PmChangeRequest).filter(
        PmChangeRequest.id == change_id, PmChangeRequest.project_id == project_id
    ).first()
    if not change:
        raise HTTPException(status_code=404, detail=f"Change request #{change_id} not found on project #{project_id}")
    return change


def _to_response(db: Session, change: PmChangeRequest) -> PmChangeRequestResponse:
    resp = PmChangeRequestResponse.model_validate(change)
    if change.requested_by_id:
        requested_by = db.query(User).filter(User.id == change.requested_by_id).first()
        if requested_by:
            resp.requested_by_name = requested_by.name or requested_by.email
    if change.decided_by_id:
        decided_by = db.query(User).filter(User.id == change.decided_by_id).first()
        if decided_by:
            resp.decided_by_name = decided_by.name or decided_by.email
    return resp


@router.get("", response_model=list[PmChangeRequestResponse])
async def list_change_requests(
    project_id: int,
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmChangeRequest).filter(PmChangeRequest.project_id == project_id)
    if status_filter:
        query = query.filter(PmChangeRequest.status == status_filter)
    changes = query.order_by(PmChangeRequest.id.asc()).all()
    return [_to_response(db, c) for c in changes]


@router.post("", response_model=PmChangeRequestResponse)
async def create_change_request(
    project_id: int,
    payload: PmChangeRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)

    change = PmChangeRequest(
        project_id=project_id,
        title=payload.title,
        description=payload.description,
        impact_assessment=payload.impact_assessment,
        status="submitted",
        requested_by_id=user.id,
    )
    db.add(change)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Change request '{change.title}' created by {user.name or user.email}.")

    db.commit()
    db.refresh(change)
    return _to_response(db, change)


@router.patch("/{change_id}", response_model=PmChangeRequestResponse)
async def update_change_request(
    project_id: int,
    change_id: int,
    payload: PmChangeRequestUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    change = _get_change_or_404(db, project_id, change_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in PM_CHANGE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Must be one of {PM_CHANGE_STATUSES}.")

    if new_status in ("approved", "rejected"):
        if "decided_at" not in updates and change.decided_at is None:
            updates["decided_at"] = datetime.now(timezone.utc)
        if "decided_by_id" not in updates and change.decided_by_id is None:
            updates["decided_by_id"] = user.id

    for field, val in updates.items():
        old_val = getattr(change, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(change, field, val)

    db.commit()
    db.refresh(change)
    return _to_response(db, change)


@router.delete("/{change_id}")
async def delete_change_request(
    project_id: int,
    change_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    change = _get_change_or_404(db, project_id, change_id)

    _write_audit(db, project_id, "deleted", user, summary=f"Change request '{change.title}' deleted by {user.name or user.email}.")
    db.delete(change)
    db.commit()
    return {"message": "Change request deleted"}
