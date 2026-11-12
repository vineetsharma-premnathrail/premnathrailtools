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

Since 2026-11-03 a task can also hang on a Project Management ("All Projects")
project — R&D work on a customer project, given from R&D › R&D Tasks. Every
route works on a TaskParent (R&D project or PM project): on a PM project the
R&D heads, admins and the project's manager / management give and review
tasks, and any active person with R&D access can be assigned.
"""
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.data_scope import in_scope as pm_in_scope
from app.core.permission_registry import can_view_tab, is_admin_user
from app.core.permissions import ensure_feature_action, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.project_task import RndProjectTask, RndProjectTaskEvent
from app.modules.projects import workflow as pm_wf
from app.modules.projects.models.project import PmProject
from app.modules.rnd.scope import ensure_in_scope
from app.modules.rnd.services import project_roles as roles
from app.modules.rnd.services import requirement_access as ra
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


@dataclass
class TaskParent:
    """What a task hangs on: a Prototype / Research project (`rnd`) or a Project
    Management project (`pm`). Routes read only this — never the models directly."""
    kind: str                     # "rnd" | "pm"
    id: int
    project_number: str           # RND number or PEW code
    title: str
    lead_ids: list[int]           # who gives / reviews tasks (besides admins) and is told about them
    members_fn: Callable[[], list[int]]   # who a top-level task can go to — computed only when needed (create / edit / access)
    manager_label: str            # for messages: "a project lead" / "an R&D head or the project manager"
    rnd: RndProject | None = None
    pm: PmProject | None = None
    managers: set[int] = field(default_factory=set)
    _members: list[int] | None = None

    @property
    def member_ids(self) -> list[int]:
        if self._members is None:
            self._members = self.members_fn()
        return self._members

    @property
    def entity_type(self) -> str:
        """Notification entity: the bell opens the R&D page for both (NotificationBell maps
        rnd_pm_project → /dashboard/rnd/project-tasks/<ref>), never the PM project page."""
        return "rnd_project" if self.kind == "rnd" else "rnd_pm_project"

    def can_manage(self, user: User) -> bool:
        return is_admin_user(user) or user.id in self.managers

    def can_decide(self, user: User) -> bool:
        """Decide an approval request: a named lead / R&D head / project manager only. A portal
        admin manages (gives, edits, cancels) but does not decide just because they are admin
        (owner decision 2026-11-04) — `managers` never holds an admin who is only an admin."""
        return user.id in self.managers

    def fk(self) -> dict:
        """Keyword for RndProjectTask / RndDocument: which parent column to set."""
        return {"project_id": self.id} if self.kind == "rnd" else {"pm_project_id": self.id}

    def task_filter(self):
        return RndProjectTask.project_id == self.id if self.kind == "rnd" else RndProjectTask.pm_project_id == self.id


def _rnd_parent(db: Session, project_id: int, user: User) -> TaskParent:
    p = db.query(RndProject).filter(RndProject.id == project_id, RndProject.is_deleted == False).first()  # noqa: E712
    if not p:
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found (it may have been deleted) — refresh the list.")
    ensure_in_scope(db, user, p)
    leads = roles.lead_ids(p)
    return TaskParent(kind="rnd", id=p.id, project_number=p.project_number, title=p.title, lead_ids=leads,
                      members_fn=lambda: roles.member_ids(p), manager_label="a project lead", rnd=p, managers=set(leads))


def _rnd_people_ids(db: Session) -> list[int]:
    """Active people who can hold an R&D task on a PM project — everyone with R&D access
    who can open R&D › Prototype / Research (where the task actions live); admins only
    when nobody else qualifies. Like the requirement task assignees."""
    active = db.query(User).filter(User.is_active == True).order_by(User.name.asc()).all()  # noqa: E712
    people = [u for u in active if "rnd" in u.get_apps() and can_view_tab(u, "rnd", "projects")]
    return [u.id for u in people if u.role != "admin"] or [u.id for u in people]


def pm_manages(db: Session, user: User, p: PmProject, *, decision: bool = False) -> bool:
    """Who gives / reviews R&D tasks on a PM project: admins, the R&D department head(s)
    set in Organization › Department (no "everyone" fallback here), the project manager,
    and management (Partners / Directors / All Projects › Create) when the project is
    inside their Project Management data scope. Shared with the picker (routes/tasks.py).
    `decision=True` (who may DECIDE approval requests): the same list without the admin
    shortcut — an admin who is only an admin manages but does not decide."""
    if user.id in ra.org_head_ids(db) or user.id == p.project_manager_id:
        return True
    if is_admin_user(user):
        return not decision
    return pm_wf.can_manage(p, user) and pm_in_scope(db, user, p)


def _pm_parent(db: Session, pm_project_id: int, user: User) -> TaskParent:
    """The PM project behind an R&D task. Opens for whoever manages R&D tasks on it
    (pm_manages) and for anyone who holds or gave a task on it; everyone else gets 404
    (not 403) so project codes / client names can't be enumerated. The Project
    Management data scope is not required of R&D heads or assignees — the per-task
    rules (_list, _ensure_reviewer, _ensure_assignee) decide what they may do."""
    p = db.get(PmProject, pm_project_id)
    not_found = HTTPException(status_code=404, detail="Project not found, or you have no R&D task on it — open it from R&D › R&D Tasks, or ask an R&D head to give you a task on it.")
    if not p:
        raise not_found
    managers = {*ra.org_head_ids(db), *([p.project_manager_id] if p.project_manager_id else [])}
    if pm_manages(db, user, p, decision=True):
        managers.add(user.id)
    elif pm_manages(db, user, p):
        pass  # a portal admin: manages through can_manage, never counted as a lead / decider
    elif db.query(RndProjectTask.id).filter(RndProjectTask.pm_project_id == p.id,
                                            or_(RndProjectTask.assigned_to_id == user.id, RndProjectTask.created_by_id == user.id)).first() is None:
        raise not_found
    return TaskParent(kind="pm", id=p.id, project_number=p.project_code, title=p.name,
                      lead_ids=sorted(managers), members_fn=lambda: _rnd_people_ids(db),
                      manager_label="an R&D head or the project manager", pm=p, managers=managers)


def _parent_of(db: Session, task: RndProjectTask, user: User) -> TaskParent:
    if task.pm_project_id:
        return _pm_parent(db, task.pm_project_id, user)
    return _rnd_parent(db, task.project_id, user)


def _task(db: Session, task_id: int) -> RndProjectTask:
    t = db.query(RndProjectTask).filter(RndProjectTask.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="This task no longer exists — refresh the page.")
    return t


def _ensure_manager(user: User, project: TaskParent, what: str) -> None:
    if not project.can_manage(user):
        hint = " Ask a lead, or have them add you as a lead." if project.kind == "rnd" else " Ask them to give the task, or to make you the project manager."
        raise HTTPException(status_code=403, detail=f"Only {project.manager_label} of {project.project_number} can {what}.{hint}")


def _ensure_reviewer(user: User, project: TaskParent, task: RndProjectTask, what: str, *, decision: bool = False) -> None:
    """The task's creator reviews it; project leads (R&D heads / the project manager on a PM project) and admins can review any task.
    `decision=True` (deciding an approval request): admins are left out — only the creator or a named lead decides."""
    allowed = project.can_decide(user) if decision else project.can_manage(user)
    if task.created_by_id != user.id and not allowed:
        raise HTTPException(status_code=403, detail=f"Only the person who created this task (or {project.manager_label} of {project.project_number}) can {what}."
                            + (" A portal admin does not decide for them." if decision and is_admin_user(user) else ""))


def _team_ids(project: TaskParent) -> list[int]:
    return list(dict.fromkeys([*project.member_ids, *project.lead_ids]))


def _broadcast(db: Session, project: TaskParent, event: str, *, title: str, message: str, actor: User,
               skip_user_ids: set[int], background_tasks: BackgroundTasks | None) -> None:
    """Role subscribers of an R&D project event. A PM project has no R&D data scope to
    broadcast on — its people were told directly (assignee, creator, heads, manager)."""
    if project.rnd is not None:
        rnd_events.project_event(db, event, project.rnd, title=title, message=message, actor=actor,
                                 skip_user_ids=skip_user_ids, background_tasks=background_tasks)


def _check_assignee(db: Session, project: TaskParent, assignee_id: int, allowed: list[int], who: str, user: User) -> User:
    if assignee_id not in allowed:
        hint = "Add them under Project Members (Edit → Team Members) first, then assign the task." if project.kind == "rnd" else "Only active people with R&D access can hold an R&D task — grant R&D in User Management first."
        raise HTTPException(status_code=400, detail=f"That person isn't {who} of {project.project_number}. {hint}")
    assignee = db.query(User).filter(User.id == assignee_id).first()
    if not assignee or not assignee.is_active:
        raise HTTPException(status_code=400, detail="The selected person was not found or is deactivated — pick someone else.")
    if "rnd" not in assignee.get_apps():
        raise HTTPException(status_code=400, detail=f"{_name(assignee)} has no access to the R&D module, so they couldn't see this task. Grant it in User Management, then assign again.")
    if project.kind == "pm" and not can_view_tab(assignee, "rnd", "projects"):
        # Task actions live under the R&D › Prototype / Research tab (this router's gate).
        raise HTTPException(status_code=400, detail=f"{_name(assignee)} can't open R&D › Prototype / Research, so they couldn't work this task. Give their role 'View' on that tab in Organization › Role & Permissions, then assign again.")
    # The role's assign-to rule (Role & Permissions › R&D › Prototype / Research › Project tasks).
    assignee_rules.ensure_allowed(db, user, RULE_KEY, assignee)
    return assignee


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


async def _store_files(db: Session, project: TaskParent, task: RndProjectTask, files: list[UploadFile] | None, role: str, user: User) -> list[RndDocument]:
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
            **project.fk(), task_id=task.id, task_doc_role=role, doc_type="other",
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
            "id": t.id, "source": "project" if t.project_id else "pm_project", "record_id": t.project_id or t.pm_project_id, "parent_task_id": t.parent_task_id,
            "department": (users.get(t.assigned_to_id).department if users.get(t.assigned_to_id) else None) or "R&D",
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


def _notify_managers(db: Session, project: TaskParent, task: RndProjectTask, actor: User, title: str, message: str, kind: str) -> None:
    # Top-level task → its creator + the leads; sub-task → only its creator.
    targets = {task.created_by_id} if task.parent_task_id else {task.created_by_id, *project.lead_ids}
    for uid in (targets - {actor.id}):
        notify_user(db, uid, title=title, message=message, notification_type=kind, entity_type=project.entity_type, entity_id=project.id)


# ── project-level ─────────────────────────────────────────────────────────

def _access(db: Session, project: TaskParent, user: User) -> dict:
    ids = _team_ids(project)
    found = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    leads = set(project.lead_ids)

    def row(u: User) -> dict:
        return {"id": u.id, "name": _name(u), "email": u.email, "designation": getattr(u, "designation", None),
                "department": u.department, "team_role": "head" if u.id in leads else "member"}

    team = assignee_rules.filter_people(db, user, RULE_KEY, [row(u) for i in ids if (u := found.get(i)) and u.is_active])
    members = set(project.member_ids)
    out = {"can_manage": project.can_manage(user), "people": [r for r in team if r["id"] in members], "team": team}
    if project.pm is not None:
        out["project"] = {"id": project.pm.id, "project_code": project.pm.project_code, "name": project.pm.name,
                          "client_name": project.pm.client_name, "status": project.pm.status}
    return out


@router.get("/projects/{project_id}/task-access")
async def task_access(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Whether the current user can hand out top-level tasks (leads / admins), and
    the project team: `people` (team members — top-level task assignees) and
    `team` (members + leads — who a sub-task can go to)."""
    return _access(db, _rnd_parent(db, project_id, user), user)


@router.get("/pm-projects/{pm_project_id}/task-access")
async def pm_task_access(pm_project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Same for a Project Management project: `can_manage` (admin, R&D head, the project's
    manager / management), `people` = active people with R&D access (after the role's
    "Assign to" rule), plus the project header for the R&D page."""
    return _access(db, _pm_parent(db, pm_project_id, user), user)


@router.get("/project-tasks/mine")
async def my_project_tasks(include_done: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Tasks assigned to me on any R&D project (open by default) — for R&D › My Tasks."""
    q = db.query(RndProjectTask).filter(RndProjectTask.assigned_to_id == user.id)
    if not include_done:
        q = q.filter(RndProjectTask.status == "open")
    tasks = q.order_by(RndProjectTask.due_date.asc()).all()
    projects = {p.id: p for p in db.query(RndProject).filter(
        RndProject.id.in_({t.project_id for t in tasks if t.project_id}), RndProject.is_deleted == False).all()} if tasks else {}  # noqa: E712
    pm_projects = {p.id: p for p in db.query(PmProject).filter(
        PmProject.id.in_({t.pm_project_id for t in tasks if t.pm_project_id})).all()} if tasks else {}
    tasks = [t for t in tasks if (t.project_id in projects) or (t.pm_project_id in pm_projects)]
    out = _serialize(db, tasks)
    for row, t in zip(out, tasks):
        if t.pm_project_id:
            p = pm_projects[t.pm_project_id]
            row["requirement_ref"], row["requirement_title"] = p.project_code, p.name
        else:
            p = projects[t.project_id]
            row["requirement_ref"], row["requirement_title"] = p.project_number, p.title
    return out


def _visible(db: Session, project: TaskParent, user: User) -> list[RndProjectTask]:
    ensure_feature_action(user, "rnd", "projects", "tasks", "view")
    tasks = db.query(RndProjectTask).filter(project.task_filter()).order_by(RndProjectTask.id.desc()).all()
    if not project.can_manage(user):
        mine = {t.id for t in tasks if user.id in (t.assigned_to_id, t.created_by_id)}
        tasks = [t for t in tasks if t.id in mine or t.parent_task_id in mine]
    return tasks


def _list(db: Session, project: TaskParent, user: User) -> list[dict]:
    return _serialize(db, _visible(db, project, user))


@router.get("/project-tasks/{task_id}/detail")
async def project_task_detail(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One project task on its own page (R&D › R&D Tasks › task): the task, its main task
    and its sub-tasks (as far as the user may see them), a one-line project header, and
    whether the user may also open the project page."""
    task = _task(db, task_id)
    project = _parent_of(db, task, user)
    tasks = _visible(db, project, user)
    if task.id not in {t.id for t in tasks}:
        raise HTTPException(status_code=403, detail=f"This task isn't yours — on {project.project_number} you see only the tasks assigned to you, "
                            f"the ones you gave, and their sub-tasks. Ask {project.manager_label} if you need to work on it.")
    family = [t for t in tasks if t.id in (task.id, task.parent_task_id) or t.parent_task_id == task.id]
    return {
        "tasks": _serialize(db, family),
        "parent": {"kind": "project" if project.kind == "rnd" else "pm_project", "id": project.id,
                   "ref": project.project_number, "title": project.title},
        "can_manage": project.can_manage(user),
        # _parent_of already checked the user may open the project (R&D data scope / a task on the PM project).
        "can_open_parent": True,
    }


@router.get("/projects/{project_id}/tasks")
async def list_tasks(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Leads / admins: every task on the project. Others: tasks assigned to
    them, tasks they created (their sub-tasks) and the sub-tasks under those."""
    return _list(db, _rnd_parent(db, project_id, user), user)


@router.get("/pm-projects/{pm_project_id}/tasks")
async def list_pm_tasks(pm_project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """R&D tasks on a Project Management project — same visibility rule."""
    return _list(db, _pm_parent(db, pm_project_id, user), user)


async def create_project_task(
    db: Session, user: User, *, project_id: int | None = None, pm_project_id: int | None = None,
    title: str, assigned_to_id: int, due_date: str,
    remarks: str | None = None, files: list[UploadFile] | None = None, priority: str | None = None,
    start_date: str | None = None, work_status: str | None = None, checklist: str | None = None,
    background_tasks: BackgroundTasks | None = None, check_feature: bool = True,
) -> dict:
    """Create a task on a Prototype / Research project (`project_id`) or on a Project
    Management project (`pm_project_id`) — shared by this router and POST /rnd/tasks.
    Project leads (R&D heads / the project manager on a PM project) and admins give
    tasks; `check_feature` also asks for the role's Project tasks > Create feature
    (the R&D Tasks board checks rnd:tasks:create instead)."""
    if pm_project_id:
        project = _pm_parent(db, pm_project_id, user)
        if project.pm.status in ("closed", "cancelled"):
            raise HTTPException(status_code=422, detail=f"{project.project_number} is {project.pm.status} — R&D tasks can only be given on a running project. Pick another project, or ask management to reopen this one.")
    elif project_id:
        project = _rnd_parent(db, project_id, user)
    else:
        raise HTTPException(status_code=422, detail="Pick the project this task is for.")
    _ensure_manager(user, project, "create tasks")
    if check_feature:
        ensure_feature_action(user, "rnd", "projects", "tasks", "create")
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Give the task a title — what should be done.")
    if len(title) > 200:
        raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 200 and put details in Remarks.")
    due = _parse_date(due_date, "Due date")
    if due < today_ist():
        raise HTTPException(status_code=422, detail=f"Due date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    assignee = _check_assignee(db, project, assigned_to_id, project.member_ids, "a team member" if project.kind == "rnd" else "an R&D person", user)

    task = RndProjectTask(
        **project.fk(), title=title, remarks=(remarks or "").strip() or None,
        assigned_to_id=assignee.id, created_by_id=user.id, original_due_date=due, due_date=due, status="open",
    )
    task_fields.apply_create(task, priority=priority, start_date=start_date, work_status=work_status, checklist=checklist, user=user)
    db.add(task)
    db.flush()
    await _store_files(db, project, task, files, BRIEF, user)
    _event(db, task, "created", user, remarks=task.remarks, new_due=due)
    if assignee.id != user.id:
        notify_user(db, assignee.id, title=f"New task on {project.project_number} — {project.title}",
                    message=f"{_name(user)} assigned you \"{title}\" — due {due.strftime('%d %b %Y')}." + (f" Remarks: {task.remarks}" if task.remarks else ""),
                    notification_type="rnd_project_task_assigned", entity_type=project.entity_type, entity_id=project.id)
    _broadcast(
        db, project, "project_task_assigned", title=f"{_name(assignee)} got a task on {project.project_number}",
        message=f"{_name(user)} assigned {_name(assignee)} \"{title}\" on {project.project_number} — {project.title}, due {due.strftime('%d %b %Y')}.",
        actor=user, skip_user_ids={assignee.id}, background_tasks=background_tasks,
    )
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/projects/{project_id}/tasks")
async def create_task(
    project_id: int,
    title: str = Form(...), assigned_to_id: int = Form(...), due_date: str = Form(...),
    remarks: str | None = Form(None), files: list[UploadFile] | None = File(None),
    priority: str | None = Form(None), start_date: str | None = Form(None),
    work_status: str | None = Form(None), checklist: str | None = Form(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    return await create_project_task(
        db, user, project_id=project_id, title=title, assigned_to_id=assigned_to_id, due_date=due_date, remarks=remarks,
        files=files, priority=priority, start_date=start_date, work_status=work_status, checklist=checklist,
        background_tasks=background_tasks,
    )


@router.post("/pm-projects/{pm_project_id}/tasks")
async def create_pm_task(
    pm_project_id: int,
    title: str = Form(...), assigned_to_id: int = Form(...), due_date: str = Form(...),
    remarks: str | None = Form(None), files: list[UploadFile] | None = File(None),
    priority: str | None = Form(None), start_date: str | None = Form(None),
    work_status: str | None = Form(None), checklist: str | None = Form(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """An R&D task on a Project Management project (from its R&D page)."""
    return await create_project_task(
        db, user, pm_project_id=pm_project_id, title=title, assigned_to_id=assigned_to_id, due_date=due_date, remarks=remarks,
        files=files, priority=priority, start_date=start_date, work_status=work_status, checklist=checklist,
        background_tasks=background_tasks,
    )


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
    project = _parent_of(db, parent, user)
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
        **project.fk(), parent_task_id=parent.id, title=title, remarks=(remarks or "").strip() or None,
        assigned_to_id=assignee.id, created_by_id=user.id, original_due_date=due, due_date=due, status="open",
    )
    task_fields.apply_create(task, priority=priority, start_date=start_date, work_status=work_status, checklist=checklist, user=user)
    db.add(task)
    db.flush()
    await _store_files(db, project, task, files, BRIEF, user)
    _event(db, task, "created", user, remarks=task.remarks, new_due=due)
    if assignee.id != user.id:
        notify_user(db, assignee.id, title=f"New sub-task on {project.project_number} — {project.title}",
                    message=f"{_name(user)} assigned you \"{title}\" (part of \"{parent.title}\") — due {due.strftime('%d %b %Y')}.",
                    notification_type="rnd_project_task_assigned", entity_type=project.entity_type, entity_id=project.id)
    _broadcast(
        db, project, "project_task_assigned", title=f"{_name(assignee)} got a sub-task on {project.project_number}",
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


class TaskProgressPayload(BaseModel):
    """A new work status, one checklist step ticked / unticked, or the progress
    percentage (0-100; only for a task without a checklist)."""
    work_status: str | None = None
    item_id: str | None = None
    done: bool | None = None
    progress_percent: int | None = None


@router.patch("/project-tasks/{task_id}")
async def edit_task(task_id: int, payload: TaskEditPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The task's creator (or a lead / admin) changes what, who or when — only while it is open."""
    task = _task(db, task_id)
    project = _parent_of(db, task, user)
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
        allowed = _team_ids(project) if task.parent_task_id else project.member_ids
        assignee = _check_assignee(db, project, data["assigned_to_id"], allowed, "on the project team" if task.parent_task_id else "a team member", user)
        prev = db.query(User).filter(User.id == task.assigned_to_id).first()
        changes.append(f"Assignee: {_name(prev)} → {_name(assignee)}")
        task.assigned_to_id = assignee.id
    changes += task_fields.apply_edit(task, data, _name(user), user)

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
                    notification_type="rnd_project_task_edited", entity_type=project.entity_type, entity_id=project.id)
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
    project = _parent_of(db, task, user)
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
    project = _parent_of(db, task, user)
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
    task_fields.mark_complete(task)
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
    project = _parent_of(db, task, user)
    if task.assigned_to_id != user.id:
        _ensure_reviewer(user, project, task, "update its checklist or status")
        ensure_feature_action(user, "rnd", "projects", "tasks", "edit")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — the checklist and status can change only while it is open. Reopen it first if needed.")
    line = task_fields.apply_progress(task, work_status=payload.work_status, item_id=payload.item_id, done=payload.done,
                                      actor_name=_name(user), progress_percent=payload.progress_percent)
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
    project = _parent_of(db, task, user)
    _ensure_assignee(task, user, "ask for approval on it")
    ensure_feature_action(user, "rnd", "projects", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — approvals can be asked only while it is open.")
    row = task_approvals.create(db, KIND, task.id, user, request)
    docs = await _store_files(db, project, task, files, APPROVAL, user)
    row.document_ids = [d.id for d in docs]
    _event(db, task, "approval_requested", user, remarks=row.request)
    targets = {task.created_by_id} if task.parent_task_id else {task.created_by_id, *project.lead_ids}
    for uid in targets - {user.id}:
        notify_user(db, uid, title=f"Approval needed on a task ({project.project_number})",
                    message=f"{_name(user)} asks for your approval on \"{task.title}\": {row.request[:200]}",
                    notification_type="rnd_project_task_approval_requested", entity_type=project.entity_type, entity_id=project.id, teams=True)
    db.commit()
    return _serialize(db, [task])[0]


class ApprovalDecision(BaseModel):
    decision: str
    remarks: str | None = None


@router.post("/project-task-approvals/{approval_id}/decide")
async def decide_approval(approval_id: int, payload: ApprovalDecision, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = task_approvals.get(db, KIND, approval_id)
    task = _task(db, row.task_id)
    project = _parent_of(db, task, user)
    _ensure_reviewer(user, project, task, "decide its approval requests", decision=True)
    ensure_feature_action(user, "rnd", "projects", "tasks", "approve")
    task_approvals.ensure_task_open(task)
    task_approvals.decide(row, user, payload.decision, payload.remarks)
    _event(db, task, row.status, user, remarks=row.decision_remarks)
    if row.requested_by_id != user.id:
        notify_user(db, row.requested_by_id, title=f"Approval {row.status} ({project.project_number})",
                    message=f"{_name(user)} {row.status} your request on \"{task.title}\"." + (f" Remarks: {row.decision_remarks}" if row.decision_remarks else ""),
                    notification_type=f"rnd_project_task_approval_{row.status}", entity_type=project.entity_type, entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-task-approvals/{approval_id}/withdraw")
async def withdraw_approval(approval_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = task_approvals.get(db, KIND, approval_id)
    task = _task(db, row.task_id)
    _parent_of(db, task, user)
    task_approvals.withdraw(row, user)
    _event(db, task, "approval_withdrawn", user)
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/update")
async def add_task_update(task_id: int, remarks: str = Form(...), files: list[UploadFile] | None = File(None),
                          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Assignee posts progress (remarks + any files); the task stays open."""
    task = _task(db, task_id)
    project = _parent_of(db, task, user)
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
                    notification_type="rnd_project_task_update", entity_type=project.entity_type, entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/reopen")
async def reopen_task(task_id: int, payload: ReviewPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task(db, task_id)
    project = _parent_of(db, task, user)
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
    task_fields.on_reopen(task)
    changed = task.due_date != old
    _event(db, task, "reopened", user, remarks=reason, old_due=old if changed else None, new_due=task.due_date if changed else None)
    if task.assigned_to_id != user.id:
        notify_user(db, task.assigned_to_id, title=f"Task reopened ({project.project_number})",
                    message=f"{_name(user)} reopened \"{task.title}\" — due {task.due_date.strftime('%d %b %Y')}. Reason: {reason}",
                    notification_type="rnd_project_task_reopened", entity_type=project.entity_type, entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]


@router.post("/project-tasks/{task_id}/cancel")
async def cancel_task(task_id: int, payload: ReviewPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task(db, task_id)
    project = _parent_of(db, task, user)
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
                    notification_type="rnd_project_task_cancelled", entity_type=project.entity_type, entity_id=project.id)
    db.commit()
    return _serialize(db, [task])[0]
