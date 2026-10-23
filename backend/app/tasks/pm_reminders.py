"""Daily Project Management reminders and escalations (wired up in
app/main.py's scheduler block). Only Active projects — On hold pauses
every alert.

1. Task due tomorrow → assignee.
2. Task overdue → assignee every day; from the 2nd overdue day also the
   WBS lead and department head (escalation).
3. WBS at risk (a task blocked or overdue, WBS date not yet
   passed) → WBS lead, department head + project manager, at most once a week.
4. WBS overdue → project manager, WBS lead and department head every day;
   after 7 days overdue also every Director/Partner (escalation).
5. WBS submitted → the project's owners (project manager, or every
   Partner/Director when none is set), every other day, until they accept or
   reject it. A submitted WBS never counts as overdue/at risk for the
   department — the department has finished; the hold-up is acceptance.

6. Project milestones (the Milestones given to one person, no WBS) and
   their sub-tasks, in Planning or Active projects:
   - due tomorrow → the owner (sub-task: its person);
   - due today → the owner AND whoever gave it (sub-task: its person and
     the milestone owner who gave it);
   - overdue → the same two, every 3 days until done.

Same "one notification per recipient/entity/type per window" dedup as
app/tasks/hr_reminders.py, so a scheduler restart never double-sends."""
import logging
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.organization.models.department import Department
from app.modules.projects.models.task import PmProjectTask, PmTaskSubtask, PM_TASK_OPEN_STATUSES
from app.modules.projects import workflow as wf
from app.utils.notifications import notify_user
from app.modules.projects.events import pm_event

logger = logging.getLogger(__name__)

TASK_DUE_SOON = "pm_task_due_soon"
TASK_OVERDUE = "pm_task_overdue"
TASK_OVERDUE_ESCALATED = "pm_task_overdue_escalated"
MILESTONE_AT_RISK = "pm_milestone_at_risk"
MILESTONE_OVERDUE = "pm_milestone_overdue"
MILESTONE_OVERDUE_ESCALATED = "pm_milestone_overdue_escalated"
MILESTONE_AWAITING_ACCEPTANCE = "pm_milestone_awaiting_acceptance"
GOAL_DUE_SOON = "pm_goal_due_soon"
GOAL_DUE_TODAY = "pm_goal_due_today"
GOAL_OVERDUE = "pm_goal_overdue"
OVERDUE_EVERY_DAYS = 3


def _sent_since(db: Session, user_id: int, entity_type: str, entity_id: int, ntype: str, since: date) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id,
        Notification.entity_type == entity_type,
        Notification.entity_id == entity_id,
        Notification.notification_type == ntype,
        func.date(Notification.created_at) >= since,
    ).first() is not None


def _send(db: Session, user_ids, ntype: str, entity_type: str, entity_id: int, since: date, title: str, message: str) -> int:
    sent = 0
    for uid in dict.fromkeys(u for u in user_ids if u):
        if _sent_since(db, uid, entity_type, entity_id, ntype, since):
            continue
        notify_user(db, user_id=uid, title=title, message=message, notification_type=ntype,
                    entity_type=entity_type, entity_id=entity_id, teams=True)
        sent += 1
    return sent


def run_pm_reminders(db: Session, today: date) -> int:
    projects = {p.id: p for p in db.query(PmProject).filter(PmProject.status == "active").all()}
    if not projects:
        return _milestone_reminders(db, today)
    management = wf.management_ids(db)
    milestones = {
        m.id: m for m in db.query(PmProjectMilestone).filter(
            PmProjectMilestone.project_id.in_(projects), PmProjectMilestone.status.notin_(("achieved", "cancelled"))
        ).all()
    }
    sent = 0

    # WBS tasks only — project milestones (no WBS) are handled below.
    tasks = db.query(PmProjectTask).filter(
        PmProjectTask.project_id.in_(projects),
        PmProjectTask.milestone_id.isnot(None),
        PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES),
        PmProjectTask.due_date.isnot(None),
    ).all()
    tasks_by_ms: dict[int, list[PmProjectTask]] = {}
    for t in db.query(PmProjectTask).filter(PmProjectTask.milestone_id.in_(milestones)).all():
        tasks_by_ms.setdefault(t.milestone_id, []).append(t)

    for t in tasks:
        p = projects[t.project_id]
        m = milestones.get(t.milestone_id)
        if t.due_date == today + timedelta(days=1):
            sent += _send(db, [t.assignee_id], TASK_DUE_SOON, "pm_task", t.id, today,
                          "Task due tomorrow", f"{p.project_code} — '{t.title}' is due tomorrow ({t.due_date:%d-%m-%Y}).")
        elif t.due_date < today:
            days = (today - t.due_date).days
            sent += _send(db, [t.assignee_id], TASK_OVERDUE, "pm_task", t.id, today,
                          "Task overdue", f"{p.project_code} — '{t.title}' was due {t.due_date:%d-%m-%Y} ({days} day(s) ago). "
                                          f"Finish it, or tell your department head what's holding it up.")
            if days >= 2 and m:
                sent += _send(db, wf.owner_ids(db, m), TASK_OVERDUE_ESCALATED, "pm_task", t.id, today,
                              "Team task overdue",
                              f"{p.project_code} — '{t.title}' ({wf.name_of(db, t.assignee_id)}) is {days} day(s) overdue.")

    for m in milestones.values():
        p = projects[m.project_id]
        if m.status == "submitted":
            submitted_on = f" on {m.submitted_at:%d-%m-%Y}" if m.submitted_at else ""
            sent += _send(db, wf.project_owner_ids(db, p), MILESTONE_AWAITING_ACCEPTANCE, "pm_milestone", m.id, today - timedelta(days=1),
                          "Reminder: WBS awaiting your acceptance",
                          f"{p.project_code} — '{m.title}' was submitted by the department{submitted_on} and is waiting for your acceptance. "
                          f"Open the project's WBS tab to accept or reject it.")
            continue
        flags = wf.milestone_flags(m, tasks_by_ms.get(m.id, []), today)
        heads = wf.owner_ids(db, m)
        if flags["is_overdue"]:
            days = (today - m.target_date).days
            sent += _send(db, [p.project_manager_id, *heads], MILESTONE_OVERDUE, "pm_milestone", m.id, today,
                          "WBS overdue", f"{p.project_code} — '{m.title}' was due {m.target_date:%d-%m-%Y} ({days} day(s) ago) and is {wf.MILESTONE_STATUS_LABELS.get(m.status, m.status)}.")
            if days > 7:
                sent += _send(db, management, MILESTONE_OVERDUE_ESCALATED, "pm_milestone", m.id, today,
                              "Escalation: WBS overdue",
                              f"{p.project_code} {p.name} — '{m.title}' is {days} days overdue. Project manager: {wf.name_of(db, p.project_manager_id)}.")
        elif flags["is_at_risk"]:
            sent += _send(db, [*heads, p.project_manager_id], MILESTONE_AT_RISK, "pm_milestone", m.id, today - timedelta(days=6),
                          "WBS at risk",
                          f"{p.project_code} — '{m.title}' (due {m.target_date:%d-%m-%Y}) has blocked or overdue tasks.")
    return sent + _milestone_reminders(db, today)


def _due_messages(db: Session, kind: str, p: PmProject, title: str, due: date, today: date, owner: int | None) -> tuple[str, str, str, date] | None:
    """(type, title, message, dedup-since) for a due date, or None if nothing is due."""
    who = f" ({wf.name_of(db, owner)})" if owner else ""
    if due == today + timedelta(days=1):
        return GOAL_DUE_SOON, f"{kind} due tomorrow", f"{p.project_code} {p.name} — '{title}' is due tomorrow ({due:%d-%m-%Y}).", today
    if due == today:
        return GOAL_DUE_TODAY, f"{kind} due today", f"{p.project_code} {p.name} — '{title}'{who} is due today ({due:%d-%m-%Y}).", today
    if due < today:
        days = (today - due).days
        return (GOAL_OVERDUE, f"{kind} overdue",
                f"{p.project_code} {p.name} — '{title}'{who} was due {due:%d-%m-%Y} ({days} day(s) ago) and is not done yet.",
                today - timedelta(days=OVERDUE_EVERY_DAYS - 1))
    return None


def _milestone_reminders(db: Session, today: date) -> int:
    """Project milestones (one owner each) and their sub-tasks."""
    projects = {p.id: p for p in db.query(PmProject).filter(PmProject.status.in_(("planning", "active"))).all()}
    if not projects:
        return 0
    sent = 0
    goals = db.query(PmProjectTask).filter(
        PmProjectTask.project_id.in_(projects), PmProjectTask.milestone_id.is_(None),
        PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES), PmProjectTask.due_date.isnot(None),
    ).all()
    for t in goals:
        p = projects[t.project_id]
        owners = [t.assignee_id] if t.assignee_id else wf.department_head_ids(db.get(Department, t.department_id) if t.department_id else None)
        msg = _due_messages(db, "Milestone", p, t.title, t.due_date, today, owners[0] if len(owners) == 1 else None)
        if not msg:
            continue
        ntype, title, text, since = msg
        to = owners if ntype == GOAL_DUE_SOON else [*owners, t.created_by_id]
        now_sent = _send(db, to, ntype, "pm_task", t.id, since, title, text)
        sent += now_sent
        if ntype == GOAL_OVERDUE and now_sent:
            # Role subscribers (core/events/projects.py), on the same every-few-days rhythm;
            # bell / Teams only — a job has no background task for email.
            pm_event(db, None, "milestone_overdue", p, title=title, message=text,
                     entity_type="pm_project", entity_id=p.id, skip=to)

    open_goals = {t.id: t for t in goals}
    subs = db.query(PmTaskSubtask).filter(
        PmTaskSubtask.task_id.in_(open_goals), PmTaskSubtask.status != "done", PmTaskSubtask.due_date.isnot(None),
    ).all() if open_goals else []
    for st in subs:
        t = open_goals[st.task_id]
        p = projects[t.project_id]
        msg = _due_messages(db, "Sub-task", p, f"{st.title}' (part of '{t.title}", st.due_date, today, st.assignee_id)
        if not msg:
            continue
        ntype, title, text, since = msg
        to = [st.assignee_id] if ntype == GOAL_DUE_SOON else [st.assignee_id, st.created_by_id]
        sent += _send(db, to, ntype, "pm_subtask", st.id, since, title, text)
    return sent


def send_pm_reminders() -> None:
    db = SessionLocal()
    try:
        sent = run_pm_reminders(db, date.today())
        db.commit()
        logger.info("Project Management reminders sent: %s", sent)
    except Exception:
        db.rollback()
        logger.exception("Project Management reminders failed")
    finally:
        db.close()
