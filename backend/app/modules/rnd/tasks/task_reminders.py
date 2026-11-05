"""Daily due / overdue reminders for R&D tasks (owner, 2026-11-05).

Covers OPEN tasks only (a submitted task is done and waits for review) of both
kinds: requirement tasks (rnd_requirement_tasks) and project tasks
(rnd_project_tasks — Prototype / Research projects and R&D work on a PM project).

- due tomorrow  → the assignee                                  (rnd_task_due_soon)
- due today     → the assignee                                  (rnd_task_due_today)
- overdue       → the assignee, every day                       (rnd_task_overdue)
- overdue 2+ days → whoever gave the task and the R&D head(s),
  every 3 days                                                  (rnd_task_overdue_escalated)

Channels default to bell + Teams (core/events/direct_scheduled.py); a role's
Notifications tab or a personal setting can change them. One reminder per
recipient / task / type per window, matched on the notification title (which
names the task), so a scheduler restart never double-sends.

Registered in core/jobs.py (JOB_INFO "rnd_task_reminders") and main.py's
scheduler; `run_task_reminders` is pure over an open session so tests call it."""
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.crm.services.requirement_movement import IST
from app.modules.main.models.notification import Notification
from app.modules.rnd.models.project_task import RndProjectTask
from app.modules.rnd.models.requirement_work import RndRequirementTask
from app.modules.rnd.services import requirement_access as ra
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)

DUE_SOON = "rnd_task_due_soon"
DUE_TODAY = "rnd_task_due_today"
OVERDUE = "rnd_task_overdue"
OVERDUE_ESCALATED = "rnd_task_overdue_escalated"
ESCALATE_AFTER_DAYS = 2
ESCALATE_EVERY_DAYS = 3


def _sent_since(db: Session, user_id: int, ntype: str, title: str, since: date) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.notification_type == ntype,
        Notification.title == title, func.date(Notification.created_at) >= since,
    ).first() is not None


def _send(db: Session, user_ids, ntype: str, title: str, message: str, entity_type: str, entity_id: int, since: date) -> int:
    sent = 0
    for uid in dict.fromkeys(u for u in user_ids if u):
        if _sent_since(db, uid, ntype, title, since):
            continue
        notify_user(db, user_id=uid, title=title, message=message, notification_type=ntype,
                    entity_type=entity_type, entity_id=entity_id, teams=True)
        sent += 1
    return sent


def _requirement_ref(db: Session, task: RndRequirementTask, cache: dict) -> str:
    key = (task.source, task.record_id)
    if key not in cache:
        from app.modules.rnd.routes.requirement_work import _record, _ref  # same live-record rule as the pages
        try:
            cache[key] = f"requirement {_ref(task.source, _record(db, task.source, task.record_id))}"
        except Exception:  # the CRM record was deleted or taken back — no reminder
            cache[key] = None
    return cache[key]


def _project_ref(db: Session, task: RndProjectTask, cache: dict) -> tuple[str, str, int] | None:
    """(reference text, notification entity type, entity id) — the bell opens the R&D page."""
    key = (task.project_id, task.pm_project_id)
    if key not in cache:
        if task.project_id:
            from app.modules.rnd.models.project import RndProject
            p = db.get(RndProject, task.project_id)
            cache[key] = (f"project {p.project_number}", "rnd_project", p.id) if p else None
        else:
            from app.modules.projects.models.project import PmProject
            p = db.get(PmProject, task.pm_project_id)
            cache[key] = (f"project {p.project_code}", "rnd_pm_project", p.id) if p else None
    return cache[key]


def _remind(db: Session, today: date, task, ref: str, entity_type: str, entity_id: int, heads: list[int]) -> int:
    due = task.due_date
    if due == today + timedelta(days=1):
        return _send(db, [task.assigned_to_id], DUE_SOON, f"R&D task due tomorrow: {task.title} ({ref})",
                     f"'{task.title}' on {ref} is due tomorrow ({due:%d-%m-%Y}).", entity_type, entity_id, today)
    if due == today:
        return _send(db, [task.assigned_to_id], DUE_TODAY, f"R&D task due today: {task.title} ({ref})",
                     f"'{task.title}' on {ref} is due today ({due:%d-%m-%Y}). Submit it when done, or move the date with a reason.",
                     entity_type, entity_id, today)
    if due >= today:
        return 0
    days = (today - due).days
    sent = _send(db, [task.assigned_to_id], OVERDUE, f"R&D task overdue: {task.title} ({ref})",
                 f"'{task.title}' on {ref} was due {due:%d-%m-%Y} ({days} day{'s' if days != 1 else ''} ago). "
                 "Submit it, or give a new completion date with the reason.", entity_type, entity_id, today)
    if days >= ESCALATE_AFTER_DAYS:
        from app.modules.rnd.routes.requirement_work import _name
        from app.modules.main.models.user import User
        who = _name(db.get(User, task.assigned_to_id))
        to = [u for u in [task.created_by_id, *heads] if u != task.assigned_to_id]
        sent += _send(db, to, OVERDUE_ESCALATED, f"Team R&D task overdue: {task.title} ({ref})",
                      f"'{task.title}' on {ref} ({who}) is {days} days overdue (due {due:%d-%m-%Y}).",
                      entity_type, entity_id, today - timedelta(days=ESCALATE_EVERY_DAYS - 1))
    return sent


def run_task_reminders(db: Session, today: date | None = None) -> int:
    """Send every due reminder for open R&D tasks. Returns how many notifications went out."""
    today = today or datetime.now(IST).date()
    horizon = today + timedelta(days=1)
    heads = ra.head_ids(db)
    sent = 0

    req_cache: dict = {}
    for t in db.query(RndRequirementTask).filter(RndRequirementTask.status == "open", RndRequirementTask.due_date <= horizon).all():
        ref = _requirement_ref(db, t, req_cache)
        if ref is None:
            continue
        entity_type, entity_id = ra.link_for(db, None, t.source, t.record_id)
        sent += _remind(db, today, t, ref, entity_type, entity_id, heads)

    proj_cache: dict = {}
    for t in db.query(RndProjectTask).filter(RndProjectTask.status == "open", RndProjectTask.due_date <= horizon).all():
        found = _project_ref(db, t, proj_cache)
        if found is None:
            continue
        ref, entity_type, entity_id = found
        sent += _remind(db, today, t, ref, entity_type, entity_id, heads)
    return sent


def send_task_reminders() -> None:
    db = SessionLocal()
    try:
        count = run_task_reminders(db)
        db.commit()
        logger.info("R&D task due/overdue reminders sent: %s", count)
    except Exception:
        db.rollback()
        logger.exception("R&D task due/overdue reminders failed")
    finally:
        db.close()
