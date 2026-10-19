"""Daily Design reminders (wired up in app/main.py's scheduler block).
Project task due/overdue alerts already come from pm_reminders — these are
the Design-only ones from the module plan:

1. Customer response overdue (Settings › days) → Design head(s) + the
   project manager, then weekly.
2. Drawing or BOM revision waiting on its checker/approver past the
   overdue days → that person, daily.
3. Design request past its due date → lead designer + Design head(s), daily.
4. Released ECN not acknowledged for 3+ days → that department's named
   acknowledgers, every 3 days.

Bell + Teams per the Teams rule (approvals/reminders opt in). Same
one-per-window dedup as pm_reminders so a restart never double-sends."""
import logging
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.design.access import get_settings, head_ids
from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.design.models.change_notice import DesignChangeNotice, DesignEcnAcknowledgement
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.request import DesignRequest, DESIGN_REQUEST_ACTIVE_STATUSES
from app.modules.design.models.submission import DesignCustomerSubmission
from app.modules.design.service import as_aware
from app.modules.projects.models.project import PmProject
from app.tasks.pm_reminders import _send


def _weekly(days_late: int) -> bool:
    """Role-based reminders go out on the first overdue day, then weekly
    (notify_event has no per-user dedup like _send)."""
    return days_late >= 1 and (days_late - 1) % 7 == 0

logger = logging.getLogger(__name__)

CUSTOMER_OVERDUE = "design_customer_overdue"
REVIEW_OVERDUE = "design_review_overdue"
REQUEST_OVERDUE = "design_request_overdue"
ECN_ACK_PENDING = "design_ecn_ack_pending"


def run_design_reminders(db: Session, today: date) -> int:
    settings = get_settings(db)
    heads = head_ids(db)
    sent = 0

    for sub in db.query(DesignCustomerSubmission).filter(
        DesignCustomerSubmission.status == "sent", DesignCustomerSubmission.is_deleted == False,  # noqa: E712
        DesignCustomerSubmission.response_due_date < today,
    ).all():
        pm = db.query(PmProject).filter(PmProject.id == sub.pm_project_id).first() if sub.pm_project_id else None
        days = (today - sub.sent_date).days if sub.sent_date else 0
        sent += _send(db, [*heads, pm.project_manager_id if pm else None], CUSTOMER_OVERDUE, "design_submission", sub.id,
                      today - timedelta(days=6), f"Customer response overdue: {sub.submission_number}",
                      f"{sub.customer_name} has had {sub.submission_number} for {days} days (due {sub.response_due_date:%d-%m-%Y}). Follow up with the customer.")
        if _weekly((today - sub.response_due_date).days):
            from app.modules.design.events import notify_design_event
            notify_design_event(
                db, None, "customer_response_overdue", sub, entity_type="design_submission", team_only=True,
                title=f"Customer response overdue: {sub.submission_number}",
                message=f"{sub.customer_name} has had {sub.submission_number} for {days} days (due {sub.response_due_date:%d-%m-%Y}). Follow up with the customer.",
                skip={*heads, pm.project_manager_id if pm else None},
            )

    limit = settings.review_overdue_days or 7
    for rev, doc in db.query(DesignDocumentRevision, DesignDocument).join(DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id).filter(
        DesignDocumentRevision.status.in_(("in_review", "in_approval")), DesignDocumentRevision.is_deleted == False,  # noqa: E712
        DesignDocument.is_deleted == False,  # noqa: E712
    ).all():
        since = rev.reviewed_at if rev.status == "in_approval" and rev.reviewed_at else rev.submitted_at
        if not since or (today - as_aware(since).date()).days < limit:
            continue
        who = rev.reviewer_id if rev.status == "in_review" else rev.approver_id
        sent += _send(db, [who], REVIEW_OVERDUE, "design_document", doc.id, today,
                      f"Waiting on you: {doc.doc_number} {rev.revision_label}",
                      f"{doc.doc_number} {rev.revision_label} ({doc.title}) has been waiting for your {'check' if rev.status == 'in_review' else 'approval'} "
                      f"for {(today - as_aware(since).date()).days} days.")

    # BOMs follow the same signature workflow — a released BOM is what
    # Purchase and Production act on, so a stuck one needs the same nudge.
    for rev, bom in db.query(DesignBomRevision, DesignBom).join(DesignBom, DesignBom.id == DesignBomRevision.bom_id).filter(
        DesignBomRevision.status.in_(("in_review", "in_approval")), DesignBomRevision.is_deleted == False,  # noqa: E712
        DesignBom.is_deleted == False,  # noqa: E712
    ).all():
        since = rev.reviewed_at if rev.status == "in_approval" and rev.reviewed_at else rev.submitted_at
        if not since or (today - as_aware(since).date()).days < limit:
            continue
        who = rev.reviewer_id if rev.status == "in_review" else rev.approver_id
        sent += _send(db, [who], REVIEW_OVERDUE, "design_bom", bom.id, today,
                      f"Waiting on you: {bom.bom_number} {rev.revision_label}",
                      f"BOM {bom.bom_number} {rev.revision_label} ({bom.title}) has been waiting for your "
                      f"{'check' if rev.status == 'in_review' else 'release approval'} for {(today - as_aware(since).date()).days} days.")

    for req in db.query(DesignRequest).filter(
        DesignRequest.status.in_(DESIGN_REQUEST_ACTIVE_STATUSES), DesignRequest.is_deleted == False,  # noqa: E712
        DesignRequest.due_date < today, DesignRequest.waiting_on == "design",
    ).all():
        sent += _send(db, [req.lead_designer_id, *heads], REQUEST_OVERDUE, "design_request", req.id, today,
                      f"Design request overdue: {req.request_number}",
                      f"{req.request_number} ({req.title}) was due {req.due_date:%d-%m-%Y} and is still {req.status.replace('_', ' ')}.")
        if _weekly((today - req.due_date).days):
            from app.modules.design.events import notify_design_event
            notify_design_event(
                db, None, "request_overdue", req, entity_type="design_request",
                title=f"Design request overdue: {req.request_number}",
                message=f"{req.request_number} ({req.title}) was due {req.due_date:%d-%m-%Y} and is still {req.status.replace('_', ' ')}.",
                skip={req.lead_designer_id, *heads},
            )

    named = settings.ecn_acknowledger_ids or {}
    for ack, ecn in db.query(DesignEcnAcknowledgement, DesignChangeNotice).join(
        DesignChangeNotice, DesignChangeNotice.id == DesignEcnAcknowledgement.ecn_id
    ).filter(DesignEcnAcknowledgement.acknowledged_at.is_(None), DesignChangeNotice.status == "implemented").all():
        if not ecn.implemented_at or (today - as_aware(ecn.implemented_at).date()).days < 3:
            continue
        sent += _send(db, named.get(ack.department) or [], ECN_ACK_PENDING, "design_ecn", ecn.id, today - timedelta(days=2),
                      f"Acknowledge {ecn.ecn_number}", f"{ecn.ecn_number} ({ecn.title}) still needs the {ack.department} acknowledgement.")
    return sent


def send_design_reminders() -> None:
    db = SessionLocal()
    try:
        sent = run_design_reminders(db, date.today())
        db.commit()
        logger.info("Design reminders sent: %s", sent)
    except Exception:
        db.rollback()
        logger.exception("Design reminders failed")
    finally:
        db.close()
