from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.resource import PmProjectResource
from app.modules.projects.schemas.resource import PmProjectResourceCreate, PmProjectResourceUpdate, PmProjectResourceResponse

router = APIRouter(
    prefix="/projects/{project_id}/resources", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="resources",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_resource_or_404(db: Session, project_id: int, resource_id: int) -> PmProjectResource:
    resource = db.query(PmProjectResource).filter(
        PmProjectResource.id == resource_id, PmProjectResource.project_id == project_id
    ).first()
    if not resource:
        raise HTTPException(status_code=404, detail=f"Resource #{resource_id} not found on project #{project_id}")
    return resource


def _to_response(db: Session, resource: PmProjectResource) -> PmProjectResourceResponse:
    resp = PmProjectResourceResponse.model_validate(resource)
    user_row = db.query(User).filter(User.id == resource.user_id).first()
    if user_row:
        resp.user_name = user_row.name or user_row.email
    return resp


@router.get("", response_model=list[PmProjectResourceResponse])
async def list_resources(project_id: int, db: Session = Depends(get_db)):
    _get_project_or_404(db, project_id)
    resources = db.query(PmProjectResource).filter(PmProjectResource.project_id == project_id).order_by(PmProjectResource.id.asc()).all()
    return [_to_response(db, r) for r in resources]


@router.post("", response_model=PmProjectResourceResponse)
async def create_resource(
    project_id: int,
    payload: PmProjectResourceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    assigned_user = db.query(User).filter(User.id == payload.user_id).first()
    if not assigned_user:
        raise HTTPException(status_code=404, detail=f"User #{payload.user_id} not found")
    if payload.allocation_percent is not None and (payload.allocation_percent < 0 or payload.allocation_percent > 100):
        raise HTTPException(status_code=422, detail=f"allocation_percent must be between 0 and 100, got {payload.allocation_percent}.")

    resource = PmProjectResource(
        project_id=project_id,
        user_id=payload.user_id,
        role=payload.role,
        allocation_percent=payload.allocation_percent,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(resource)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Resource {assigned_user.name or assigned_user.email} assigned by {user.name or user.email}.")

    db.commit()
    db.refresh(resource)
    return _to_response(db, resource)


@router.patch("/{resource_id}", response_model=PmProjectResourceResponse)
async def update_resource(
    project_id: int,
    resource_id: int,
    payload: PmProjectResourceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    resource = _get_resource_or_404(db, project_id, resource_id)
    updates = payload.model_dump(exclude_unset=True)

    if "allocation_percent" in updates and updates["allocation_percent"] is not None:
        pct = updates["allocation_percent"]
        if pct < 0 or pct > 100:
            raise HTTPException(status_code=422, detail=f"allocation_percent must be between 0 and 100, got {pct}.")

    for field, val in updates.items():
        old_val = getattr(resource, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(resource, field, val)

    db.commit()
    db.refresh(resource)
    return _to_response(db, resource)


@router.delete("/{resource_id}")
async def delete_resource(
    project_id: int,
    resource_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    resource = _get_resource_or_404(db, project_id, resource_id)
    resource_user = db.query(User).filter(User.id == resource.user_id).first()
    _write_audit(db, project_id, "deleted", user, summary=f"Resource {resource_user.name or resource_user.email if resource_user else resource.user_id} unassigned by {user.name or user.email}.")
    db.delete(resource)
    db.commit()
    return {"message": "Resource unassigned"}
