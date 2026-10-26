"""Tasks on an R&D (Prototype / Research) project.

Project leads (and admins) create a task for a project team member (title,
remarks, due date, files) → the assignee works, posts updates and completes
the task themselves (remarks + files; a delay reason when late) or, once it is
overdue, gives a reason and a new completion date. While working, the
assignee can "ask for approval" on something task-related; whoever created
the task (or a lead) approves / rejects it and the task stays open. The
assignee of an open task can split it into sub-tasks for the project team;
whoever created a task can edit, cancel or reopen it — project leads and
admins can do that on every task. Same flow and
response shape as the requirement tasks (requirement_work.py), so the
frontend reuses one task component for both.

Files are RndDocument rows on the project with task_id set; they are kept out
of the project's Attachments list.
"""
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import ensure_feature_action, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.project_milestone import RND_MILESTONE_OPEN, RND_MILESTONE_STATUS_LABELS, RndProjectMilestone
from app.modules.rnd.models.project_task import RndProjectTask, RndProjectTaskEvent
from app.modules.rnd.scope import ensure_in_scope
from app.modules.rnd.services import project_roles as roles
from app.modules.rnd.services import task_approvals
from app.modules.rnd.services import task_fields
from app.modules.rnd.services import events as rnd_events
from app.utils.notifications import notify_user
from app.utils.sharepoint import build_sharepoint_folder_path, upload_file_to_sharepoint

from app.core import assignee_rules

RULE_KEY = "rnd:projects.tasks"  # core/assignee_rules.PICKERS
router = APIRouter(
    tags=["RnD Project Tasks"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "projects"))],
)

MAX_FILES = 10
BRIEF, WORK, APPROVAL = "brief", "work", "approval"   # task_doc_role: lead's files / assignee's files / approval-request files
KIND = "project"   # task_kind on rnd_task_approvals


# ── helpers ───────────────────────────────────────────────────────────────

def _name(u: User | None) -> str:
    return (u.name or u.email or f"User #{u.id}") if u else "—"


def _project(db: Session, project_id: int, user: User) -> RndProject:
    p = db.query(RndProject).filter(RndProject.id == project_id, RndProject.is_deleted == False).first()  # noqa: E712
    if not p:
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found (it may have been deleted) — refresh the list.")
    ensure_in_scope(db, user, p)
    return p


def _task(db: Session, task_id: int) -> RndProjectTask:
    t = db.query(RndProjectTask).filter(RndProjectTask.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="This task no longer exists — refresh the page.")
    return t


def _ensure_manager(user: User, project: RndProject, what: str) -> None:
    if not roles.can_manage(user, project):
        raise HTTPException(status_code=403, detail=f"Only a project lead of {project.project_number} can {what}. Ask a lead, or have them add you as a lead.")


def _ensure_reviewer(user: User, project: RndProject, task: RndProjectTask, what: str) -> None:
    """The task's creator reviews it; project leads / admins can review any task."""
    if task.created_by_id != user.id and not roles.can_manage(user, project):
        raise HTTPException(status_code=403, detail=f"Only the person who created this task (or a project lead of {project.project_number}) can {what}.")


def _team_ids(project: RndProject) -> list[int]:
    return list(dict.fromkeys([*roles.member_ids(project), *roles.lead_ids(project)]))


def _check_assignee(db: Session, project: RndProject, assignee_id: int, allowed: list[int], who: str, user: User) -> User:
    if assignee_id not in allowed:
        raise HTTPException(status_code=400, detail=f"That person isn't {who} of {project.project_number}. Add them under Project Members (Edit → Team Members) first, then assign the task.")
    assignee = db.query(User).filter(User.id == assignee_id).first()
    if not assignee or not assignee.is_active:
        raise HTTPException(status_code=400, detail="The selected person was not found or is deactivated — pick someone else.")
    if "rnd" not in assignee.get_apps():
        raise HTTPException(status_code=400, detail=f"{_name(assignee)} has no access to the R&D module, so they couldn't see this task. Grant it in User Management, then assign again.")
    # The role's assign-to rule (Role & Permissions › R&D › Prototype / Research › Project tasks).
    assignee_rules.ensure_allowed(db, user, RULE_KEY, assignee)
    return assignee


def _open_milestone(db: Session, project: RndProject, milestone_id: int | None) -> RndProjectMilestone | None:
    """The milestone a task goes into — on this project and still open."""
    if not milestone_id:
        return None
    m = db.query(RndProjectMilestone).filter(RndProjectMilestone.id == milestone_id).first()
    if not m or m.project_id != project.id:
        raise HTTPException(status_code=404, detail=f"That milestone isn't on {project.project_number} any more — refresh the page.")
    if m.status not in RND_MILESTONE_OPEN:
        raise HTTPException(status_code=409, detail=f"Milestone '{m.title}' is {RND_MILESTONE_STATUS_LABELS[m.status]}, so it can't get tasks. Reopen it first, or pick another milestone.")
    return m


def _check_in_milestone(m: RndProjectMilestone | None, due: date, start: date | None = None) -> None:
    if not m:
        return
    if due > m.due_date:
        raise HTTPException(status_code=422, detail=f"A task in '{m.title}' can't be due after the milestone's end date ({m.due_date.strftime('%d %b %Y')}). Pick an earlier date, or move the milestone's end date first.")
    if start and m.start_date and start < m.start_date:
        raise HTTPException(status_code=422, detail=f"A task in '{m.title}' can't start before the milestone starts ({m.start_date.strftime('%d %b %Y')}).")


def _ensure_assignee(task: RndProjectTask, user: User, what: str) -> None:
    if task.assigned_to_id != user.id:
        raise HTTPException(status_code=403, detail=f"Only the person this task is assigned to can {what}.")


def _parse_date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{label} '{value}' isn't a valid date — pick it from the calendar.") from None


def _is_overdue(t: RndProjectTask) -> bool:
    return t.status == "open" and today_ist() > t.due_date


def _event(db: Session, task: RndProjectTask, action: str, user: User, remarks: str | None = None,
           old_due: date | None = None, new_due: date | None = None) -> None:
    db.add(RndProjectTaskEvent(task_id=task.id, action=action, remarks=remarks, old_due_date=old_due, new_due_date=new_due,
                               user_id=user.id, created_at=datetime.now(timezone.utc)))


async def _store_files(db: Session, project: RndProject, task: RndProjectTask, files: list[UploadFile] | None, role: str, user: User) -> list[RndDocument]:
    files = [f for f in (files or []) if f and f.filename]
    if not files:
        return []
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=422, detail=f"You attached {len(files)} files — attach at most {MAX_FILES} at a time.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server, so files can't be saved. Ask IT to set SHAREPOINT_SITE_ID.")
    path = build_sharepoint_folder_path(_name(user), "RnD", f"{project.project_number}-task-{task.id}", root_folder="RnD-media")
    out = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, path, f)
        doc = RndDocument(
            project_id=project.id, task_id=task.id, task_doc_role=role, doc_type="other",
            title=result["name"], file_name=result["name"], sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"), file_size=result.get("size"), mime_type=f.content_type,
            uploaded_by_id=user.id, uploaded_by_name=_name(user),
        )
        db.add(doc)
        out.append(doc)
    db.flush()
    return out


def _serialize(db: Session, tasks: list[RndProjectTask]) -> list[dict]:
    if not tasks:
        return []
    ids = [t.id for t in tasks]
    events = db.query(RndProjectTaskEvent).filter(RndProjectTaskEvent.task_id.in_(ids)).order_by(RndProjectTaskEvent.id.asc()).all()
    docs = db.query(RndDocument).filter(RndDocument.task_id.in_(ids), RndDocument.is_deleted == False).order_by(RndDocument.id.asc()).all()  # noqa: E712
    uids = {t.assigned_to_id for t in tasks} | {t.created_by_id for t in tasks} | {e.user_id for e in events if e.user_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    ev_by: dict[int, list] = {}
    for e in events:
        ev_by.setdefault(e.task_id, []).append({
            "action": e.action, "remarks": e.remarks, "by": _name(users.get(e.user_id)),
            "at": e.created_at.isoformat() if e.created_at else None,
            "old_due_date": e.old_due_date.isoformat() if e.old_due_date else None,
            "new_due_date": e.new_due_date.isoformat() if e.new_due_date else None,
        })
    doc_by: dict[int, list] = {}
    doc_dicts: dict[int, dict] = {}
    for d in docs:
        dd = {
            "id": d.id, "name": d.file_name, "file_size": d.file_size, "uploaded_by": d.uploaded_by_name,
            "uploaded_at": d.created_at.isoformat() if d.created_at else None, "category": d.task_doc_role,
        }
        doc_dicts[d.id] = dd
        doc_by.setdefault(d.task_id, []).append(dd)
    approvals = task_approvals.serialize(db, KIND, ids, doc_dicts)
    return [
        {
            "id": t.id, "source": "project", "record_id": t.project_id, "parent_task_id": t.parent_task_id, "milestone_id": t.milestone_id,
            "title": t.title, "remarks": t.remarks,
            "assigned_to_id": t.assigned_to_id, "assigned_to": _name(users.get(t.assigned_to_id)),
            "created_by_id": t.created_by_id, "created_by": _name(users.get(t.created_by_id)),
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "original_due_date": t.original_due_date.isoformat(), "due_date": t.due_date.isoformat(),
            "status": t.status, "is_overdue": _is_overdue(t),
            "extensions": sum(1 for e in ev_by.get(t.id, []) if e["action"] == "extended"),
            "submitted_at": t.submitted_at.isoformat() if t.submitted_at else None,
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
            "events": ev_by.get(t.id, []),
            "brief_documents": [d for d in doc_by.get(t.id, []) if d["category"] == BRIEF],
            "work_documents": [d for d in doc_by.get(t.id, []) if d["category"] == WORK],
            "approvals": approvals.get(t.id, []),
            "pending_approval": any(a["status"] == "pending" for a in approvals.get(t.id, [])),
            **task_fields.fields_out(t),
        }
        for t in tasks
    ]


def _notify_managers(db: Session, project: RndProject, task: RndProjectTask, actor: User, title: str, message: str, kind: str) -> None:
    # Top-level task → its creator + the leads; sub-task → only its creator.
    targets = {task.created_by_id} if task.parent_task_id else {task.created_by_id, *roles.lead_ids(project)}
    for uid in (targets - {actor.id}):
        notify_user(db, uid, title=title, message=message, notification_type=kind, entity_type="rnd_project", entity_id=project.id)


# ── project-level ─────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/task-access")
async def task_access(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Whether the current user can hand out top-level tasks (leads / admins), and
    the project team: `people` (team members — top-level task assignees) and
    `team` (members + leads — who a sub-task can go to)."""
    project = _project(db, project_id, user)
    ids = _team_ids(project)
    found = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    leads = set(roles.lead_ids(project))

    def row(u: User) -> dict:
        return {"id": u.id, "name": _name(u), "email": u.email, "designation": getattr(u, "designation", None),
                "team_role": "head" if u.id in leads else "member"}

    team = assignee_rules.filter_people(db, user, RULE_KEY, [row(u) for i in ids if (u := found.get(i)) and u.is_active])
    return {"can_manage": roles.can_manage(user, project), "people": [r for r in team if r["id"] in roles.member_ids(project)], "team": team}


@router.get("/project-tasks/mine")
async def my_project_tasks(include_done: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Tasks assigned to me on any R&D project (open by default) — for R&D › My Tasks."""
    q = db.query(RndProjectTask).filter(RndProjectTask.assigned_to_id == user.id)
    if not include_done:
        q = q.filter(RndProjectTask.status == "open")
    tasks = q.order_by(RndProjectTask.due_date.asc()).all()
    projects = {p.id: p for p in db.query(RndProject).filter(
        RndProject.id.in_({t.project_id for t in tasks}), RndProject.is_deleted == False).all()} if tasks else {}  # noqa: E712
    tasks = [t for t in tasks if t.project_id in projects]
    out = _serialize(db, tasks)
    for row in out:
        p = projects[row["record_id"]]
        row["requirement_ref"], row["requirement_title"] = p.project_number, p.title
    return out


@router.get("/projects/{project_id}/tasks")
async def list_tasks(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Leads / admins: every task on the project. Others: tasks assigned to
    them, tasks they created (their sub-tasks) and the sub-tasks under those."""
    project = _project(db, project_id, user)
    ensure_feature_action(user, "rnd", "projects", "tasks", "view")
    tasks = db.query(RndProjectTask).filter(RndProjectTask.project_id == project.id).order_by(RndProjectTask.id.desc()).all()
    if not roles.can_manage(user, project):
        mine = {t.id for t in tasks if user.id in (t.assigned_to_id, t.created_by_id)}
        tasks = [t for t in tasks if t.id in mine or t.parent_task_id in mine]
    return _serialize(db, tasks)


@router.post("/projects/{project_id}/tasks")
async def create_task(
    project_id: int,
    title: str = Form(...), assigned_to_id: int = Form(...), due_date: str = Form(...),
    remarks: str | None = Form(None), files: list[UploadFile] | None = File(None),
    priority: str | None = Form(None), start_date: str | None = Form(None),
    work_status: str | None = Form(None), checklist: str | None = Form(None),
    milestone_id: int | None = Form(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    project = _project(db, project_id, user)
    milestone = _open_milestone(db, project, milestone_id)
    # Leads give tasks; a milestone's responsible people may add tasks to it.
    if not (milestone and user.id in [milestone.assignee_id, *(milestone.co_owner_ids or [])]):
        _ensure_manager(user, project, "create tasks")
    ensure_feature_action(user, "rnd", "projects", "tasks", "create")
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Give the task a title — what should be done.")
    if len(title) > 200:
        raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 200 and put details in Remarks.")
    due = _parse_date(due_date, "Due date")
    if due < today_ist():
        raise HTTPException(status_code=422, detail=f"Due date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    assignee = _check_assignee(db, project, assigned_to_id, roles.member_ids(project), "a team member", user)

    task = RndProjectTask(
        project_id=project.id, milestone_id=milestone.id if milestone else None, title=title, remarks=(remarks or "").strip() or None,
        assigned_to_id=assignee.id, created_by_id=user.id, original_due_date=due, due_date=due, status="open",
    )
    task_fields.apply_create(task, priority=priority, start_date=start_date, work_status=work_status, checklist=checklist)
    _check_in_milestone(milestone, due, task.start_date)
    if milestone and milestone.status == "todo":
        # Work has begun on the milestone once its first task is handed out.
        milestone.status = "in_progress"
    db.add(task)
    db.flush()
    await _store_files(db, project, task, files, BRIEF, user)
    _event(db, task, "created", user, remarks=task.remarks, new_due=due)
    if assignee.id != user.id:
        notify_user(db, assignee.id, title=f"New task on {project.project_number} — {project.title}",
                    message=f"{_name(user)} assigned you \"{title}\" — due {due.strftime('%d %b %Y')}." + (f" Remarks: {task.remarks}" if task.remarks else ""),
                    notification_type="rnd_project_task_assigned", entity_type="rnd_project", entity_id=project.id)
    rnd_events.project_event(
        db, "project_task_assigned", project, title=f"{_name(assignee)} got a task on {project.project_number}",
        message=f"{_name(user)} assigned {_name(assignee)} \"{title}\" on {project.project_number} — {project.title}, due {due.strftime('%d %b %Y')}.",
        actor=user, skip_user_ids={assignee.id}, background_tasks=background_tasks,
    )
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/subtasks")
async def create_subtask(
    task_id: int,
    title: str = Form(...), assigned_to_id: int = Form(...), due_date: str = Form(...),
    remarks: str | None = Form(None), files: list[UploadFile] | None = File(None),
    priority: str | None = Form(None), start_date: str | None = Form(None),
    work_status: str | None = Form(None), checklist: str | None = Form(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """The assignee of an open task hands part of it to someone on the project team."""
    parent = _task(db, task_id)
    project = _project(db, parent.project_id, user)
    _ensure_assignee(parent, user, "split it into sub-tasks")
    ensure_feature_action(user, "rnd", "projects", "tasks", "create")
    if parent.parent_task_id:
        raise HTTPException(status_code=409, detail="This is already a sub-task — sub-tasks can't be split further. Ask the person who gave it to you to create another task instead.")
    if parent.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {parent.status}, so it can't get new sub-tasks.")
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Give the sub-task a title — what should be done.")
    if len(title) > 200:
        raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 200 and put details in Remarks.")
    due = _parse_date(due_date, "Due date")
    if due < today_ist():
        raise HTTPException(status_code=422, detail=f"Due date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    if due > parent.due_date:
        raise HTTPException(status_code=422, detail=f"A sub-task can't be due after its main task ({parent.due_date.strftime('%d %b %Y')}). Pick an earlier date, or ask for more time on the main task first.")
    assignee = _check_assignee(db, project, assigned_to_id, _team_ids(project), "on the project team", user)

    task = RndProjectTask(
        project_id=project.id, parent_task_id=parent.id, milestone_id=parent.milestone_id, title=title, remarks=(remarks or "").strip() or None,
        assigned_to_id=assignee.id, created_by_id=user.id, original_due_date=due, due_date=due, status="open",
    )
    task_fields.apply_create(task, priority=priority, start_date=start_date, work_status=work_status, checklist=checklist)
    db.add(task)
    db.flush()
    await _store_files(db, project, task, files, BRIEF, user)
    _event(db, task, "created", user, remarks=task.remarks, new_due=due)
    if assignee.id != user.id:
        notify_user(db, assignee.id, title=f"New sub-task on {project.project_number} — {project.title}",
                    message=f"{_name(user)} assigned you \"{title}\" (part of \"{parent.title}\") — due {due.strftime('%d %b %Y')}.",
                    notification_type="rnd_project_task_assigned", entity_type="rnd_project", entity_id=project.id)
    rnd_events.project_event(
        db, "project_task_assigned", project, title=f"{_name(assignee)} got a sub-task on {project.project_number}",
        message=f"{_name(user)} assigned {_name(assignee)} \"{title}\" (part of \"{parent.title}\") on {project.project_number}, due {due.strftime('%d %b %Y')}.",
        actor=user, skip_user_ids={assignee.id}, background_tasks=background_tasks,
    )
    db.commit()
    return _serialize(db, [task])[0]


class TaskEditPayload(BaseModel):
    title: str | None = None
    remarks: str | None = None
    due_date: date | None = None
    assigned_to_id: int | None = None
    priority: str | None = None
    start_date: date | None = None
    work_status: str | None = None
    # [{id?, text, done?}] — the whole list; items keep their id / who ticked them.
    checklist: list[dict] | None = None
    # Move a main task into (another) milestone; its sub-tasks move with it.
    milestone_id: int | None = None


class TaskProgressPayload(BaseModel):
    """Either a new work status, or one checklist step ticked / unticked."""
    work_status: str | None = None
    item_id: str | None = None
    done: bool | None = None


@router.patch("/project-tasks/{task_id}")
async def edit_task(task_id: int, payload: TaskEditPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The task's creator (or a lead / admin) changes what, who or when — only while it is open."""
    task = _task(db, task_id)
    project = _project(db, task.project_id, user)
    _ensure_reviewer(user, project, task, "edit it")
    ensure_feature_action(user, "rnd", "projects", "tasks", "edit")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — only an open task can be edited." + (" Reopen it first if it needs changes." if task.status == "closed" else ""))
    data = payload.model_dump(exclude_unset=True)
    changes: list[str] = []
    old_due = task.due_date

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="Task title can't be empty — say what should be done.")
        if len(title) > 200:
            raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 200 and put details in Remarks.")
        if title != task.title:
            changes.append(f"Task: \"{task.title}\" → \"{title}\"")
            task.title = title
    if "remarks" in data:
        remarks = (data["remarks"] or "").strip() or None
        if remarks != task.remarks:
            changes.append("Remarks updated")
            task.remarks = remarks
    if data.get("due_date") and data["due_date"] != task.due_date:
        due = data["due_date"]
        if due < today_ist():
            raise HTTPException(status_code=422, detail=f"Due date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
        if task.parent_task_id:
            parent = _task(db, task.parent_task_id)
            if due > parent.due_date:
                raise HTTPException(status_code=422, detail=f"A sub-task can't be due after its main task ({parent.due_date.strftime('%d %b %Y')}).")
        else:
            later = [t for t in db.query(RndProjectTask).filter(
                RndProjectTask.parent_task_id == task.id, RndProjectTask.status == "open", RndProjectTask.due_date > due,
            ).all()]
            if later:
                names = ", ".join(f"\"{t.title}\" ({t.due_date:%d %b %Y})" for t in later[:3]) + (f" and {len(later) - 3} more" if len(later) > 3 else "")
                raise HTTPException(status_code=422, detail=f"Open sub-task(s) are due after {due.strftime('%d %b %Y')}: {names}. "
                                                            "Move those sub-tasks earlier first, or pick a later due date for the main task.")
        changes.append(f"Due date: {task.due_date.strftime('%d %b %Y')} → {due.strftime('%d %b %Y')}")
        task.due_date = due
    old_assignee = task.assigned_to_id
    if data.get("assigned_to_id") and data["assigned_to_id"] != task.assigned_to_id:
        allowed = _team_ids(project) if task.parent_task_id else roles.member_ids(project)
        assignee = _check_assignee(db, project, data["assigned_to_id"], allowed, "on the project team" if task.parent_task_id else "a team member", user)
        prev = db.query(User).filter(User.id == task.assigned_to_id).first()
        changes.append(f"Assignee: {_name(prev)} → {_name(assignee)}")
        task.assigned_to_id = assignee.id
    changes += task_fields.apply_edit(task, data, _name(user))
    if data.get("milestone_id") and data["milestone_id"] != task.milestone_id:
        if task.parent_task_id:
            raise HTTPException(status_code=409, detail="A sub-task stays in its main task's milestone — move the main task instead.")
        _ensure_manager(user, project, "move tasks between milestones")
        target = _open_milestone(db, project, data["milestone_id"])
        _check_in_milestone(target, task.due_date)
        changes.append(f"Milestone: → '{target.title}'")
        task.milestone_id = target.id
        for sub in db.query(RndProjectTask).filter(RndProjectTask.parent_task_id == task.id).all():
            sub.milestone_id = target.id
        if target.status == "todo":
            target.status = "in_progress"
    elif task.milestone_id and not task.parent_task_id and "due_date" in data:
        _check_in_milestone(db.get(RndProjectMilestone, task.milestone_id), task.due_date)

    if not changes:
        return _serialize(db, [task])[0]
    _event(db, task, "edited", user, remarks="\n".join(changes),
           old_due=old_due if task.due_date != old_due else None, new_due=task.due_date if task.due_date != old_due else None)
    summary = "; ".join(changes)
    for uid in ({task.assigned_to_id, old_assignee} - {user.id}):
        if uid == old_assignee and uid != task.assigned_to_id:
            msg = f"{_name(user)} reassigned \"{task.title}\" to someone else — it's no longer yours."
        elif uid != old_assignee:
            msg = f"{_name(user)} assigned you \"{task.title}\" — due {task.due_date.strftime('%d %b %Y')}."
        else:
            msg = f"{_name(user)} changed \"{task.title}\": {summary}"
        notify_user(db, uid, title=f"Task updated ({project.project_number})", message=msg,
                    notification_type="rnd_project_task_edited", entity_type="rnd_project", entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]


# ── task actions ──────────────────────────────────────────────────────────

class ReviewPayload(BaseModel):
    remarks: str | None = None
    new_due_date: date | None = None


@router.post("/project-tasks/{task_id}/extend")
async def extend_task(task_id: int, reason: str = Form(...), new_due_date: str = Form(...),
                      db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task(db, task_id)
    project = _project(db, task.project_id, user)
    _ensure_assignee(task, user, "give a new completion date")
    ensure_feature_action(user, "rnd", "projects", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status}, so its due date can't be changed.")
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Enter the reason the task isn't complete by its due date.")
    new_due = _parse_date(new_due_date, "New completion date")
    if new_due < today_ist():
        raise HTTPException(status_code=422, detail=f"New completion date {new_due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    if new_due <= task.due_date:
        raise HTTPException(status_code=422, detail=f"New completion date must be after the current due date ({task.due_date.strftime('%d %b %Y')}).")
    old = task.due_date
    task.due_date = new_due
    _event(db, task, "extended", user, remarks=reason, old_due=old, new_due=new_due)
    _notify_managers(db, project, task, user, f"Task re-dated on {project.project_number}",
                     f"{_name(user)} moved \"{task.title}\" from {old.strftime('%d %b %Y')} to {new_due.strftime('%d %b %Y')}. Reason: {reason}",
                     "rnd_project_task_extended")
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/complete")
async def complete_task(task_id: int, remarks: str = Form(...), delay_reason: str | None = Form(None),
                        files: list[UploadFile] | None = File(None),
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Assignee completes the task themselves (remarks + files; a delay reason when late)."""
    task = _task(db, task_id)
    project = _project(db, task.project_id, user)
    _ensure_assignee(task, user, "complete it")
    ensure_feature_action(user, "rnd", "projects", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is already {task.status}.")
    remarks = (remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=422, detail="Describe what you did (completion remarks) before completing the task.")
    pending = db.query(RndProjectTask).filter(RndProjectTask.parent_task_id == task.id, RndProjectTask.status == "open").all()
    if pending:
        names = ", ".join(f'"{t.title}"' for t in pending[:3]) + (f" and {len(pending) - 3} more" if len(pending) > 3 else "")
        raise HTTPException(status_code=409, detail=f"{len(pending)} sub-task(s) are still open: {names}. They must be completed or cancelled before this task.")
    task_approvals.ensure_none_pending(db, KIND, task.id)
    task_fields.ensure_checklist_done(task)
    delay_reason = (delay_reason or "").strip() or None
    if _is_overdue(task) and not delay_reason:
        raise HTTPException(status_code=422, detail=f"This task was due on {task.due_date.strftime('%d %b %Y')}. Enter the reason for the delay before completing it.")
    await _store_files(db, project, task, files, WORK, user)
    task.status = "closed"
    task.closed_at = datetime.now(timezone.utc)
    _event(db, task, "completed", user, remarks=remarks + (f"\nDelay reason: {delay_reason}" if delay_reason else ""))
    _notify_managers(db, project, task, user, f"Task completed ({project.project_number})",
                     f"{_name(user)} completed \"{task.title}\"" + (" after its due date." if delay_reason else ".") + f" {remarks[:200]}",
                     "rnd_project_task_completed")
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/progress")
async def task_progress(task_id: int, payload: TaskProgressPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Tick / untick a checklist step or change the work status of an open task —
    the assignee, or whoever reviews the task (its creator, a lead, an admin)."""
    task = _task(db, task_id)
    project = _project(db, task.project_id, user)
    if task.assigned_to_id != user.id:
        _ensure_reviewer(user, project, task, "update its checklist or status")
        ensure_feature_action(user, "rnd", "projects", "tasks", "edit")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — the checklist and status can change only while it is open. Reopen it first if needed.")
    line = task_fields.apply_progress(task, work_status=payload.work_status, item_id=payload.item_id, done=payload.done, actor_name=_name(user))
    if line:
        _event(db, task, "progress", user, remarks=line)
        db.commit()
    return _serialize(db, [task])[0]


# ── approval requests (task stays open) ───────────────────────────────────

@router.post("/project-tasks/{task_id}/approvals")
async def request_approval(task_id: int, request: str = Form(...), files: list[UploadFile] | None = File(None),
                           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Assignee asks whoever created the task (or a lead) to approve something task-related."""
    task = _task(db, task_id)
    project = _project(db, task.project_id, user)
    _ensure_assignee(task, user, "ask for approval on it")
    ensure_feature_action(user, "rnd", "projects", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — approvals can be asked only while it is open.")
    row = task_approvals.create(db, KIND, task.id, user, request)
    docs = await _store_files(db, project, task, files, APPROVAL, user)
    row.document_ids = [d.id for d in docs]
    _event(db, task, "approval_requested", user, remarks=row.request)
    targets = {task.created_by_id} if task.parent_task_id else {task.created_by_id, *roles.lead_ids(project)}
    for uid in targets - {user.id}:
        notify_user(db, uid, title=f"Approval needed on a task ({project.project_number})",
                    message=f"{_name(user)} asks for your approval on \"{task.title}\": {row.request[:200]}",
                    notification_type="rnd_project_task_approval_requested", entity_type="rnd_project", entity_id=project.id, teams=True)
    db.commit()
    return _serialize(db, [task])[0]


class ApprovalDecision(BaseModel):
    decision: str
    remarks: str | None = None


@router.post("/project-task-approvals/{approval_id}/decide")
async def decide_approval(approval_id: int, payload: ApprovalDecision, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = task_approvals.get(db, KIND, approval_id)
    task = _task(db, row.task_id)
    project = _project(db, task.project_id, user)
    _ensure_reviewer(user, project, task, "decide its approval requests")
    ensure_feature_action(user, "rnd", "projects", "tasks", "approve")
    task_approvals.ensure_task_open(task)
    task_approvals.decide(row, user, payload.decision, payload.remarks)
    _event(db, task, row.status, user, remarks=row.decision_remarks)
    if row.requested_by_id != user.id:
        notify_user(db, row.requested_by_id, title=f"Approval {row.status} ({project.project_number})",
                    message=f"{_name(user)} {row.status} your request on \"{task.title}\"." + (f" Remarks: {row.decision_remarks}" if row.decision_remarks else ""),
                    notification_type=f"rnd_project_task_approval_{row.status}", entity_type="rnd_project", entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-task-approvals/{approval_id}/withdraw")
async def withdraw_approval(approval_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = task_approvals.get(db, KIND, approval_id)
    task = _task(db, row.task_id)
    _project(db, task.project_id, user)
    task_approvals.withdraw(row, user)
    _event(db, task, "approval_withdrawn", user)
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/update")
async def add_task_update(task_id: int, remarks: str = Form(...), files: list[UploadFile] | None = File(None),
                          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Assignee posts progress (remarks + any files); the task stays open."""
    task = _task(db, task_id)
    project = _project(db, task.project_id, user)
    _ensure_assignee(task, user, "post an update on it")
    ensure_feature_action(user, "rnd", "projects", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — updates can be added only while it is open.")
    remarks = (remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=422, detail="Write the update — what you did or found so far.")
    await _store_files(db, project, task, files, WORK, user)
    _event(db, task, "update", user, remarks=remarks)
    for uid in {task.created_by_id} - {user.id}:
        notify_user(db, uid, title=f"Task update ({project.project_number})",
                    message=f"{_name(user)} on \"{task.title}\": {remarks[:200]}",
                    notification_type="rnd_project_task_update", entity_type="rnd_project", entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/reopen")
async def reopen_task(task_id: int, payload: ReviewPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task(db, task_id)
    project = _project(db, task.project_id, user)
    _ensure_reviewer(user, project, task, "reopen it")
    ensure_feature_action(user, "rnd", "projects", "tasks", "edit")
    if task.status != "closed":
        raise HTTPException(status_code=409, detail="Only a completed task can be reopened.")
    if task.parent_task_id:
        parent = _task(db, task.parent_task_id)
        if parent.status != "open":
            raise HTTPException(status_code=409, detail=f"Its main task \"{parent.title}\" is {parent.status} — reopen the main task first, then this sub-task.")
    reason = (payload.remarks or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Enter what still needs to be done — the assignee sees it as the reason.")
    old = task.due_date
    if payload.new_due_date:
        if payload.new_due_date < today_ist():
            raise HTTPException(status_code=422, detail=f"New due date {payload.new_due_date.strftime('%d %b %Y')} is in the past — pick today or a later date.")
        task.due_date = payload.new_due_date
    elif task.due_date < today_ist():
        raise HTTPException(status_code=422, detail=f"The due date ({task.due_date.strftime('%d %b %Y')}) has passed — set a new due date when reopening the task.")
    task.status = "open"
    task.closed_at = None
    changed = task.due_date != old
    _event(db, task, "reopened", user, remarks=reason, old_due=old if changed else None, new_due=task.due_date if changed else None)
    if task.assigned_to_id != user.id:
        notify_user(db, task.assigned_to_id, title=f"Task reopened ({project.project_number})",
                    message=f"{_name(user)} reopened \"{task.title}\" — due {task.due_date.strftime('%d %b %Y')}. Reason: {reason}",
                    notification_type="rnd_project_task_reopened", entity_type="rnd_project", entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/cancel")
async def cancel_task(task_id: int, payload: ReviewPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task(db, task_id)
    project = _project(db, task.project_id, user)
    _ensure_reviewer(user, project, task, "cancel it")
    ensure_feature_action(user, "rnd", "projects", "tasks", "cancel")
    if task.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"This task is already {task.status}.")
    reason = (payload.remarks or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Enter why the task is cancelled — the assignee sees it.")
    task.status = "cancelled"
    _event(db, task, "cancelled", user, remarks=reason)
    cancelled_ids = [task.id]
    for sub in db.query(RndProjectTask).filter(RndProjectTask.parent_task_id == task.id, RndProjectTask.status.in_(("open", "submitted"))).all():
        sub.status = "cancelled"
        _event(db, sub, "cancelled", user, remarks=f"Main task \"{task.title}\" was cancelled: {reason}")
        cancelled_ids.append(sub.id)
    task_approvals.withdraw_pending(db, KIND, cancelled_ids)
    if task.assigned_to_id != user.id:
        notify_user(db, task.assigned_to_id, title=f"Task cancelled ({project.project_number})",
                    message=f"{_name(user)} cancelled \"{task.title}\". Reason: {reason}",
                    notification_type="rnd_project_task_cancelled", entity_type="rnd_project", entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]
