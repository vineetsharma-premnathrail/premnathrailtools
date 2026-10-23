"""Design landing page KPIs and the "My Tasks" queue."""
from datetime import date, datetime, time, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.core.record_ref import encode_ref
from app.db.session import get_db
from app.modules.design.access import get_settings, is_head, role_of, team_roles
from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.design.models.change_notice import DesignChangeNotice, DesignEcnAcknowledgement
from app.modules.design.models.change_request import DesignChangeRequest
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.request import DesignRequest, DESIGN_REQUEST_ACTIVE_STATUSES
from app.modules.design.models.submission import DesignCustomerSubmission, DesignSubmissionComment, DesignSubmissionLine
from app.modules.projects.models.task import PmProjectTask, PM_TASK_OPEN_STATUSES
from app.modules.design.schemas.dashboard import DesignDashboard, DesignMyTasks, DesignRecentRelease, DesignTaskItem
from app.modules.design.service import OVERDUE_DAYS, as_aware, days_since, display_status, user_name, users_by_id
from app.modules.design.scope import apply_scope
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/design", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)


def _open_revisions(db: Session, user: User | None = None) -> list[tuple[DesignDocumentRevision, DesignDocument]]:
    """Open revisions; limited to `user`'s data scope when given (dashboard
    counts — the My Tasks queue is the user's own work and isn't scoped)."""
    query = db.query(DesignDocumentRevision, DesignDocument).join(
        DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id
    )
    if user is not None:
        query = apply_scope(query, user, DesignDocument)
    return query.filter(
        DesignDocumentRevision.is_deleted == False,  # noqa: E712
        DesignDocument.is_deleted == False,  # noqa: E712
        DesignDocumentRevision.status.in_(("draft", "in_review", "in_approval", "approved")),
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


def _bom_task(kind: str, rev: DesignBomRevision, bom: DesignBom, users: dict, comment: str | None = None) -> DesignTaskItem:
    since = rev.reviewed_at if rev.status == "in_approval" and rev.reviewed_at else (rev.submitted_at if rev.status != "draft" else rev.updated_at)
    return DesignTaskItem(
        kind=kind, bom_id=bom.id, bom_number=bom.bom_number, title=bom.title, revision_label=rev.revision_label,
        status=rev.status, author_name=user_name(users.get(rev.created_by_id)), comment=comment, since=since,
        days_waiting=days_since(since), link=f"/dashboard/design/boms/{encode_ref(bom.id)}",
    )


def _extend_my_tasks(db: Session, user: User, tasks: DesignMyTasks) -> None:
    """BOM checks, ECR votes/decisions, ECN acknowledgements, releases after
    customer approval and customer comments assigned to me."""
    from app.modules.design.routes.change_notices import can_acknowledge

    rows = db.query(DesignBomRevision, DesignBom).join(DesignBom, DesignBom.id == DesignBomRevision.bom_id).filter(
        DesignBomRevision.is_deleted == False, DesignBom.is_deleted == False,  # noqa: E712
        DesignBomRevision.status.in_(("draft", "in_review", "in_approval")),
    ).all()
    users = users_by_id(db, {r.created_by_id for r, _ in rows})
    for rev, bom in rows:
        if rev.status == "in_review" and rev.reviewer_id == user.id:
            tasks.boms_to_review.append(_bom_task("bom_review", rev, bom, users))
        elif rev.status == "in_approval" and rev.approver_id == user.id:
            tasks.boms_to_approve.append(_bom_task("bom_approve", rev, bom, users))
        elif rev.status == "draft" and rev.created_by_id == user.id and rev.returned_count:
            tasks.boms_returned_to_me.append(_bom_task("bom_returned", rev, bom, users, rev.approval_comment or rev.review_comment))

    head = is_head(db, user)
    for ecr in db.query(DesignChangeRequest).filter(
        DesignChangeRequest.is_deleted == False, DesignChangeRequest.status.in_(("open", "impact_checked"))  # noqa: E712
    ).all():
        item = DesignTaskItem(kind="ecr", ecr_id=ecr.id, ecr_number=ecr.ecr_number, title=ecr.title, status=ecr.status,
                              since=ecr.created_at, days_waiting=days_since(ecr.created_at), link=f"/dashboard/design/change-requests/{encode_ref(ecr.id)}")
        voted = {v.user_id for v in ecr.votes}
        if ecr.status == "impact_checked" and user.id in (ecr.board_member_ids or []) and user.id not in voted:
            tasks.ecrs_to_vote.append(item.model_copy(update={"kind": "ecr_vote"}))
        elif head and (ecr.status == "open" or set(ecr.board_member_ids or []) <= voted):
            tasks.ecrs_to_decide.append(item.model_copy(update={"kind": "ecr_impact" if ecr.status == "open" else "ecr_decide"}))

    pending_acks = db.query(DesignEcnAcknowledgement, DesignChangeNotice).join(
        DesignChangeNotice, DesignChangeNotice.id == DesignEcnAcknowledgement.ecn_id
    ).filter(DesignEcnAcknowledgement.acknowledged_at.is_(None), DesignChangeNotice.is_deleted == False).all()  # noqa: E712
    rights: dict[str, bool] = {}
    for ack, ecn in pending_acks:
        if ack.department not in rights:
            rights[ack.department] = can_acknowledge(db, user, ack.department)
        if rights[ack.department]:
            tasks.ecns_to_acknowledge.append(DesignTaskItem(
                kind="ecn_acknowledge", ecn_id=ecn.id, ecn_number=ecn.ecn_number, title=f"{ecn.title} ({ack.department})",
                status=ecn.status, since=ecn.implemented_at, days_waiting=days_since(ecn.implemented_at),
                link=f"/dashboard/design/change-notices/{encode_ref(ecn.id)}",
            ))

    approved = db.query(DesignDocumentRevision, DesignDocument).join(DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id).join(
        DesignSubmissionLine, DesignSubmissionLine.revision_id == DesignDocumentRevision.id
    ).filter(
        DesignDocumentRevision.status == "approved", DesignDocumentRevision.is_deleted == False,  # noqa: E712
        DesignDocument.is_deleted == False,  # noqa: E712
        DesignSubmissionLine.response.in_(("approved", "approved_with_comments")),
    ).all()
    seen: set[int] = set()  # a revision sent on several submissions is one release task
    for rev, doc in approved:
        if rev.id not in seen and (head or rev.approver_id == user.id):
            seen.add(rev.id)
            tasks.to_release.append(_task("release", rev, doc, {}, "Customer approved — release it"))

    for c, sub in db.query(DesignSubmissionComment, DesignCustomerSubmission).join(
        DesignCustomerSubmission, DesignCustomerSubmission.id == DesignSubmissionComment.submission_id
    ).filter(
        DesignSubmissionComment.status == "open", DesignSubmissionComment.assigned_to_id == user.id,
        DesignCustomerSubmission.is_deleted == False,  # noqa: E712
    ).all():
        tasks.customer_comments.append(DesignTaskItem(
            kind="customer_comment", submission_id=sub.id, title=c.comment[:140], status="open",
            comment=f"{sub.submission_number} — {sub.customer_name}", since=c.created_at, days_waiting=days_since(c.created_at),
            link=f"/dashboard/design/reviews/submissions/{encode_ref(sub.id)}",
        ))
    for bucket in (tasks.boms_to_review, tasks.boms_to_approve, tasks.boms_returned_to_me, tasks.ecrs_to_vote,
                   tasks.ecrs_to_decide, tasks.ecns_to_acknowledge, tasks.to_release, tasks.customer_comments):
        bucket.sort(key=lambda t: t.days_waiting, reverse=True)


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
        elif rev.status == "approved":
            continue  # waiting on the customer, not on a person here
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
    _extend_my_tasks(db, user, tasks)
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
    docs = apply_scope(db.query(DesignDocument).options(selectinload(DesignDocument.revisions)), user, DesignDocument).filter(
        DesignDocument.is_deleted == False  # noqa: E712
    ).all()
    statuses = [display_status(d) for d in docs]
    overdue_days = get_settings(db).review_overdue_days or OVERDUE_DAYS
    out = DesignDashboard(overdue_days=overdue_days)
    out.my_role = role_of(db, user)
    out.active_documents = sum(1 for d in docs if d.status == "active")
    out.obsolete_documents = sum(1 for d in docs if d.status == "obsolete")
    out.released_documents = sum(1 for s in statuses if s in ("released", "revising"))

    rows = _open_revisions(db, user)
    out.drafts = sum(1 for r, _ in rows if r.status == "draft")
    out.in_review = sum(1 for r, _ in rows if r.status == "in_review")
    out.in_approval = sum(1 for r, _ in rows if r.status == "in_approval")

    month_start = datetime.combine(date.today().replace(day=1), time.min, tzinfo=timezone.utc)
    released = apply_scope(db.query(DesignDocumentRevision, DesignDocument).join(
        DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id
    ), user, DesignDocument).filter(
        DesignDocumentRevision.is_deleted == False,  # noqa: E712
        DesignDocument.is_deleted == False,  # noqa: E712
        DesignDocumentRevision.released_at.isnot(None),
    ).order_by(DesignDocumentRevision.released_at.desc()).all()
    out.released_this_month = sum(1 for r, _ in released if as_aware(r.released_at) >= month_start)

    out.open_ecns = apply_scope(db.query(DesignChangeNotice), user, DesignChangeNotice).filter(
        DesignChangeNotice.is_deleted == False,  # noqa: E712
        DesignChangeNotice.status.in_(("draft", "submitted", "approved")),
    ).count()

    tasks = build_my_tasks(db, user)
    waiting = (
        tasks.to_review + tasks.to_approve + tasks.returned_to_me + tasks.ecns_to_approve + tasks.boms_to_review
        + tasks.boms_to_approve + tasks.boms_returned_to_me + tasks.ecrs_to_vote + tasks.ecrs_to_decide
        + tasks.ecns_to_acknowledge + tasks.to_release + tasks.customer_comments
    )
    out.my_tasks = sorted(waiting, key=lambda t: t.days_waiting, reverse=True)[:12]
    out.waiting_on_me = len(waiting)

    users = users_by_id(db, {r.created_by_id for r, _ in rows} | {r.approved_by_id for r, _ in released[:8]})
    overdue = [
        _task("review" if r.status == "in_review" else "approve", r, d, users)
        for r, d in rows if r.status in ("in_review", "in_approval")
    ]
    # BOM revisions stuck with their checker/approver count too.
    bom_rows = apply_scope(db.query(DesignBomRevision, DesignBom).join(DesignBom, DesignBom.id == DesignBomRevision.bom_id), user, DesignBom).filter(
        DesignBomRevision.is_deleted == False, DesignBom.is_deleted == False,  # noqa: E712
        DesignBomRevision.status.in_(("in_review", "in_approval")),
    ).all()
    bom_users = users_by_id(db, {r.created_by_id for r, _ in bom_rows})
    overdue += [
        _bom_task("bom_review" if r.status == "in_review" else "bom_approve", r, b, bom_users) for r, b in bom_rows
    ]
    out.overdue = sorted((t for t in overdue if t.days_waiting >= overdue_days), key=lambda t: t.days_waiting, reverse=True)[:10]
    out.overdue_in_workflow = sum(1 for t in overdue if t.days_waiting >= overdue_days)
    out.recent_releases = [
        DesignRecentRelease(
            document_id=d.id, doc_number=d.doc_number, title=d.title, revision_id=r.id, revision_label=r.revision_label,
            released_at=r.released_at, approved_by_name=user_name(users.get(r.approved_by_id)),
        )
        for r, d in released[:8]
    ]
    _phase_two_to_four(db, user, out)
    return out


def _phase_two_to_four(db: Session, user: User, out: DesignDashboard) -> None:
    today = date.today()
    reqs = apply_scope(db.query(DesignRequest), user, DesignRequest).filter(DesignRequest.is_deleted == False, DesignRequest.status.in_(DESIGN_REQUEST_ACTIVE_STATUSES)).all()  # noqa: E712
    out.requests_waiting = sum(1 for r in reqs if r.waiting_on == "design")
    out.requests_overdue = sum(1 for r in reqs if r.due_date and r.due_date < today)

    my_tasks = db.query(PmProjectTask).filter(PmProjectTask.assignee_id == user.id, PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES)).all()
    out.my_pm_tasks_due = sum(1 for t in my_tasks if t.due_date and 0 <= (t.due_date - today).days <= 7)
    out.my_pm_tasks_overdue = sum(1 for t in my_tasks if t.due_date and t.due_date < today)

    boms = apply_scope(db.query(DesignBomRevision.status).join(DesignBom, DesignBom.id == DesignBomRevision.bom_id), user, DesignBom).filter(
        DesignBomRevision.is_deleted == False, DesignBom.is_deleted == False  # noqa: E712
    ).all()
    out.boms_in_workflow = sum(1 for (st,) in boms if st in ("in_review", "in_approval"))
    out.released_boms = sum(1 for (st,) in boms if st == "released")

    subs = apply_scope(db.query(DesignCustomerSubmission), user, DesignCustomerSubmission).filter(DesignCustomerSubmission.is_deleted == False, DesignCustomerSubmission.status == "sent").all()  # noqa: E712
    out.customer_pending = len(subs)
    out.customer_overdue = sum(1 for s in subs if s.response_due_date and s.response_due_date < today)
    ages = [(today - s.sent_date).days for s in subs if s.sent_date]
    out.oldest_customer_days = max(ages) if ages else 0
    out.customer_pending_list = [
        {"id": s.id, "submission_number": s.submission_number, "customer_name": s.customer_name,
         "days_waiting": (today - s.sent_date).days if s.sent_date else 0,
         "overdue": bool(s.response_due_date and s.response_due_date < today)}
        for s in sorted(subs, key=lambda s: s.sent_date or today)[:8]
    ]
    out.open_ecrs = apply_scope(db.query(DesignChangeRequest), user, DesignChangeRequest).filter(
        DesignChangeRequest.is_deleted == False, DesignChangeRequest.status.in_(("open", "impact_checked"))  # noqa: E712
    ).count()
    out.ecns_awaiting_ack = apply_scope(db.query(DesignChangeNotice), user, DesignChangeNotice).filter(DesignChangeNotice.is_deleted == False, DesignChangeNotice.status == "implemented").count()  # noqa: E712

    # Team workload: open PM tasks and open drafts per team member.
    roles = team_roles(db)
    member_ids = set(roles)
    if not member_ids:
        return
    people = users_by_id(db, member_ids)
    open_tasks = db.query(PmProjectTask).filter(PmProjectTask.assignee_id.in_(member_ids), PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES)).all()
    drafts = db.query(DesignDocumentRevision.created_by_id).filter(
        DesignDocumentRevision.created_by_id.in_(member_ids), DesignDocumentRevision.status == "draft", DesignDocumentRevision.is_deleted == False  # noqa: E712
    ).all()
    reviews = db.query(DesignDocumentRevision.reviewer_id).filter(
        DesignDocumentRevision.reviewer_id.in_(member_ids), DesignDocumentRevision.status == "in_review", DesignDocumentRevision.is_deleted == False  # noqa: E712
    ).all()
    for uid in member_ids:
        mine = [t for t in open_tasks if t.assignee_id == uid]
        out.workload.append({
            "user_id": uid, "name": user_name(people.get(uid)), "role": roles[uid],
            "open_tasks": len(mine), "overdue_tasks": sum(1 for t in mine if t.due_date and t.due_date < today),
            "drafts": sum(1 for (u,) in drafts if u == uid), "to_check": sum(1 for (u,) in reviews if u == uid),
        })
    out.workload.sort(key=lambda w: (-(w["open_tasks"] + w["drafts"] + w["to_check"]), w["name"] or ""))
