from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.organization.models.department import Department
from app.modules.organization.models.branch import Branch
from app.modules.projects.models.project import PmProject, PM_PROJECT_STATUSES, PM_PROJECT_PRIORITIES
from app.modules.projects.models.resource import PmProjectResource
from app.modules.projects.schemas.project import PmProjectCreate, PmProjectUpdate, PmProjectResponse
from app.modules.projects.service import generate_project_code

router = APIRouter(
    prefix="/projects", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="details_scope",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _to_response(db: Session, project: PmProject) -> PmProjectResponse:
    resp = PmProjectResponse.model_validate(project)
    user_ids = {project.project_manager_id, project.sponsor_id, project.created_by_id, project.closed_by_id}
    user_ids.discard(None)
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email
    if project.project_manager_id:
        resp.project_manager_name = user_map.get(project.project_manager_id)
    if project.sponsor_id:
        resp.sponsor_name = user_map.get(project.sponsor_id)
    if project.created_by_id:
        resp.created_by_name = user_map.get(project.created_by_id)
    if project.closed_by_id:
        resp.closed_by_name = user_map.get(project.closed_by_id)
    if project.department_id:
        dept = db.query(Department).filter(Department.id == project.department_id).first()
        if dept:
            resp.department_name = dept.name
    if project.branch_id:
        branch = db.query(Branch).filter(Branch.id == project.branch_id).first()
        if branch:
            resp.branch_name = branch.name
    return resp


def _get_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


@router.get("/meta")
async def get_project_meta():
    return {"statuses": PM_PROJECT_STATUSES, "priorities": PM_PROJECT_PRIORITIES}


@router.get("", response_model=list[PmProjectResponse])
async def list_projects(
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    search: str | None = None,
    mine: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    query = db.query(PmProject)
    if status_filter:
        query = query.filter(PmProject.status == status_filter)
    if priority:
        query = query.filter(PmProject.priority == priority)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (PmProject.name.ilike(like)) | (PmProject.project_code.ilike(like)) | (PmProject.client_name.ilike(like))
        )
    if mine:
        resource_project_ids = db.query(PmProjectResource.project_id).filter(PmProjectResource.user_id == user.id)
        query = query.filter(
            (PmProject.project_manager_id == user.id)
            | (PmProject.created_by_id == user.id)
            | (PmProject.id.in_(resource_project_ids))
        )
    projects = query.order_by(PmProject.created_at.desc()).all()
    return [_to_response(db, p) for p in projects]


@router.post("", response_model=PmProjectResponse)
async def create_project(
    payload: PmProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    if payload.priority not in PM_PROJECT_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{payload.priority}'")
    if payload.department_id is not None and not db.query(Department).filter(Department.id == payload.department_id).first():
        raise HTTPException(status_code=404, detail=f"Department #{payload.department_id} not found")
    if payload.branch_id is not None and not db.query(Branch).filter(Branch.id == payload.branch_id).first():
        raise HTTPException(status_code=404, detail=f"Branch #{payload.branch_id} not found")

    project = PmProject(
        project_code=generate_project_code(db),
        name=payload.name,
        description=payload.description,
        scope_statement=payload.scope_statement,
        objectives=payload.objectives,
        client_name=payload.client_name,
        project_type=payload.project_type,
        category=payload.category,
        department_id=payload.department_id,
        branch_id=payload.branch_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status="planning",
        priority=payload.priority,
        project_manager_id=payload.project_manager_id or user.id,
        sponsor_id=payload.sponsor_id,
        created_by_id=user.id,
    )
    db.add(project)
    db.flush()

    _write_audit(db, project.id, "created", user, summary=f"Project {project.project_code} ({project.name}) created by {user.name or user.email}.")

    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.get("/{project_id}", response_model=PmProjectResponse)
async def get_project(project_id: int, db: Session = Depends(get_db)):
    project = _get_or_404(db, project_id)
    return _to_response(db, project)


@router.patch("/{project_id}", response_model=PmProjectResponse)
async def update_project(
    project_id: int,
    payload: PmProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    project = _get_or_404(db, project_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in PM_PROJECT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
    new_priority = updates.get("priority")
    if new_priority and new_priority not in PM_PROJECT_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{new_priority}'")
    new_dept_id = updates.get("department_id")
    if new_dept_id is not None and not db.query(Department).filter(Department.id == new_dept_id).first():
        raise HTTPException(status_code=404, detail=f"Department #{new_dept_id} not found")
    new_branch_id = updates.get("branch_id")
    if new_branch_id is not None and not db.query(Branch).filter(Branch.id == new_branch_id).first():
        raise HTTPException(status_code=404, detail=f"Branch #{new_branch_id} not found")

    # Status/closure is an explicit separate action, not implied by a status
    # change — setting status to "completed"/"cancelled" here does NOT
    # auto-stamp closure_date; the caller must set closure fields explicitly.
    changed_fields = []
    for field, val in updates.items():
        old_val = getattr(project, field)
        if old_val != val:
            changed_fields.append(field)
            _write_audit(
                db, project.id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(project, field, val)

    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    project = _get_or_404(db, project_id)
    _write_audit(db, project.id, "deleted", user, summary=f"Project {project.project_code} ({project.name}) deleted by {user.name or user.email}.")
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}


@router.get("/{project_id}/audit")
async def get_project_audit(
    project_id: int,
    db: Session = Depends(get_db),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "pm_project", AuditLog.entity_id == project_id
    ).order_by(AuditLog.performed_at.desc()).all()

    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"

    return [
        {
            "id": log.id,
            "action": log.action,
            "field_name": log.field_name,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]
