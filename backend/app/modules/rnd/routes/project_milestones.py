"""History (Timeline) of an R&D (Prototype / Research) project.

Milestones were removed from R&D projects on 2026-10-30 (R&D rework: tasks
only). The milestone tables stay as read-only history (nothing is dropped);
what is left here is the project's Timeline: project changes logged in
audit_logs (entity_type "rnd_project", including old milestone entries) merged
with every task event, newest first.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.project_task import RndProjectTask, RndProjectTaskEvent
from app.modules.rnd.scope import ensure_in_scope

router = APIRouter(
    tags=["RnD Project Timeline"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "projects"))],
)


def _name(u: User | None) -> str:
    return (u.name or u.email or f"User #{u.id}") if u else "—"


def _project(db: Session, project_id: int, user: User) -> RndProject:
    p = db.query(RndProject).filter(RndProject.id == project_id, RndProject.is_deleted == False).first()  # noqa: E712
    if not p:
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found (it may have been deleted) — refresh the list.")
    ensure_in_scope(db, user, p)
    return p


# ── history ───────────────────────────────────────────────────────────────

TASK_VERBS = {
    "created": "assigned", "update": "posted an update on", "completed": "completed", "extended": "moved the due date of",
    "reopened": "reopened", "cancelled": "cancelled", "edited": "edited", "approval_requested": "asked for approval on",
    "approved": "approved a request on", "rejected": "rejected a request on", "approval_withdrawn": "withdrew an approval request on",
    "progress": "updated progress on", "submitted": "marked done", "closed": "closed",
}


def task_event_text(e, t, users: dict) -> str:
    """One task event as a sentence for a Timeline (project or requirement)."""
    what = "sub-task" if t.parent_task_id else "task"
    verb = TASK_VERBS.get(e.action, e.action)
    text = f"{_name(users.get(e.user_id))} {verb} {what} '{t.title}'"
    if e.action == "created":
        text += f" to {_name(users.get(t.assigned_to_id))}"
    if e.new_due_date and e.action in ("created", "extended", "edited", "reopened"):
        text += f" — due {e.new_due_date:%d %b %Y}"
    if e.remarks:
        text += f". {e.remarks}"
    return text


@router.get("/projects/{project_id}/history")
async def project_history(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything that happened on the project, newest first: project changes
    (audit log) and every task event."""
    project = _project(db, project_id, user)
    logs = db.query(AuditLog).filter(AuditLog.entity_type == "rnd_project", AuditLog.entity_id == project.id).order_by(AuditLog.id.desc()).limit(500).all()
    tasks = {t.id: t for t in db.query(RndProjectTask).filter(RndProjectTask.project_id == project.id).all()}
    events = db.query(RndProjectTaskEvent).filter(RndProjectTaskEvent.task_id.in_(list(tasks))).order_by(RndProjectTaskEvent.id.desc()).limit(500).all() if tasks else []
    uids = {lg.performed_by_id for lg in logs if lg.performed_by_id} | {e.user_id for e in events if e.user_id} | {t.assigned_to_id for t in tasks.values()}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    rows = [{
        "id": f"a{lg.id}", "kind": "milestone" if (lg.action or "").startswith("milestone") else "project",
        "action": lg.action, "summary": lg.summary or lg.action,
        "performed_by": _name(users.get(lg.performed_by_id)) if lg.performed_by_id else "System",
        "performed_at": lg.performed_at.isoformat() if lg.performed_at else None,
    } for lg in logs]
    for e in events:
        t = tasks[e.task_id]
        rows.append({
            "id": f"t{e.id}", "kind": "task", "action": e.action, "summary": task_event_text(e, t, users),
            "performed_by": _name(users.get(e.user_id)) if e.user_id else "System",
            "performed_at": e.created_at.isoformat() if e.created_at else None,
        })
    rows.sort(key=lambda r: r["performed_at"] or "", reverse=True)
    return rows
