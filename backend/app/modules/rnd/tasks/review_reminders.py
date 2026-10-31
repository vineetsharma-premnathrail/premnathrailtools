"""Teams reminder for a requirement nobody in R&D has reviewed yet.

BD's send is bell-only. When the latest revision stays "submitted" for 2
working days, each R&D head gets a Teams + bell reminder, repeated every 3
days until the revision is accepted or returned (an accepted / returned /
superseded revision gets none). `last_reminded_at` on the revision keeps the
cadence; roles subscribed to rnd.review_pending are told on their own channels.

Registered by the Manager in core/jobs.py (JOB_INFO key "rnd_review_reminders")
and the scheduler in main.py; `run_review_reminders` is pure over an open session
so tests call it directly.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.notification_events import notify_event
from app.db.session import SessionLocal
from app.modules.crm.services.requirement_movement import IST
from app.modules.rnd.models.requirement import RndRequirement, RndRequirementRevision
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import requirements as intake
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)
NOTIFICATION_TYPE = "rnd_review_reminder"


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def run_review_reminders(db: Session, now: datetime | None = None) -> int:
    """Remind the heads of every latest revision still waiting for review. Returns how many revisions were reminded."""
    from app.modules.rnd.routes.requirement_work import _record  # same live-record rule as the requirement pages
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(IST).date()
    reminded = 0
    waiting = db.query(RndRequirementRevision).filter(RndRequirementRevision.status == "submitted").all()
    for rev in waiting:
        req = db.get(RndRequirement, rev.requirement_id)
        if req is None or req.current_revision != rev.revision_no:
            continue  # not the latest revision
        if intake.working_days_between(_aware(rev.submitted_at).astimezone(IST).date(), today) < intake.REMINDER_AFTER_WORKING_DAYS:
            continue
        if rev.last_reminded_at and (today - _aware(rev.last_reminded_at).astimezone(IST).date()).days < intake.REMINDER_EVERY_DAYS:
            continue
        try:
            record = _record(db, req.source, req.record_id)
        except Exception:  # the CRM record was deleted — nothing to review
            continue
        days = (today - _aware(rev.submitted_at).astimezone(IST).date()).days
        title = f"Requirement {rev.revision_code} is waiting for review"
        message = (f"{rev.revision_code} ({record.universal_id}) was sent by BD {days} day{'s' if days != 1 else ''} ago and is still not accepted. "
                   "Open R&D › Requirements to accept it.")
        head_ids = set(ra.head_ids(db))
        for uid in head_ids:
            notify_user(db, uid, title=title, message=message, notification_type=NOTIFICATION_TYPE,
                        entity_type=f"rnd_req_{req.source}", entity_id=req.record_id, teams=True)
        notify_event(
            db, None, "rnd", "review_pending", title=title, message=message, entity_type=f"rnd_req_{req.source}",
            entity_id=req.record_id, actor=None, skip_user_ids=head_ids,
            can_open=lambda u, s=req.source, r=req.record_id: ra.is_rnd_side(u) and bool(ra.access_for(db, u, s, r)["view"]),
        )
        rev.last_reminded_at = now
        reminded += 1
    return reminded


def send_review_reminders() -> None:
    db = SessionLocal()
    try:
        count = run_review_reminders(db)
        db.commit()
        logger.info("R&D review reminders sent for %s requirement(s)", count)
    except Exception:
        db.rollback()
        logger.exception("R&D review reminders failed")
    finally:
        db.close()
