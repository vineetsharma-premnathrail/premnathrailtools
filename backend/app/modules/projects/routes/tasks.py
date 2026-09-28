from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask, PM_TASK_STATUSES, PM_TASK_PRIORITIES
from app.modules.projects.schemas.task import PmProjectTaskCreate, PmProjectTaskUpdate, PmProjectTaskResponse

router = APIRouter(
    prefix="/projects/{project_id}/tasks", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="tasks",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_task_or_404(db: Session, project_id: int, task_id: int) -> PmProjectTask:
    task = db.query(PmProjectTask).filter(
        PmProjectTask.id == task_id, PmProjectTask.project_id == project_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task #{task_id} not found on project #{project_id}")
    return task


def _to_response(db: Session, task: PmProjectTask) -> PmProjectTaskResponse:
    resp = PmProjectTaskResponse.model_validate(task)
    if task.assignee_id:
        assignee = db.query(User).filter(User.id == task.assignee_id).first()
        if assignee:
            resp.assignee_name = assignee.name or assignee.email
    return resp


@router.get("", response_model=list[PmProjectTaskResponse])
async def list_tasks(
    project_id: int,
    phase_id: int | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    assignee_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmProjectTask).filter(PmProjectTask.project_id == project_id)
    if phase_id is not None:
        query = query.filter(PmProjectTask.phase_id == phase_id)
    if status_filter:
        query = query.filter(PmProjectTask.status == status_filter)
    if assignee_id is not None:
        query = query.filter(PmProjectTask.assignee_id == assignee_id)
    tasks = query.order_by(PmProjectTask.id.asc()).all()
    return [_to_response(db, t) for t in tasks]


@router.post("", response_model=PmProjectTaskResponse)
async def create_task(
    project_id: int,
    payload: PmProjectTaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    if payload.priority not in PM_TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{payload.priority}'. Must be one of {PM_TASK_PRIORITIES}.")
    if payload.phase_id is not None:
        from app.modules.projects.models.phase import PmProjectPhase
        if not db.query(PmProjectPhase).filter(PmProjectPhase.id == payload.phase_id, PmProjectPhase.project_id == project_id).first():
            raise HTTPException(status_code=404, detail=f"Phase #{payload.phase_id} not found on project #{project_id}")
    if payload.parent_task_id is not None:
        if not db.query(PmProjectTask).filter(PmProjectTask.id == payload.parent_task_id, PmProjectTask.project_id == project_id).first():
            raise HTTPException(status_code=404, detail=f"Parent task #{payload.parent_task_id} not found on project #{project_id}")
    if payload.assignee_id is not None:
        if not db.query(User).filter(User.id == payload.assignee_id).first():
            raise HTTPException(status_code=404, detail=f"User #{payload.assignee_id} not found")

    task = PmProjectTask(
        project_id=project_id,
        phase_id=payload.phase_id,
        parent_task_id=payload.parent_task_id,
        title=payload.title,
        description=payload.description,
        assignee_id=payload.assignee_id,
        priority=payload.priority,
        start_date=payload.start_date,
        due_date=payload.due_date,
        status="not_started",
        percent_complete=0,
    )
    db.add(task)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Task '{task.title}' created by {user.name or user.email}.")

    db.commit()
    db.refresh(task)
    return _to_response(db, task)


@router.patch("/{task_id}", response_model=PmProjectTaskResponse)
async def update_task(
    project_id: int,
    task_id: int,
    payload: PmProjectTaskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    task = _get_task_or_404(db, project_id, task_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in PM_TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Must be one of {PM_TASK_STATUSES}.")
    new_priority = updates.get("priority")
    if new_priority and new_priority not in PM_TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{new_priority}'. Must be one of {PM_TASK_PRIORITIES}.")
    if "percent_complete" in updates and updates["percent_complete"] is not None:
        pct = updates["percent_complete"]
        if pct < 0 or pct > 100:
            raise HTTPException(status_code=422, detail=f"percent_complete must be between 0 and 100, got {pct}.")
    if "phase_id" in updates and updates["phase_id"] is not None:
        from app.modules.projects.models.phase import PmProjectPhase
        if not db.query(PmProjectPhase).filter(PmProjectPhase.id == updates["phase_id"], PmProjectPhase.project_id == project_id).first():
            raise HTTPException(status_code=404, detail=f"Phase #{updates['phase_id']} not found on project #{project_id}")
    if "parent_task_id" in updates and updates["parent_task_id"] is not None:
        if updates["parent_task_id"] == task_id:
            raise HTTPException(status_code=422, detail="A task cannot be its own parent.")
        if not db.query(PmProjectTask).filter(PmProjectTask.id == updates["parent_task_id"], PmProjectTask.project_id == project_id).first():
            raise HTTPException(status_code=404, detail=f"Parent task #{updates['parent_task_id']} not found on project #{project_id}")
    if "assignee_id" in updates and updates["assignee_id"] is not None:
        if not db.query(User).filter(User.id == updates["assignee_id"]).first():
            raise HTTPException(status_code=404, detail=f"User #{updates['assignee_id']} not found")

    for field, val in updates.items():
        old_val = getattr(task, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(task, field, val)

    db.commit()
    db.refresh(task)
    return _to_response(db, task)


@router.delete("/{task_id}")
async def delete_task(
    project_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    task = _get_task_or_404(db, project_id, task_id)

    # A subtask's own work isn't invalidated by its parent going away — orphan
    # rather than cascade-delete.
    db.query(PmProjectTask).filter(PmProjectTask.parent_task_id == task_id).update({"parent_task_id": None})

    _write_audit(db, project_id, "deleted", user, summary=f"Task '{task.title}' deleted by {user.name or user.email}.")
    db.delete(task)
    db.commit()
    return {"message": "Task deleted"}
