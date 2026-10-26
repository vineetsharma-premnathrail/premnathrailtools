"""Project Plan & Milestones on an R&D (Prototype / Research) project — the
same plan as Project Management: milestones on a timeline, each with one
responsible person (plus optional co-owners) and an expected achievable date;
the project's tasks are created inside a milestone.

Who does what (record rules — the role's features in core/features/rnd.py
apply on top):
  * project leads / admins add, edit, delete, reopen and cancel milestones;
  * the responsible people (and leads) mark a milestone achieved — only once
    every task in it is finished — and can add tasks to it;
  * delete only while no task was ever created in it, otherwise cancel.

Also serves the project's History tab: milestone / project changes logged in
audit_logs (entity_type "rnd_project") merged with the task events.
"""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.audit import record_audit
from app.core.permissions import ensure_feature_action, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.project_milestone import (
    RND_MILESTONE_ICONS, RND_MILESTONE_OPEN, RND_MILESTONE_STATUS_LABELS, RndProjectMilestone,
)
from app.modules.rnd.models.project_task import RndProjectTask, RndProjectTaskEvent
from app.modules.rnd.scope import ensure_in_scope
from app.modules.rnd.services import project_roles as roles
from app.utils.notifications import notify_user

RULE_KEY = "rnd:projects.milestones"  # core/assignee_rules.PICKERS
router = APIRouter(
    tags=["RnD Project Milestones"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "projects"))],
)

FINISHED = ("submitted", "closed")   # a task counts as done (rnd_project_tasks.status)


# ── helpers ───────────────────────────────────────────────────────────────

def _name(u: User | None) -> str:
    return (u.name or u.email or f"User #{u.id}") if u else "—"


def _project(db: Session, project_id: int, user: User) -> RndProject:
    p = db.query(RndProject).filter(RndProject.id == project_id, RndProject.is_deleted == False).first()  # noqa: E712
    if not p:
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found (it may have been deleted) — refresh the list.")
    ensure_in_scope(db, user, p)
    return p


def _milestone(db: Session, project: RndProject, milestone_id: int) -> RndProjectMilestone:
    m = db.query(RndProjectMilestone).filter(RndProjectMilestone.id == milestone_id).first()
    if not m or m.project_id != project.id:
        raise HTTPException(status_code=404, detail=f"Milestone #{milestone_id} isn't on {project.project_number} any more — refresh the page.")
    return m


def owner_ids(m: RndProjectMilestone) -> list[int]:
    return list(dict.fromkeys([m.assignee_id, *(m.co_owner_ids or [])]))


def can_plan(user: User, project: RndProject, m: RndProjectMilestone) -> bool:
    """Leads / admins, and the milestone's responsible people, add tasks to it."""
    return roles.can_manage(user, project) or user.id in owner_ids(m)


def _ensure_lead(user: User, project: RndProject, what: str) -> None:
    if not roles.can_manage(user, project):
        raise HTTPException(status_code=403, detail=f"Only a project lead of {project.project_number} can {what}. Ask a lead, or have them add you as a lead.")


def _audit(db: Session, project: RndProject, user: User, action: str, summary: str) -> None:
    record_audit(db, entity_type="rnd_project", entity_id=project.id, action=action, module_key="rnd", summary=summary, user_id=user.id)


def _team_ids(project: RndProject) -> list[int]:
    return list(dict.fromkeys([*roles.lead_ids(project), *roles.member_ids(project)]))


def _check_people(db: Session, project: RndProject, user: User, assignee_id: int | None, co_ids: list[int] | None) -> tuple[int, list[int]]:
    if not assignee_id:
        raise HTTPException(status_code=422, detail="Pick the person responsible for the milestone.")
    team = _team_ids(project)
    clean: list[int] = []
    for uid in [assignee_id, *(co_ids or [])]:
        if uid in clean:
            continue
        u = db.query(User).filter(User.id == uid).first()
        if not u or not u.is_active:
            raise HTTPException(status_code=422, detail=f"User #{uid} doesn't exist or is deactivated — pick an active person.")
        if uid not in team:
            raise HTTPException(status_code=422, detail=f"{_name(u)} isn't on {project.project_number}'s team. Add them under Project Members (Edit → Project Leads / Team Members) first, then make them responsible.")
        assignee_rules.ensure_allowed(db, user, RULE_KEY, u)
        clean.append(uid)
    return clean[0], clean[1:]


def _check_dates(project: RndProject, start: date | None, due: date | None) -> None:
    if not due:
        raise HTTPException(status_code=422, detail="Expected achievable date (End Date) is required.")
    if start and start > due:
        raise HTTPException(status_code=422, detail=f"Start date {start:%d %b %Y} is after the end date {due:%d %b %Y}.")
    if project.start_date and (start or due) < project.start_date:
        raise HTTPException(status_code=422, detail=f"The milestone can't start before the project starts ({project.start_date:%d %b %Y}). Pick a later date, or move the project's Start Date first (Edit).")
    if project.target_end_date and due > project.target_end_date:
        raise HTTPException(status_code=422, detail=f"End date {due:%d %b %Y} is after the project's Target End Date ({project.target_end_date:%d %b %Y}). Pick an earlier date, or move the project's Target End Date first (Edit).")


def _check_look(color: str | None, icon: str | None) -> None:
    if icon and icon not in RND_MILESTONE_ICONS:
        raise HTTPException(status_code=422, detail=f"Icon '{icon}' isn't one of the milestone icons — pick one from the Icons panel.")
    if color and (len(color) not in (4, 7, 9) or not color.startswith("#")):
        raise HTTPException(status_code=422, detail=f"Colour '{color}' isn't a valid colour — pick an icon, its colour is used.")


def _tasks(db: Session, milestone_ids: list[int]) -> list[RndProjectTask]:
    if not milestone_ids:
        return []
    return db.query(RndProjectTask).filter(RndProjectTask.milestone_id.in_(milestone_ids)).all()


def serialize(db: Session, user: User, project: RndProject, rows: list[RndProjectMilestone]) -> list[dict]:
    tasks = _tasks(db, [m.id for m in rows])
    uids = {uid for m in rows for uid in owner_ids(m)} | {m.created_by_id for m in rows if m.created_by_id} | {m.completed_by_id for m in rows if m.completed_by_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    today = today_ist()
    lead = roles.can_manage(user, project)
    out = []
    for m in rows:
        # Progress counts the milestone's top-level tasks (sub-tasks are part of their task).
        mine = [t for t in tasks if t.milestone_id == m.id and not t.parent_task_id and t.status != "cancelled"]
        ever = [t for t in tasks if t.milestone_id == m.id]
        owner = users.get(m.assignee_id)
        open_ = m.status in RND_MILESTONE_OPEN
        out.append({
            "id": m.id, "project_id": m.project_id, "title": m.title, "description": m.description,
            "assignee_id": m.assignee_id, "assignee_name": _name(owner) if owner else None,
            "department_name": getattr(owner, "department", None) if owner else None,
            "co_owner_ids": list(m.co_owner_ids or []),
            "co_owner_names": [_name(users.get(i)) for i in (m.co_owner_ids or []) if users.get(i)],
            "start_date": m.start_date.isoformat() if m.start_date else None,
            "due_date": m.due_date.isoformat(),
            "status": m.status, "status_label": RND_MILESTONE_STATUS_LABELS.get(m.status, m.status),
            "blocker_reason": m.blocker_reason, "reopen_reason": m.reopen_reason, "cancel_reason": m.cancel_reason,
            "color": m.color, "icon": m.icon,
            "created_by_name": _name(users.get(m.created_by_id)) if m.created_by_id else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "completed_by_name": _name(users.get(m.completed_by_id)) if m.completed_by_id else None,
            "completed_at": m.completed_at.isoformat() if m.completed_at else None,
            "is_overdue": open_ and today > m.due_date,
            "tasks_total": len(mine),
            "tasks_done": sum(1 for t in mine if t.status in FINISHED),
            "tasks": [{"id": t.id, "title": t.title, "done": t.status in FINISHED} for t in sorted(mine, key=lambda t: (t.due_date, t.id))],
            "can_edit": lead,
            "can_work": lead or user.id in owner_ids(m),
            "can_plan": open_ and can_plan(user, project, m),
            "can_delete": lead and not ever,
        })
    return out


def _notify(db: Session, project: RndProject, actor: User, ids: set[int], title: str, message: str, kind: str) -> None:
    for uid in ids - {actor.id}:
        notify_user(db, uid, title=title, message=message, notification_type=kind, entity_type="rnd_project", entity_id=project.id)


# ── milestones ────────────────────────────────────────────────────────────

class MilestoneIn(BaseModel):
    title: str | None = None
    description: str | None = None
    assignee_id: int | None = None
    co_owner_ids: list[int] | None = None
    start_date: date | None = None
    due_date: date | None = None
    status: str | None = None          # todo | in_progress | blocked (Achieved / Cancelled use /status)
    blocker_reason: str | None = None
    color: str | None = None
    icon: str | None = None


class StatusIn(BaseModel):
    action: str                        # done | reopen | cancel
    reason: str | None = None


@router.get("/projects/{project_id}/milestones")
async def list_milestones(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = _project(db, project_id, user)
    ensure_feature_action(user, "rnd", "projects", "milestones", "view")
    rows = db.query(RndProjectMilestone).filter(RndProjectMilestone.project_id == project.id).order_by(RndProjectMilestone.due_date, RndProjectMilestone.id).all()
    return serialize(db, user, project, rows)


@router.get("/projects/{project_id}/milestone-people")
async def milestone_people(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Who can be made responsible: the project team (leads + members), narrowed by the role's 'Assign to' rule."""
    project = _project(db, project_id, user)
    ids = _team_ids(project)
    found = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    leads = set(roles.lead_ids(project))
    rows = [{"id": u.id, "name": _name(u), "department": getattr(u, "department", None), "designation": getattr(u, "designation", None),
             "team_role": "lead" if u.id in leads else "member"} for i in ids if (u := found.get(i)) and u.is_active]
    return assignee_rules.filter_people(db, user, RULE_KEY, rows)


@router.post("/projects/{project_id}/milestones")
async def create_milestone(project_id: int, payload: MilestoneIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = _project(db, project_id, user)
    _ensure_lead(user, project, "add milestones")
    ensure_feature_action(user, "rnd", "projects", "milestones", "create")
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Milestone name is required.")
    if len(title) > 200:
        raise HTTPException(status_code=422, detail=f"Milestone name is {len(title)} characters — keep it under 200 and put details in Description.")
    _check_dates(project, payload.start_date, payload.due_date)
    assignee, co = _check_people(db, project, user, payload.assignee_id, payload.co_owner_ids)
    _check_look(payload.color, payload.icon)
    status = payload.status or "todo"
    if status not in ("todo", "in_progress", "blocked"):
        raise HTTPException(status_code=422, detail="A new milestone is Not Started, In Progress or On Hold — Achieved is set once its tasks are done.")
    blocker = (payload.blocker_reason or "").strip() or None
    if status == "blocked" and not blocker:
        raise HTTPException(status_code=422, detail="Say why the milestone is on hold.")
    m = RndProjectMilestone(
        project_id=project.id, title=title, description=(payload.description or "").strip() or None,
        assignee_id=assignee, co_owner_ids=co, start_date=payload.start_date, due_date=payload.due_date,
        status=status, blocker_reason=blocker if status == "blocked" else None,
        color=payload.color, icon=payload.icon, created_by_id=user.id,
    )
    db.add(m)
    db.flush()
    _audit(db, project, user, "milestone_created",
           f"Milestone '{m.title}' added by {_name(user)} — responsible {_name(db.get(User, assignee))}, expected by {m.due_date:%d %b %Y}.")
    _notify(db, project, user, {assignee, *co}, f"Milestone on {project.project_number} — {project.title}",
            f"{_name(user)} made you responsible for '{m.title}', expected by {m.due_date:%d %b %Y}. Add its tasks on the project's Milestones tab.",
            "rnd_project_milestone_assigned")
    db.commit()
    db.refresh(m)
    return serialize(db, user, project, [m])[0]


@router.patch("/projects/{project_id}/milestones/{milestone_id}")
async def edit_milestone(project_id: int, milestone_id: int, payload: MilestoneIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = _project(db, project_id, user)
    _ensure_lead(user, project, "edit milestones")
    ensure_feature_action(user, "rnd", "projects", "milestones", "edit")
    m = _milestone(db, project, milestone_id)
    data = payload.model_dump(exclude_unset=True)
    changes: list[str] = []

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="Milestone name can't be empty.")
        if len(title) > 200:
            raise HTTPException(status_code=422, detail=f"Milestone name is {len(title)} characters — keep it under 200 and put details in Description.")
        if title != m.title:
            changes.append(f"name '{m.title}' → '{title}'")
            m.title = title
    if "description" in data:
        desc = (data["description"] or "").strip() or None
        if desc != m.description:
            changes.append("description updated")
            m.description = desc
    start = data["start_date"] if "start_date" in data else m.start_date
    due = data["due_date"] if "due_date" in data else m.due_date
    if start != m.start_date or due != m.due_date:
        _check_dates(project, start, due)
        late = [t for t in _tasks(db, [m.id]) if not t.parent_task_id and t.status == "open" and t.due_date > due]
        if late:
            names = ", ".join(f"'{t.title}' ({t.due_date:%d %b %Y})" for t in late[:3]) + (f" and {len(late) - 3} more" if len(late) > 3 else "")
            raise HTTPException(status_code=422, detail=f"Open task(s) in this milestone are due after {due:%d %b %Y}: {names}. Move those tasks earlier first, or pick a later end date.")
        if due != m.due_date:
            changes.append(f"end date {m.due_date:%d %b %Y} → {due:%d %b %Y}")
        if start != m.start_date:
            changes.append(f"start date {m.start_date:%d %b %Y} → {start:%d %b %Y}" if m.start_date and start else "start date changed")
        m.start_date, m.due_date = start, due
    old_owners = set(owner_ids(m))
    if "assignee_id" in data or "co_owner_ids" in data:
        assignee, co = _check_people(db, project, user, data.get("assignee_id", m.assignee_id),
                                     data["co_owner_ids"] if data.get("co_owner_ids") is not None else (m.co_owner_ids or []))
        if assignee != m.assignee_id:
            changes.append(f"responsible {_name(db.get(User, m.assignee_id))} → {_name(db.get(User, assignee))}")
        if co != list(m.co_owner_ids or []):
            changes.append("more responsible people changed")
        m.assignee_id, m.co_owner_ids = assignee, co
    if "color" in data or "icon" in data:
        _check_look(data.get("color", m.color), data.get("icon", m.icon))
        m.color, m.icon = data.get("color", m.color), data.get("icon", m.icon)
    if data.get("status") and data["status"] != m.status:
        new = data["status"]
        if m.status not in RND_MILESTONE_OPEN:
            raise HTTPException(status_code=409, detail=f"'{m.title}' is {RND_MILESTONE_STATUS_LABELS[m.status]} — use Reopen on the milestone to change its status.")
        if new not in RND_MILESTONE_OPEN:
            raise HTTPException(status_code=422, detail="Achieved and Cancelled are set with the buttons on the milestone, not on the form.")
        blocker = (data.get("blocker_reason") or "").strip()
        if new == "blocked" and not blocker:
            raise HTTPException(status_code=422, detail="Say why the milestone is on hold.")
        changes.append(f"status {RND_MILESTONE_STATUS_LABELS[m.status]} → {RND_MILESTONE_STATUS_LABELS[new]}" + (f" ({blocker})" if new == "blocked" else ""))
        m.status, m.blocker_reason = new, blocker if new == "blocked" else None
    elif m.status == "blocked" and "blocker_reason" in data and (data["blocker_reason"] or "").strip() and data["blocker_reason"].strip() != m.blocker_reason:
        m.blocker_reason = data["blocker_reason"].strip()
        changes.append("on-hold reason updated")

    if changes:
        _audit(db, project, user, "milestone_updated", f"Milestone '{m.title}' edited by {_name(user)}: " + "; ".join(changes) + ".")
        added = set(owner_ids(m)) - old_owners
        _notify(db, project, user, added, f"Milestone on {project.project_number} — {project.title}",
                f"{_name(user)} made you responsible for '{m.title}', expected by {m.due_date:%d %b %Y}.", "rnd_project_milestone_assigned")
        _notify(db, project, user, set(owner_ids(m)) - added, f"Milestone changed ({project.project_number})",
                f"{_name(user)} changed '{m.title}': " + "; ".join(changes) + ".", "rnd_project_milestone_edited")
    db.commit()
    db.refresh(m)
    return serialize(db, user, project, [m])[0]


@router.post("/projects/{project_id}/milestones/{milestone_id}/status")
async def milestone_status(project_id: int, milestone_id: int, payload: StatusIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = _project(db, project_id, user)
    m = _milestone(db, project, milestone_id)
    reason = (payload.reason or "").strip()
    action = payload.action
    if action == "done":
        ensure_feature_action(user, "rnd", "projects", "milestone_status", "approve")
        if not (roles.can_manage(user, project) or user.id in owner_ids(m)):
            raise HTTPException(status_code=403, detail=f"Only the people responsible for '{m.title}' (or a project lead) can mark it achieved.")
        if m.status not in RND_MILESTONE_OPEN:
            raise HTTPException(status_code=409, detail=f"'{m.title}' is already {RND_MILESTONE_STATUS_LABELS[m.status]}.")
        open_tasks = [t for t in _tasks(db, [m.id]) if t.status == "open"]
        if open_tasks:
            names = ", ".join(f"'{t.title}'" for t in open_tasks[:3]) + (f" and {len(open_tasks) - 3} more" if len(open_tasks) > 3 else "")
            raise HTTPException(status_code=409, detail=f"{len(open_tasks)} task(s) in '{m.title}' are still open: {names}. Each must be completed (or cancelled) before the milestone is achieved.")
        m.status, m.completed_at, m.completed_by_id, m.blocker_reason = "done", datetime.now(timezone.utc), user.id, None
        late = (today_ist() - m.due_date).days
        _audit(db, project, user, "milestone_achieved", f"Milestone '{m.title}' marked achieved by {_name(user)}" + (f" — {late} day(s) after its expected date." if late > 0 else "."))
        _notify(db, project, user, {*owner_ids(m), *roles.lead_ids(project)}, f"Milestone achieved ({project.project_number})",
                f"{_name(user)} marked '{m.title}' achieved.", "rnd_project_milestone_achieved")
    elif action in ("reopen", "cancel"):
        ensure_feature_action(user, "rnd", "projects", "milestone_status", "edit" if action == "reopen" else "cancel")
        _ensure_lead(user, project, f"{action} milestones")
        if not reason:
            raise HTTPException(status_code=422, detail=f"Say why '{m.title}' is being {'reopened' if action == 'reopen' else 'cancelled'}.")
        if action == "reopen":
            if m.status != "done":
                raise HTTPException(status_code=409, detail=f"'{m.title}' is {RND_MILESTONE_STATUS_LABELS[m.status]} — only an achieved milestone can be reopened.")
            m.status, m.reopen_reason, m.completed_at, m.completed_by_id = "in_progress", reason, None, None
        else:
            if m.status not in RND_MILESTONE_OPEN:
                raise HTTPException(status_code=409, detail=f"'{m.title}' is {RND_MILESTONE_STATUS_LABELS[m.status]} — only an open milestone can be cancelled.")
            open_tasks = [t for t in _tasks(db, [m.id]) if t.status == "open"]
            if open_tasks:
                names = ", ".join(f"'{t.title}'" for t in open_tasks[:3]) + (f" and {len(open_tasks) - 3} more" if len(open_tasks) > 3 else "")
                raise HTTPException(status_code=409, detail=f"'{m.title}' still has {len(open_tasks)} open task(s): {names}. Cancel those tasks first (each keeps its own reason and history), then cancel the milestone.")
            m.status, m.cancel_reason = "cancelled", reason
        _audit(db, project, user, f"milestone_{action}", f"Milestone '{m.title}' {'reopened' if action == 'reopen' else 'cancelled'} by {_name(user)}. Reason: {reason}")
        _notify(db, project, user, set(owner_ids(m)), f"Milestone {'reopened' if action == 'reopen' else 'cancelled'} ({project.project_number})",
                f"{_name(user)} {'reopened' if action == 'reopen' else 'cancelled'} '{m.title}'. Reason: {reason}", "rnd_project_milestone_edited")
    else:
        raise HTTPException(status_code=422, detail="Action must be done, reopen or cancel.")
    db.commit()
    db.refresh(m)
    return serialize(db, user, project, [m])[0]


@router.delete("/projects/{project_id}/milestones/{milestone_id}")
async def delete_milestone(project_id: int, milestone_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = _project(db, project_id, user)
    _ensure_lead(user, project, "delete milestones")
    ensure_feature_action(user, "rnd", "projects", "milestones", "delete")
    m = _milestone(db, project, milestone_id)
    if _tasks(db, [m.id]):
        raise HTTPException(status_code=409, detail=f"'{m.title}' already has tasks (even cancelled ones count), so it can't be deleted. Use Cancel milestone instead — its record is kept.")
    _audit(db, project, user, "milestone_deleted", f"Milestone '{m.title}' (expected by {m.due_date:%d %b %Y}) deleted by {_name(user)}.")
    db.delete(m)
    db.commit()
    return {"message": f"Milestone '{m.title}' deleted."}


# ── history ───────────────────────────────────────────────────────────────

TASK_VERBS = {
    "created": "assigned", "update": "posted an update on", "completed": "completed", "extended": "moved the due date of",
    "reopened": "reopened", "cancelled": "cancelled", "edited": "edited", "approval_requested": "asked for approval on",
    "approved": "approved a request on", "rejected": "rejected a request on", "approval_withdrawn": "withdrew an approval request on",
    "progress": "updated progress on", "submitted": "marked done", "closed": "closed",
}


@router.get("/projects/{project_id}/history")
async def project_history(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything that happened on the project, newest first: milestone and
    project changes (audit log) and every task event."""
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
        what = "sub-task" if t.parent_task_id else "task"
        verb = TASK_VERBS.get(e.action, e.action)
        text = f"{_name(users.get(e.user_id))} {verb} {what} '{t.title}'"
        if e.action == "created":
            text += f" to {_name(users.get(t.assigned_to_id))}"
        if e.new_due_date and e.action in ("created", "extended", "edited", "reopened"):
            text += f" — due {e.new_due_date:%d %b %Y}"
        if e.remarks:
            text += f". {e.remarks}"
        rows.append({
            "id": f"t{e.id}", "kind": "task", "action": e.action, "summary": text,
            "performed_by": _name(users.get(e.user_id)) if e.user_id else "System",
            "performed_at": e.created_at.isoformat() if e.created_at else None,
        })
    rows.sort(key=lambda r: r["performed_at"] or "", reverse=True)
    return rows
