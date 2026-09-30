"""Troubleshooting log — faults found on an RRV's electrical system and how
they were traced and fixed."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.electrical.models.cable import ElectricalCable
from app.modules.electrical.models.issue import (
    ElectricalIssue, ELECTRICAL_ISSUE_SEVERITIES, ELECTRICAL_ISSUE_STATUSES, ELECTRICAL_OPEN_ISSUE_STATUSES,
)
from app.modules.electrical.models.job import ElectricalJob
from app.modules.electrical.models.panel import ElectricalPanel
from app.modules.electrical.models.test_record import ElectricalTest
from app.modules.electrical.schemas.issue import (
    ElectricalIssueCreate, ElectricalIssueUpdate, ElectricalIssueResolvePayload, ElectricalIssueResponse,
)
from app.modules.electrical.service import (
    ELECTRICAL_APP, generate_issue_number, get_job_or_404, require_working, user_names,
)
from app.modules.main.models.user import User
from app.utils.notifications import notify_user

router = APIRouter(
    prefix="/electrical", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)

_CAN_EDIT = require_tab_action(ELECTRICAL_APP, "jobs", "edit")


def _to_responses(db: Session, issues: list[ElectricalIssue]) -> list[ElectricalIssueResponse]:
    job_ids = {i.job_id for i in issues}
    jobs = {j.id: j for j in db.query(ElectricalJob).filter(ElectricalJob.id.in_(job_ids)).all()} if job_ids else {}
    test_ids = {i.test_id for i in issues if i.test_id}
    panel_ids = {i.panel_id for i in issues if i.panel_id}
    cable_ids = {i.cable_id for i in issues if i.cable_id}
    tests = {t.id: t.test_number for t in db.query(ElectricalTest).filter(ElectricalTest.id.in_(test_ids)).all()} if test_ids else {}
    panels = {p.id: p.panel_tag for p in db.query(ElectricalPanel).filter(ElectricalPanel.id.in_(panel_ids)).all()} if panel_ids else {}
    cables = {c.id: c.cable_tag for c in db.query(ElectricalCable).filter(ElectricalCable.id.in_(cable_ids)).all()} if cable_ids else {}
    names = user_names(db, {i.reported_by_id for i in issues} | {i.assigned_to_id for i in issues} | {i.resolved_by_id for i in issues})
    out = []
    for i in issues:
        resp = ElectricalIssueResponse.model_validate(i)
        job = jobs.get(i.job_id)
        resp.job_number = job.job_number if job else None
        resp.job_title = job.title if job else None
        resp.test_number = tests.get(i.test_id)
        resp.panel_tag = panels.get(i.panel_id)
        resp.cable_tag = cables.get(i.cable_id)
        resp.reported_by_name = names.get(i.reported_by_id)
        resp.assigned_to_name = names.get(i.assigned_to_id)
        resp.resolved_by_name = names.get(i.resolved_by_id)
        out.append(resp)
    return out


def _get_issue(db: Session, issue_id: int) -> ElectricalIssue:
    issue = db.query(ElectricalIssue).filter(ElectricalIssue.id == issue_id, ElectricalIssue.is_deleted == False).first()  # noqa: E712
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue #{issue_id} not found (it may have been deleted).")
    return issue


def _validate(db: Session, job_id: int, data: dict) -> None:
    if data.get("severity") and data["severity"] not in ELECTRICAL_ISSUE_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity '{data['severity']}'. Use one of: {', '.join(ELECTRICAL_ISSUE_SEVERITIES)}.")
    for key, model, noun in (("test_id", ElectricalTest, "Test"), ("panel_id", ElectricalPanel, "Panel"), ("cable_id", ElectricalCable, "Cable")):
        if data.get(key) and not db.query(model).filter(model.id == data[key], model.job_id == job_id, model.is_deleted == False).first():  # noqa: E712
            raise HTTPException(status_code=404, detail=f"{noun} #{data[key]} isn't on this job. Pick one of this job's records.")
    if data.get("assigned_to_id") and not db.query(User).filter(User.id == data["assigned_to_id"], User.is_active == True).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"User #{data['assigned_to_id']} not found or inactive. Pick someone else to assign.")


def _notify_assignee(db: Session, issue: ElectricalIssue, job: ElectricalJob, actor: User) -> None:
    if issue.assigned_to_id and issue.assigned_to_id != actor.id:
        notify_user(
            db, issue.assigned_to_id, title="Electrical Issue Assigned",
            message=f"{issue.issue_number} on {job.job_number}: {issue.title} ({issue.severity}).",
            notification_type="electrical_issue_assigned", entity_type="electrical_job", entity_id=job.id,
        )


@router.get("/issues", response_model=list[ElectricalIssueResponse])
async def list_issues(
    job_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    severity: str | None = None,
    mine: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access(ELECTRICAL_APP, "troubleshooting")),
):
    query = db.query(ElectricalIssue).join(ElectricalJob, ElectricalJob.id == ElectricalIssue.job_id).filter(
        ElectricalIssue.is_deleted == False, ElectricalJob.is_deleted == False  # noqa: E712
    )
    if job_id:
        query = query.filter(ElectricalIssue.job_id == job_id)
    if status_filter == "open":
        query = query.filter(ElectricalIssue.status.in_(ELECTRICAL_OPEN_ISSUE_STATUSES))
    elif status_filter:
        query = query.filter(ElectricalIssue.status == status_filter)
    if severity:
        query = query.filter(ElectricalIssue.severity == severity)
    if mine:
        query = query.filter(ElectricalIssue.assigned_to_id == user.id)
    return _to_responses(db, query.order_by(ElectricalIssue.created_at.desc()).limit(500).all())


@router.get("/jobs/{job_id}/issues", response_model=list[ElectricalIssueResponse])
async def list_job_issues(job_id: int, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    issues = db.query(ElectricalIssue).filter(
        ElectricalIssue.job_id == job_id, ElectricalIssue.is_deleted == False  # noqa: E712
    ).order_by(ElectricalIssue.issue_number.desc()).all()
    return _to_responses(db, issues)


@router.post("/jobs/{job_id}/issues", response_model=ElectricalIssueResponse)
async def create_issue(job_id: int, payload: ElectricalIssueCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "log issues")
    data = payload.model_dump()
    data["title"] = data["title"].strip()
    _validate(db, job_id, data)
    issue = ElectricalIssue(**data, job_id=job_id, issue_number=generate_issue_number(db, job_id), status="open", reported_by_id=user.id)
    db.add(issue)
    db.flush()
    _notify_assignee(db, issue, job, user)
    db.commit()
    db.refresh(issue)
    return _to_responses(db, [issue])[0]


@router.patch("/issues/{issue_id}", response_model=ElectricalIssueResponse)
async def update_issue(issue_id: int, payload: ElectricalIssueUpdate, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    issue = _get_issue(db, issue_id)
    job = get_job_or_404(db, issue.job_id, lock=True)
    require_working(job, "change its issues")
    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates:
        # Resolving has its own endpoint (it needs a root cause); here only open ↔ investigating.
        if updates["status"] not in ELECTRICAL_ISSUE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{updates['status']}'. Use one of: {', '.join(ELECTRICAL_ISSUE_STATUSES)}.")
        if updates["status"] not in ELECTRICAL_OPEN_ISSUE_STATUSES or issue.status not in ELECTRICAL_OPEN_ISSUE_STATUSES:
            raise HTTPException(status_code=400, detail="Use Resolve / Close / Reopen to change a resolved or closed issue's status.")
    if updates.get("title"):
        updates["title"] = updates["title"].strip()
    _validate(db, job.id, updates)
    reassigned = "assigned_to_id" in updates and updates["assigned_to_id"] and updates["assigned_to_id"] != issue.assigned_to_id
    for field, val in updates.items():
        setattr(issue, field, val)
    if reassigned:
        _notify_assignee(db, issue, job, user)
    db.commit()
    db.refresh(issue)
    return _to_responses(db, [issue])[0]


@router.post("/issues/{issue_id}/resolve", response_model=ElectricalIssueResponse)
async def resolve_issue(issue_id: int, payload: ElectricalIssueResolvePayload, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    issue = _get_issue(db, issue_id)
    job = get_job_or_404(db, issue.job_id, lock=True)
    require_working(job, "resolve issues")
    if issue.status not in ELECTRICAL_OPEN_ISSUE_STATUSES:
        raise HTTPException(status_code=409, detail=f"Issue {issue.issue_number} is already {issue.status}.")
    issue.root_cause = payload.root_cause.strip()
    issue.corrective_action = payload.corrective_action.strip()
    issue.status = "resolved"
    issue.resolved_by_id = user.id
    issue.resolved_at = datetime.now(timezone.utc)
    if issue.reported_by_id and issue.reported_by_id != user.id:
        notify_user(
            db, issue.reported_by_id, title="Electrical Issue Resolved",
            message=f"{issue.issue_number} on {job.job_number} ({issue.title}) was resolved: {issue.corrective_action}",
            notification_type="electrical_issue_resolved", entity_type="electrical_job", entity_id=job.id,
        )
    db.commit()
    db.refresh(issue)
    return _to_responses(db, [issue])[0]


@router.post("/issues/{issue_id}/close", response_model=ElectricalIssueResponse)
async def close_issue(issue_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    issue = _get_issue(db, issue_id)
    job = get_job_or_404(db, issue.job_id, lock=True)
    require_working(job, "close issues")
    if issue.status != "resolved":
        raise HTTPException(status_code=409, detail=f"Issue {issue.issue_number} is {issue.status}. Resolve it (with its root cause and fix) before closing.")
    issue.status = "closed"
    db.commit()
    db.refresh(issue)
    return _to_responses(db, [issue])[0]


@router.post("/issues/{issue_id}/reopen", response_model=ElectricalIssueResponse)
async def reopen_issue(issue_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    issue = _get_issue(db, issue_id)
    job = get_job_or_404(db, issue.job_id, lock=True)
    require_working(job, "reopen issues")
    if issue.status in ELECTRICAL_OPEN_ISSUE_STATUSES:
        raise HTTPException(status_code=409, detail=f"Issue {issue.issue_number} is already {issue.status}.")
    issue.status = "open"
    issue.resolved_at = None
    issue.resolved_by_id = None
    db.commit()
    db.refresh(issue)
    return _to_responses(db, [issue])[0]


@router.delete("/issues/{issue_id}")
async def delete_issue(issue_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    issue = _get_issue(db, issue_id)
    job = get_job_or_404(db, issue.job_id, lock=True)
    require_working(job, "change its issues")
    if issue.status not in ELECTRICAL_OPEN_ISSUE_STATUSES:
        raise HTTPException(status_code=409, detail=f"Issue {issue.issue_number} is {issue.status} and stays on record as troubleshooting history.")
    if not (user.role == "admin" or issue.reported_by_id == user.id):
        raise HTTPException(status_code=403, detail="Only the person who logged this issue (or an admin) can delete it.")
    issue.is_deleted = True
    issue.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Issue {issue.issue_number} deleted"}
