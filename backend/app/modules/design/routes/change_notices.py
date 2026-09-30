"""Engineering Change Notices: raise → submit → approve/reject → implement.
Approval authorises the affected documents' next revisions (raised with
ecn_id); implementation is only accepted once each affected document has a
released revision under the ECN, and then notifies Production and Store —
a notification, never an automatic BOM/stock change."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.design.models.change_notice import (
    DesignChangeNotice, DesignChangeNoticeDocument, DESIGN_ECN_PRIORITIES, DESIGN_ECN_REASONS,
)
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.event import DesignEvent
from app.modules.design.routes.documents import machine_label, validate_links
from app.modules.design.schemas.change_notice import (
    DesignChangeNoticeCancelPayload, DesignChangeNoticeCreate, DesignChangeNoticeDecisionPayload,
    DesignChangeNoticeDetail, DesignChangeNoticeDocumentPayload, DesignChangeNoticeDocumentResponse,
    DesignChangeNoticeResponse, DesignChangeNoticeUpdate,
)
from app.modules.design.schemas.event import DesignCommentPayload, DesignEventResponse
from app.modules.design.service import (
    add_event, allowed_ecn_actions, check_ecn_cancel, check_ecn_decide, check_ecn_delete, check_ecn_edit,
    check_ecn_implement, ensure, generate_ecn_number, get_workflow_user, notify, released_revision, user_name,
    users_by_id, utcnow,
)
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject
from app.utils.notifications import broadcast_notification

router = APIRouter(
    prefix="/design/change-notices", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)

_NOTIFY_ENTITY = "design_ecn"


def _get_ecn(db: Session, ecn_id: int, lock: bool = False) -> DesignChangeNotice:
    if lock:
        db.query(DesignChangeNotice.id).filter(DesignChangeNotice.id == ecn_id).with_for_update().first()
    ecn = db.query(DesignChangeNotice).options(selectinload(DesignChangeNotice.documents)).populate_existing().filter(
        DesignChangeNotice.id == ecn_id, DesignChangeNotice.is_deleted == False  # noqa: E712
    ).first()
    if not ecn:
        raise HTTPException(status_code=404, detail=f"Change notice #{ecn_id} not found — it may have been deleted.")
    return ecn


def _implementation_state(db: Session, ecn_ids: list[int]) -> dict[tuple[int, int], DesignDocumentRevision]:
    """(ecn_id, document_id) → the latest live revision raised under that ECN."""
    if not ecn_ids:
        return {}
    revs = db.query(DesignDocumentRevision).filter(
        DesignDocumentRevision.ecn_id.in_(ecn_ids), DesignDocumentRevision.is_deleted == False  # noqa: E712
    ).order_by(DesignDocumentRevision.revision_index).all()
    return {(r.ecn_id, r.document_id): r for r in revs}


def _responses(db: Session, ecns: list[DesignChangeNotice], cls=DesignChangeNoticeResponse) -> list:
    doc_ids = {d.document_id for e in ecns for d in e.documents}
    docs = {
        d.id: d for d in db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(DesignDocument.id.in_(doc_ids)).all()
    } if doc_ids else {}
    impl = _implementation_state(db, [e.id for e in ecns])
    user_ids = {u for e in ecns for u in (e.created_by_id, e.approver_id, e.decided_by_id, e.implemented_by_id)}
    user_ids |= {d.owner_id for d in docs.values()}
    users = users_by_id(db, user_ids)
    pm_ids = {e.pm_project_id for e in ecns} - {None}
    pm = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_(pm_ids)).all()} if pm_ids else {}
    erp_ids = {e.erp_project_id for e in ecns} - {None}
    machines = {p.id: p for p in db.query(Project).filter(Project.id.in_(erp_ids)).all()} if erp_ids else {}

    out = []
    for ecn in ecns:
        resp = cls.model_validate(ecn)
        resp.created_by_name = user_name(users.get(ecn.created_by_id))
        resp.approver_name = user_name(users.get(ecn.approver_id))
        resp.decided_by_name = user_name(users.get(ecn.decided_by_id))
        resp.implemented_by_name = user_name(users.get(ecn.implemented_by_id))
        project = pm.get(ecn.pm_project_id)
        resp.pm_project_label = f"{project.project_code} — {project.name}" if project else None
        resp.erp_project_label = machine_label(machines.get(ecn.erp_project_id))
        resp.documents = []
        for link in ecn.documents:
            row = DesignChangeNoticeDocumentResponse.model_validate(link)
            doc = docs.get(link.document_id)
            if doc:
                row.doc_number = doc.doc_number
                row.title = doc.title
                row.document_status = doc.status
                row.owner_name = user_name(users.get(doc.owner_id))
                released = released_revision(doc)
                row.released_revision_label = released.revision_label if released else None
            rev = impl.get((ecn.id, link.document_id))
            if rev:
                row.ecn_revision_id = rev.id
                row.ecn_revision_label = rev.revision_label
                row.implementation_status = "released" if rev.status in ("released", "superseded") else rev.status
            resp.documents.append(row)
        resp.document_count = len(resp.documents)
        resp.released_count = sum(1 for d in resp.documents if d.implementation_status == "released")
        out.append(resp)
    return out


def _detail(db: Session, ecn: DesignChangeNotice, user: User) -> DesignChangeNoticeDetail:
    ecn = _get_ecn(db, ecn.id)
    resp: DesignChangeNoticeDetail = _responses(db, [ecn], DesignChangeNoticeDetail)[0]
    events = db.query(DesignEvent).filter(DesignEvent.ecn_id == ecn.id).order_by(DesignEvent.created_at.desc(), DesignEvent.id.desc()).all()
    actors = users_by_id(db, {e.actor_id for e in events})
    doc_numbers = {d.document_id: d.doc_number for d in resp.documents}
    rev_ids = {e.revision_id for e in events} - {None}
    rev_labels = {r.id: r.revision_label for r in db.query(DesignDocumentRevision).filter(DesignDocumentRevision.id.in_(rev_ids)).all()} if rev_ids else {}
    resp.events = []
    for e in events:
        er = DesignEventResponse.model_validate(e)
        er.actor_name = user_name(actors.get(e.actor_id))
        er.doc_number = doc_numbers.get(e.document_id)
        er.revision_label = rev_labels.get(e.revision_id)
        resp.events.append(er)
    resp.allowed_actions = allowed_ecn_actions(user, ecn)
    return resp


def _validate_fields(values: dict) -> None:
    if values.get("reason") is not None and values["reason"] not in DESIGN_ECN_REASONS:
        raise HTTPException(status_code=400, detail=f"'{values['reason']}' isn't a valid reason. Choose one of: {', '.join(DESIGN_ECN_REASONS)}.")
    if values.get("priority") is not None and values["priority"] not in DESIGN_ECN_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"'{values['priority']}' isn't a valid priority. Choose one of: {', '.join(DESIGN_ECN_PRIORITIES)}.")


def _set_documents(db: Session, ecn: DesignChangeNotice, rows: list[DesignChangeNoticeDocumentPayload]) -> None:
    seen: set[int] = set()
    for row in rows:
        if row.document_id in seen:
            raise HTTPException(status_code=400, detail="The same document is listed twice on this ECN — keep one entry per document.")
        seen.add(row.document_id)
    docs = {d.id: d for d in db.query(DesignDocument).filter(DesignDocument.id.in_(seen), DesignDocument.is_deleted == False).all()} if seen else {}  # noqa: E712
    for doc_id in seen:
        doc = docs.get(doc_id)
        if not doc:
            raise HTTPException(status_code=400, detail=f"Design document #{doc_id} wasn't found — it may have been deleted. Remove it from the ECN.")
        if doc.status == "obsolete":
            raise HTTPException(status_code=400, detail=f"{doc.doc_number} is obsolete, so it can't be changed under an ECN. Remove it, or ask an admin to reactivate it.")
    ecn.documents = [
        DesignChangeNoticeDocument(document_id=row.document_id, change_description=(row.change_description or "").strip() or None)
        for row in rows
    ]


@router.get("", response_model=list[DesignChangeNoticeResponse])
async def list_change_notices(
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    document_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("design", "change_notices")),
):
    query = db.query(DesignChangeNotice).options(selectinload(DesignChangeNotice.documents)).filter(
        DesignChangeNotice.is_deleted == False  # noqa: E712
    )
    if status_filter:
        query = query.filter(DesignChangeNotice.status.in_(status_filter.split(",")))
    if priority:
        query = query.filter(DesignChangeNotice.priority.in_(priority.split(",")))
    if document_id:
        query = query.filter(DesignChangeNotice.documents.any(DesignChangeNoticeDocument.document_id == document_id))
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(DesignChangeNotice.ecn_number.ilike(like) | DesignChangeNotice.title.ilike(like) | DesignChangeNotice.description.ilike(like))
    return _responses(db, query.order_by(DesignChangeNotice.created_at.desc(), DesignChangeNotice.id.desc()).limit(1000).all())


@router.post("", response_model=DesignChangeNoticeDetail, status_code=201)
async def create_change_notice(
    payload: DesignChangeNoticeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    _validate_fields(payload.model_dump())
    validate_links(db, pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id)
    if payload.approver_id:
        if payload.approver_id == user.id:
            raise HTTPException(status_code=400, detail="You can't approve an ECN you're raising — pick someone else as approver.")
        get_workflow_user(db, payload.approver_id, "approver")
    ecn = DesignChangeNotice(
        ecn_number=generate_ecn_number(db), title=payload.title.strip(), reason=payload.reason, priority=payload.priority,
        description=payload.description, impact_assessment=payload.impact_assessment, target_date=payload.target_date,
        pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id, approver_id=payload.approver_id,
        status="draft", created_by_id=user.id,
    )
    _set_documents(db, ecn, payload.documents)
    db.add(ecn)
    db.flush()
    add_event(db, "ecn_created", user, ecn_id=ecn.id)
    db.commit()
    return _detail(db, ecn, user)


@router.get("/{ecn_id}", response_model=DesignChangeNoticeDetail)
async def get_change_notice(
    ecn_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    return _detail(db, _get_ecn(db, ecn_id), user)


@router.patch("/{ecn_id}", response_model=DesignChangeNoticeDetail)
async def update_change_notice(
    ecn_id: int,
    payload: DesignChangeNoticeUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True)
    ensure(check_ecn_edit(user, ecn))
    changes = payload.model_dump(exclude_unset=True)
    documents = changes.pop("documents", None)
    _validate_fields(changes)
    if "title" in changes and not (changes["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Title can't be empty.")
    for key in ("reason", "priority"):
        if key in changes and changes[key] is None:
            raise HTTPException(status_code=400, detail=f"{key.title()} can't be empty.")
    validate_links(db, **{k: v for k, v in changes.items() if k in ("pm_project_id", "erp_project_id")})
    if changes.get("approver_id"):
        if changes["approver_id"] == ecn.created_by_id:
            raise HTTPException(status_code=400, detail=f"The person who raised {ecn.ecn_number} can't also approve it — pick someone else.")
        get_workflow_user(db, changes["approver_id"], "approver")
    for key, value in changes.items():
        setattr(ecn, key, value.strip() if key == "title" else value)
    if documents is not None:
        _set_documents(db, ecn, payload.documents or [])
    add_event(db, "ecn_updated", user, ecn_id=ecn.id)
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/submit", response_model=DesignChangeNoticeDetail)
async def submit_change_notice(
    ecn_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True)
    ensure(check_ecn_edit(user, ecn))
    if not ecn.documents:
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number} doesn't list any affected documents. Add the drawings/documents this change touches before submitting.")
    if not ecn.approver_id:
        raise HTTPException(status_code=400, detail=f"Name an approver before submitting {ecn.ecn_number}.")
    if ecn.approver_id == ecn.created_by_id:
        raise HTTPException(status_code=400, detail=f"The person who raised {ecn.ecn_number} can't also approve it — pick someone else.")
    get_workflow_user(db, ecn.approver_id, "approver")
    obsolete = db.query(DesignDocument.doc_number).filter(
        DesignDocument.id.in_([d.document_id for d in ecn.documents]), DesignDocument.status == "obsolete"
    ).all()
    if obsolete:
        raise HTTPException(status_code=400, detail=f"{', '.join(n for (n,) in obsolete)} became obsolete since this ECN was drafted. Remove them before submitting.")
    ecn.status = "submitted"
    ecn.submitted_at = utcnow()
    add_event(db, "ecn_submitted", user, ecn_id=ecn.id)
    notify(
        db, ecn.approver_id, user, f"ECN approval needed: {ecn.ecn_number}",
        f"{user_name(user)} raised {ecn.ecn_number} ({ecn.title}) affecting {len(ecn.documents)} document(s) — it needs your decision.",
        "design_ecn_submitted", _NOTIFY_ENTITY, ecn.id,
    )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/approve", response_model=DesignChangeNoticeDetail)
async def approve_change_notice(
    ecn_id: int,
    payload: DesignChangeNoticeDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True)
    approver = db.query(User).filter(User.id == ecn.approver_id).first() if ecn.approver_id else None
    ensure(check_ecn_decide(user, ecn, approver))
    ecn.status = "approved"
    ecn.decided_by_id = user.id
    ecn.decided_at = utcnow()
    ecn.decision_comment = (payload.comment or "").strip() or None
    add_event(db, "ecn_approved", user, ecn_id=ecn.id, comment=ecn.decision_comment)
    notify(
        db, ecn.created_by_id, user, f"ECN approved: {ecn.ecn_number}",
        f"{user_name(user)} approved {ecn.ecn_number}. Raise the new revisions of the affected documents under it.",
        "design_ecn_approved", _NOTIFY_ENTITY, ecn.id,
    )
    owners = {
        o for (o,) in db.query(DesignDocument.owner_id).filter(DesignDocument.id.in_([d.document_id for d in ecn.documents])).all()
    } - {ecn.created_by_id}
    for owner_id in owners:
        notify(
            db, owner_id, user, f"Revision needed under {ecn.ecn_number}",
            f"{ecn.ecn_number} ({ecn.title}) was approved and affects a document you own — start its next revision under this ECN.",
            "design_ecn_approved", _NOTIFY_ENTITY, ecn.id,
        )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/reject", response_model=DesignChangeNoticeDetail)
async def reject_change_notice(
    ecn_id: int,
    payload: DesignChangeNoticeDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True)
    approver = db.query(User).filter(User.id == ecn.approver_id).first() if ecn.approver_id else None
    ensure(check_ecn_decide(user, ecn, approver))
    comment = (payload.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail=f"Give a reason for rejecting {ecn.ecn_number} — the person who raised it sees it.")
    ecn.status = "rejected"
    ecn.decided_by_id = user.id
    ecn.decided_at = utcnow()
    ecn.decision_comment = comment
    add_event(db, "ecn_rejected", user, ecn_id=ecn.id, comment=comment)
    notify(
        db, ecn.created_by_id, user, f"ECN rejected: {ecn.ecn_number}",
        f"{user_name(user)} rejected {ecn.ecn_number}: {comment}",
        "design_ecn_rejected", _NOTIFY_ENTITY, ecn.id,
    )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/implement", response_model=DesignChangeNoticeDetail)
async def implement_change_notice(
    ecn_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True)
    ensure(check_ecn_implement(user, ecn))
    detail = _responses(db, [ecn])[0]
    pending = [d for d in detail.documents if d.implementation_status != "released"]
    if pending:
        listing = "; ".join(
            f"{d.doc_number} ({'no revision raised yet' if d.implementation_status == 'pending' else d.ecn_revision_label + ' is ' + d.implementation_status.replace('_', ' ')})"
            for d in pending
        )
        raise HTTPException(
            status_code=409,
            detail=f"{ecn.ecn_number} can't be marked implemented yet — these documents don't have a released revision under it: {listing}.",
        )
    ecn.status = "implemented"
    ecn.implemented_by_id = user.id
    ecn.implemented_at = utcnow()
    add_event(db, "ecn_implemented", user, ecn_id=ecn.id)
    changed = ", ".join(f"{d.doc_number} {d.ecn_revision_label}" for d in detail.documents)
    notify(
        db, ecn.created_by_id, user, f"ECN implemented: {ecn.ecn_number}",
        f"{user_name(user)} marked {ecn.ecn_number} implemented ({changed}).",
        "design_ecn_implemented", _NOTIFY_ENTITY, ecn.id,
    )
    # Downstream teams usually don't hold the Design app, so no deep link —
    # the message itself says what changed and what to check.
    for app_name, what in (("production", "BOMs and routings"), ("store", "item masters and stock")):
        broadcast_notification(
            db, f"Engineering change released: {ecn.ecn_number}",
            f"{ecn.ecn_number} ({ecn.title}) is implemented — new controlled revisions: {changed}. Check affected {what}.",
            "design_ecn_implemented", None, None, exclude_user_id=user.id, app_name=app_name,
        )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/cancel", response_model=DesignChangeNoticeDetail)
async def cancel_change_notice(
    ecn_id: int,
    payload: DesignChangeNoticeCancelPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True)
    ensure(check_ecn_cancel(user, ecn))
    was_submitted = ecn.status == "submitted"
    ecn.status = "cancelled"
    ecn.cancelled_at = utcnow()
    ecn.cancel_reason = payload.reason.strip()
    add_event(db, "ecn_cancelled", user, ecn_id=ecn.id, comment=ecn.cancel_reason)
    if was_submitted:
        notify(
            db, ecn.approver_id, user, f"ECN cancelled: {ecn.ecn_number}",
            f"{user_name(user)} cancelled {ecn.ecn_number} — no decision is needed from you.",
            "design_ecn_cancelled", _NOTIFY_ENTITY, ecn.id,
        )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/comments", response_model=DesignChangeNoticeDetail)
async def comment_change_notice(
    ecn_id: int,
    payload: DesignCommentPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id)
    add_event(db, "comment", user, ecn_id=ecn.id, comment=payload.comment)
    db.commit()
    return _detail(db, ecn, user)


@router.delete("/{ecn_id}")
async def delete_change_notice(
    ecn_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True)
    ensure(check_ecn_delete(user, ecn))
    ecn.is_deleted = True
    ecn.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{ecn.ecn_number} deleted"}
