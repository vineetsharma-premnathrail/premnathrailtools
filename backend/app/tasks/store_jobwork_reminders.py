"""Daily job-work (GST Rule 45) reminders (wired up in app/main.py).

Material sent to a job worker must come back (or be used there into goods
that come back) within 1 year for inputs and 3 years for capital goods, or
the supply is deemed made on the challan date and GST becomes payable. A
challan still holding material is flagged once at each step — 300 / 330 /
360 days (inputs), 1000 / 1080 days (capital goods) — to the person who
posted it, the store's manager and the Store Managers (Teams + bell: it is a
reminder)."""
import logging
from datetime import date

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.main.models.user import User
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.services import job_work as jw
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)

JOBWORK_DUE = "store_jobwork_return_due"


def _recipients(db: Session, issue: StoreMaterialIssue) -> set[int]:
    ids = {issue.issued_by_id} - {None}
    mgr = db.query(StoreLocation.manager_user_id).filter(StoreLocation.id == issue.location_id).scalar()
    if mgr:
        ids.add(mgr)
    ids |= {u for (u,) in db.query(User.id).filter(User.is_store_manager == True, User.is_active == True).all()}  # noqa: E712
    return ids


def _send_jobwork_reminders(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    by_issue: dict[int, list[dict]] = {}
    for r in jw.challan_lines(db, today=today):
        if r["quantity_outstanding"] > 1e-9:
            by_issue.setdefault(r["issue_id"], []).append(r)
    sent = 0
    for issue_id, rows in by_issue.items():
        issue = db.get(StoreMaterialIssue, issue_id)
        capital = any(r["goods_type"] == "capital_goods" for r in rows)
        days_out = rows[0]["days_out"]
        step = jw.reminder_step(days_out, capital, issue.jobwork_reminded_days)
        if step is None:
            continue
        deadline = min(r["return_deadline"] for r in rows)
        left = (deadline - today).days
        items = "; ".join(f"{r['quantity_outstanding']:g} {r['uom'] or ''} {r['item_name']}".replace("  ", " ") for r in rows[:5])
        when = f"in {left} day(s) ({deadline:%d-%m-%Y})" if left >= 0 else f"{-left} day(s) ago ({deadline:%d-%m-%Y})"
        msg = (f"Job-work challan {issue.challan_number or issue.issue_number} to {issue.vendor_name or 'the vendor'} has been out "
               f"{days_out} days and still holds {items}. GST Rule 45: it must come back {'within 3 years' if capital else 'within 1 year'} — "
               f"the limit falls {when}. Get it returned (Store › Returns) or received as processed goods (Store › Job Work), "
               "otherwise GST is payable on it as a supply.")
        direct = _recipients(db, issue)
        for uid in direct:
            notify_user(db, user_id=uid, title="Job Work Material Due Back (GST)", message=msg, notification_type=JOBWORK_DUE,
                        entity_type="store_material_issue", entity_id=issue.id, teams=True)
            sent += 1
        # Role event (bell / Teams — a scheduled job has no background task for email).
        from app.core.notification_events import notify_event
        from app.modules.store.services.store_events import location_opener
        sent += len(notify_event(
            db, None, "store", "jobwork_due_back", title="Job Work Material Due Back (GST)", message=msg,
            entity_type="store_material_issue", entity_id=issue.id,
            can_open=location_opener(db, issue.location_id), skip_user_ids=direct,
        ))
        issue.jobwork_reminded_days = step
    db.commit()
    return sent


def send_jobwork_reminders() -> None:
    db = SessionLocal()
    try:
        _send_jobwork_reminders(db)
    except Exception:
        logger.exception("Job work reminders failed")
        db.rollback()
    finally:
        db.close()
