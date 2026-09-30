"""Design landing page KPIs and the "My Tasks" queue."""
from datetime import date, datetime, time, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.design.models.change_notice import DesignChangeNotice
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.schemas.dashboard import DesignDashboard, DesignMyTasks, DesignRecentRelease, DesignTaskItem
from app.modules.design.service import OVERDUE_DAYS, as_aware, days_since, display_status, user_name, users_by_id
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/design", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)


def _open_revisions(db: Session) -> list[tuple[DesignDocumentRevision, DesignDocument]]:
    return db.query(DesignDocumentRevision, DesignDocument).join(
        DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id
    ).filter(
        DesignDocumentRevision.is_deleted == False,  # noqa: E712
        DesignDocument.is_deleted == False,  # noqa: E712
        DesignDocumentRevision.status.in_(("draft", "in_review", "in_approval")),
    ).all()


def _task(kind: str, rev: DesignDocumentRevision, doc: DesignDocument, users: dict, comment: str | None = None) -> DesignTaskItem:
    since = rev.submitted_at if rev.status in ("in_review", "in_approval") else rev.updated_at
    if rev.status == "in_approval" and rev.reviewed_at:
        since = rev.reviewed_at
    return DesignTaskItem(
        kind=kind, document_id=doc.id, doc_number=doc.doc_number, title=doc.title, revision_id=rev.id,
        revision_label=rev.revision_label, status=rev.status, ecn_id=rev.ecn_id,
        author_name=user_name(users.get(rev.created_by_id)), comment=comment, since=since, days_waiting=days_since(since),
    )


def _ecn_task(kind: str, ecn: DesignChangeNotice, users: dict) -> DesignTaskItem:
    since = ecn.submitted_at if kind == "ecn_approve" else ecn.decided_at
    return DesignTaskItem(
        kind=kind, title=ecn.title, status=ecn.status, ecn_id=ecn.id, ecn_number=ecn.ecn_number,
        author_name=user_name(users.get(ecn.created_by_id)), since=since, days_waiting=days_since(since),
    )


def build_my_tasks(db: Session, user: User) -> DesignMyTasks:
    rows = _open_revisions(db)
    ecns = db.query(DesignChangeNotice).filter(
        DesignChangeNotice.is_deleted == False,  # noqa: E712
        DesignChangeNotice.status.in_(("submitted", "approved")),
    ).all()
    users = users_by_id(db, {r.created_by_id for r, _ in rows} | {e.created_by_id for e in ecns})
    tasks = DesignMyTasks()
    for rev, doc in rows:
        if rev.status == "in_review" and rev.reviewer_id == user.id:
            tasks.to_review.append(_task("review", rev, doc, users))
        elif rev.status == "in_approval" and rev.approver_id == user.id:
            tasks.to_approve.append(_task("approve", rev, doc, users))
        elif rev.status == "draft" and rev.created_by_id == user.id:
            if rev.returned_count:
                tasks.returned_to_me.append(_task("returned", rev, doc, users, rev.approval_comment or rev.review_comment))
            else:
                tasks.my_drafts.append(_task("draft", rev, doc, users))
    for ecn in ecns:
        if ecn.status == "submitted" and ecn.approver_id == user.id:
            tasks.ecns_to_approve.append(_ecn_task("ecn_approve", ecn, users))
        elif ecn.status == "approved" and user.id in (ecn.created_by_id, ecn.approver_id):
            tasks.ecns_to_implement.append(_ecn_task("ecn_implement", ecn, users))
    for bucket in (tasks.to_review, tasks.to_approve, tasks.returned_to_me, tasks.my_drafts, tasks.ecns_to_approve, tasks.ecns_to_implement):
        bucket.sort(key=lambda t: t.days_waiting, reverse=True)
    return tasks


@router.get("/my-tasks", response_model=DesignMyTasks)
async def my_tasks(
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
    _tab: User = Depends(require_tab_access("design", "tasks")),
):
    return build_my_tasks(db, user)


@router.get("/dashboard", response_model=DesignDashboard)
async def dashboard(
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
    _tab: User = Depends(require_tab_access("design", "dashboard")),
):
    docs = db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(
        DesignDocument.is_deleted == False  # noqa: E712
    ).all()
    statuses = [display_status(d) for d in docs]
    out = DesignDashboard(overdue_days=OVERDUE_DAYS)
    out.active_documents = sum(1 for d in docs if d.status == "active")
    out.obsolete_documents = sum(1 for d in docs if d.status == "obsolete")
    out.released_documents = sum(1 for s in statuses if s in ("released", "revising"))

    rows = _open_revisions(db)
    out.drafts = sum(1 for r, _ in rows if r.status == "draft")
    out.in_review = sum(1 for r, _ in rows if r.status == "in_review")
    out.in_approval = sum(1 for r, _ in rows if r.status == "in_approval")

    month_start = datetime.combine(date.today().replace(day=1), time.min, tzinfo=timezone.utc)
    released = db.query(DesignDocumentRevision, DesignDocument).join(
        DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id
    ).filter(
        DesignDocumentRevision.is_deleted == False,  # noqa: E712
        DesignDocument.is_deleted == False,  # noqa: E712
        DesignDocumentRevision.released_at.isnot(None),
    ).order_by(DesignDocumentRevision.released_at.desc()).all()
    out.released_this_month = sum(1 for r, _ in released if as_aware(r.released_at) >= month_start)

    out.open_ecns = db.query(DesignChangeNotice).filter(
        DesignChangeNotice.is_deleted == False,  # noqa: E712
        DesignChangeNotice.status.in_(("draft", "submitted", "approved")),
    ).count()

    tasks = build_my_tasks(db, user)
    out.my_tasks = (tasks.to_review + tasks.to_approve + tasks.returned_to_me + tasks.ecns_to_approve)[:10]
    out.waiting_on_me = len(tasks.to_review) + len(tasks.to_approve) + len(tasks.returned_to_me) + len(tasks.ecns_to_approve)

    users = users_by_id(db, {r.created_by_id for r, _ in rows} | {r.approved_by_id for r, _ in released[:8]})
    overdue = [
        _task("review" if r.status == "in_review" else "approve", r, d, users)
        for r, d in rows if r.status in ("in_review", "in_approval")
    ]
    out.overdue = sorted((t for t in overdue if t.days_waiting >= OVERDUE_DAYS), key=lambda t: t.days_waiting, reverse=True)[:10]
    out.overdue_in_workflow = sum(1 for t in overdue if t.days_waiting >= OVERDUE_DAYS)
    out.recent_releases = [
        DesignRecentRelease(
            document_id=d.id, doc_number=d.doc_number, title=d.title, revision_id=r.id, revision_label=r.revision_label,
            released_at=r.released_at, approved_by_name=user_name(users.get(r.approved_by_id)),
        )
        for r, d in released[:8]
    ]
    return out
