"""Project milestones (shown as "Milestones" in the UI; stored as department
tasks — `pm_project_tasks` rows with no WBS `milestone_id`).

- The project manager / management gives a milestone to ONE PERSON of a
  department, with a title and a due date (`router`, needs the Project
  Management app). That person is its owner.
- The owner works it from Project Management › My Tasks (`ongoing_router`,
  no app needed): starts it, splits it into sub-tasks for anyone (each with
  a due date, not after the milestone's) and marks it done once every
  sub-task is done. Whoever gets a sub-task ticks it off in their My Tasks.
- Every user sees only their own work (milestones they own, sub-tasks given
  to them) — there is no "everything for everyone" list any more.
- Due dates: app/tasks/pm_reminders.py tells the owner the day before and
  the owner AND whoever gave it on the day and when overdue.
Old milestones given to a department before owners existed (assignee empty)
fall back to the department head as owner.
Every status change is kept in the task history and the project History."""
from datetime import date, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.permissions import ensure_feature_action, require_feature_action
from app.core.permission_registry import can_feature, can_view_tab
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.department import Department
from app.modules.projects import views, workflow as wf
from app.modules.projects.events import pm_event
from app.modules.projects.models.project import PmProject
from sqlalchemy import func

from app.modules.projects.models.document import PmProjectDocument
from app.modules.projects.models.task import (
    PmProjectTask, PmTaskSubtask, PmTaskTimeLog, PmTaskUpdate, PM_TASK_OPEN_STATUSES, PM_TASK_PRIORITIES,
    PM_SUBTASK_STATUSES, PM_MILESTONE_COLORS, PM_MILESTONE_ICONS,
)
from app.modules.design.models.request import DesignTaskDeliverable
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.projects.routes.documents import _project_or_404, file_response, soft_delete, store_files
from app.modules.projects.schemas.document import PmProjectDocumentResponse

router = APIRouter(prefix="/projects/{project_id}/project-tasks", tags=["Project Management"])
ongoing_router = APIRouter(prefix="/pm-ongoing", tags=["Project Management"])

OPEN_PROJECT = ("planning", "active", "on_hold", "technically_complete")

# Role "Assign to" rules (core/assignee_rules.PICKERS, declared in core/features/projects.py).
MS_RULE_KEY = "projects:overview.milestones"   # milestone responsible person + co-owners
TASK_RULE_KEY = "projects:overview.tasks"      # a milestone's tasks: assignee + collaborators


def _pm_role(user: User) -> bool:
    """True when the user's roles open the project workspace (projects:overview).
    Its features (core/features/projects.py: milestones, tasks, checklist,
    files, comments, activity log) then also apply on the shared My Tasks
    endpoints below. My Tasks is open to everyone, so people outside
    Project Management keep working their own items under the record rules."""
    return can_view_tab(user, "projects", "overview")


# ── Schemas ────────────────────────────────────────────────────────────

class DeptTaskCreate(BaseModel):
    title: str
    department_id: int | None = None  # left out: the responsible person's own department
    assignee_id: int
    due_date: date                    # end date (expected achievable date)
    description: str | None = None
    start_date: date | None = None
    # Set from the form: todo | in_progress | blocked (On hold, needs blocker_reason).
    # Achieved / cancelled go through the status actions, which carry their own rules.
    status: str | None = None
    blocker_reason: str | None = None
    color: str | None = None
    icon: str | None = None
    co_owner_ids: list[int] = []      # more responsible people besides assignee_id


class DeptTaskEdit(BaseModel):
    title: str | None = None
    department_id: int | None = None
    assignee_id: int | None = None
    due_date: date | None = None
    description: str | None = None
    start_date: date | None = None
    status: str | None = None
    blocker_reason: str | None = None
    color: str | None = None
    icon: str | None = None
    co_owner_ids: list[int] | None = None


class TaskStatusPayload(BaseModel):
    # start | done | reopen | cancel
    action: str
    reason: str | None = None


class SubtaskCreate(BaseModel):
    title: str
    assignee_id: int
    due_date: date
    description: str | None = None
    collaborator_ids: list[int] = []
    start_date: date | None = None
    priority: str = "medium"
    status: str = "todo"
    labels: list[str] = []


class SubtaskEdit(BaseModel):
    title: str | None = None
    assignee_id: int | None = None
    due_date: date | None = None
    description: str | None = None
    collaborator_ids: list[int] | None = None
    start_date: date | None = None
    priority: str | None = None
    status: str | None = None
    labels: list[str] | None = None


class SubtaskStatus(BaseModel):
    done: bool


class SubtaskOut(BaseModel):
    id: int
    parent_id: int | None = None         # set on a sub-task of a task
    title: str
    assignee_id: int | None = None
    assignee_name: str | None = None
    created_by_name: str | None = None   # who gave it
    created_at: datetime | None = None
    description: str | None = None
    collaborator_ids: list[int] = []
    collaborator_names: list[str] = []
    collab: bool = False                 # the viewer is a collaborator
    start_date: date | None = None
    due_date: date | None = None
    priority: str = "medium"
    status: str
    progress: int = 0                    # Done = 100, else the share of its checklist ticked
    labels: list[str] = []
    is_overdue: bool = False
    completed_at: datetime | None = None
    mine: bool = False                   # given to the viewer
    can_toggle: bool = False
    can_delete: bool = False
    can_write: bool = False     # add remarks and attachments to this sub-task
    can_add_child: bool = False  # split this task into sub-tasks
    can_edit: bool = False       # change name / person / due date
    remarks_count: int = 0
    files_count: int = 0


class DeptTaskOut(BaseModel):
    id: int
    project_id: int
    project_code: str | None = None
    project_name: str | None = None
    title: str
    description: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    assignee_id: int | None = None
    assignee_name: str | None = None     # the owner (department head for old ones)
    co_owner_ids: list[int] = []          # more responsible people besides assignee_id
    start_date: date | None = None
    due_date: date | None = None
    color: str | None = None
    icon: str | None = None
    blocker_reason: str | None = None
    status: str
    is_overdue: bool = False
    created_by_name: str | None = None   # who gave it
    completed_at: datetime | None = None
    reopen_reason: str | None = None
    cancel_reason: str | None = None
    created_at: datetime | None = None
    subtasks: list[SubtaskOut] = []
    # What the viewer may do — the UI shows only these buttons.
    can_edit: bool = False      # PM: edit / cancel / reopen
    can_delete: bool = False    # PM: delete the milestone outright
    can_work: bool = False      # owner or PM: start / done
    can_plan: bool = False      # owner or PM: add / remove sub-tasks
    can_write: bool = False     # add remarks and attachments
    mine: bool = False          # the viewer owns it
    has_my_subtask: bool = False
    given_by_me: bool = False   # the viewer gave it (follows it up in My Tasks)
    remarks_count: int = 0
    files_count: int = 0
    # All tasks of the milestone (the viewer may see only theirs in `subtasks`).
    tasks_total: int = 0
    tasks_done: int = 0


class RemarkCreate(BaseModel):
    comment: str


class RemarkOut(BaseModel):
    id: int
    user_id: int | None = None
    user_name: str | None = None
    comment: str | None = None
    created_at: datetime | None = None


class LogOut(BaseModel):
    id: int
    user_name: str | None = None
    text: str | None = None
    from_status: str | None = None
    to_status: str | None = None
    created_at: datetime | None = None


class TaskActivityOut(BaseModel):
    remarks: list[RemarkOut] = []
    files: list[PmProjectDocumentResponse] = []
    # A task's own history (created, edited, status, dependencies) — newest first.
    log: list[LogOut] = []
    can_write: bool = False


# ── Helpers ────────────────────────────────────────────────────────────

def _co_owners(db: Session, ids: list[int] | None, main_id: int | None) -> list[int]:
    """Further responsible people on a milestone: active users, no repeats,
    not the main responsible person."""
    out = [i for i in dict.fromkeys(int(i) for i in (ids or []) if i) if i != main_id]
    if out:
        found = {u.id for u in db.query(User).filter(User.id.in_(out), User.is_active.is_(True)).all()}
        missing = [i for i in out if i not in found]
        if missing:
            raise HTTPException(status_code=422, detail=f"User(s) #{', #'.join(map(str, missing))} don't exist or are deactivated — remove them from Responsible people.")
    return out


def _ensure_may_pick(db: Session, user: User, key: str, ids) -> None:
    """The role's assign-to rule for every newly picked person — only people
    who weren't on the record already, so an untouched value never blocks a save."""
    for uid in dict.fromkeys(i for i in ids if i):
        person = db.get(User, uid)
        if person:
            assignee_rules.ensure_allowed(db, user, key, person)


def _owner_ids(db: Session, t: PmProjectTask) -> list[int]:
    """Who owns a milestone: the person it was given to. Old ones given to a
    department before owners existed → that department's head(s)."""
    if t.assignee_id:
        return list(dict.fromkeys([t.assignee_id, *(int(i) for i in (t.co_owner_ids or []) if i)]))
    dept = db.get(Department, t.department_id) if t.department_id else None
    return wf.department_head_ids(dept)


def _is_owner(db: Session, user: User, t: PmProjectTask) -> bool:
    return wf.is_admin(user) or user.id in _owner_ids(db, t)


def _owner_label(db: Session, t: PmProjectTask) -> str:
    return ", ".join(filter(None, (wf.name_of(db, i) for i in _owner_ids(db, t)))) or "the person it was given to"


def _sees_task(user: User, s: PmTaskSubtask) -> bool:
    """A task is visible to whoever created it, its assignee and its
    collaborators (admins see all) — nobody else."""
    return (wf.is_admin(user) or s.created_by_id == user.id or s.assignee_id == user.id
            or user.id in (s.collaborator_ids or []))


def _require_sees_task(db: Session, user: User, st: PmTaskSubtask) -> None:
    task = db.get(PmTaskSubtask, st.parent_id) if st.parent_id else st
    if task is not None and not _sees_task(user, task):
        raise HTTPException(status_code=403, detail=f"'{task.title}' isn't yours — only whoever created it and the people it is assigned to can open it.")


def _ms_creator(project: PmProject, t: PmProjectTask, user: User) -> bool:
    """Only whoever created a milestone edits, cancels, reopens or deletes it.
    Older milestones without a recorded creator: the project manager."""
    return t.created_by_id == user.id if t.created_by_id else wf.can_manage(project, user)


def _require_ms_creator(db: Session, project: PmProject, t: PmProjectTask, user: User, action: str) -> None:
    if not _ms_creator(project, t, user):
        who = wf.name_of(db, t.created_by_id) if t.created_by_id else "the project manager"
        raise HTTPException(status_code=403, detail=f"Only {who}, who created the milestone '{t.title}', can {action} it.")


def _subtask_overdue(s: PmTaskSubtask) -> bool:
    return s.status != "done" and s.due_date is not None and s.due_date < date.today()


def _feature_flags(user: User) -> dict[str, bool]:
    """The viewer's task / checklist / milestone feature grants — the same for
    every row, so worked out once per request (see _pm_role)."""
    pm_role = _pm_role(user)
    return {f"{feat}.{action}": not pm_role or can_feature(user, "projects", "overview", feat, action)
            for feat, action in (("tasks", "create"), ("tasks", "edit"), ("tasks", "delete"), ("task_checklist", "create"),
                                 ("task_checklist", "edit"), ("task_checklist", "delete"), ("milestones", "delete"))}


def _task_out(db: Session, t: PmProjectTask, project: PmProject, user: User, cache, subs: list[PmTaskSubtask],
              counts: tuple[int, int] = (0, 0), sub_counts: dict[int, tuple[int, int]] | None = None,
              flags: dict[str, bool] | None = None, manage: bool | None = None) -> DeptTaskOut:
    open_project = project.status in OPEN_PROJECT
    manage = wf.can_manage(project, user) if manage is None else manage
    owners = _owner_ids(db, t)
    flags = flags or _feature_flags(user)
    f_task_create, f_task_edit, f_task_delete = flags["tasks.create"], flags["tasks.edit"], flags["tasks.delete"]
    f_item_create, f_item_edit = flags["task_checklist.create"], flags["task_checklist.edit"]
    f_item_delete, f_ms_delete = flags["task_checklist.delete"], flags["milestones.delete"]
    owner = wf.is_admin(user) or user.id in owners
    task_open = t.status in PM_TASK_OPEN_STATUSES
    sub_holder = any(s.assignee_id == user.id for s in subs)
    by_id = {s.id: s for s in subs}

    def collab(s: PmTaskSubtask) -> bool:
        return user.id in (s.collaborator_ids or [])

    def parent_holder(s: PmTaskSubtask) -> bool:
        """Works on the task this checklist item belongs to (assignee or collaborator)."""
        parent = by_id.get(s.parent_id) if s.parent_id else None
        return parent is not None and (parent.assignee_id == user.id or collab(parent))
    sub_holder = sub_holder or any(collab(s) for s in subs)
    # Edit / delete belong to whoever created it (older ones without a creator: the project manager).
    ms_creator = _ms_creator(project, t, user)
    ms_has_done = any(x.parent_id is None and x.status == "done" for x in subs)
    top = [x for x in subs if x.parent_id is None]
    # Each person sees only their tasks: ones they created, or are assigned to / collaborate on.
    mine_ids = {x.id for x in top if _sees_task(user, x)}
    shown = [x for x in subs if (x.id if x.parent_id is None else x.parent_id) in mine_ids]

    def task_creator(s: PmTaskSubtask) -> bool:
        return s.created_by_id == user.id if s.created_by_id else manage

    def item_keeper(s: PmTaskSubtask) -> bool:
        """May add / remove a checklist item: whoever works on its task, or the task's creator."""
        parent = by_id.get(s.parent_id) if s.parent_id else None
        return parent is not None and (parent_holder(s) or task_creator(parent))

    def files_of(s: PmTaskSubtask) -> int:
        return (sub_counts or {}).get(s.id, (0, 0))[1]

    def progress(s: PmTaskSubtask) -> int:
        if s.status == "done":
            return 100
        kids = [k for k in subs if k.parent_id == s.id]
        return round(sum(1 for k in kids if k.status == "done") * 100 / len(kids)) if kids else 0
    return DeptTaskOut(
        id=t.id, project_id=t.project_id, project_code=project.project_code, project_name=project.name,
        title=t.title, description=t.description,
        department_id=t.department_id, department_name=cache.dept(t.department_id),
        assignee_id=t.assignee_id, co_owner_ids=[int(i) for i in (t.co_owner_ids or []) if i], assignee_name=", ".join(filter(None, (cache.user(i) for i in owners))) or None,
        start_date=t.start_date, due_date=t.due_date, color=t.color, icon=t.icon, blocker_reason=t.blocker_reason, status=t.status,
        is_overdue=wf.task_is_overdue(t), created_by_name=cache.user(t.created_by_id), completed_at=t.completed_at,
        reopen_reason=t.reopen_reason, cancel_reason=t.cancel_reason, created_at=t.created_at,
        subtasks=[SubtaskOut(
            id=s.id, parent_id=s.parent_id, title=s.title, assignee_id=s.assignee_id, assignee_name=cache.user(s.assignee_id),
            created_by_name=cache.user(s.created_by_id), created_at=s.created_at,
            description=s.description, collaborator_ids=list(s.collaborator_ids or []),
            collaborator_names=[n for n in (cache.user(i) for i in (s.collaborator_ids or [])) if n], collab=collab(s),
            start_date=s.start_date, due_date=s.due_date, priority=s.priority or "medium",
            status=s.status, progress=progress(s),
            labels=list(s.labels or []),
            is_overdue=_subtask_overdue(s), completed_at=s.completed_at, mine=s.assignee_id == user.id,
            can_toggle=open_project and task_open and (f_item_edit if s.parent_id else f_task_edit)
                       and (owner or manage or s.assignee_id == user.id or parent_holder(s) or collab(s)),
            can_delete=open_project and task_open and s.status != "done" and (
                (f_item_delete and item_keeper(s)) if s.parent_id else (f_task_delete and task_creator(s) and files_of(s) == 0)),
            can_write=open_project and (manage or owner or s.assignee_id == user.id or parent_holder(s) or collab(s)),
            can_add_child=open_project and task_open and s.parent_id is None and s.status != "done" and f_item_create
                          and (s.assignee_id == user.id or collab(s) or task_creator(s)),
            can_edit=open_project and task_open and s.parent_id is None and s.status != "done" and task_creator(s) and f_task_edit,
            remarks_count=(sub_counts or {}).get(s.id, (0, 0))[0], files_count=(sub_counts or {}).get(s.id, (0, 0))[1],
        ) for s in shown],
        tasks_total=len(top), tasks_done=sum(1 for x in top if x.status == "done"),
        can_edit=open_project and ms_creator and t.status != "cancelled",
        can_delete=open_project and ms_creator and not ms_has_done and f_ms_delete,
        can_work=open_project and task_open and (manage or owner),
        can_plan=open_project and task_open and (manage or owner) and f_task_create,
        can_write=open_project and (manage or owner or sub_holder),
        mine=user.id in owners,
        has_my_subtask=sub_holder,
        given_by_me=t.created_by_id == user.id,
        remarks_count=counts[0], files_count=counts[1],
    )


def _tasks_out(db: Session, projects: list[PmProject], user: User, only: set[int] | None = None) -> dict[int, list[DeptTaskOut]]:
    """project_id → its department tasks (with sub-tasks), due date first.
    `only`: just these milestones (My Tasks / one milestone) instead of all."""
    ids = [p.id for p in projects]
    if not ids:
        return {}
    by_id = {p.id: p for p in projects}
    q = db.query(PmProjectTask).filter(PmProjectTask.project_id.in_(ids), PmProjectTask.milestone_id.is_(None))
    if only is not None:
        q = q.filter(PmProjectTask.id.in_(list(only) or [-1]))
    tasks = q.order_by(PmProjectTask.due_date.is_(None), PmProjectTask.due_date, PmProjectTask.id).all()
    subs: dict[int, list[PmTaskSubtask]] = {}
    if tasks:
        for s in db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id.in_([t.id for t in tasks])).order_by(PmTaskSubtask.id).all():
            subs.setdefault(s.task_id, []).append(s)
    # Remark / file counters — task-level ones (subtask_id NULL) and per sub-task.
    remarks: dict[int, int] = {}
    files: dict[int, int] = {}
    sub_counts: dict[int, tuple[int, int]] = {}
    if tasks:
        tids = [t.id for t in tasks]
        for task_id, sub_id, n in (db.query(PmTaskUpdate.task_id, PmTaskUpdate.subtask_id, func.count(PmTaskUpdate.id))
                                   .filter(PmTaskUpdate.task_id.in_(tids), PmTaskUpdate.kind == "comment")
                                   .group_by(PmTaskUpdate.task_id, PmTaskUpdate.subtask_id).all()):
            if sub_id:
                sub_counts[sub_id] = (n, sub_counts.get(sub_id, (0, 0))[1])
            else:
                remarks[task_id] = n
        for task_id, sub_id, n in (db.query(PmProjectDocument.task_id, PmProjectDocument.subtask_id, func.count(PmProjectDocument.id))
                                   .filter(PmProjectDocument.task_id.in_(tids), PmProjectDocument.is_deleted == False)  # noqa: E712
                                   .group_by(PmProjectDocument.task_id, PmProjectDocument.subtask_id).all()):
            if sub_id:
                sub_counts[sub_id] = (sub_counts.get(sub_id, (0, 0))[0], n)
            else:
                files[task_id] = n
    cache = views.names(db)
    flags = _feature_flags(user)
    manage = {p.id: wf.can_manage(p, user) for p in projects}
    out: dict[int, list[DeptTaskOut]] = {}
    for t in tasks:
        out.setdefault(t.project_id, []).append(_task_out(db, t, by_id[t.project_id], user, cache, subs.get(t.id, []),
                                                          (remarks.get(t.id, 0), files.get(t.id, 0)), sub_counts,
                                                          flags, manage[t.project_id]))
    return out


def _one(db: Session, t: PmProjectTask, user: User) -> DeptTaskOut:
    project = db.get(PmProject, t.project_id)
    return next(x for x in _tasks_out(db, [project], user, only={t.id}).get(project.id, []) if x.id == t.id)


def _project(db: Session, project_id: int) -> PmProject:
    p = db.get(PmProject, project_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found — it may have been deleted.")
    return p


def _task(db: Session, task_id: int, project_id: int | None = None) -> PmProjectTask:
    t = db.get(PmProjectTask, task_id)
    if not t or t.milestone_id is not None or (project_id is not None and t.project_id != project_id):
        raise HTTPException(status_code=404, detail=f"Milestone #{task_id} not found — it may have been deleted.")
    return t


def _require_open(project: PmProject) -> None:
    if project.status not in OPEN_PROJECT:
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} is {wf.PROJECT_STATUS_LABELS[project.status]}, so its milestones can't change.")


def _department(db: Session, department_id: int) -> Department:
    d = db.get(Department, department_id)
    if not d:
        raise HTTPException(status_code=422, detail=f"Department #{department_id} doesn't exist — pick one from the list.")
    return d


def _person_in(db: Session, dept: Department, user_id: int | None) -> User:
    """The milestone's owner: an active person of the chosen department."""
    if not user_id:
        raise HTTPException(status_code=422, detail="Pick the person who will own this milestone.")
    person = db.get(User, user_id)
    if not person or not person.is_active:
        raise HTTPException(status_code=422, detail=f"User #{user_id} doesn't exist or is deactivated — pick someone else.")
    if person.id not in wf.department_member_ids(db, dept):
        raise HTTPException(status_code=422, detail=f"{wf.user_label(person)} is not in {dept.name}. Pick someone from the {dept.name} list "
                                                    "(their HR profile or Azure department must be set to it).")
    return person


def _responsible(db: Session, user_id: int | None) -> User:
    """The milestone's responsible person: any active user."""
    if not user_id:
        raise HTTPException(status_code=422, detail="Pick the person responsible for this milestone.")
    person = db.get(User, user_id)
    if not person or not person.is_active:
        raise HTTPException(status_code=422, detail=f"User #{user_id} doesn't exist or is deactivated — pick someone else.")
    return person


def _home_department_id(db: Session, person: User) -> int | None:
    """The person's own department (HR profile, else user record, else the
    Azure department name) — shown on the milestone, never asked for."""
    dept_id = db.query(HrEmployeeProfile.department_id).filter(HrEmployeeProfile.user_id == person.id).scalar() or person.department_id
    if dept_id:
        return dept_id
    name = (person.department or "").strip().lower()
    if name:
        d = db.query(Department).filter(func.lower(func.trim(Department.name)) == name).first()
        return d.id if d else None
    return None


MS_FORM_STATUSES = {"todo": "Not started", "in_progress": "In progress", "blocked": "On hold"}
SUB_STATUS_LABELS = {"todo": "To do", "in_progress": "In progress", "on_hold": "On hold", "done": "Done"}


def _check_ms_look(updates: dict) -> None:
    if updates.get("color") and updates["color"] not in PM_MILESTONE_COLORS:
        raise HTTPException(status_code=422, detail=f"'{updates['color']}' is not one of the milestone colours — pick one from the palette.")
    if updates.get("icon") and updates["icon"] not in PM_MILESTONE_ICONS:
        raise HTTPException(status_code=422, detail=f"'{updates['icon']}' is not one of the milestone icons — pick one from the list.")


def _check_ms_dates(start: date | None, end: date | None) -> None:
    if start and end and start > end:
        raise HTTPException(status_code=422, detail=f"Start date {start:%d-%m-%Y} is after the end date {end:%d-%m-%Y}. Fix one of the two dates.")


def _apply_ms_status(db: Session, t: PmProjectTask, user: User, status: str | None, reason: str | None) -> None:
    """Status picked on the milestone form: Not started / In progress / On hold."""
    if not status or status == t.status:
        if status == "blocked" and reason:
            t.blocker_reason = reason
        return
    if status not in MS_FORM_STATUSES:
        raise HTTPException(status_code=422, detail=f"'{status}' can't be set from the form. Pick Not started, In progress or On hold — "
                                                    "use Mark achieved / Cancel milestone for the others.")
    if t.status not in PM_TASK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS.get(t.status, t.status)}; reopen it first to change its status.")
    if status == "blocked":
        if not reason:
            raise HTTPException(status_code=422, detail="Say why the milestone is on hold, so its owner and the PM know what it waits for.")
        t.blocker_reason = reason
    if status == "todo" and db.query(PmTaskSubtask.id).filter(PmTaskSubtask.task_id == t.id, PmTaskSubtask.status != "todo").first():
        raise HTTPException(status_code=409, detail=f"Work has already started on '{t.title}' (some tasks are in progress or done), so it can't go back to Not started.")
    if status == "in_progress":
        t.started_at = t.started_at or wf.now()
    if t.id:
        wf.set_task_status(db, t, user, status, reason if status == "blocked" else None)
    else:
        t.status = status


def _clean_labels(labels: list[str]) -> list[str]:
    out: list[str] = []
    for raw in labels:
        tag = " ".join((raw or "").split())[:30]
        if tag and tag.lower() not in {x.lower() for x in out}:
            out.append(tag)
    if len(out) > 10:
        raise HTTPException(status_code=422, detail=f"{len(out)} labels — keep it to 10 at most so they stay useful for filtering.")
    return out


def _apply_task_fields(db: Session, project: PmProject, t: PmProjectTask, s: PmTaskSubtask, data: dict, user: User) -> list[int]:
    """Validate and set a task's detail fields (create and edit). Returns the
    collaborators newly added, to notify. Does not commit."""
    if "description" in data:
        s.description = (data["description"] or "").strip() or None
    if "priority" in data:
        if data["priority"] not in PM_TASK_PRIORITIES:
            raise HTTPException(status_code=422, detail=f"'{data['priority']}' is not a priority. Use one of {', '.join(PM_TASK_PRIORITIES)}.")
        s.priority = data["priority"]
    start = data["start_date"] if "start_date" in data else s.start_date
    if start and s.due_date and start > s.due_date:
        raise HTTPException(status_code=422, detail=f"Start date {start:%d-%m-%Y} is after the due date {s.due_date:%d-%m-%Y}. Fix one of the two dates.")
    if start and t.start_date and start < t.start_date:
        raise HTTPException(status_code=422, detail=f"Start date {start:%d-%m-%Y} is before the milestone '{t.title}' starts ({t.start_date:%d-%m-%Y}).")
    s.start_date = start
    if "labels" in data and data["labels"] is not None:
        s.labels = _clean_labels(data["labels"])
    added: list[int] = []
    if "collaborator_ids" in data and data["collaborator_ids"] is not None:
        ids = list(dict.fromkeys(i for i in data["collaborator_ids"] if i and i != s.assignee_id))
        if len(ids) > 10:
            raise HTTPException(status_code=422, detail=f"{len(ids)} collaborators — at most 10. Split the task if more people are needed.")
        people = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
        bad = [str(i) for i in ids if i not in people or not people[i].is_active]
        if bad:
            raise HTTPException(status_code=422, detail=f"Collaborator(s) #{', #'.join(bad)} don't exist or are deactivated — pick active people.")
        added = [i for i in ids if i not in (s.collaborator_ids or [])]
        _ensure_may_pick(db, user, TASK_RULE_KEY, added)
        s.collaborator_ids = ids

    if "status" in data and data["status"] and data["status"] != s.status:
        _set_sub_status(db, t, s, data["status"])
    return added


def _log(db: Session, t: PmProjectTask, s: PmTaskSubtask, user: User, text: str,
         from_status: str | None = None, to_status: str | None = None) -> None:
    """One line of the task's Activity Log (PmTaskUpdate kind="log")."""
    db.add(PmTaskUpdate(task_id=t.id, subtask_id=s.id, user_id=user.id, kind="log", comment=text[:2000],
                        from_status=from_status, to_status=to_status))


_TRACKED = {
    "title": "Name", "assignee_id": "Assignee", "due_date": "Due date", "start_date": "Start date", "priority": "Priority",
    "status": "Status", "description": "Description", "collaborator_ids": "Collaborators", "labels": "Labels",
}


def _snapshot(s: PmTaskSubtask) -> dict:
    return {k: (list(getattr(s, k) or []) if k.endswith("_ids") or k == "labels" else getattr(s, k)) for k in _TRACKED}


def _describe_changes(db: Session, before: dict, s: PmTaskSubtask) -> list[str]:
    after = _snapshot(s)
    out = []
    for k, label in _TRACKED.items():
        old, new = before[k], after[k]
        if old == new:
            continue
        if k == "assignee_id":
            out.append(f"{label}: {wf.name_of(db, old) or '—'} → {wf.name_of(db, new) or '—'}")
        elif k == "collaborator_ids":
            out.append(f"{label}: {', '.join(filter(None, (wf.name_of(db, i) for i in new))) or 'none'}")
        elif k == "labels":
            out.append(f"{label}: {', '.join(new) or 'none'}")
        elif k == "status":
            out.append(f"{label}: {SUB_STATUS_LABELS.get(old, old)} → {SUB_STATUS_LABELS.get(new, new)}")
        elif k == "description":
            out.append("Description updated")
        elif hasattr(new, "strftime") or hasattr(old, "strftime"):
            out.append(f"{label}: {old:%d-%m-%Y} → {new:%d-%m-%Y}" if old and new else f"{label}: {old or '—'} → {new or '—'}")
        else:
            out.append(f"{label}: {old or '—'} → {new or '—'}")
    return out


def _set_sub_status(db: Session, t: PmProjectTask, s: PmTaskSubtask, status: str) -> None:
    """Task status with its rule: its checklist ticked before Done. Does not commit."""
    if status not in PM_SUBTASK_STATUSES:
        raise HTTPException(status_code=422, detail=f"'{status}' is not a task status. Use one of: {', '.join(SUB_STATUS_LABELS.values())}.")
    if status == "done" and s.id:
        open_children = [c.title for c in db.query(PmTaskSubtask).filter(PmTaskSubtask.parent_id == s.id, PmTaskSubtask.status != "done").all()]
        if open_children:
            raise HTTPException(status_code=409, detail=f"'{s.title}' still has {len(open_children)} unticked checklist item(s): {', '.join(open_children[:5])}. Tick or remove them first.")
    s.status = status
    s.completed_at = wf.now() if status == "done" else None
    if status != "todo" and t.status == "todo":
        t.started_at = t.started_at or wf.now()
        t.status = "in_progress"


def _notify_owner(db: Session, project: PmProject, t: PmProjectTask, actor: User, title: str, msg: str,
                  ntype: str = "pm_dept_task") -> None:
    wf.notify_many(db, _owner_ids(db, t), actor, title, msg, ntype, "pm_task", t.id)


# ── Project manager (Project Management › project › Milestones) ─────────

@router.get("", response_model=list[DeptTaskOut])
async def list_tasks(project_id: int, db: Session = Depends(get_db),
                     user: User = Depends(require_feature_action("projects", "overview", "milestones", "view"))):
    project = _project_or_404(db, project_id, user)
    return _tasks_out(db, [project], user).get(project.id, [])


@router.post("", response_model=DeptTaskOut)
async def create_task(project_id: int, payload: DeptTaskCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                      user: User = Depends(require_feature_action("projects", "overview", "milestones", "create"))):
    project = _project_or_404(db, project_id, user)
    wf.require_manage(project, user, "add milestones")
    _require_open(project)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Milestone title is required.")
    if payload.due_date < date.today():
        raise HTTPException(status_code=422, detail=f"Expected achievable date {payload.due_date:%d-%m-%Y} is in the past — pick today or later.")
    _check_ms_dates(payload.start_date, payload.due_date)
    _check_ms_look(payload.model_dump())
    if payload.department_id:
        dept = _department(db, payload.department_id)
        person = _person_in(db, dept, payload.assignee_id)
    else:
        person = _responsible(db, payload.assignee_id)
        dept_id = _home_department_id(db, person)
        dept = db.get(Department, dept_id) if dept_id else None
    t = PmProjectTask(project_id=project.id, milestone_id=None, department_id=dept.id if dept else None, assignee_id=person.id, title=title,
                      description=(payload.description or "").strip() or None, due_date=payload.due_date,
                      start_date=payload.start_date, color=payload.color or None, icon=payload.icon or None,
                      status="todo", priority="medium", created_by_id=user.id)
    t.co_owner_ids = _co_owners(db, payload.co_owner_ids, person.id) or None
    _ensure_may_pick(db, user, MS_RULE_KEY, [person.id, *(t.co_owner_ids or [])])
    _apply_ms_status(db, t, user, payload.status, (payload.blocker_reason or "").strip() or None)
    db.add(t)
    db.flush()
    wf.audit(db, project.id, user, "task_created",
             f"Milestone '{t.title}' given to {wf.user_label(person)}{f' ({dept.name})' if dept else ''}, due {t.due_date:%d-%m-%Y}, by {wf.user_label(user)}.",
             subtab_key="tasks")
    _notify_owner(db, project, t, user, "New milestone for you",
                  f"{project.project_code} {project.name}: '{t.title}', due {t.due_date:%d-%m-%Y}, from {wf.user_label(user)}. "
                  f"Open Project Management › My Tasks — split it into tasks if needed.")
    # Role subscribers (core/events/projects.py); the owner(s) got the notice above.
    pm_event(db, background_tasks, "milestone_assigned", project, title=f"Milestone given: {t.title}",
             message=f"{project.project_code} {project.name}: '{t.title}' given to {wf.user_label(person)}, due {t.due_date:%d-%m-%Y}, "
                     f"by {wf.user_label(user)}. Open the project's Milestones tab to follow it.",
             entity_type="pm_project", entity_id=project.id, actor=user, skip=_owner_ids(db, t))
    db.commit()
    return _one(db, t, user)


@router.patch("/{task_id}", response_model=DeptTaskOut)
async def edit_task(project_id: int, task_id: int, payload: DeptTaskEdit, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                    user: User = Depends(require_feature_action("projects", "overview", "milestones", "edit"))):
    project = _project_or_404(db, project_id, user)
    _require_open(project)
    t = _task(db, task_id, project_id)
    _require_ms_creator(db, project, t, user, "edit")
    if t.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"'{t.title}' is cancelled. Delete it, or add a new milestone instead.")
    updates = payload.model_dump(exclude_unset=True)
    if "title" in updates:
        if not (updates["title"] or "").strip():
            raise HTTPException(status_code=422, detail="Milestone title can't be empty.")
        updates["title"] = updates["title"].strip()
    if "due_date" in updates and updates["due_date"] is None:
        raise HTTPException(status_code=422, detail="A milestone needs a due date.")
    if "assignee_id" in updates and updates["assignee_id"] is None:
        raise HTTPException(status_code=422, detail="A milestone needs the person who owns it.")
    new_owner = updates.get("assignee_id", t.assignee_id)
    reassigned = new_owner != t.assignee_id or ("department_id" in updates and updates["department_id"] != t.department_id)
    if reassigned:
        if updates.get("department_id"):
            person = _person_in(db, _department(db, updates["department_id"]), new_owner)
        else:
            person = _responsible(db, new_owner)
            updates["department_id"] = _home_department_id(db, person)
        updates["assignee_id"] = person.id
    if "description" in updates:
        updates["description"] = (updates["description"] or "").strip() or None
    old_owners = set(_owner_ids(db, t))
    if "co_owner_ids" in updates:
        updates["co_owner_ids"] = _co_owners(db, updates["co_owner_ids"] or [], updates.get("assignee_id", t.assignee_id)) or None
    # Handing over / adding co-owners: the role's assign-to rule, for new people only.
    _ensure_may_pick(db, user, MS_RULE_KEY, [i for i in [updates.get("assignee_id"), *(updates.get("co_owner_ids") or [])]
                                             if i and i not in old_owners])
    _check_ms_look(updates)
    _check_ms_dates(updates.get("start_date", t.start_date), updates.get("due_date", t.due_date))
    new_status, reason = updates.pop("status", None), (updates.pop("blocker_reason", None) or "").strip() or None
    if "start_date" in updates and updates["start_date"]:
        early = [x.title for x in db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id == t.id, PmTaskSubtask.start_date < updates["start_date"]).all()]
        if early:
            raise HTTPException(status_code=422, detail=f"These tasks start before {updates['start_date']:%d-%m-%Y}: {', '.join(early[:5])}. Move them first.")
    for field, val in updates.items():
        setattr(t, field, val)
    _apply_ms_status(db, t, user, new_status, reason)
    wf.audit(db, project.id, user, "task_updated", f"Milestone '{t.title}' edited by {wf.user_label(user)}.", subtab_key="tasks")
    added = [i for i in _owner_ids(db, t) if i not in old_owners]
    if added:
        wf.notify_many(db, added, user, "New milestone for you",
                       f"{project.project_code} {project.name}: you are now responsible for '{t.title}', due {t.due_date:%d-%m-%Y} — from {wf.user_label(user)}.",
                       "pm_dept_task", "pm_task", t.id)
        pm_event(db, background_tasks, "milestone_assigned", project, title=f"Milestone handed over: {t.title}",
                 message=f"{project.project_code} {project.name}: '{t.title}' (due {t.due_date:%d-%m-%Y}) is now with "
                         f"{', '.join(filter(None, (wf.name_of(db, i) for i in added)))} — changed by {wf.user_label(user)}.",
                 entity_type="pm_project", entity_id=project.id, actor=user, skip=added)
    db.commit()
    return _one(db, t, user)


@router.delete("/{task_id}")
async def delete_task(project_id: int, task_id: int, db: Session = Depends(get_db),
                      user: User = Depends(require_feature_action("projects", "overview", "milestones", "delete"))):
    """The project manager removes a milestone outright — with its sub-tasks,
    remarks, time logs and files. The deletion is kept in History."""
    project = _project_or_404(db, project_id, user)
    _require_open(project)
    t = _task(db, task_id, project_id)
    _require_ms_creator(db, project, t, user, "delete")
    done = [x.title for x in db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id == t.id, PmTaskSubtask.parent_id.is_(None),
                                                             PmTaskSubtask.status == "done").all()]
    if done:
        raise HTTPException(status_code=409, detail=f"'{t.title}' can't be deleted — {len(done)} of its tasks are completed ({', '.join(done[:3])}"
                                                    f"{'…' if len(done) > 3 else ''}) and are kept as a record. Cancel the milestone instead.")
    linked = db.query(DesignTaskDeliverable.id).filter(DesignTaskDeliverable.pm_task_id == t.id).first()
    if linked:
        raise HTTPException(status_code=409, detail=f"'{t.title}' is linked to a Design drawing/BOM deliverable. Remove that link in Design first, or cancel the milestone instead.")
    for doc in db.query(PmProjectDocument).filter(PmProjectDocument.task_id == t.id, PmProjectDocument.is_deleted.is_(False)).all():
        await soft_delete(db, doc, user)
    db.query(PmProjectDocument).filter(PmProjectDocument.task_id == t.id).update({PmProjectDocument.task_id: None}, synchronize_session=False)
    for model in (PmTaskUpdate, PmTaskTimeLog, PmTaskSubtask):
        db.query(model).filter(model.task_id == t.id).delete(synchronize_session=False)
    wf.audit(db, project.id, user, "task_deleted",
             f"Milestone '{t.title}' ({_owner_label(db, t)}, due {t.due_date:%d-%m-%Y}) deleted by {wf.user_label(user)}." if t.due_date
             else f"Milestone '{t.title}' deleted by {wf.user_label(user)}.", subtab_key="tasks")
    if t.assignee_id and t.assignee_id != user.id and t.status in PM_TASK_OPEN_STATUSES:
        # Points at the project — the milestone itself is gone.
        wf.notify_many(db, _owner_ids(db, t), user, "Milestone removed",
                       f"{project.project_code} {project.name}: '{t.title}' was deleted by {wf.user_label(user)} — no further work is needed on it.",
                       "pm_dept_task", "pm_project", project.id)
    db.delete(t)
    db.commit()
    return {"message": f"Milestone '{t.title}' deleted."}


# ── Everyone — their own milestones and sub-tasks (My Tasks) ───────────

@ongoing_router.get("/my", response_model=list[DeptTaskOut])
async def my_work(include_closed: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The viewer's own work only: milestones they own, milestones where one
    of the sub-tasks is theirs (with the whole milestone for context), and
    milestones they gave to someone (to follow up — they get its due-date
    reminders too). Only projects still running."""
    sub_task_ids = {tid for (tid,) in db.query(PmTaskSubtask.task_id).filter(PmTaskSubtask.assignee_id == user.id).all()}
    # JSON columns: read just the ids + lists (an empty / JSON-null list isn't SQL NULL, so these scan every row).
    sub_task_ids |= {tid for tid, ids in db.query(PmTaskSubtask.task_id, PmTaskSubtask.collaborator_ids)
                     .filter(PmTaskSubtask.collaborator_ids.isnot(None)).all() if user.id in (ids or [])}
    base = db.query(PmProjectTask).filter(PmProjectTask.milestone_id.is_(None))
    owned = {tid for (tid,) in base.filter(PmProjectTask.assignee_id == user.id).with_entities(PmProjectTask.id).all()}
    owned |= {tid for tid, ids in base.filter(PmProjectTask.co_owner_ids.isnot(None))
              .with_entities(PmProjectTask.id, PmProjectTask.co_owner_ids).all() if user.id in (ids or [])}
    owned |= {tid for (tid,) in base.filter(PmProjectTask.created_by_id == user.id).with_entities(PmProjectTask.id).all()}
    # Old milestones without an owner belong to the department head.
    headed = set(wf.headed_department_ids(db, user))
    legacy = {tid for tid, did in base.filter(PmProjectTask.assignee_id.is_(None))
              .with_entities(PmProjectTask.id, PmProjectTask.department_id).all() if did and did in headed} if headed else set()
    wanted = owned | legacy | sub_task_ids
    if not wanted:
        return []
    project_ids = {pid for (pid,) in db.query(PmProjectTask.project_id).filter(PmProjectTask.id.in_(wanted)).distinct().all()}
    projects = db.query(PmProject).filter(PmProject.id.in_(project_ids), PmProject.status.in_(OPEN_PROJECT)).all()
    rows = [t for ts in _tasks_out(db, projects, user, only=wanted).values() for t in ts]
    if not include_closed:
        rows = [t for t in rows if t.status in PM_TASK_OPEN_STATUSES]
    rows.sort(key=lambda t: (t.due_date is None, t.due_date or date.max, t.id))
    return rows


@ongoing_router.get("/tasks/{task_id}", response_model=DeptTaskOut)
async def one_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A milestone in full — for its owner, the people on its sub-tasks,
    whoever gave it and the project's management."""
    t = _task(db, task_id)
    out = _one(db, t, user)
    project = _project(db, t.project_id)
    if not (out.mine or out.has_my_subtask or t.created_by_id == user.id or wf.can_manage(project, user)):
        raise HTTPException(status_code=403, detail=f"'{t.title}' is not yours — it is with {out.assignee_name or 'someone else'}.")
    return out


@ongoing_router.get("/people")
async def all_people(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everyone a milestone owner can give a sub-task to (any active user)."""
    users = db.query(User).filter(User.is_active.is_(True)).all()
    users.sort(key=lambda u: (u.name or u.email or "").lower())
    return [{"id": u.id, "name": wf.user_label(u), "designation": u.designation, "department": u.department} for u in users]


@ongoing_router.get("/departments/{department_id}/people")
async def department_people(department_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A department's people (heads first) — whom a milestone can be given to."""
    dept = db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail=f"Department #{department_id} not found")
    heads = wf.department_head_ids(dept)
    ids = wf.department_member_ids(db, dept)
    users = db.query(User).filter(User.id.in_(ids), User.is_active.is_(True)).all() if ids else []
    users.sort(key=lambda u: (u.id not in heads, (u.name or u.email or "").lower()))
    return [{"id": u.id, "name": wf.user_label(u), "designation": u.designation, "is_head": u.id in heads} for u in users]


@ongoing_router.post("/tasks/{task_id}/status", response_model=DeptTaskOut)
async def change_status(task_id: int, payload: TaskStatusPayload, background_tasks: BackgroundTasks,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = _task(db, task_id)
    project = _project(db, t.project_id)
    _require_open(project)
    manage = wf.can_manage(project, user)
    owner = _is_owner(db, user, t)
    action, reason = payload.action, (payload.reason or "").strip() or None
    label = wf.TASK_STATUS_LABELS.get(t.status, t.status)
    if _pm_role(user):
        if action == "done":
            ensure_feature_action(user, "projects", "overview", "milestone_status", "approve")
        elif action == "reopen":
            ensure_feature_action(user, "projects", "overview", "milestone_status", "edit")
        elif action == "cancel":
            ensure_feature_action(user, "projects", "overview", "milestone_status", "cancel")
    if action in ("start", "done") and not (manage or owner):
        raise HTTPException(status_code=403, detail=f"Only {_owner_label(db, t)} (it is theirs) or the project manager can {action} '{t.title}'.")
    if action in ("reopen", "cancel"):
        _require_ms_creator(db, project, t, user, action)
    if action == "start":
        if t.status != "todo":
            raise HTTPException(status_code=409, detail=f"'{t.title}' is {label}; only a To-do milestone can be started.")
        t.started_at = wf.now()
        wf.set_task_status(db, t, user, "in_progress")
    elif action == "done":
        if t.status not in PM_TASK_OPEN_STATUSES:
            raise HTTPException(status_code=409, detail=f"'{t.title}' is {label}; it can't be marked done.")
        pending = [s.title for s in db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id == t.id, PmTaskSubtask.status != "done").all()]
        if pending:
            raise HTTPException(status_code=409, detail=f"{len(pending)} sub-task(s) are not done yet: {', '.join(pending[:5])}. Finish or remove them first.")
        t.started_at = t.started_at or wf.now()
        t.completed_at = wf.now()
        wf.set_task_status(db, t, user, "done")
        told = [*wf.project_owner_ids(db, project), t.created_by_id]
        wf.notify_many(db, told, user, "Milestone done",
                       f"{project.project_code}: '{t.title}' was marked done by {wf.user_label(user)}.",
                       "pm_project_task_done", "pm_project", project.id)
        pm_event(db, background_tasks, "milestone_achieved", project, title=f"Milestone achieved: {t.title}",
                 message=f"{project.project_code} {project.name}: '{t.title}' was marked achieved by {wf.user_label(user)}.",
                 entity_type="pm_project", entity_id=project.id, actor=user, skip=told)
    elif action == "reopen":
        if t.status != "done":
            raise HTTPException(status_code=409, detail=f"'{t.title}' is {label}; only a Done milestone can be reopened.")
        if not reason:
            raise HTTPException(status_code=422, detail="Say why the milestone is being reopened, so its owner knows what to redo.")
        t.completed_at, t.reopen_reason = None, reason
        wf.set_task_status(db, t, user, "in_progress", reason)
        _notify_owner(db, project, t, user, "Milestone reopened", f"{project.project_code}: '{t.title}' was reopened by {wf.user_label(user)}. Reason: {reason}")
        pm_event(db, background_tasks, "milestone_reopened", project, title=f"Milestone reopened: {t.title}",
                 message=f"{project.project_code} {project.name}: '{t.title}' was reopened by {wf.user_label(user)}. Reason: {reason}",
                 entity_type="pm_project", entity_id=project.id, actor=user, skip=_owner_ids(db, t))
    elif action == "cancel":
        if t.status not in PM_TASK_OPEN_STATUSES:
            raise HTTPException(status_code=409, detail=f"'{t.title}' is {label}; only an open milestone can be cancelled.")
        if not reason:
            raise HTTPException(status_code=422, detail="Give a reason for cancelling the milestone.")
        t.cancel_reason = reason
        wf.set_task_status(db, t, user, "cancelled", reason)
        _notify_owner(db, project, t, user, "Milestone cancelled", f"{project.project_code}: '{t.title}' was cancelled by {wf.user_label(user)}. Reason: {reason}")
        pm_event(db, background_tasks, "milestone_cancelled", project, title=f"Milestone cancelled: {t.title}",
                 message=f"{project.project_code} {project.name}: '{t.title}' was cancelled by {wf.user_label(user)}. Reason: {reason}",
                 entity_type="pm_project", entity_id=project.id, actor=user, skip=_owner_ids(db, t))
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action '{action}'. Use one of: start, done, reopen, cancel.")
    db.commit()
    return _one(db, t, user)


@ongoing_router.post("/tasks/{task_id}/subtasks", response_model=DeptTaskOut)
async def add_subtask(task_id: int, payload: SubtaskCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = _task(db, task_id)
    project = _project(db, t.project_id)
    _require_open(project)
    if not (_is_owner(db, user, t) or wf.can_manage(project, user)):
        raise HTTPException(status_code=403, detail=f"Only {_owner_label(db, t)} (it is theirs) or the project manager can split '{t.title}' into sub-tasks.")
    if _pm_role(user):
        ensure_feature_action(user, "projects", "overview", "tasks", "create")
    if t.status not in PM_TASK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; it can't get new sub-tasks.")
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Sub-task name is required.")
    person = db.get(User, payload.assignee_id)
    if not person or not person.is_active:
        raise HTTPException(status_code=422, detail=f"User #{payload.assignee_id} doesn't exist or is deactivated — pick someone else.")
    if payload.due_date < date.today():
        raise HTTPException(status_code=422, detail=f"Sub-task due date {payload.due_date:%d-%m-%Y} is in the past — pick today or later.")
    if t.due_date and payload.due_date > t.due_date:
        raise HTTPException(status_code=422, detail=f"Sub-task due date {payload.due_date:%d-%m-%Y} is after the milestone's due date {t.due_date:%d-%m-%Y}.")
    assignee_rules.ensure_allowed(db, user, TASK_RULE_KEY, person)
    s = PmTaskSubtask(task_id=t.id, title=title, assignee_id=person.id, due_date=payload.due_date, status="todo", created_by_id=user.id)
    collabs = _apply_task_fields(db, project, t, s, payload.model_dump(), user)
    db.add(s)
    db.flush()
    _log(db, t, s, user, f"Created and given to {wf.user_label(person)}, due {payload.due_date:%d-%m-%Y}.", None, s.status)
    if t.status == "todo":
        t.started_at = wf.now()
        wf.set_task_status(db, t, user, "in_progress", "Work split into sub-tasks")
    wf.audit(db, project.id, user, "subtask_created",
             f"Sub-task '{title}' of '{t.title}' given to {wf.user_label(person)} by {wf.user_label(user)}.", subtab_key="tasks")
    wf.notify_many(db, [person.id], user, "New sub-task for you",
                   f"{project.project_code} {project.name}: '{title}' (part of '{t.title}'), due {payload.due_date:%d-%m-%Y}, "
                   f"from {wf.user_label(user)}. Open Project Management › My Tasks.",
                   "pm_subtask", "pm_task", t.id)
    _notify_collaborators(db, project, t, s, user, collabs)
    db.commit()
    return _one(db, t, user)


def _notify_collaborators(db: Session, project: PmProject, t: PmProjectTask, s: PmTaskSubtask, actor: User, ids: list[int]) -> None:
    if ids:
        wf.notify_many(db, ids, actor, "You're a collaborator on a task",
                       f"{project.project_code} {project.name}: '{s.title}' (milestone '{t.title}'), with {wf.name_of(db, s.assignee_id) or 'the assignee'}, "
                       f"due {s.due_date:%d-%m-%Y}. Open Project Management › My Tasks.", "pm_subtask", "pm_task", t.id)


class ChecklistItemCreate(BaseModel):
    title: str


@ongoing_router.post("/subtasks/{subtask_id}/subtasks", response_model=DeptTaskOut)
async def add_child_subtask(subtask_id: int, payload: ChecklistItemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Add a checklist item to a task. A checklist item is only a line to tick
    off — it belongs to the task's assignee and due date, with no person,
    dates or comments of its own."""
    parent = db.get(PmTaskSubtask, subtask_id)
    if not parent:
        raise HTTPException(status_code=404, detail=f"Task #{subtask_id} not found — it may have been deleted.")
    if parent.parent_id is not None:
        raise HTTPException(status_code=422, detail=f"'{parent.title}' is a checklist item — add the new item to its task instead.")
    t = _task(db, parent.task_id)
    project = _project(db, t.project_id)
    _require_open(project)
    if not (_works_on(user, parent) or _is_owner(db, user, t) or wf.can_manage(project, user)):
        raise HTTPException(status_code=403, detail=f"Only {wf.name_of(db, parent.assignee_id) or 'the person it is assigned to'}, its collaborators, "
                                                    f"the milestone owner or the project manager can add checklist items to '{parent.title}'.")
    if t.status not in PM_TASK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; its tasks can't change.")
    if parent.status == "done":
        raise HTTPException(status_code=409, detail=f"'{parent.title}' is done. Set it back to In progress first to add checklist items.")
    if _pm_role(user):
        ensure_feature_action(user, "projects", "overview", "task_checklist", "create")
    title = " ".join((payload.title or "").split())
    if not title:
        raise HTTPException(status_code=422, detail="Write the checklist item before adding it.")
    if len(title) > 255:
        raise HTTPException(status_code=422, detail=f"The checklist item is {len(title)} characters — keep it under 255.")
    db.add(PmTaskSubtask(task_id=t.id, parent_id=parent.id, title=title, assignee_id=parent.assignee_id, due_date=parent.due_date,
                         status="todo", created_by_id=user.id))
    _log(db, t, parent, user, f"Checklist item added: '{title}'")
    wf.audit(db, project.id, user, "subtask_created", f"Checklist item '{title}' added to '{parent.title}' ('{t.title}') by {wf.user_label(user)}.", subtab_key="tasks")
    db.commit()
    return _one(db, t, user)


def _works_on(user: User, s: PmTaskSubtask | None) -> bool:
    """The task's assignee or one of its collaborators."""
    return s is not None and (s.assignee_id == user.id or user.id in (s.collaborator_ids or []))


@ongoing_router.patch("/subtasks/{subtask_id}", response_model=DeptTaskOut)
async def edit_subtask(subtask_id: int, payload: SubtaskEdit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Change a task's (or sub-task's) name, person or due date — whoever gave
    it, the milestone owner, the PM, or (for a sub-task) the task's holder."""
    s = _subtask(db, subtask_id)
    t = _task(db, s.task_id)
    project = _project(db, t.project_id)
    _require_open(project)
    parent = db.get(PmTaskSubtask, s.parent_id) if s.parent_id else None
    updates = payload.model_dump(exclude_unset=True)
    if parent:
        raise HTTPException(status_code=422, detail=f"'{s.title}' is a checklist item — tick it, or remove it and add it again.")
    if _pm_role(user):
        ensure_feature_action(user, "projects", "overview", "tasks", "edit")
    # Only whoever created the task edits it; its assignee / collaborators change its status.
    creator = s.created_by_id == user.id if s.created_by_id else wf.can_manage(project, user)
    if not creator:
        doer = _works_on(user, s)
        if not (doer and set(updates) <= {"status"}):
            raise HTTPException(status_code=403, detail=f"Only {wf.name_of(db, s.created_by_id) or 'whoever created it'}, who created '{s.title}', can edit it"
                                                        f"{' — as its assignee or collaborator you can change its status, add checklist items and comments' if doer else ''}.")
    if t.status not in PM_TASK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"Milestone '{t.title}' is {wf.TASK_STATUS_LABELS.get(t.status, t.status)}; its tasks can't change.")
    if s.status == "done" and not (updates.get("status") and updates["status"] != "done"):
        raise HTTPException(status_code=409, detail=f"'{s.title}' is done. Set its status back (e.g. In progress) to change it.")
    if "title" in updates:
        if not (updates["title"] or "").strip():
            raise HTTPException(status_code=422, detail="The name can't be empty.")
        updates["title"] = updates["title"].strip()
    if "assignee_id" in updates:
        person = db.get(User, updates["assignee_id"]) if updates["assignee_id"] else None
        if not person or not person.is_active:
            raise HTTPException(status_code=422, detail="Pick an active person to assign it to.")
        if person.id != s.assignee_id:
            assignee_rules.ensure_allowed(db, user, TASK_RULE_KEY, person)
    if "due_date" in updates:
        if updates["due_date"] is None:
            raise HTTPException(status_code=422, detail="A due date is required.")
        limit = (parent.due_date if parent else None) or t.due_date
        if limit and updates["due_date"] > limit:
            raise HTTPException(status_code=422, detail=f"Due date {updates['due_date']:%d-%m-%Y} is after the {'task' if parent else 'milestone'}'s date {limit:%d-%m-%Y}.")
        late = [c.title for c in db.query(PmTaskSubtask).filter(PmTaskSubtask.parent_id == s.id).all() if c.due_date and c.due_date > updates["due_date"]]
        if late:
            raise HTTPException(status_code=422, detail=f"These sub-tasks are due after {updates['due_date']:%d-%m-%Y}: {', '.join(late[:5])}. Move them first.")
    old_person = s.assignee_id
    before = _snapshot(s)
    for field in ("title", "assignee_id", "due_date"):
        if field in updates:
            setattr(s, field, updates[field])
    old_status = s.status
    collabs = _apply_task_fields(db, project, t, s, updates, user)
    changes = _describe_changes(db, before, s)
    if changes:
        _log(db, t, s, user, "; ".join(changes), before["status"] if before["status"] != s.status else None,
             s.status if before["status"] != s.status else None)
    wf.audit(db, project.id, user, "subtask_updated",
             f"'{s.title}' on '{t.title}' edited by {wf.user_label(user)}"
             + (f" — status {SUB_STATUS_LABELS.get(old_status, old_status)} → {SUB_STATUS_LABELS.get(s.status, s.status)}" if s.status != old_status else "")
             + ".", subtab_key="tasks")
    _notify_collaborators(db, project, t, s, user, collabs)
    if s.assignee_id != old_person:
        wf.notify_many(db, [s.assignee_id], user, "New task for you",
                       f"{project.project_code} {project.name}: '{s.title}' (milestone '{t.title}'), due {s.due_date:%d-%m-%Y}, "
                       f"from {wf.user_label(user)}. Open Project Management › My Tasks.",
                       "pm_subtask", "pm_task", t.id)
    db.commit()
    return _one(db, t, user)


@ongoing_router.post("/subtasks/{subtask_id}/status", response_model=DeptTaskOut)
async def toggle_subtask(subtask_id: int, payload: SubtaskStatus, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(PmTaskSubtask, subtask_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Sub-task #{subtask_id} not found — it may have been deleted.")
    t = _task(db, s.task_id)
    project = _project(db, t.project_id)
    _require_open(project)
    parent = db.get(PmTaskSubtask, s.parent_id) if s.parent_id else None
    if _pm_role(user):
        if parent:
            ensure_feature_action(user, "projects", "overview", "task_checklist", "edit")
        else:
            ensure_feature_action(user, "projects", "overview", "tasks", "edit")
    if not (_works_on(user, s) or _works_on(user, parent) or _is_owner(db, user, t) or wf.can_manage(project, user)):
        raise HTTPException(status_code=403, detail=f"Only {wf.name_of(db, s.assignee_id) or 'the person it was given to'}, its collaborators, the milestone owner ({_owner_label(db, t)}) or the project manager can tick off '{s.title}'.")
    if t.status not in PM_TASK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; its sub-tasks can't change.")
    old_status = s.status
    _set_sub_status(db, t, s, "done" if payload.done else ("in_progress" if parent is None and old_status == "done" else "todo"))
    if s.status != old_status:
        if parent:  # a checklist item: recorded on its task
            _log(db, t, parent, user, f"Checklist item {'ticked' if s.status == 'done' else 'unticked'}: '{s.title}'")
        else:
            _log(db, t, s, user, f"Status: {SUB_STATUS_LABELS.get(old_status, old_status)} → {SUB_STATUS_LABELS.get(s.status, s.status)}", old_status, s.status)
    wf.audit(db, project.id, user, "subtask_status",
             f"Sub-task '{s.title}' of '{t.title}' marked {'done' if payload.done else 'not done'} by {wf.user_label(user)}.", subtab_key="tasks")
    if payload.done and s.assignee_id == user.id:
        wf.notify_many(db, [*_owner_ids(db, t), s.created_by_id], user, "Sub-task done",
                       f"{project.project_code}: '{s.title}' (part of '{t.title}') was done by {wf.user_label(user)}.",
                       "pm_dept_task", "pm_task", t.id)
    db.commit()
    return _one(db, t, user)


@ongoing_router.delete("/subtasks/{subtask_id}", response_model=DeptTaskOut)
async def delete_subtask(subtask_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(PmTaskSubtask, subtask_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Sub-task #{subtask_id} not found — it may have been deleted.")
    t = _task(db, s.task_id)
    project = _project(db, t.project_id)
    _require_open(project)
    parent = db.get(PmTaskSubtask, s.parent_id) if s.parent_id else None
    if _pm_role(user):
        if parent:
            ensure_feature_action(user, "projects", "overview", "task_checklist", "delete")
        else:
            ensure_feature_action(user, "projects", "overview", "tasks", "delete")
    if parent:
        parent_creator = parent.created_by_id == user.id if parent.created_by_id else wf.can_manage(project, user)
        if not (_works_on(user, parent) or parent_creator):
            raise HTTPException(status_code=403, detail=f"Only whoever works on '{parent.title}' or created it can remove its checklist items.")
    else:
        creator = s.created_by_id == user.id if s.created_by_id else wf.can_manage(project, user)
        if not creator:
            raise HTTPException(status_code=403, detail=f"Only {wf.name_of(db, s.created_by_id) or 'whoever created it'}, who created '{s.title}', can delete it.")
        files = db.query(func.count(PmProjectDocument.id)).filter(PmProjectDocument.subtask_id == s.id, PmProjectDocument.is_deleted.is_(False)).scalar()
        if files:
            raise HTTPException(status_code=409, detail=f"'{s.title}' has {files} attached file(s), which are kept as a record, so it can't be deleted.")
    if s.status == "done":
        raise HTTPException(status_code=409, detail=f"'{s.title}' is completed and kept as a record, so it can't be deleted.")
    if db.query(PmTaskSubtask.id).filter(PmTaskSubtask.parent_id == s.id, PmTaskSubtask.status == "done").first():
        raise HTTPException(status_code=409, detail=f"'{s.title}' has finished sub-tasks, which are kept as a record. Untick them first, or keep the task.")
    if parent:
        _log(db, t, parent, user, f"Checklist item removed: '{s.title}'")
    db.query(PmTaskSubtask).filter(PmTaskSubtask.parent_id == s.id).delete(synchronize_session=False)
    wf.audit(db, project.id, user, "subtask_deleted", f"Sub-task '{s.title}' of '{t.title}' removed by {wf.user_label(user)}.", subtab_key="tasks")
    db.delete(s)
    db.commit()
    return _one(db, t, user)


# ── Remarks and attachments on a department task or one sub-task ───────

def _subtask(db: Session, subtask_id: int) -> PmTaskSubtask:
    st = db.get(PmTaskSubtask, subtask_id)
    if not st:
        raise HTTPException(status_code=404, detail=f"Sub-task #{subtask_id} not found — it may have been deleted.")
    return st


def _activity(db: Session, t: PmProjectTask, user: User, st: PmTaskSubtask | None = None) -> TaskActivityOut:
    project = _project(db, t.project_id)
    cache = views.names(db)
    rq = db.query(PmTaskUpdate).filter(PmTaskUpdate.task_id == t.id, PmTaskUpdate.kind == "comment")
    dq = db.query(PmProjectDocument).filter(PmProjectDocument.task_id == t.id, PmProjectDocument.is_deleted == False)  # noqa: E712
    if st:
        rq, dq = rq.filter(PmTaskUpdate.subtask_id == st.id), dq.filter(PmProjectDocument.subtask_id == st.id)
    else:
        rq, dq = rq.filter(PmTaskUpdate.subtask_id.is_(None)), dq.filter(PmProjectDocument.subtask_id.is_(None))
    log = []
    if st:
        log = [LogOut(id=x.id, user_name=cache.user(x.user_id), text=x.comment, from_status=x.from_status, to_status=x.to_status,
                      created_at=x.created_at)
               for x in db.query(PmTaskUpdate).filter(PmTaskUpdate.subtask_id == st.id, PmTaskUpdate.kind == "log")
               .order_by(PmTaskUpdate.id.desc()).limit(200).all()]
    out = TaskActivityOut(
        log=log,
        remarks=[RemarkOut(id=r.id, user_id=r.user_id, user_name=cache.user(r.user_id), comment=r.comment, created_at=r.created_at)
                 for r in rq.order_by(PmTaskUpdate.id).all()],
        files=[views.document_response(d, cache) for d in dq.order_by(PmProjectDocument.id).all()],
        can_write=_can_write(db, project, t, user, st),
    )
    if _pm_role(user):
        if not can_feature(user, "projects", "overview", "task_comments", "view"):
            out.remarks = []
        if not can_feature(user, "projects", "overview", "task_files", "view"):
            out.files = []
        if not can_feature(user, "projects", "overview", "task_log", "view"):
            out.log = []
    return out


def _can_see(db: Session, project: PmProject, t: PmProjectTask, user: User) -> bool:
    """Who may read a milestone's remarks and files: its owner, the people on
    its sub-tasks, whoever gave it, and the project's management."""
    return (_is_owner(db, user, t) or t.created_by_id == user.id or wf.can_manage(project, user)
            or db.query(PmTaskSubtask.id).filter(PmTaskSubtask.task_id == t.id, PmTaskSubtask.assignee_id == user.id).first() is not None
            or any(user.id in (x.collaborator_ids or []) for x in db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id == t.id).all()))


def _require_see(db: Session, t: PmProjectTask, user: User) -> None:
    if not _can_see(db, _project(db, t.project_id), t, user):
        raise HTTPException(status_code=403, detail=f"'{t.title}' is not yours — only its owner, the people on its sub-tasks, "
                                                    "whoever gave it and the project manager can open it.")


def _can_write(db: Session, project: PmProject, t: PmProjectTask, user: User, st: PmTaskSubtask | None) -> bool:
    """Milestone: PM / management, its owner, sub-task holders. Sub-task:
    PM / management, the milestone owner, the person it was given to."""
    if project.status not in OPEN_PROJECT:
        return False
    if wf.can_manage(project, user) or _is_owner(db, user, t):
        return True
    if st:
        parent = db.get(PmTaskSubtask, st.parent_id) if st.parent_id else None
        return st.assignee_id == user.id or user.id in (st.collaborator_ids or []) or (parent is not None and parent.assignee_id == user.id)
    return db.query(PmTaskSubtask.id).filter(PmTaskSubtask.task_id == t.id, PmTaskSubtask.assignee_id == user.id).first() is not None


def _require_writer(db: Session, t: PmProjectTask, user: User, action: str, st: PmTaskSubtask | None = None) -> PmProject:
    project = _project(db, t.project_id)
    _require_open(project)
    if not _can_write(db, project, t, user, st):
        who = (f"the project manager, the milestone owner ({_owner_label(db, t)}) or {wf.name_of(db, st.assignee_id) or 'the person it was given to'}"
               if st else f"the project manager, the milestone owner ({_owner_label(db, t)}) or someone with a sub-task on '{t.title}'")
        raise HTTPException(status_code=403, detail=f"Only {who} can {action}.")
    return project


def _tell(db: Session, project: PmProject, t: PmProjectTask, actor: User, title: str, msg: str, st: PmTaskSubtask | None = None) -> None:
    """Milestone: the PM, whoever gave it and its owner. Sub-task: the
    milestone owner and the person it was given to."""
    owners = _owner_ids(db, t)
    parent = db.get(PmTaskSubtask, st.parent_id) if st and st.parent_id else None
    to = [*owners, st.assignee_id, *(st.collaborator_ids or []), *([parent.assignee_id] if parent else [])] if st else [*wf.project_owner_ids(db, project), t.created_by_id, *owners]
    wf.notify_many(db, to, actor, title, msg, "pm_task_remark", "pm_task", t.id)


async def _remark(db: Session, t: PmProjectTask, user: User, comment: str, st: PmTaskSubtask | None) -> TaskActivityOut:
    if _pm_role(user):
        ensure_feature_action(user, "projects", "overview", "task_comments", "create")
    project = _require_writer(db, t, user, "add remarks", st)
    text = (comment or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write the remark before saving.")
    db.add(PmTaskUpdate(task_id=t.id, subtask_id=st.id if st else None, user_id=user.id, kind="comment", comment=text))
    where = f"sub-task '{st.title}' of '{t.title}'" if st else f"'{t.title}'"
    wf.audit(db, project.id, user, "task_remark", f"Remark on {where} by {wf.user_label(user)}: {text[:200]}", subtab_key="tasks")
    _tell(db, project, t, user, "New remark on a task", f"{project.project_code} · {where} — {wf.user_label(user)}: {text[:200]}", st)
    db.commit()
    return _activity(db, t, user, st)


async def _attach(db: Session, t: PmProjectTask, user: User, files: list[UploadFile], title: str, st: PmTaskSubtask | None) -> TaskActivityOut:
    if _pm_role(user):
        ensure_feature_action(user, "projects", "overview", "task_files", "create")
    project = _require_writer(db, t, user, "attach files", st)
    files = [f for f in files if f and f.filename]
    if not files:
        raise HTTPException(status_code=422, detail="Choose at least one file to attach.")
    if len(files) > 10:
        raise HTTPException(status_code=422, detail=f"You chose {len(files)} files — attach at most 10 at a time.")
    where = f"sub-task '{st.title}' of '{t.title}'" if st else f"task '{t.title}'"
    docs = await store_files(db, project, files, user, doc_type="other", title=title, task_id=t.id, description=f"Attached to {where}")
    if st:
        for d in docs:
            d.subtask_id = st.id
    names = ", ".join(f.filename for f in files[:3]) + (f" +{len(files) - 3} more" if len(files) > 3 else "")
    _tell(db, project, t, user, "File attached to a task", f"{project.project_code} · {where} — {wf.user_label(user)} attached {names}.", st)
    db.commit()
    return _activity(db, t, user, st)


@ongoing_router.get("/tasks/{task_id}/activity", response_model=TaskActivityOut)
async def task_activity(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = _task(db, task_id)
    _require_see(db, t, user)
    return _activity(db, t, user)


@ongoing_router.post("/tasks/{task_id}/remarks", response_model=TaskActivityOut)
async def add_remark(task_id: int, payload: RemarkCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return await _remark(db, _task(db, task_id), user, payload.comment, None)


@ongoing_router.post("/tasks/{task_id}/files", response_model=TaskActivityOut)
async def add_files(task_id: int, files: list[UploadFile] = File(...), title: str = Form(""),
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return await _attach(db, _task(db, task_id), user, files, title, None)


@ongoing_router.get("/subtasks/{subtask_id}/activity", response_model=TaskActivityOut)
async def subtask_activity(subtask_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    st = _subtask(db, subtask_id)
    t = _task(db, st.task_id)
    _require_see(db, t, user)
    _require_sees_task(db, user, st)
    return _activity(db, t, user, st)


@ongoing_router.post("/subtasks/{subtask_id}/remarks", response_model=TaskActivityOut)
async def add_subtask_remark(subtask_id: int, payload: RemarkCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    st = _subtask(db, subtask_id)
    _require_sees_task(db, user, st)
    return await _remark(db, _task(db, st.task_id), user, payload.comment, st)


@ongoing_router.post("/subtasks/{subtask_id}/files", response_model=TaskActivityOut)
async def add_subtask_files(subtask_id: int, files: list[UploadFile] = File(...), title: str = Form(""),
                            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    st = _subtask(db, subtask_id)
    _require_sees_task(db, user, st)
    return await _attach(db, _task(db, st.task_id), user, files, title, st)


@ongoing_router.get("/files/{document_id}/content")
async def task_file(document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(PmProjectDocument, document_id)
    if not doc or doc.is_deleted or not doc.task_id:
        raise HTTPException(status_code=404, detail=f"File #{document_id} not found — it may have been removed.")
    _require_see(db, _task(db, doc.task_id), user)
    # A sub-task's file follows the sub-task (same rule as its activity):
    # seeing the milestone isn't enough to open someone else's private sub-task.
    if doc.subtask_id:
        _require_sees_task(db, user, _subtask(db, doc.subtask_id))
    if _pm_role(user):
        ensure_feature_action(user, "projects", "overview", "task_files", "export")
    return await file_response(doc)


@ongoing_router.delete("/files/{document_id}", response_model=TaskActivityOut)
async def remove_file(document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(PmProjectDocument, document_id)
    if not doc or doc.is_deleted or not doc.task_id:
        raise HTTPException(status_code=404, detail=f"File #{document_id} not found — it may have been removed.")
    t = _task(db, doc.task_id)
    _require_open(_project(db, t.project_id))
    if _pm_role(user):
        ensure_feature_action(user, "projects", "overview", "task_files", "delete")
    if not (wf.is_admin(user) or doc.uploaded_by_id == user.id):
        raise HTTPException(status_code=403, detail="Only the person who attached this file, or an admin, can remove it.")
    if t.status not in PM_TASK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}, so its files are kept as a record.")
    st = db.get(PmTaskSubtask, doc.subtask_id) if doc.subtask_id else None
    await soft_delete(db, doc, user)
    db.commit()
    return _activity(db, t, user, st)
