"""Daily HR reminders (wired up in app/main.py's scheduler block).

1. Employee documents (user_documents.expiry_date) expiring in exactly 30
   or 7 days, or today: notifies the employee and every HR user (anyone
   with the `hr` app, admins included). 'HR Only' documents notify HR only.
2. Probation ending within the next 7 days (hr_employee_profiles with
   employment_status onboarding/probation): notifies HR, the reporting
   manager and the employee — once per probation end date, not daily.
3. HR approvals (leave, attendance regularization, travel: 'pending';
   expense claims: 'submitted') waiting more than PENDING_APPROVAL_DAYS:
   reminds the captured approver once a day. When there is no approver or
   the approver can't act (inactive, or no HR app), every HR user is
   reminded instead — HR can always decide (services/access.can_decide).

Same "one notification per recipient/entity/day" dedup shape as
app/tasks/po_overdue_reminders.py, so a scheduler restart never double-sends."""
import logging
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.core.permission_registry import can_perform
from app.modules.main.models.user import User
from app.modules.main.models.user_document import UserDocument
from app.modules.hr.models.attendance import HrAttendanceRegularization
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.expense import HrExpenseClaim
from app.modules.hr.models.leave import HrLeaveRequest
from app.modules.hr.models.travel import HrTravelRequest
from app.modules.hr.services.access import HR_ONLY_CONFIDENTIALITY, is_hr, is_hr_for
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)

DOC_EXPIRING = "hr_document_expiring"
PROBATION_ENDING = "hr_probation_ending"
DOC_REMINDER_DAYS = (30, 7, 0)
PROBATION_WINDOW_DAYS = 7
APPROVAL_PENDING = "hr_approval_pending_reminder"
# Days a request may wait before the approver is reminded. A constant for
# now; moves to HR settings (MODULE_DETAILED_PLAN §47) later.
PENDING_APPROVAL_DAYS = 2


def _hr_user_ids(db: Session, tabs: str | tuple[str, ...] | None = None) -> list[int]:
    """Active users with the hr app; with `tabs`, only those the HR Permission
    Matrix lets act on (any of) those tabs. The hr app alone is held by every
    employee who uses My HR, so "HR staff" recipients must be narrowed by tab."""
    users = db.query(User).filter(User.is_active.is_(True)).all()
    if tabs is None:
        return [u.id for u in users if is_hr(u)]
    return [u.id for u in users if is_hr_for(u, tabs)]


def _sent_since(db: Session, user_id: int, entity_type: str, entity_id: int, ntype: str, since: date) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id,
        Notification.entity_type == entity_type,
        Notification.entity_id == entity_id,
        Notification.notification_type == ntype,
        func.date(Notification.created_at) >= since,
    ).first() is not None


def _fmt(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def _send_document_reminders(db: Session, today: date, hr_ids: list[int], staff_ids: list[int] | None = None) -> int:
    """`hr_ids`: users who can open HR at all (the owner is reminded only if
    they can); `staff_ids`: HR staff who handle employee documents."""
    staff_ids = hr_ids if staff_ids is None else staff_ids
    targets = [today + timedelta(days=n) for n in DOC_REMINDER_DAYS]
    docs = (
        db.query(UserDocument, User)
        .join(User, User.id == UserDocument.user_id)
        .filter(UserDocument.expiry_date.in_(targets), User.is_active.is_(True))
        .all()
    )
    sent = 0
    for doc, owner in docs:
        days = (doc.expiry_date - today).days
        when = "today" if days == 0 else f"in {days} days, on {_fmt(doc.expiry_date)}"
        # An 'HR Only' document is hidden from its owner, so don't reveal it in a reminder either.
        recipients = set(staff_ids)
        # HR is visible only to users given the HR app, so the owner is pinged only if they have it.
        if doc.confidentiality != HR_ONLY_CONFIDENTIALITY and owner.id in set(hr_ids):
            recipients.add(owner.id)
        for rid in recipients:
            if _sent_since(db, rid, "user_document", doc.id, DOC_EXPIRING, today):
                continue
            if rid == owner.id:
                title = "Your document is expiring"
                msg = f"Your {doc.document_type} '{doc.document_name}' expires {when}. Renew it and send the new copy to HR."
            else:
                title = "Employee document expiring"
                msg = f"{owner.name}'s {doc.document_type} '{doc.document_name}' expires {when}. Collect the renewed copy and upload it under HR > Employees > {owner.name} > Documents."
            notify_user(db, user_id=rid, title=title, message=msg, notification_type=DOC_EXPIRING,
                        entity_type="user_document", entity_id=doc.id, teams=True)
            sent += 1
    return sent


def _send_probation_reminders(db: Session, today: date, hr_ids: list[int], staff_ids: list[int] | None = None) -> int:
    """`hr_ids`: users who can open HR at all; `staff_ids`: HR staff who
    record confirmations."""
    staff_ids = hr_ids if staff_ids is None else staff_ids
    staff = set(staff_ids)
    rows = (
        db.query(HrEmployeeProfile, User)
        .join(User, User.id == HrEmployeeProfile.user_id)
        .filter(
            User.is_active.is_(True),
            or_(HrEmployeeProfile.employment_status == "onboarding", HrEmployeeProfile.probation_status == "on_probation"),
            HrEmployeeProfile.probation_end_date.isnot(None),
            HrEmployeeProfile.probation_end_date >= today,
            HrEmployeeProfile.probation_end_date <= today + timedelta(days=PROBATION_WINDOW_DAYS),
        )
        .all()
    )
    sent = 0
    for profile, emp in rows:
        end = profile.probation_end_date
        days = (end - today).days
        when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
        # once per probation end date: anything sent in the window counts
        since = end - timedelta(days=PROBATION_WINDOW_DAYS + 1)
        recipients = {emp.id}
        if emp.reporting_manager_id:
            recipients.add(emp.reporting_manager_id)
        recipients &= set(hr_ids)  # only users who can open HR
        recipients |= staff
        for rid in recipients:
            if _sent_since(db, rid, "hr_employee_profile", profile.id, PROBATION_ENDING, since):
                continue
            if rid == emp.id:
                title = "Your probation is ending"
                msg = f"Your probation period ends {when} ({_fmt(end)}). HR and your manager will review your confirmation."
            elif rid == emp.reporting_manager_id and rid not in staff:
                title = "Team member's probation ending"
                msg = f"{emp.name}'s probation ends {when} ({_fmt(end)}). Share your confirmation recommendation with HR."
            else:
                title = "Probation ending"
                msg = f"{emp.name}'s probation ends {when} ({_fmt(end)}). Record the confirmation under HR > Lifecycle (New > Confirmation) or extend the probation end date."
            notify_user(db, user_id=rid, title=title, message=msg, notification_type=PROBATION_ENDING,
                        entity_type="hr_employee_profile", entity_id=profile.id, teams=True)
            sent += 1
    return sent


def _pending_approval_queries(db: Session):
    """(label, entity_type, query) for every HR request type still waiting on
    a decision — same filters as services/lifecycle._pending_hr_approval_queries,
    across all approvers."""
    return [
        ("Leave request", "hr_leave_request", db.query(HrLeaveRequest).filter(HrLeaveRequest.status == "pending")),
        ("Attendance regularization", "hr_attendance_regularization",
         db.query(HrAttendanceRegularization).filter(HrAttendanceRegularization.status == "pending")),
        ("Travel request", "hr_travel_request", db.query(HrTravelRequest).filter(HrTravelRequest.status == "pending")),
        ("Expense claim", "hr_expense_claim", db.query(HrExpenseClaim).filter(HrExpenseClaim.status == "submitted")),
    ]


def _send_pending_approval_reminders(db: Session, today: date, hr_ids: list[int], approver_hr_ids: list[int] | None = None) -> int:
    """`hr_ids`: users who can open HR at all (a captured approver needs it);
    `approver_hr_ids`: HR users who may decide anyone's request (the Approvals
    tab, same rule as access.can_decide) — the fallback recipients."""
    cutoff = datetime.combine(today - timedelta(days=PENDING_APPROVAL_DAYS), time.min, tzinfo=timezone.utc)
    hr_set = set(hr_ids)
    deciders = set(hr_ids if approver_hr_ids is None else approver_hr_ids)
    users: dict[int, User | None] = {}

    def _user(uid: int | None) -> User | None:
        if uid is None:
            return None
        if uid not in users:
            users[uid] = db.get(User, uid)
        return users[uid]

    sent = 0
    for label, entity_type, q in _pending_approval_queries(db):
        for row in q.all():
            raised = getattr(row, "submitted_at", None) or row.created_at
            if raised is None:
                continue
            if raised.tzinfo is None:
                raised = raised.replace(tzinfo=timezone.utc)
            if raised >= cutoff:
                continue
            requester = _user(row.user_id)
            approver = _user(row.approver_id)
            ref = getattr(row, "request_no", None) or getattr(row, "claim_no", None) or f"#{row.id}"
            days = (today - raised.date()).days
            who = requester.name if requester else f"user #{row.user_id}"
            # HR is gated to the hr app (require_hr_module), so an approver
            # without it can't open Approvals — HR picks those up instead.
            if approver and approver.is_active and approver.id in hr_set and approver.id != row.user_id:
                recipients = {approver.id}
                msg = f"{label} {ref} from {who} has been waiting for your decision for {days} days. Approve or reject it in HR > Approvals."
            else:
                recipients = deciders - {row.user_id}
                reason = (
                    "has no approver" if not approver
                    else f"is waiting on {approver.name}, who can't act on it (account inactive or no HR access)"
                )
                msg = (
                    f"{label} {ref} from {who} {reason} and has been pending for {days} days. "
                    "Decide it in HR > Approvals, or fix the reporting manager in HR > Employees."
                )
            for rid in recipients:
                if _sent_since(db, rid, entity_type, row.id, APPROVAL_PENDING, today):
                    continue
                notify_user(db, user_id=rid, title=f"{label} pending for {days} days", message=msg,
                            notification_type=APPROVAL_PENDING, entity_type=entity_type, entity_id=row.id, teams=True)
                sent += 1
    return sent


def run_hr_reminders(db: Session, today: date | None = None) -> dict[str, int]:
    """Pure logic over an open session (tests call this directly)."""
    today = today or date.today()
    hr_ids = _hr_user_ids(db)
    docs = _send_document_reminders(db, today, hr_ids, _hr_user_ids(db, "employees"))
    probation = _send_probation_reminders(db, today, hr_ids, _hr_user_ids(db, ("employees", "lifecycle")))
    # Unrouted requests are decided by HR holding Approvals › Approve (see
    # hr/services/access.can_decide) — remind those people, not mere viewers.
    approvers = [uid for uid in _hr_user_ids(db, "approvals")
                 if can_perform(db.get(User, uid), "hr", "approvals", "approve")]
    approvals = _send_pending_approval_reminders(db, today, hr_ids, approvers)
    db.commit()
    return {"documents": docs, "probation": probation, "approvals": approvals}


def send_hr_reminders() -> None:
    """Scheduler entry point — opens its own DB session."""
    db = SessionLocal()
    try:
        result = run_hr_reminders(db)
        logger.info("HR reminders sent: %s", result)
    except Exception:
        db.rollback()
        logger.exception("Failed to send HR reminders")
    finally:
        db.close()
