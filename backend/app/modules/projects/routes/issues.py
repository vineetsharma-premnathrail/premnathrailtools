from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.issue import PmIssue, PM_ISSUE_SEVERITIES, PM_ISSUE_STATUSES
from app.modules.projects.schemas.issue import PmIssueCreate, PmIssueUpdate, PmIssueResponse

router = APIRouter(
    prefix="/projects/{project_id}/issues", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="issues",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_issue_or_404(db: Session, project_id: int, issue_id: int) -> PmIssue:
    issue = db.query(PmIssue).filter(
        PmIssue.id == issue_id, PmIssue.project_id == project_id
    ).first()
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue #{issue_id} not found on project #{project_id}")
    return issue


def _to_response(db: Session, issue: PmIssue) -> PmIssueResponse:
    resp = PmIssueResponse.model_validate(issue)
    if issue.raised_by_id:
        raised_by = db.query(User).filter(User.id == issue.raised_by_id).first()
        if raised_by:
            resp.raised_by_name = raised_by.name or raised_by.email
    if issue.assigned_to_id:
        assigned_to = db.query(User).filter(User.id == issue.assigned_to_id).first()
        if assigned_to:
            resp.assigned_to_name = assigned_to.name or assigned_to.email
    return resp


@router.get("", response_model=list[PmIssueResponse])
async def list_issues(
    project_id: int,
    status_filter: str | None = Query(None, alias="status"),
    severity: str | None = Query(None),
    assigned_to_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmIssue).filter(PmIssue.project_id == project_id)
    if status_filter:
        query = query.filter(PmIssue.status == status_filter)
    if severity:
        query = query.filter(PmIssue.severity == severity)
    if assigned_to_id is not None:
        query = query.filter(PmIssue.assigned_to_id == assigned_to_id)
    issues = query.order_by(PmIssue.id.asc()).all()
    return [_to_response(db, i) for i in issues]


@router.post("", response_model=PmIssueResponse)
async def create_issue(
    project_id: int,
    payload: PmIssueCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    if payload.severity and payload.severity not in PM_ISSUE_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity '{payload.severity}'. Must be one of {PM_ISSUE_SEVERITIES}.")
    if payload.assigned_to_id is not None:
        if not db.query(User).filter(User.id == payload.assigned_to_id).first():
            raise HTTPException(status_code=404, detail=f"User #{payload.assigned_to_id} not found")

    issue = PmIssue(
        project_id=project_id,
        title=payload.title,
        description=payload.description,
        severity=payload.severity or "medium",
        status="open",
        raised_by_id=user.id,
        assigned_to_id=payload.assigned_to_id,
        raised_date=payload.raised_date or date.today(),
    )
    db.add(issue)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Issue '{issue.title}' created by {user.name or user.email}.")

    db.commit()
    db.refresh(issue)
    return _to_response(db, issue)


@router.patch("/{issue_id}", response_model=PmIssueResponse)
async def update_issue(
    project_id: int,
    issue_id: int,
    payload: PmIssueUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    issue = _get_issue_or_404(db, project_id, issue_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in PM_ISSUE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Must be one of {PM_ISSUE_STATUSES}.")
    new_severity = updates.get("severity")
    if new_severity and new_severity not in PM_ISSUE_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity '{new_severity}'. Must be one of {PM_ISSUE_SEVERITIES}.")
    if "assigned_to_id" in updates and updates["assigned_to_id"] is not None:
        if not db.query(User).filter(User.id == updates["assigned_to_id"]).first():
            raise HTTPException(status_code=404, detail=f"User #{updates['assigned_to_id']} not found")

    if new_status in ("resolved", "closed") and "resolved_date" not in updates:
        updates["resolved_date"] = date.today()

    for field, val in updates.items():
        old_val = getattr(issue, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(issue, field, val)

    db.commit()
    db.refresh(issue)
    return _to_response(db, issue)


@router.delete("/{issue_id}")
async def delete_issue(
    project_id: int,
    issue_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    issue = _get_issue_or_404(db, project_id, issue_id)

    _write_audit(db, project_id, "deleted", user, summary=f"Issue '{issue.title}' deleted by {user.name or user.email}.")
    db.delete(issue)
    db.commit()
    return {"message": "Issue deleted"}
