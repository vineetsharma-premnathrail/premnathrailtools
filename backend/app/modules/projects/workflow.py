"""Project → WBS → Task → Sub-task rules shared by the management-side
routes (routes/project.py, milestones.py) and the department/user side
(routes/work.py).

Who is who:
- Management: portal admins, company Partners and Directors, plus anyone an
  admin grants "Project Management › All Projects › Create" in the
  Permission Matrix. Management creates projects, sets WBS elements for every
  department, moves dates (with a reason), accepts/rejects WBS elements and
  closes projects. A project's own Project Manager has the same rights on
  that project.
- WBS lead: the person management names to represent the department
  on one WBS. Acts as that WBS's head.
- Department head: any head slot on the WBS's `Department`
  (head_user_id / secondary_head_user_id / additional_head_user_ids). Same
  rights as the lead on every WBS of the department. Lead and heads
  create and assign tasks, and submit the WBS.
- Assistants: the rest of the WBS team. They see the WBS name and
  date, their own tasks and the team chat (not the WBS's progress),
  and can add tasks for themselves.
- User: the task's assignee. Works the task and its sub-tasks and logs time.
- Anyone tagged with @ in the WBS chat (e.g. Purchase, tagged by R&D)
  can read and answer that chat.

Technically complete is automatic: the project moves there the moment
every WBS that isn't cancelled is achieved (auto_complete).

WBS run in a strict chain (`sequence`): work on step N can't start
until every earlier step that isn't cancelled is Achieved.
- Viewer: anyone else with the Project Management app — read-only.

Progress is computed from completed work on every read, never typed in:
task = sub-tasks done ÷ total (100 when Done), WBS = done tasks ÷
tasks, project = achieved WBS elements ÷ WBS elements.
"""
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask, PmTaskSubtask, PmTaskUpdate, PM_TASK_OPEN_STATUSES
from app.utils.notifications import notify_user

PROJECT_STATUS_LABELS = {
    "planning": "Planning", "active": "Active", "on_hold": "On hold",
    "technically_complete": "Technically complete", "closed": "Closed", "cancelled": "Cancelled",
}
MILESTONE_STATUS_LABELS = {
    "not_started": "Not started", "in_progress": "In progress", "submitted": "Submitted",
    "achieved": "Achieved", "cancelled": "Cancelled",
}
TASK_STATUS_LABELS = {"todo": "To do", "in_progress": "In progress", "blocked": "Blocked", "done": "Done", "cancelled": "Cancelled"}
# Explicit Permission Matrix grant that makes a user "management".
MANAGE_GRANT = "projects:all_projects:create"


def now() -> datetime:
    return datetime.now(timezone.utc)


def user_label(user: User | None) -> str:
    if not user:
        return "Unknown user"
    return user.name or user.email


def name_of(db: Session, user_id: int | None) -> str | None:
    if not user_id:
        return None
    u = db.get(User, user_id)
    return user_label(u) if u else None


# ── Roles ──────────────────────────────────────────────────────────────

def is_admin(user: User) -> bool:
    return user.role == "admin" or bool(getattr(user, "is_azure_admin", False))


def is_management(user: User) -> bool:
    return (
        is_admin(user) or bool(user.is_partner) or bool(user.is_director)
        or MANAGE_GRANT in user.effective_permissions
    )


def can_manage(project: PmProject, user: User) -> bool:
    return is_management(user) or project.project_manager_id == user.id


def require_management(user: User, action: str) -> None:
    if not is_management(user):
        raise HTTPException(
            status_code=403,
            detail=f"Only authorised management can {action}: Partners, Directors, or users an admin has granted "
                   f"'Project Management › All Projects › Create' in Users › Permission Matrix.",
        )


def require_manage(project: PmProject, user: User, action: str) -> None:
    if not can_manage(project, user):
        raise HTTPException(
            status_code=403,
            detail=f"Only management or the project manager of {project.project_code} can {action}.",
        )


def management_ids(db: Session) -> list[int]:
    """Active Partners/Directors — the escalation level for long-overdue WBS elements."""
    return [u.id for u in db.query(User).filter(User.is_active.is_(True), (User.is_director.is_(True)) | (User.is_partner.is_(True))).all()]


def department_head_ids(dept: Department | None) -> list[int]:
    if not dept:
        return []
    ids = [dept.head_user_id, dept.secondary_head_user_id, *(dept.additional_head_user_ids or [])]
    out: list[int] = []
    for i in ids:
        if i and i not in out:
            out.append(i)
    return out


def headed_department_ids(db: Session, user: User) -> list[int]:
    return [d.id for d in db.query(Department).all() if user.id in department_head_ids(d)]


def is_department_head(db: Session, user: User, department_id: int | None) -> bool:
    if department_id is None:
        return False
    return user.id in department_head_ids(db.get(Department, department_id))


def department_member_ids(db: Session, dept: Department) -> set[int]:
    """People a head can assign tasks to: the department's heads, plus users
    whose HR profile is in the department — or, with no HR profile, whose
    Azure department name matches."""
    profile_dept = {p.user_id: p.department_id for p in db.query(HrEmployeeProfile.user_id, HrEmployeeProfile.department_id).all()}
    members = set(department_head_ids(dept))
    name = dept.name.strip().lower()
    for u in db.query(User).filter(User.is_active.is_(True)).all():
        pd = profile_dept.get(u.id) or u.department_id
        if (pd == dept.id) if pd else (u.department or "").strip().lower() == name:
            members.add(u.id)
    return members


def assistant_ids(milestone: PmProjectMilestone) -> list[int]:
    return [int(i) for i in (milestone.assistant_user_ids or []) if i]


def team_ids(milestone: PmProjectMilestone) -> list[int]:
    """Lead first, then assistants — the people working the WBS."""
    out = [milestone.lead_user_id] if milestone.lead_user_id else []
    return out + [i for i in assistant_ids(milestone) if i not in out]


def is_milestone_lead(db: Session, user: User, milestone: PmProjectMilestone) -> bool:
    """Lead rights: the named lead, any head of the department, or an admin."""
    return is_admin(user) or milestone.lead_user_id == user.id or is_department_head(db, user, milestone.department_id)


def is_team_member(user: User, milestone: PmProjectMilestone) -> bool:
    return user.id in team_ids(milestone)


def owner_ids(db: Session, milestone: PmProjectMilestone) -> list[int]:
    """Who answers for a WBS: its lead plus the department's heads."""
    dept = db.get(Department, milestone.department_id) if milestone.department_id else None
    out = [milestone.lead_user_id] if milestone.lead_user_id else []
    return out + [i for i in department_head_ids(dept) if i not in out]


def require_head(db: Session, user: User, milestone: PmProjectMilestone, action: str) -> None:
    if is_milestone_lead(db, user, milestone):
        return
    lead = name_of(db, milestone.lead_user_id)
    dept = db.get(Department, milestone.department_id) if milestone.department_id else None
    who = f"the WBS lead ({lead})" if lead else "the WBS lead"
    raise HTTPException(
        status_code=403,
        detail=f"Only {who} or the head of {dept.name if dept else 'the owning department'} can {action}. "
               f"Ask the project manager to make you the lead of '{milestone.title}' if you should be.",
    )


_STARTED = ("in_progress", "submitted", "achieved")


def _blocker(db: Session, milestone: PmProjectMilestone, seen: set[int]) -> tuple[PmProjectMilestone, str] | None:
    """(the step this one waits for, what it must reach: 'achieved' |
    'started'), or None when it may start — by the WBS's start_rule."""
    if milestone.id in seen:  # defensive: a loop never blocks forever
        return None
    seen.add(milestone.id)
    rule = getattr(milestone, "start_rule", None) or "after_previous"
    if rule in ("after_step_done", "after_step_started") and milestone.depends_on_milestone_id:
        dep = db.get(PmProjectMilestone, milestone.depends_on_milestone_id)
        if dep is None or dep.status == "cancelled":
            return None
        if rule == "after_step_done":
            return (dep, "achieved") if dep.status != "achieved" else None
        return (dep, "started") if dep.status not in _STARTED else None
    if rule == "with_previous":
        prev = (
            db.query(PmProjectMilestone)
            .filter(PmProjectMilestone.project_id == milestone.project_id, PmProjectMilestone.sequence < milestone.sequence,
                    PmProjectMilestone.status != "cancelled")
            .order_by(PmProjectMilestone.sequence.desc(), PmProjectMilestone.id.desc())
            .first()
        )
        # Same gate as the step above: blocked only by what blocks that step.
        if prev is None or prev.status in _STARTED:
            return None
        return _blocker(db, prev, seen)
    prev = (
        db.query(PmProjectMilestone)
        .filter(
            PmProjectMilestone.project_id == milestone.project_id,
            PmProjectMilestone.sequence < milestone.sequence,
            PmProjectMilestone.status.notin_(("achieved", "cancelled")),
        )
        .order_by(PmProjectMilestone.sequence, PmProjectMilestone.id)
        .first()
    )
    return (prev, "achieved") if prev else None


def blocking_milestone(db: Session, milestone: PmProjectMilestone) -> PmProjectMilestone | None:
    """The step this one is waiting for (by its start rule). None means the
    WBS is unlocked."""
    b = _blocker(db, milestone, set())
    return b[0] if b else None


def blocking_reason(db: Session, milestone: PmProjectMilestone) -> str | None:
    """'Waits for step 3 'GA design' to be achieved' — None when unlocked."""
    b = _blocker(db, milestone, set())
    if not b:
        return None
    dep, need = b
    return f"step {dep.sequence} '{dep.title}' to {'start' if need == 'started' else 'be achieved'}"


def require_unlocked(db: Session, milestone: PmProjectMilestone, action: str) -> None:
    b = _blocker(db, milestone, set())
    if b:
        prev, need = b
        raise HTTPException(
            status_code=409,
            detail=f"You can't {action} yet: '{milestone.title}' waits for step {prev.sequence} '{prev.title}' "
                   f"({MILESTONE_STATUS_LABELS.get(prev.status, prev.status)}) to {'start' if need == 'started' else 'be achieved'} "
                   f"(its start rule — the project manager can change it on the WBS tab). "
                   f"You can still plan tasks and talk in the team chat meanwhile.",
        )


def notify_unlocked_successors(db: Session, project: PmProject, actor: User | None) -> None:
    """After a step is achieved or cancelled, tell the team of every step
    that has just become workable."""
    for m in db.query(PmProjectMilestone).filter(
        PmProjectMilestone.project_id == project.id, PmProjectMilestone.status == "not_started",
    ).order_by(PmProjectMilestone.sequence).all():
        if blocking_milestone(db, m) is None:
            notify_many(db, [*owner_ids(db, m), *assistant_ids(m)], actor, "Your WBS can start now",
                        f"{project.project_code} {project.name}: the previous step is done — work on '{m.title}' "
                        f"(due {m.target_date:%d-%m-%Y}) can start.", "pm_milestone_unlocked", "pm_milestone", m.id)


def locked_milestone_ids(db: Session, project_id: int) -> set[int]:
    """Not-started steps currently waiting on something — taken before a
    change so notify_newly_unlocked tells only the teams it unlocked."""
    return {m.id for m in db.query(PmProjectMilestone).filter(
        PmProjectMilestone.project_id == project_id, PmProjectMilestone.status == "not_started").all()
        if _blocker(db, m, set())}


def notify_newly_unlocked(db: Session, project: PmProject, before: set[int], actor: User | None) -> None:
    db.flush()
    for m in db.query(PmProjectMilestone).filter(PmProjectMilestone.id.in_(before)).all() if before else []:
        if m.status == "not_started" and _blocker(db, m, set()) is None:
            notify_many(db, [*owner_ids(db, m), *assistant_ids(m)], actor, "Your WBS can start now",
                        f"{project.project_code} {project.name}: what '{m.title}' waits for has started — its work "
                        f"(due {m.target_date:%d-%m-%Y}) can start.", "pm_milestone_unlocked", "pm_milestone", m.id)


def auto_complete(db: Session, project: PmProject, actor: User | None) -> None:
    """Active → Technically complete as soon as every WBS that isn't
    cancelled is achieved — there is no manual button for it."""
    if project.status != "active":
        return
    db.flush()
    live = [m for m in db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project.id).all() if m.status != "cancelled"]
    if not live or any(m.status != "achieved" for m in live):
        return
    project.status = "technically_complete"
    project.technically_completed_on = date.today()
    if actor:
        audit(db, project.id, actor, "status_changed",
              "Every WBS is accepted — project moved to Technically complete automatically.",
              subtab_key="overview", field_name="status", old_value="active", new_value="technically_complete")
    notify_many(db, project_owner_ids(db, project), actor, "Project technically complete",
                f"{project.project_code} {project.name}: every WBS is accepted. Finish the closure checklist and the Final Project Report to close it.",
                "pm_project_technically_complete", "pm_project", project.id)


def require_project_active(project: PmProject) -> None:
    """Departments and users can only work while the project is Active —
    On hold freezes all work, Planning hasn't been released yet."""
    if project.status == "active":
        return
    if project.status == "on_hold":
        reason = f" Reason: {project.hold_reason}." if project.hold_reason else ""
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} is on hold, so all work is frozen.{reason} Management must resume it first.")
    if project.status == "planning":
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} is still in Planning. Management must release it before departments can work on it.")
    label = PROJECT_STATUS_LABELS.get(project.status, project.status)
    raise HTTPException(status_code=409, detail=f"Project {project.project_code} is {label}; no more work can be recorded on it.")


# ── Progress, flags, forecast ──────────────────────────────────────────

def subtask_counts(db: Session, task_ids: list[int]) -> dict[int, tuple[int, int]]:
    """task_id → (total, done) sub-tasks."""
    out: dict[int, tuple[int, int]] = {}
    if not task_ids:
        return out
    for st in db.query(PmTaskSubtask.task_id, PmTaskSubtask.status).filter(PmTaskSubtask.task_id.in_(task_ids)).all():
        total, done = out.get(st.task_id, (0, 0))
        out[st.task_id] = (total + 1, done + (1 if st.status == "done" else 0))
    return out


def task_progress(task: PmProjectTask, counts: tuple[int, int] | None) -> int:
    if task.status == "done":
        return 100
    total, done = counts or (0, 0)
    return round(done * 100 / total) if total else 0


def task_is_overdue(task: PmProjectTask, today: date | None = None) -> bool:
    today = today or date.today()
    return task.status in PM_TASK_OPEN_STATUSES and task.due_date is not None and task.due_date < today


def live_tasks(tasks: list[PmProjectTask]) -> list[PmProjectTask]:
    return [t for t in tasks if t.status != "cancelled"]


def milestone_progress(milestone: PmProjectMilestone, tasks: list[PmProjectTask]) -> int:
    if milestone.status == "achieved":
        return 100
    live = live_tasks(tasks)
    if not live:
        return 0
    return round(sum(1 for t in live if t.status == "done") * 100 / len(live))


def milestone_flags(milestone: PmProjectMilestone, tasks: list[PmProjectTask], today: date | None = None) -> dict:
    """Overdue: target date passed and not achieved. At risk: not yet
    overdue, but a task is overdue or blocked."""
    today = today or date.today()
    if milestone.status in ("achieved", "cancelled"):
        return {"is_overdue": False, "is_at_risk": False}
    overdue = milestone.target_date < today
    at_risk = not overdue and any(t.status == "blocked" or task_is_overdue(t, today) for t in live_tasks(tasks))
    return {"is_overdue": overdue, "is_at_risk": at_risk}


def milestone_forecast(milestone: PmProjectMilestone, tasks: list[PmProjectTask], today: date | None = None) -> date | None:
    """Expected finish: the actual date once achieved; otherwise the latest of
    the target date, the latest open task due date, and today if anything is
    already late (it can't finish in the past)."""
    today = today or date.today()
    if milestone.status == "cancelled":
        return None
    if milestone.status == "achieved":
        return milestone.actual_date
    candidates = [milestone.target_date]
    open_due = [t.due_date for t in tasks if t.status in PM_TASK_OPEN_STATUSES and t.due_date]
    candidates += open_due
    if milestone.target_date < today or any(d < today for d in open_due):
        candidates.append(today)
    return max(candidates)


def project_rollup(db: Session, project: PmProject, today: date | None = None) -> dict:
    """Everything the project list / dashboard shows that is computed."""
    today = today or date.today()
    milestones = [m for m in db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project.id).all() if m.status != "cancelled"]
    tasks = db.query(PmProjectTask).filter(PmProjectTask.project_id == project.id).all()
    by_ms: dict[int, list[PmProjectTask]] = {}
    for t in tasks:
        if t.milestone_id:
            by_ms.setdefault(t.milestone_id, []).append(t)
    achieved = [m for m in milestones if m.status == "achieved"]
    open_ms = sorted([m for m in milestones if m.status != "achieved"], key=lambda m: m.target_date)
    flags = {m.id: milestone_flags(m, by_ms.get(m.id, []), today) for m in milestones}
    forecasts = [f for f in (milestone_forecast(m, by_ms.get(m.id, []), today) for m in open_ms) if f]
    forecast = max(forecasts) if forecasts else None

    dept_names: dict[int, str] = {}
    for d in db.query(Department).filter(Department.id.in_({m.department_id for m in milestones if m.department_id})).all():
        dept_names[d.id] = d.name
    current = []
    for m in open_ms:
        n = dept_names.get(m.department_id)
        if n and n not in current and m.status in ("in_progress", "submitted"):
            current.append(n)

    health = None
    if project.status in ("active", "on_hold"):
        late = any(f["is_overdue"] for f in flags.values()) or (
            forecast is not None and project.target_handover_date is not None and forecast > project.target_handover_date
        )
        health = "delayed" if late else ("at_risk" if any(f["is_at_risk"] for f in flags.values()) else "on_track")

    nxt = open_ms[0] if open_ms else None
    return {
        "progress_percent": round(len(achieved) * 100 / len(milestones)) if milestones else 0,
        "milestones_total": len(milestones),
        "milestones_achieved": len(achieved),
        "next_milestone": {
            "id": nxt.id, "title": nxt.title, "department_name": dept_names.get(nxt.department_id),
            "target_date": nxt.target_date, "is_overdue": flags[nxt.id]["is_overdue"],
        } if nxt else None,
        "current_departments": current,
        "forecast_date": forecast,
        "health": health,
    }


def milestone_tasks(db: Session, milestone_id: int) -> list[PmProjectTask]:
    return (
        db.query(PmProjectTask)
        .filter(PmProjectTask.milestone_id == milestone_id)
        .order_by(PmProjectTask.due_date.is_(None), PmProjectTask.due_date, PmProjectTask.id)
        .all()
    )


# ── Audit, task log and notifications ──────────────────────────────────

def audit(db: Session, project_id: int, user: User, action: str, summary: str, subtab_key: str = "milestones",
          field_name: str | None = None, old_value: str | None = None, new_value: str | None = None) -> None:
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key=subtab_key,
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def set_task_status(db: Session, task: PmProjectTask, user: User, new_status: str, comment: str | None = None) -> None:
    """Every task status change goes through here so the task history
    always shows who moved it and when."""
    old = task.status
    task.status = new_status
    db.add(PmTaskUpdate(task_id=task.id, user_id=user.id, kind="status", from_status=old, to_status=new_status, comment=comment))
    audit(db, task.project_id, user, "status_changed",
          f"Task '{task.title}': {TASK_STATUS_LABELS.get(old, old)} → {TASK_STATUS_LABELS.get(new_status, new_status)} by {user_label(user)}."
          + (f" Note: {comment}" if comment else ""),
          subtab_key="tasks", field_name="status", old_value=old, new_value=new_status)


def notify_many(db: Session, user_ids, actor: User | None, title: str, message: str, ntype: str,
                entity_type: str, entity_id: int, teams: bool = False) -> None:
    seen: set[int] = set()
    for uid in user_ids:
        if not uid or uid in seen or (actor and uid == actor.id):
            continue
        seen.add(uid)
        notify_user(db, user_id=uid, title=title, message=message, notification_type=ntype,
                    entity_type=entity_type, entity_id=entity_id, teams=teams)


def notify_department_heads(db: Session, milestone: PmProjectMilestone, actor: User | None, title: str, message: str,
                            ntype: str, teams: bool = False) -> None:
    """WBS lead + the department's heads."""
    notify_many(db, owner_ids(db, milestone), actor, title, message, ntype, "pm_milestone", milestone.id, teams=teams)


def project_owner_ids(db: Session, project: PmProject) -> list[int]:
    """Who 'management' means for a notification about one project: its
    project manager; with none set, every Partner/Director."""
    return [project.project_manager_id] if project.project_manager_id else management_ids(db)
