"""Department and user side of Project Management.

WBS leads and department heads see their WBS elements, create tasks and
assign them to the WBS team, and submit the WBS with evidence.
Assistants see the WBS name and date, only their own tasks, and can add
tasks for themselves. Users split tasks into sub-tasks, log time, comment
(with @mentions), attach files (drawings) and complete them. Each WBS
has a team chat where anyone can be tagged in.

These routes are NOT gated on the `projects` app: heads and users work
from their own department modules and may not have the Project Management
module at all. Each route needs Project Management › My Tasks / Department
Work, or the department module's "Ongoing Projects" tab (see _work_access),
AND the caller's role on the record (see workflow.py for who counts as what).
"""
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.permission_registry import can_perform, can_view_tab
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.department import Department
from app.modules.projects.models.document import PmProjectDocument
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import (
    PmMilestoneMessage, PmProjectTask, PmTaskSubtask, PmTaskTimeLog, PmTaskUpdate, PM_TASK_OPEN_STATUSES, PM_TASK_PRIORITIES,
)
from app.modules.projects.routes.documents import file_response, soft_delete, store_files
from app.modules.projects.schemas.document import PmProjectDocumentResponse
from app.modules.projects.schemas.milestone import PmMilestoneSubmitPayload, PmMilestoneTeamPayload, PmProjectMilestoneResponse
from app.modules.projects.schemas.task import (
    PmMessageResponse, PmMilestoneWorkspaceResponse, PmProjectTaskResponse, PmSelfTaskCreate, PmSubtaskCreate,
    PmSubtaskResponse, PmSubtaskUpdate, PmTaskCommentPayload, PmTaskCompletePayload, PmTaskCreate, PmTaskDetailResponse, PmTaskReasonPayload,
    PmTaskUpdatePayload, PmTimeLogCreate,
)
from app.modules.projects import views, workflow as wf
from app.modules.projects import access as pm_access
from app.core.data_scope import apply_scope, ensure_in_scope

router = APIRouter(prefix="/pm-work", tags=["Project Management — Department work"])

# Role "Assign to" rule for WBS tasks — the same picker as a milestone's tasks
# (core/assignee_rules.PICKERS, declared in core/features/projects.py).
TASK_RULE_KEY = "projects:overview.tasks"

# Projects whose milestones departments can see. Planning isn't released yet.
_VISIBLE_PROJECT_STATUSES = ("active", "on_hold", "technically_complete")


# ── Permission Matrix gate ─────────────────────────────────────────────
# The record checks below (lead / head / assignee / team) decide WHAT a user
# may touch; the matrix decides whether they may use this screen at all —
# tab permission is necessary, not sufficient. Tab choice:
# - lead/head work (plan tasks, team, evidence, submit, cancel/reopen,
#   delete an untouched task = editing the milestone) -> Department Work;
# - assignee work (start/block/complete, sub-tasks, time) -> My Tasks;
# - shared screens (milestone page, task page, chat, comments, files) ->
#   either tab.
# The same screens are embedded as "Ongoing Projects" in each department
# module, so that tab's grant there counts too — those users may not have
# Project Management at all.
_DEPT_WORK_TABS = (
    ("design", "ongoing_projects"), ("rnd", "project_work"), ("electrical", "project_work"),
    ("hydraulic", "project_work"), ("maintenance", "project_work"), ("production", "project_work"),
    ("store", "project_work"), ("quality", "project_work"),
)
_PM_TAB_LABELS = {"my_tasks": "My Tasks", "department_work": "Department Work"}


def _has_work_access(user: User, pm_tabs: tuple[str, ...], action: str) -> bool:
    return any(can_perform(user, "projects", t, action) for t in pm_tabs) or any(
        can_perform(user, mod, tab, action) for mod, tab in _DEPT_WORK_TABS)


def _work_access(pm_tabs: tuple[str, ...], action: str):
    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not _has_work_access(user, pm_tabs, action):
            tabs = " or ".join(f"Project Management › {_PM_TAB_LABELS[t]}" for t in pm_tabs)
            raise HTTPException(
                status_code=403,
                detail=f"You don't have '{action.capitalize()}' permission on {tabs}, nor on 'Ongoing Projects' in your "
                       f"department's module. Ask an admin to add it to one of your roles in Organization › Role & Permissions.",
            )
        return user
    return _dependency


# ── Lookups and access ─────────────────────────────────────────────────

def _milestone_or_404(db: Session, milestone_id: int, user: User | None = None) -> PmProjectMilestone:
    m = db.get(PmProjectMilestone, milestone_id)
    if not m:
        raise HTTPException(status_code=404, detail=f"WBS #{milestone_id} not found — it may have been deleted.")
    if user is not None:
        ensure_in_scope(db, user, m)
    return m


def _task_or_404(db: Session, task_id: int, user: User | None = None) -> PmProjectTask:
    t = db.get(PmProjectTask, task_id)
    if not t:
        raise HTTPException(status_code=404, detail=f"Task #{task_id} not found — it may have been deleted.")
    if user is not None:
        ensure_in_scope(db, user, t)
    return t


def _project(db: Session, project_id: int) -> PmProject:
    return db.get(PmProject, project_id)


def _mentioned_in_chat(db: Session, user: User, milestone_id: int) -> bool:
    for (ids,) in db.query(PmMilestoneMessage.mention_user_ids).filter(PmMilestoneMessage.milestone_id == milestone_id).all():
        if user.id in (ids or []):
            return True
    return False


def _milestone_role(db: Session, user: User, m: PmProjectMilestone) -> str | None:
    """manage | lead | member | guest, or None for no access."""
    if wf.is_milestone_lead(db, user, m):
        return "lead"
    if wf.can_manage(_project(db, m.project_id), user):
        return "manage"
    if wf.is_team_member(user, m) or db.query(PmProjectTask.id).filter(PmProjectTask.milestone_id == m.id, PmProjectTask.assignee_id == user.id).first():
        return "member"
    if _mentioned_in_chat(db, user, m.id):
        return "guest"
    return None


def _require_view_milestone(db: Session, user: User, m: PmProjectMilestone) -> str:
    role = _milestone_role(db, user, m)
    if role:
        return role
    raise HTTPException(status_code=403, detail=f"You are not on the team for '{m.title}'. Ask its lead ({wf.name_of(db, m.lead_user_id) or 'not set'}) to add you, or to tag you in the team chat.")


def _require_view_task(db: Session, user: User, t: PmProjectTask) -> PmProjectMilestone:
    m = db.get(PmProjectMilestone, t.milestone_id) if t.milestone_id else None
    if t.assignee_id == user.id or wf.is_admin(user):
        return m
    if m and (wf.is_milestone_lead(db, user, m) or wf.can_manage(_project(db, t.project_id), user)):
        return m
    for (ids,) in db.query(PmTaskUpdate.mention_user_ids).filter(PmTaskUpdate.task_id == t.id, PmTaskUpdate.kind == "comment").all():
        if user.id in (ids or []):
            return m
    raise HTTPException(status_code=403, detail="This task isn't assigned to you. You can open your own tasks, tasks you were tagged on, and — as a WBS lead or department head — your team's tasks.")


def _require_assignee(user: User, t: PmProjectTask, action: str) -> None:
    if t.assignee_id != user.id:
        raise HTTPException(status_code=403, detail=f"Only the person the task is assigned to can {action}.")


def _department_or_404(db: Session, department_id: int) -> Department:
    dept = db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail=f"Department #{department_id} not found")
    return dept


def _require_head_of(db: Session, user: User, department_id: int) -> Department:
    dept = _department_or_404(db, department_id)
    if not (wf.is_admin(user) or user.id in wf.department_head_ids(dept)):
        raise HTTPException(status_code=403, detail=f"Only the head of {dept.name} can do this.")
    return dept


def _scoped_department_ids(db: Session, user: User, department_id: int | None) -> list[int]:
    if department_id is not None:
        _require_head_of(db, user, department_id)
        return [department_id]
    if wf.is_admin(user):
        return [d.id for d in db.query(Department.id).all()]
    return wf.headed_department_ids(db, user)


def _visible_milestones(db: Session, user: User | None = None) -> list[PmProjectMilestone]:
    q = (
        db.query(PmProjectMilestone)
        .join(PmProject, PmProject.id == PmProjectMilestone.project_id)
        .filter(PmProject.status.in_(_VISIBLE_PROJECT_STATUSES))
    )
    if user is not None:
        q = apply_scope(q, user, PmProjectMilestone)
    return q.order_by(PmProjectMilestone.target_date).all()


def _my_milestones(db: Session, user: User, department_id: int | None) -> dict[int, tuple[PmProjectMilestone, str]]:
    """WBS the user works on, with their role: every WBS of a
    department they head (or all, for an admin) as "lead", the ones they lead
    as "lead", the ones they assist on as "member"."""
    if department_id is not None:
        dept = _department_or_404(db, department_id)
        dept_ids = {department_id} if (wf.is_admin(user) or user.id in wf.department_head_ids(dept)) else set()
    else:
        dept_ids = set(_scoped_department_ids(db, user, None))
    out: dict[int, tuple[PmProjectMilestone, str]] = {}
    for m in _visible_milestones(db, user):
        if department_id is not None and m.department_id != department_id:
            continue
        if m.department_id in dept_ids or m.lead_user_id == user.id:
            out[m.id] = (m, "lead")
        elif user.id in wf.assistant_ids(m):
            out[m.id] = (m, "member")
    return out


def _require_milestone_open(m: PmProjectMilestone, action: str) -> None:
    if m.status in ("submitted", "achieved", "cancelled"):
        hint = {"submitted": " Wait for management to accept or reject it.", "achieved": "", "cancelled": ""}[m.status]
        raise HTTPException(status_code=409, detail=f"WBS '{m.title}' is {wf.MILESTONE_STATUS_LABELS[m.status]}, so you can't {action}.{hint}")


def _check_assignee(db: Session, m: PmProjectMilestone, assignee_id: int) -> User:
    """Tasks go to the WBS team or the department's people. Someone
    from the department who isn't on the team yet joins it as an assistant."""
    u = db.get(User, assignee_id)
    if not u or not u.is_active:
        raise HTTPException(status_code=422, detail="The selected person doesn't exist or is deactivated. Pick someone else.")
    if assignee_id in wf.team_ids(m):
        return u
    dept = db.get(Department, m.department_id)
    if dept and assignee_id not in wf.department_member_ids(db, dept):
        raise HTTPException(status_code=422, detail=f"{wf.user_label(u)} is neither on the team for '{m.title}' nor in {dept.name}. Ask the project manager to add them to the WBS team first.")
    m.assistant_user_ids = [*wf.assistant_ids(m), assignee_id]
    return u


def _check_due(m: PmProjectMilestone, due) -> None:
    if due and due > m.target_date:
        raise HTTPException(status_code=422, detail=f"Due date {due:%d-%m-%Y} is after the WBS date {m.target_date:%d-%m-%Y}. A task must finish on or before its WBS.")


def _check_priority(priority: str) -> None:
    if priority not in PM_TASK_PRIORITIES:
        raise HTTPException(status_code=422, detail=f"Priority '{priority}' is not valid — use one of {', '.join(PM_TASK_PRIORITIES)}.")


# ── Who am I ───────────────────────────────────────────────────────────

@router.get("/me")
async def my_work_context(db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "view"))):
    headed = wf.headed_department_ids(db, user)
    depts = db.query(Department).order_by(Department.name).all()
    visible = depts if wf.is_admin(user) else [d for d in depts if d.id in headed]
    open_tasks = db.query(func.count(PmProjectTask.id)).filter(
        PmProjectTask.assignee_id == user.id, PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES),
    ).scalar() or 0
    mine = _my_milestones(db, user, None)
    return {
        "is_admin": wf.is_admin(user),
        "is_management": wf.is_management(user),
        "headed_department_ids": headed,
        "departments": [{"id": d.id, "name": d.name, "is_head": d.id in headed} for d in visible],
        "open_task_count": open_tasks,
        "lead_milestone_count": sum(1 for _, r in mine.values() if r == "lead"),
        "member_milestone_count": sum(1 for _, r in mine.values() if r == "member"),
    }


# ── Department head: projects, milestones, tasks, workload ─────────────

def _dept_milestones(db: Session, dept_ids: list[int], include_closed: bool, user: User | None = None) -> list[PmProjectMilestone]:
    q = (
        db.query(PmProjectMilestone)
        .join(PmProject, PmProject.id == PmProjectMilestone.project_id)
        .filter(PmProjectMilestone.department_id.in_(dept_ids), PmProject.status.in_(_VISIBLE_PROJECT_STATUSES))
    )
    if user is not None:
        q = apply_scope(q, user, PmProjectMilestone)
    if not include_closed:
        q = q.filter(PmProjectMilestone.status.notin_(("achieved", "cancelled")))
    return q.order_by(PmProjectMilestone.target_date).all()


@router.get("/department/projects")
async def department_projects(department_id: int | None = Query(None), db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "view"))):
    """Projects the user works on, each with the WBS elements they lead (or
    their department owns) and the ones they assist on. Assistants don't
    see a WBS's progress — only its name, dates and their own tasks."""
    mine = _my_milestones(db, user, department_id)
    if not mine:
        return []
    cache = views.names(db)
    my_open: dict[int, int] = {}
    for (mid,) in db.query(PmProjectTask.milestone_id).filter(
        PmProjectTask.assignee_id == user.id, PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES), PmProjectTask.milestone_id.in_(list(mine)),
    ).all():
        my_open[mid] = my_open.get(mid, 0) + 1
    grouped: dict[int, list[PmProjectMilestoneResponse]] = {}
    for m, role in sorted(mine.values(), key=lambda x: (x[0].project_id, x[0].sequence)):
        r = views.milestone_response(db, m, cache)
        r.my_role = role
        if role == "member":
            r.progress_percent, r.task_count, r.tasks_done, r.tasks_blocked, r.is_at_risk = 0, my_open.get(m.id, 0), 0, 0, False
        grouped.setdefault(m.project_id, []).append(r)
    out = []
    for pid, ms in grouped.items():
        p = cache.project(pid)
        out.append({
            "project": {"id": p.id, "project_code": p.project_code, "name": p.name, "client_name": p.client_name,
                        "status": p.status, "priority": p.priority, "target_handover_date": p.target_handover_date,
                        "hold_reason": p.hold_reason, "project_manager_name": cache.user(p.project_manager_id)},
            "milestones": ms,
            "open_milestones": sum(1 for m in ms if m.status not in ("achieved", "cancelled")),
        })
    out.sort(key=lambda r: (r["open_milestones"] == 0, min((m.target_date for m in r["milestones"]), default=None) or ""))
    return out


@router.get("/department/milestones", response_model=list[PmProjectMilestoneResponse])
async def department_milestones(department_id: int | None = Query(None), include_closed: bool = Query(False),
                                db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "view"))):
    dept_ids = _scoped_department_ids(db, user, department_id)
    led = [m for m, role in _my_milestones(db, user, department_id).values() if role == "lead" and m.department_id not in dept_ids]
    rows = (_dept_milestones(db, dept_ids, include_closed, user) if dept_ids else []) + [
        m for m in led if include_closed or m.status not in ("achieved", "cancelled")]
    cache = views.names(db)
    return [views.milestone_response(db, m, cache) for m in sorted(rows, key=lambda x: x.target_date)]


@router.get("/department/tasks", response_model=list[PmProjectTaskResponse])
async def department_tasks(department_id: int | None = Query(None), status_filter: str | None = Query(None, alias="status"),
                           open_only: bool = Query(True), db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "view"))):
    ms_ids = [mid for mid, (_, role) in _my_milestones(db, user, department_id).items() if role == "lead"]
    if not ms_ids:
        return []
    q = db.query(PmProjectTask).filter(PmProjectTask.milestone_id.in_(ms_ids))
    if status_filter:
        q = q.filter(PmProjectTask.status == status_filter)
    elif open_only:
        q = q.filter(PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES))
    tasks = q.order_by(PmProjectTask.due_date.is_(None), PmProjectTask.due_date, PmProjectTask.id).all()
    return views.task_list(db, tasks, user)


@router.get("/department/workload")
async def department_workload(department_id: int | None = Query(None), db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "view"))):
    """Open tasks and estimated hours per person, for the head to balance work."""
    tasks = await department_tasks(department_id=department_id, status_filter=None, open_only=True, db=db, user=user)
    rows: dict[int, dict] = {}
    for t in tasks:
        r = rows.setdefault(t.assignee_id or 0, {"user_id": t.assignee_id, "name": t.assignee_name or "Unassigned",
                                                 "open": 0, "in_progress": 0, "blocked": 0, "overdue": 0, "hours": 0.0, "logged": 0.0})
        r["open"] += 1
        r["in_progress"] += t.status == "in_progress"
        r["blocked"] += t.status == "blocked"
        r["overdue"] += t.is_overdue
        r["hours"] += t.estimated_hours or 0
        r["logged"] += t.logged_hours or 0
    return sorted(rows.values(), key=lambda r: -r["open"])


@router.get("/departments/{department_id}/people")
async def department_people(department_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "view"))):
    """People a task can be assigned to: this department's members (the
    WBS team is offered first by the screen)."""
    dept = _department_or_404(db, department_id)
    leads_here = db.query(PmProjectMilestone.id).filter(
        PmProjectMilestone.department_id == department_id, PmProjectMilestone.lead_user_id == user.id).first()
    if not (wf.is_admin(user) or wf.is_management(user) or user.id in wf.department_head_ids(dept) or leads_here):
        raise HTTPException(status_code=403, detail=f"Only a head of {dept.name} or a WBS lead in it can list its people.")
    ids = wf.department_member_ids(db, dept)
    users = db.query(User).filter(User.id.in_(ids), User.is_active.is_(True)).order_by(User.name).all() if ids else []
    users = assignee_rules.filter_people(db, user, TASK_RULE_KEY, users, id_of=lambda u: u.id)
    return [{"id": u.id, "name": wf.user_label(u), "email": u.email, "designation": u.designation} for u in users]


@router.get("/milestones/{milestone_id}", response_model=PmMilestoneWorkspaceResponse)
async def milestone_workspace(milestone_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "view"))):
    m = _milestone_or_404(db, milestone_id, user)
    role = _require_view_milestone(db, user, m)
    return views.workspace_response(db, m, user, role)


@router.get("/milestones/{milestone_id}/breakdown")
async def milestone_breakdown(milestone_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "view"))):
    """The lead's audit view of one WBS: who got how many tasks, and
    every task's sub-tasks, files, comments, mentions, reasons and history."""
    m = _milestone_or_404(db, milestone_id, user)
    if _require_view_milestone(db, user, m) not in ("manage", "lead"):
        raise HTTPException(status_code=403, detail="Only the WBS lead, department heads and management see the full task breakdown. Your own tasks are listed on this page.")
    return views.breakdown(db, _project(db, m.project_id), [m], user)


@router.post("/milestones/{milestone_id}/tasks", response_model=PmProjectTaskResponse)
async def create_task(milestone_id: int, payload: PmTaskCreate, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "edit"))):
    m = _milestone_or_404(db, milestone_id, user)
    project = _project(db, m.project_id)
    wf.require_head(db, user, m, "create tasks for this WBS")
    wf.require_project_active(project)
    _require_milestone_open(m, "add tasks")
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Task name is required.")
    _check_priority(payload.priority)
    _check_due(m, payload.due_date)
    if payload.estimated_hours is not None and payload.estimated_hours < 0:
        raise HTTPException(status_code=422, detail="Estimated hours can't be negative.")
    assignee = _check_assignee(db, m, payload.assignee_id)
    assignee_rules.ensure_allowed(db, user, TASK_RULE_KEY, assignee)
    t = PmProjectTask(
        project_id=m.project_id, milestone_id=m.id, title=payload.title.strip(), description=payload.description,
        assignee_id=assignee.id, due_date=payload.due_date, priority=payload.priority,
        estimated_hours=payload.estimated_hours, status="todo", created_by_id=user.id,
    )
    db.add(t)
    db.flush()
    wf.audit(db, m.project_id, user, "task_created", f"Task '{t.title}' (WBS '{m.title}') created and assigned to {wf.user_label(assignee)}, due {t.due_date:%d-%m-%Y}, by {wf.user_label(user)}.", subtab_key="tasks")
    wf.notify_many(db, [assignee.id], user, "New task assigned",
                   f"{project.project_code} — '{t.title}' is due {t.due_date:%d-%m-%Y}. Open My Tasks to start it.",
                   "pm_task_assigned", "pm_task", t.id)
    db.commit()
    db.refresh(t)
    return views.task_response(db, t, user)


@router.post("/milestones/{milestone_id}/my-tasks", response_model=PmProjectTaskResponse)
async def create_own_task(milestone_id: int, payload: PmSelfTaskCreate, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    """A team member adds a task for themselves — the lead sees it like any
    other task of the WBS."""
    m = _milestone_or_404(db, milestone_id, user)
    project = _project(db, m.project_id)
    if not (wf.is_team_member(user, m) or wf.is_milestone_lead(db, user, m)):
        raise HTTPException(status_code=403, detail=f"Only the team of '{m.title}' can add tasks to it. Ask its lead to add you.")
    wf.require_project_active(project)
    _require_milestone_open(m, "add tasks")
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Task name is required.")
    _check_priority(payload.priority)
    _check_due(m, payload.due_date)
    if payload.estimated_hours is not None and payload.estimated_hours < 0:
        raise HTTPException(status_code=422, detail="Estimated hours can't be negative.")
    t = PmProjectTask(
        project_id=m.project_id, milestone_id=m.id, title=payload.title.strip(), description=payload.description,
        assignee_id=user.id, due_date=payload.due_date, priority=payload.priority,
        estimated_hours=payload.estimated_hours, status="todo", created_by_id=user.id,
    )
    db.add(t)
    db.flush()
    wf.audit(db, m.project_id, user, "task_created", f"Task '{t.title}' (WBS '{m.title}') added by {wf.user_label(user)} for themselves, due {t.due_date:%d-%m-%Y}.", subtab_key="tasks")
    wf.notify_department_heads(db, m, user, "Team member added a task",
                               f"{project.project_code} — {wf.user_label(user)} added '{t.title}' (due {t.due_date:%d-%m-%Y}) to '{m.title}'.",
                               "pm_task_self_added")
    db.commit()
    db.refresh(t)
    return views.task_response(db, t, user)


@router.put("/milestones/{milestone_id}/team", response_model=PmProjectMilestoneResponse)
async def update_team(milestone_id: int, payload: PmMilestoneTeamPayload, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "edit"))):
    """The lead (or a department head) sets who assists on the WBS."""
    m = _milestone_or_404(db, milestone_id, user)
    project = _project(db, m.project_id)
    if not (wf.is_milestone_lead(db, user, m) or wf.can_manage(project, user)):
        raise HTTPException(status_code=403, detail="Only the WBS lead, a department head or management can change the team.")
    if project.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} is {wf.PROJECT_STATUS_LABELS[project.status]}; the team can't change.")
    new: list[int] = []
    for uid in payload.assistant_user_ids:
        if uid == m.lead_user_id or uid in new:
            continue
        u = db.get(User, uid)
        if not u or not u.is_active:
            raise HTTPException(status_code=422, detail=f"User #{uid} doesn't exist or is deactivated.")
        new.append(uid)
    old = set(wf.assistant_ids(m))
    removed = old - set(new)
    if removed:
        busy = db.query(PmProjectTask).filter(PmProjectTask.milestone_id == m.id, PmProjectTask.assignee_id.in_(removed), PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES)).all()
        if busy:
            names_ = sorted({wf.name_of(db, t.assignee_id) or "?" for t in busy})
            raise HTTPException(status_code=409, detail=f"{', '.join(names_)} still have open tasks on '{m.title}'. Reassign or cancel those tasks first.")
    m.assistant_user_ids = new
    wf.audit(db, m.project_id, user, "milestone_team_changed",
             f"Team of '{m.title}' set to: {', '.join(wf.name_of(db, i) or '?' for i in new) or 'lead only'} by {wf.user_label(user)}.")
    if project.status in ("active", "on_hold"):
        wf.notify_many(db, set(new) - old, user, "You are on a project WBS",
                       f"{project.project_code} {project.name}: {wf.user_label(user)} added you to '{m.title}' (due {m.target_date:%d-%m-%Y}).",
                       "pm_milestone_assigned", "pm_milestone", m.id)
    db.commit()
    db.refresh(m)
    return views.milestone_response(db, m)


@router.patch("/tasks/{task_id}", response_model=PmProjectTaskResponse)
async def update_task(task_id: int, payload: PmTaskUpdatePayload, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _milestone_or_404(db, t.milestone_id)
    project = _project(db, t.project_id)
    wf.require_head(db, user, m, "edit this task")
    wf.require_project_active(project)
    if t.status in ("done", "cancelled"):
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]} and can't be edited." + (" Reopen it first." if t.status == "done" else ""))
    updates = payload.model_dump(exclude_unset=True)
    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(status_code=422, detail="Task name can't be empty.")
    if "priority" in updates:
        _check_priority(updates["priority"])
    if "due_date" in updates:
        if not updates["due_date"]:
            raise HTTPException(status_code=422, detail="Due date is required.")
        _check_due(m, updates["due_date"])
    old_assignee = t.assignee_id
    if "assignee_id" in updates:
        if not updates["assignee_id"]:
            raise HTTPException(status_code=422, detail="A task must be assigned to someone.")
        new_assignee = _check_assignee(db, m, updates["assignee_id"])
        if new_assignee.id != old_assignee:
            assignee_rules.ensure_allowed(db, user, TASK_RULE_KEY, new_assignee)
    for field, val in updates.items():
        old_val = getattr(t, field)
        if old_val != val:
            wf.audit(db, t.project_id, user, "task_updated", f"Task '{t.title}': {field.replace('_', ' ')} changed by {wf.user_label(user)}.",
                     subtab_key="tasks", field_name=field, old_value=str(old_val) if old_val is not None else None, new_value=str(val) if val is not None else None)
        setattr(t, field, val)
    if t.assignee_id != old_assignee:
        wf.notify_many(db, [t.assignee_id], user, "New task assigned",
                       f"{project.project_code} — '{t.title}' (due {t.due_date:%d-%m-%Y}) was assigned to you by {wf.user_label(user)}.",
                       "pm_task_assigned", "pm_task", t.id)
        wf.notify_many(db, [old_assignee], user, "Task reassigned",
                       f"{project.project_code} — '{t.title}' was reassigned to {wf.name_of(db, t.assignee_id)}. You no longer need to work on it.",
                       "pm_task_reassigned", "pm_task", t.id)
    db.commit()
    db.refresh(t)
    return views.task_response(db, t, user)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _milestone_or_404(db, t.milestone_id)
    wf.require_head(db, user, m, "delete this task")
    wf.require_project_active(_project(db, t.project_id))
    has_work = t.status != "todo" or t.started_at or db.query(PmTaskSubtask.id).filter(PmTaskSubtask.task_id == t.id).first() \
        or db.query(PmTaskUpdate.id).filter(PmTaskUpdate.task_id == t.id).first() \
        or db.query(PmProjectDocument.id).filter(PmProjectDocument.task_id == t.id, PmProjectDocument.is_deleted == False).first()  # noqa: E712
    if has_work:
        raise HTTPException(status_code=409, detail=f"Work is already recorded on '{t.title}'. Cancel it with a reason instead, so its history is kept.")
    wf.audit(db, t.project_id, user, "task_deleted", f"Task '{t.title}' deleted by {wf.user_label(user)}.", subtab_key="tasks")
    wf.notify_many(db, [t.assignee_id], user, "Task removed", f"'{t.title}' was removed by {wf.user_label(user)}.", "pm_task_cancelled", "pm_milestone", m.id)
    db.delete(t)
    db.commit()
    return {"message": "Task deleted"}


@router.post("/tasks/{task_id}/cancel", response_model=PmProjectTaskResponse)
async def cancel_task(task_id: int, payload: PmTaskReasonPayload, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _milestone_or_404(db, t.milestone_id)
    wf.require_head(db, user, m, "cancel this task")
    wf.require_project_active(_project(db, t.project_id))
    _require_milestone_open(m, "cancel its tasks")
    if t.status not in PM_TASK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; only an open task can be cancelled.")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Give a reason for cancelling the task.")
    t.cancel_reason = reason
    wf.set_task_status(db, t, user, "cancelled", reason)
    wf.notify_many(db, [t.assignee_id], user, "Task cancelled", f"'{t.title}' was cancelled by {wf.user_label(user)}. Reason: {reason}", "pm_task_cancelled", "pm_task", t.id)
    db.commit()
    db.refresh(t)
    return views.task_response(db, t, user)


@router.post("/tasks/{task_id}/reopen", response_model=PmProjectTaskResponse)
async def reopen_task(task_id: int, payload: PmTaskReasonPayload, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _milestone_or_404(db, t.milestone_id)
    wf.require_head(db, user, m, "reopen this task")
    wf.require_project_active(_project(db, t.project_id))
    _require_milestone_open(m, "reopen its tasks")
    if t.status != "done":
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; only a Done task can be reopened.")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say what still needs doing, so the person knows why it came back.")
    t.reopen_reason, t.completed_at = reason, None
    wf.set_task_status(db, t, user, "in_progress", reason)
    wf.notify_many(db, [t.assignee_id], user, "Task reopened", f"'{t.title}' was sent back by {wf.user_label(user)}: {reason}", "pm_task_reopened", "pm_task", t.id)
    db.commit()
    db.refresh(t)
    return views.task_response(db, t, user)


@router.post("/milestones/{milestone_id}/submit", response_model=PmProjectMilestoneResponse)
async def submit_milestone(milestone_id: int, payload: PmMilestoneSubmitPayload, db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "edit"))):
    m = _milestone_or_404(db, milestone_id, user)
    project = _project(db, m.project_id)
    wf.require_head(db, user, m, "submit this WBS")
    wf.require_project_active(project)
    if m.status not in ("not_started", "in_progress"):
        raise HTTPException(status_code=409, detail=f"'{m.title}' is {wf.MILESTONE_STATUS_LABELS[m.status]} and can't be submitted.")
    wf.require_unlocked(db, m, "submit this WBS")
    live = wf.live_tasks(wf.milestone_tasks(db, m.id))
    if not live:
        raise HTTPException(status_code=409, detail="This WBS has no tasks. Create and complete at least one task before submitting it.")
    open_ = [t.title for t in live if t.status != "done"]
    if open_:
        raise HTTPException(status_code=409, detail=f"{len(open_)} task(s) are not Done yet: {', '.join(open_[:5])}. Every task must be Done (or cancelled) before you submit.")
    note = (payload.submission_note or "").strip()
    if not note:
        raise HTTPException(status_code=422, detail="Add a handover note: what evidence is attached (drawing no., report, certificate) and anything management should check.")
    m.status, m.submitted_by_id, m.submitted_at, m.submission_note = "submitted", user.id, wf.now(), note
    wf.audit(db, m.project_id, user, "milestone_submitted", f"WBS '{m.title}' submitted by {wf.user_label(user)}. Note: {note}")
    # Central approval engine (Organization › Approval Workflows › Milestone
    # acceptance): it notifies the acceptors (Teams + bell).
    pm_access.submit_milestone(db, project, m, user)
    db.commit()
    db.refresh(m)
    return views.milestone_response(db, m)


@router.post("/milestones/{milestone_id}/files", response_model=list[PmProjectDocumentResponse])
async def upload_milestone_evidence(milestone_id: int, doc_type: str = Form("other"), title: str = Form(""),
                                    files: list[UploadFile] = File(...), db: Session = Depends(get_db), user: User = Depends(_work_access(("department_work",), "edit"))):
    m = _milestone_or_404(db, milestone_id, user)
    wf.require_head(db, user, m, "attach evidence to this WBS")
    project = _project(db, m.project_id)
    wf.require_project_active(project)
    _require_milestone_open(m, "change its evidence")
    docs = await store_files(db, project, files, user, doc_type=doc_type, title=title, milestone_id=m.id)
    wf.notify_many(db, wf.project_owner_ids(db, project), user, "WBS evidence attached",
                   f"{wf.user_label(user)} attached {len(docs)} evidence file(s) to {project.project_code} · '{m.title}'.", "pm_evidence", "pm_milestone", m.id)
    db.commit()
    cache = views.names(db)
    return [views.document_response(d, cache) for d in docs]


def _doc_or_404(db: Session, document_id: int) -> PmProjectDocument:
    doc = db.query(PmProjectDocument).filter(PmProjectDocument.id == document_id, PmProjectDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail=f"File #{document_id} not found — it may have been deleted.")
    return doc


def _require_view_doc(db: Session, user: User, doc: PmProjectDocument) -> None:
    # Files are children: the owning chat message's WBS / task / WBS / project
    # must be in the caller's data scope as well as on their team.
    if doc.message_id:
        msg = db.get(PmMilestoneMessage, doc.message_id)
        if msg:
            _require_view_milestone(db, user, _milestone_or_404(db, msg.milestone_id, user))
            return
    if doc.task_id:
        _require_view_task(db, user, _task_or_404(db, doc.task_id, user))
    elif doc.milestone_id:
        _require_view_milestone(db, user, _milestone_or_404(db, doc.milestone_id, user))
    elif not can_view_tab(user, "projects", "documents"):
        raise HTTPException(status_code=403, detail="This file belongs to the project's documents; you need 'View' on Project Management › Documents to open it. Ask an admin to add it to one of your roles in Organization › Role & Permissions.")
    else:
        project = _project(db, doc.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail=f"The project of file #{doc.id} no longer exists — refresh the page.")
        ensure_in_scope(db, user, project)


@router.get("/files/{document_id}/content")
async def get_file(document_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "view"))):
    doc = _doc_or_404(db, document_id)
    _require_view_doc(db, user, doc)
    return await file_response(doc)


@router.delete("/files/{document_id}")
async def delete_file(document_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "edit"))):
    doc = _doc_or_404(db, document_id)
    _require_view_doc(db, user, doc)
    if not (wf.is_admin(user) or doc.uploaded_by_id == user.id):
        raise HTTPException(status_code=403, detail="Only the person who uploaded this file, or an admin, can delete it.")
    if doc.milestone_id or doc.task_id:
        # On hold freezes all work, including removing evidence / task files.
        wf.require_project_active(_project(db, doc.project_id))
    if doc.milestone_id:
        _require_milestone_open(_milestone_or_404(db, doc.milestone_id), "remove its evidence")
    if doc.task_id and _task_or_404(db, doc.task_id).status in ("done", "cancelled"):
        raise HTTPException(status_code=409, detail="The task is closed, so its files are kept as a record.")
    await soft_delete(db, doc, user)
    db.commit()
    return {"message": "File deleted"}


# ── User: my tasks ─────────────────────────────────────────────────────

@router.get("/my-tasks", response_model=list[PmProjectTaskResponse])
async def my_tasks(include_closed: bool = Query(False), db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "view"))):
    q = (
        db.query(PmProjectTask)
        .join(PmProject, PmProject.id == PmProjectTask.project_id)
        .filter(PmProjectTask.assignee_id == user.id, PmProject.status.in_(_VISIBLE_PROJECT_STATUSES))
    )
    if not include_closed:
        q = q.filter(PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES))
    tasks = q.order_by(PmProjectTask.due_date.is_(None), PmProjectTask.due_date, PmProjectTask.id).all()
    return views.task_list(db, tasks, user)


@router.get("/tasks/{task_id}", response_model=PmTaskDetailResponse)
async def task_detail(task_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "view"))):
    t = _task_or_404(db, task_id, user)
    _require_view_task(db, user, t)
    return views.task_detail(db, t, user)


def _work_guard(db: Session, user: User, t: PmProjectTask, action: str) -> PmProjectMilestone:
    _require_assignee(user, t, action)
    wf.require_project_active(_project(db, t.project_id))
    m = _milestone_or_404(db, t.milestone_id)
    _require_milestone_open(m, action)
    return m


@router.post("/tasks/{task_id}/start", response_model=PmTaskDetailResponse)
async def start_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _work_guard(db, user, t, "start this task")
    if t.status != "todo":
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; only a To do task can be started.")
    wf.require_unlocked(db, m, "start this task")
    t.started_at = t.started_at or wf.now()
    wf.set_task_status(db, t, user, "in_progress")
    if m.status == "not_started":
        # Overlapping steps ("once a chosen step has started") unlock now.
        locked_before = wf.locked_milestone_ids(db, m.project_id)
        m.status = "in_progress"
        wf.audit(db, m.project_id, user, "milestone_started", f"WBS '{m.title}' is now In progress — first task started by {wf.user_label(user)}.")
        project = db.get(PmProject, m.project_id)
        if project:
            wf.notify_newly_unlocked(db, project, locked_before, user)
    db.commit()
    return views.task_detail(db, t, user)


@router.post("/tasks/{task_id}/block", response_model=PmTaskDetailResponse)
async def block_task(task_id: int, payload: PmTaskReasonPayload, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _work_guard(db, user, t, "mark this task blocked")
    if t.status != "in_progress":
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; only a task In progress can be blocked.")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say what is blocking the task, so your department head can help.")
    t.blocker_reason = reason
    wf.set_task_status(db, t, user, "blocked", reason)
    wf.notify_department_heads(db, m, user, "Task blocked", f"{wf.user_label(user)} is blocked on '{t.title}': {reason}", "pm_task_blocked")
    db.commit()
    return views.task_detail(db, t, user)


@router.post("/tasks/{task_id}/unblock", response_model=PmTaskDetailResponse)
async def unblock_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _milestone_or_404(db, t.milestone_id)
    if t.assignee_id != user.id:
        wf.require_head(db, user, m, "unblock this task")
    wf.require_project_active(_project(db, t.project_id))
    if t.status != "blocked":
        raise HTTPException(status_code=409, detail=f"'{t.title}' is not blocked.")
    wf.set_task_status(db, t, user, "in_progress", f"Unblocked (was: {t.blocker_reason})")
    t.blocker_reason = None
    db.commit()
    return views.task_detail(db, t, user)


@router.post("/tasks/{task_id}/complete", response_model=PmTaskDetailResponse)
async def complete_task(task_id: int, payload: PmTaskCompletePayload | None = None, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _work_guard(db, user, t, "complete this task")
    if t.status != "in_progress":
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; start it (or unblock it) before marking it Done.")
    open_subs = [s.title for s in db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id == t.id, PmTaskSubtask.status != "done").all()]
    if open_subs:
        raise HTTPException(status_code=409, detail=f"{len(open_subs)} sub-task(s) are still open: {', '.join(open_subs[:5])}. Finish or delete them first.")
    note = ((payload.note if payload else "") or "").strip()
    if not note:
        raise HTTPException(status_code=422, detail="Add a completion note: what you delivered (drawing no., report, file name) so your lead can check it.")
    t.completed_at = wf.now()
    wf.set_task_status(db, t, user, "done", note)
    remaining = [x for x in wf.live_tasks(wf.milestone_tasks(db, m.id)) if x.status != "done"]
    tail = " All tasks of this WBS are now Done — it can be submitted." if not remaining else f" {len(remaining)} task(s) still open on '{m.title}'."
    wf.notify_department_heads(db, m, user, "Task done", f"{wf.user_label(user)} completed '{t.title}': {note[:200]}.{tail}", "pm_task_done")
    db.commit()
    return views.task_detail(db, t, user)


@router.post("/tasks/{task_id}/comments", response_model=PmTaskDetailResponse)
async def comment_task(task_id: int, payload: PmTaskCommentPayload, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "edit"))):
    t = _task_or_404(db, task_id, user)
    m = _require_view_task(db, user, t)
    text = (payload.comment or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write a comment first.")
    mentions = _check_mentions(db, user, payload.mention_user_ids)
    db.add(PmTaskUpdate(task_id=t.id, user_id=user.id, kind="comment", comment=text, mention_user_ids=mentions or None))
    if user.id == t.assignee_id and m:
        wf.notify_department_heads(db, m, user, "Task comment", f"{wf.user_label(user)} on '{t.title}': {text[:200]}", "pm_task_comment")
    else:
        wf.notify_many(db, [t.assignee_id], user, "Task comment", f"{wf.user_label(user)} on '{t.title}': {text[:200]}", "pm_task_comment", "pm_task", t.id)
    project = _project(db, t.project_id)
    wf.notify_many(db, mentions, user, "You were mentioned",
                   f"{wf.user_label(user)} tagged you on task '{t.title}' ({project.project_code}): {text[:200]}",
                   "pm_mention", "pm_task", t.id)
    db.commit()
    return views.task_detail(db, t, user)


@router.post("/tasks/{task_id}/files", response_model=PmTaskDetailResponse)
async def upload_task_files(task_id: int, title: str = Form(""), files: list[UploadFile] = File(...),
                            db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "edit"))):
    t = _task_or_404(db, task_id, user)
    _require_view_task(db, user, t)
    project = _project(db, t.project_id)
    wf.require_project_active(project)
    if t.status in ("done", "cancelled"):
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; files can't be added any more.")
    await store_files(db, project, files, user, doc_type="other", title=title, task_id=t.id,
                      milestone_id=None)
    db.commit()
    return views.task_detail(db, t, user)


def _check_mentions(db: Session, user: User, ids: list[int] | None) -> list[int]:
    out: list[int] = []
    for uid in ids or []:
        if uid == user.id or uid in out:
            continue
        u = db.get(User, uid)
        if not u or not u.is_active:
            raise HTTPException(status_code=422, detail=f"User #{uid} you tagged doesn't exist or is deactivated. Remove the tag and try again.")
        out.append(uid)
    return out


# ── User: time log ─────────────────────────────────────────────────────

@router.post("/tasks/{task_id}/time", response_model=PmTaskDetailResponse)
async def log_time(task_id: int, payload: PmTimeLogCreate, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    """The assignee records hours spent on a day — actual effort against the estimate."""
    t = _task_or_404(db, task_id, user)
    _require_assignee(user, t, "log time on this task")
    wf.require_project_active(_project(db, t.project_id))
    if t.status not in ("in_progress", "blocked", "done"):
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}. Start the task before logging time on it.")
    if payload.work_date > date.today():
        raise HTTPException(status_code=422, detail="You can't log time for a future date.")
    if not (0 < payload.hours <= 24):
        raise HTTPException(status_code=422, detail="Hours must be more than 0 and at most 24.")
    day_total = db.query(func.coalesce(func.sum(PmTaskTimeLog.hours), 0)).filter(
        PmTaskTimeLog.user_id == user.id, PmTaskTimeLog.work_date == payload.work_date).scalar() or 0
    if day_total + payload.hours > 24:
        raise HTTPException(status_code=422, detail=f"You already logged {day_total:g} h on {payload.work_date:%d-%m-%Y} across your tasks; adding {payload.hours:g} h would pass 24 h.")
    db.add(PmTaskTimeLog(task_id=t.id, user_id=user.id, work_date=payload.work_date, hours=payload.hours, note=(payload.note or "").strip() or None))
    db.commit()
    return views.task_detail(db, t, user)


@router.delete("/time/{log_id}", response_model=PmTaskDetailResponse)
async def delete_time(log_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    lg = db.get(PmTaskTimeLog, log_id)
    if not lg:
        raise HTTPException(status_code=404, detail=f"Time entry #{log_id} not found — refresh the page.")
    if lg.user_id != user.id and not wf.is_admin(user):
        raise HTTPException(status_code=403, detail="You can only remove your own time entries.")
    t = _task_or_404(db, lg.task_id, user)
    wf.require_project_active(_project(db, t.project_id))
    db.delete(lg)
    db.commit()
    return views.task_detail(db, t, user)


# ── Milestone team chat ────────────────────────────────────────────────

@router.get("/milestones/{milestone_id}/messages", response_model=list[PmMessageResponse])
async def list_messages(milestone_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks", "department_work"), "view"))):
    m = _milestone_or_404(db, milestone_id, user)
    _require_view_milestone(db, user, m)
    rows = db.query(PmMilestoneMessage).filter(PmMilestoneMessage.milestone_id == m.id).order_by(PmMilestoneMessage.id).all()
    return views.message_list(db, rows)


@router.post("/milestones/{milestone_id}/messages", response_model=PmMessageResponse)
async def post_message(milestone_id: int, body: str = Form(""), mention_user_ids: str = Form(""),
                       files: list[UploadFile] | None = File(None), db: Session = Depends(get_db),
                       user: User = Depends(_work_access(("my_tasks", "department_work"), "edit"))):
    """Send a message (and/or drawings, files) to the WBS team. Tag
    anyone with @ — e.g. R&D tagging Purchase — and they are notified and can
    reply here."""
    m = _milestone_or_404(db, milestone_id, user)
    _require_view_milestone(db, user, m)
    project = _project(db, m.project_id)
    if project.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} is {wf.PROJECT_STATUS_LABELS[project.status]}; its chat is read-only.")
    text = (body or "").strip()
    files = [f for f in (files or []) if f and f.filename]
    if not text and not files:
        raise HTTPException(status_code=422, detail="Write a message or attach a file before sending.")
    try:
        raw_ids = [int(x) for x in mention_user_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail="Tagged people list is malformed — remove the tags and tag again.")
    mentions = _check_mentions(db, user, raw_ids)
    msg = PmMilestoneMessage(milestone_id=m.id, user_id=user.id, body=text or None, mention_user_ids=mentions or None)
    db.add(msg)
    db.flush()
    if files:
        await store_files(db, project, files, user, doc_type="other", title="", message_id=msg.id,
                          description=f"Sent in the '{m.title}' team chat")
    snippet = text[:200] if text else f"{len(files)} file(s)"
    if files:
        # Files a department sends are what the project manager must not miss
        # (bell only — plain messages are in the project's Discussions tab).
        names_ = ", ".join(f.filename for f in files[:3]) + (f" +{len(files) - 3} more" if len(files) > 3 else "")
        wf.notify_many(db, wf.project_owner_ids(db, project), user, "Files sent in WBS chat",
                       f"{wf.user_label(user)} sent {names_} in {project.project_code} · '{m.title}'.", "pm_chat_files", "pm_milestone", m.id)
    wf.notify_many(db, mentions, user, "You were mentioned",
                   f"{wf.user_label(user)} tagged you in {project.project_code} · '{m.title}': {snippet}",
                   "pm_mention", "pm_milestone", m.id)
    db.commit()
    return views.message_list(db, [msg])[0]


# ── User: sub-tasks ────────────────────────────────────────────────────

def _subtask_or_404(db: Session, subtask_id: int) -> PmTaskSubtask:
    s = db.get(PmTaskSubtask, subtask_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Sub-task #{subtask_id} not found — it may have been deleted.")
    return s


def _subtask_guard(db: Session, user: User, t: PmProjectTask, action: str) -> None:
    _work_guard(db, user, t, action)
    if t.status not in PM_TASK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{t.title}' is {wf.TASK_STATUS_LABELS[t.status]}; its sub-tasks can't change.")


@router.post("/tasks/{task_id}/subtasks", response_model=PmSubtaskResponse)
async def create_subtask(task_id: int, payload: PmSubtaskCreate, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    t = _task_or_404(db, task_id, user)
    _subtask_guard(db, user, t, "add sub-tasks")
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Sub-task name is required.")
    if payload.due_date and t.due_date and payload.due_date > t.due_date:
        raise HTTPException(status_code=422, detail=f"Sub-task due date {payload.due_date:%d-%m-%Y} is after the task's due date {t.due_date:%d-%m-%Y}.")
    s = PmTaskSubtask(task_id=t.id, title=payload.title.strip(), due_date=payload.due_date, status="todo", created_by_id=user.id)
    db.add(s)
    db.commit()
    db.refresh(s)
    return PmSubtaskResponse.model_validate(s)


@router.patch("/subtasks/{subtask_id}", response_model=PmSubtaskResponse)
async def update_subtask(subtask_id: int, payload: PmSubtaskUpdate, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    s = _subtask_or_404(db, subtask_id)
    t = _task_or_404(db, s.task_id, user)
    _subtask_guard(db, user, t, "change sub-tasks")
    updates = payload.model_dump(exclude_unset=True)
    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(status_code=422, detail="Sub-task name can't be empty.")
    if updates.get("due_date") and t.due_date and updates["due_date"] > t.due_date:
        raise HTTPException(status_code=422, detail=f"Sub-task due date is after the task's due date {t.due_date:%d-%m-%Y}.")
    if "status" in updates:
        if updates["status"] not in ("todo", "done"):
            raise HTTPException(status_code=422, detail="Sub-task status must be 'todo' or 'done'.")
        if updates["status"] == "done" and t.status == "todo":
            raise HTTPException(status_code=409, detail=f"Start '{t.title}' first, then tick off its sub-tasks.")
        s.completed_at = wf.now() if updates["status"] == "done" else None
    for field, val in updates.items():
        setattr(s, field, val)
    db.commit()
    db.refresh(s)
    return PmSubtaskResponse.model_validate(s)


@router.delete("/subtasks/{subtask_id}")
async def delete_subtask(subtask_id: int, db: Session = Depends(get_db), user: User = Depends(_work_access(("my_tasks",), "edit"))):
    s = _subtask_or_404(db, subtask_id)
    t = _task_or_404(db, s.task_id, user)
    _subtask_guard(db, user, t, "delete sub-tasks")
    if s.status == "done":
        raise HTTPException(status_code=409, detail="A finished sub-task is kept as a record. Untick it first if it was marked done by mistake.")
    db.delete(s)
    db.commit()
    return {"message": "Sub-task deleted"}
