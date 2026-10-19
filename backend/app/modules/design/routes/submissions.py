"""Customer drawing approval: a submission (transmittal) of approved drawing
revisions → sent → the customer's response per drawing. Approval lets the
Design head release the revision; rejection freezes it as
customer_rejected so the fix goes out as the next revision. Customer
comments become action items for designers."""
from datetime import date, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import ensure_can_delete, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.crm.models.organization import Organization
from app.modules.design.order_project_links import on_customer_approval
from app.modules.design.access import get_settings, head_ids, is_head, next_number, require_head, require_team, year_prefix
from app.modules.design.files import remove_file, store_file, stream_file
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.event import DesignEvent
from app.modules.design.models.submission import (
    DesignCustomerSubmission, DesignSubmissionComment, DesignSubmissionLine, DESIGN_CUSTOMER_RESPONSES,
)
from app.modules.design.routes.documents import machine_label, validate_links
from app.modules.design.schemas.event import DesignEventResponse
from app.modules.design.schemas.submission import (
    DesignCustomerSubmissionCreate, DesignCustomerSubmissionDetail, DesignCustomerSubmissionResponse,
    DesignCustomerSubmissionUpdate, DesignSubmissionCancelPayload, DesignSubmissionCommentClosePayload,
    DesignSubmissionCommentCreate, DesignSubmissionCommentResponse, DesignSubmissionLineResponse,
    DesignSubmissionResponsePayload, DesignSubmissionSendPayload,
)
from app.modules.design.service import (
    add_event, ensure, ensure_assignee_rule, get_workflow_user, may_delete, notify, user_name, users_by_id, utcnow, Denied, is_admin,
)
from app.modules.erp.models.project import Project
from app.modules.design.scope import apply_scope, ensure_in_scope
from app.modules.design.events import notify_design_event
from app.modules.design.features import ensure_design_feature, gate_actions, has
from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject
from app.utils.sharepoint import sanitize_folder_name

router = APIRouter(
    prefix="/design/submissions", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)

_NOTIFY_ENTITY = "design_submission"
# "Assign to" rule for customer comment actions (core/features/design.py).
COMMENT_RULE = "design:reviews.comment_actions"
_OPEN = ("draft", "sent")


def _get(db: Session, submission_id: int, lock: bool = False, user: User | None = None) -> DesignCustomerSubmission:
    if lock:
        db.query(DesignCustomerSubmission.id).filter(DesignCustomerSubmission.id == submission_id).with_for_update().first()
    sub = db.query(DesignCustomerSubmission).options(selectinload(DesignCustomerSubmission.lines)).populate_existing().filter(
        DesignCustomerSubmission.id == submission_id, DesignCustomerSubmission.is_deleted == False  # noqa: E712
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail=f"Customer submission #{submission_id} not found — it may have been deleted.")
    if user is not None:
        ensure_in_scope(db, user, sub)
    return sub


def _phrase(sub: DesignCustomerSubmission) -> str:
    return {"draft": "still a draft", "sent": "with the customer", "closed": "closed", "cancelled": "cancelled"}.get(sub.status, sub.status)


def check_edit(user: User, sub: DesignCustomerSubmission, head: bool) -> Denied | None:
    if sub.status != "draft":
        return Denied(409, f"{sub.submission_number} is {_phrase(sub)}, so its drawings and details can't be changed.")
    if not (head or user.id == sub.created_by_id):
        return Denied(403, f"Only the Design head or the person who prepared {sub.submission_number} can change it.")
    return None


def check_send(user: User, sub: DesignCustomerSubmission, head: bool) -> Denied | None:
    if sub.status != "draft":
        return Denied(409, f"{sub.submission_number} is {_phrase(sub)} — only a draft can be sent.")
    if not head:
        return Denied(403, "Only the Design head sends drawings to the customer.")
    return None


def check_record(user: User, sub: DesignCustomerSubmission, head: bool) -> Denied | None:
    if sub.status != "sent":
        return Denied(409, f"{sub.submission_number} is {_phrase(sub)} — responses are recorded on a sent submission.")
    if not head:
        return Denied(403, "Only the Design head records the customer's response.")
    return None


def check_cancel(user: User, sub: DesignCustomerSubmission, head: bool) -> Denied | None:
    if sub.status not in _OPEN:
        return Denied(409, f"{sub.submission_number} is {_phrase(sub)} — only a draft or sent submission can be cancelled.")
    if not (head or user.id == sub.created_by_id):
        return Denied(403, f"Only the Design head or the person who prepared {sub.submission_number} can cancel it.")
    return None


def allowed_actions(user: User, sub: DesignCustomerSubmission, head: bool) -> list[str]:
    out = ["comment"]
    if not check_edit(user, sub, head):
        out.append("edit")
        if may_delete(user, sub, "documents"):
            out.append("delete")
    if not check_send(user, sub, head):
        out.append("send")
    if not check_record(user, sub, head):
        out.append("record_response")
    if not check_cancel(user, sub, head):
        out.append("cancel")
    if sub.status in ("sent", "closed") and head:
        out.append("upload_letter")
    return out


def _responses(db: Session, subs: list[DesignCustomerSubmission], cls=DesignCustomerSubmissionResponse) -> list:
    rev_ids = {line.revision_id for s in subs for line in s.lines}
    revs = {r.id: r for r in db.query(DesignDocumentRevision).filter(DesignDocumentRevision.id.in_(rev_ids)).all()} if rev_ids else {}
    doc_ids = {line.document_id for s in subs for line in s.lines}
    docs = {d.id: d for d in db.query(DesignDocument).filter(DesignDocument.id.in_(doc_ids)).all()} if doc_ids else {}
    users = users_by_id(db, {s.created_by_id for s in subs})
    pm_ids = {s.pm_project_id for s in subs} - {None}
    pms = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_(pm_ids)).all()} if pm_ids else {}
    erp_ids = {s.erp_project_id for s in subs} - {None}
    machines = {p.id: p for p in db.query(Project).filter(Project.id.in_(erp_ids)).all()} if erp_ids else {}
    open_comments: dict[int, int] = {}
    if subs:
        for (sid,) in db.query(DesignSubmissionComment.submission_id).filter(
            DesignSubmissionComment.submission_id.in_([s.id for s in subs]), DesignSubmissionComment.status == "open"
        ).all():
            open_comments[sid] = open_comments.get(sid, 0) + 1
    today = date.today()
    out = []
    for sub in subs:
        resp = cls.model_validate(sub)
        resp.lines = []
        for line in sub.lines:
            lr = DesignSubmissionLineResponse.model_validate(line)
            doc, rev = docs.get(line.document_id), revs.get(line.revision_id)
            lr.doc_number = doc.doc_number if doc else None
            lr.title = doc.title if doc else None
            lr.revision_label = rev.revision_label if rev else None
            lr.revision_status = rev.status if rev else None
            resp.lines.append(lr)
        resp.created_by_name = user_name(users.get(sub.created_by_id))
        pm = pms.get(sub.pm_project_id)
        resp.pm_project_label = f"{pm.project_code} — {pm.name}" if pm else None
        resp.erp_project_label = machine_label(machines.get(sub.erp_project_id))
        if sub.status == "sent" and sub.sent_date:
            resp.days_waiting = (today - sub.sent_date).days
            resp.is_overdue = bool(sub.response_due_date and today > sub.response_due_date)
        if sub.sent_date and sub.response_date:
            resp.turnaround_days = (sub.response_date - sub.sent_date).days
        resp.open_comments = open_comments.get(sub.id, 0)
        out.append(resp)
    return out


def _detail(db: Session, sub: DesignCustomerSubmission, user: User) -> DesignCustomerSubmissionDetail:
    sub = _get(db, sub.id)
    resp: DesignCustomerSubmissionDetail = _responses(db, [sub], DesignCustomerSubmissionDetail)[0]
    comments = db.query(DesignSubmissionComment).filter(DesignSubmissionComment.submission_id == sub.id).order_by(DesignSubmissionComment.id).all()
    users = users_by_id(db, {c.assigned_to_id for c in comments} | {c.closed_by_id for c in comments})
    doc_numbers = {line.document_id: line.doc_number for line in resp.lines}
    resp.comments = []
    for c in comments:
        cr = DesignSubmissionCommentResponse.model_validate(c)
        cr.doc_number = doc_numbers.get(c.document_id)
        cr.assigned_to_name = user_name(users.get(c.assigned_to_id))
        cr.closed_by_name = user_name(users.get(c.closed_by_id))
        resp.comments.append(cr)
    events = db.query(DesignEvent).filter(DesignEvent.submission_id == sub.id).order_by(DesignEvent.created_at.desc(), DesignEvent.id.desc()).all()
    actors = users_by_id(db, {e.actor_id for e in events})
    resp.events = []
    for e in events:
        er = DesignEventResponse.model_validate(e)
        er.actor_name = user_name(actors.get(e.actor_id))
        er.doc_number = doc_numbers.get(e.document_id)
        resp.events.append(er)
    if not has(user, "reviews", "comment_actions"):
        resp.comments = []
    resp.allowed_actions = gate_actions(user, "reviews", allowed_actions(user, sub, is_head(db, user)))
    return resp


def _validate_lines(db: Session, sub: DesignCustomerSubmission, revision_ids: list[int]) -> dict[int, DesignDocumentRevision]:
    if len(set(revision_ids)) != len(revision_ids):
        raise HTTPException(status_code=400, detail="The same drawing revision is listed twice — keep one line per revision.")
    revs = {
        r.id: r for r in db.query(DesignDocumentRevision).filter(
            DesignDocumentRevision.id.in_(revision_ids), DesignDocumentRevision.is_deleted == False  # noqa: E712
        ).all()
    } if revision_ids else {}
    docs = {d.id: d for d in db.query(DesignDocument).filter(DesignDocument.id.in_({r.document_id for r in revs.values()})).all()} if revs else {}
    seen_docs: set[int] = set()
    for rid in revision_ids:
        rev = revs.get(rid)
        if not rev:
            raise HTTPException(status_code=400, detail=f"Revision #{rid} wasn't found — it may have been discarded. Remove it from the submission.")
        doc = docs[rev.document_id]
        ref_ = f"{doc.doc_number} {rev.revision_label}"
        if rev.status != "approved":
            raise HTTPException(
                status_code=400,
                detail=f"{ref_} is {rev.status.replace('_', ' ')} — only revisions approved internally and waiting on the customer can be submitted. "
                       "Tick 'Customer approval required' on the drawing and take it through check and approval first.",
            )
        if doc.id in seen_docs:
            raise HTTPException(status_code=400, detail=f"{doc.doc_number} is listed twice — send one revision per drawing.")
        seen_docs.add(doc.id)
        clash = db.query(DesignCustomerSubmission.submission_number).join(
            DesignSubmissionLine, DesignSubmissionLine.submission_id == DesignCustomerSubmission.id
        ).filter(
            DesignSubmissionLine.revision_id == rid, DesignCustomerSubmission.status.in_(_OPEN),
            DesignCustomerSubmission.is_deleted == False, DesignCustomerSubmission.id != (sub.id or 0),  # noqa: E712
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"{ref_} is already on submission {clash[0]}, which is still open. Finish or cancel that one first.")
    return revs


def _set_lines(db: Session, sub: DesignCustomerSubmission, revision_ids: list[int]) -> None:
    revs = _validate_lines(db, sub, revision_ids)
    sub.lines = [DesignSubmissionLine(document_id=revs[rid].document_id, revision_id=rid, response="pending") for rid in revision_ids]


def _customer_name(db: Session, customer_id: int | None, given: str | None) -> str:
    if customer_id:
        org = db.query(Organization).filter(Organization.id == customer_id, Organization.is_deleted == False).first()  # noqa: E712
        if not org:
            raise HTTPException(status_code=400, detail=f"Customer #{customer_id} wasn't found in CRM organizations.")
        return org.name
    name = (given or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Pick the customer from CRM, or type the customer's name.")
    return name


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[DesignCustomerSubmissionResponse])
async def list_submissions(
    status_filter: str | None = Query(None, alias="status"),
    customer_id: int | None = None,
    pm_project_id: int | None = None,
    overdue: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("design", "reviews")),
):
    # Submissions carry drawings not yet released plus customer correspondence
    # — Design team only (viewers see released drawings only).
    require_team(db, _tab, "see customer submissions")
    ensure_design_feature(_tab, "reviews", "customer_submissions", "view")
    query = db.query(DesignCustomerSubmission).options(selectinload(DesignCustomerSubmission.lines)).filter(
        DesignCustomerSubmission.is_deleted == False  # noqa: E712
    )
    query = apply_scope(query, _tab, DesignCustomerSubmission)
    if status_filter:
        query = query.filter(DesignCustomerSubmission.status.in_(status_filter.split(",")))
    if customer_id:
        query = query.filter(DesignCustomerSubmission.customer_id == customer_id)
    if pm_project_id:
        query = query.filter(DesignCustomerSubmission.pm_project_id == pm_project_id)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(DesignCustomerSubmission.submission_number.ilike(like) | DesignCustomerSubmission.customer_name.ilike(like))
    rows = _responses(db, query.order_by(DesignCustomerSubmission.created_at.desc(), DesignCustomerSubmission.id.desc()).limit(1000).all())
    return [r for r in rows if r.is_overdue] if overdue else rows


@router.post("", response_model=DesignCustomerSubmissionDetail, status_code=201)
async def create_submission(payload: DesignCustomerSubmissionCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "prepare customer submissions")
    ensure_design_feature(user, "reviews", "customer_submissions", "create")
    validate_links(db, pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id)
    sub = DesignCustomerSubmission(
        submission_number=next_number(db, DesignCustomerSubmission.submission_number, year_prefix("TRN")),
        customer_id=payload.customer_id, customer_name=_customer_name(db, payload.customer_id, payload.customer_name),
        contact_name=payload.contact_name, contact_email=payload.contact_email, pm_project_id=payload.pm_project_id,
        erp_project_id=payload.erp_project_id, cover_note=payload.cover_note, status="draft", created_by_id=user.id,
    )
    db.add(sub)
    db.flush()
    _set_lines(db, sub, [line.revision_id for line in payload.lines])
    add_event(db, "submission_created", user, submission_id=sub.id)
    db.commit()
    return _detail(db, sub, user)


@router.get("/{submission_id}", response_model=DesignCustomerSubmissionDetail)
async def get_submission(submission_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "see customer submissions")
    ensure_design_feature(user, "reviews", "customer_submissions", "view")
    return _detail(db, _get(db, submission_id, user=user), user)


@router.patch("/{submission_id}", response_model=DesignCustomerSubmissionDetail)
async def update_submission(submission_id: int, payload: DesignCustomerSubmissionUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "reviews", "customer_submissions", "edit")
    sub = _get(db, submission_id, lock=True, user=user)
    ensure(check_edit(user, sub, is_head(db, user)))
    changes = payload.model_dump(exclude_unset=True)
    lines = changes.pop("lines", None)
    validate_links(db, **{k: v for k, v in changes.items() if k in ("pm_project_id", "erp_project_id")})
    if "customer_id" in changes or "customer_name" in changes:
        cid = changes.get("customer_id", sub.customer_id)
        changes["customer_name"] = _customer_name(db, cid, changes.get("customer_name", sub.customer_name))
    for key, value in changes.items():
        setattr(sub, key, value)
    if lines is not None:
        _set_lines(db, sub, [line.revision_id for line in payload.lines or []])
    add_event(db, "submission_updated", user, submission_id=sub.id)
    db.commit()
    return _detail(db, sub, user)


@router.delete("/{submission_id}")
async def delete_submission(submission_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    sub = _get(db, submission_id, lock=True, user=user)
    # The Reviews tab declares no 'delete' action; a customer submission is a
    # bundle of drawings, so the Documents tab's delete permission governs it.
    ensure_can_delete(user, sub, "design", "documents", what="customer submission")
    ensure_design_feature(user, "reviews", "customer_submissions", "edit")
    ensure(check_edit(user, sub, is_head(db, user)))
    sub.is_deleted, sub.deleted_at = True, utcnow()
    db.commit()
    return {"message": f"{sub.submission_number} deleted"}


@router.post("/{submission_id}/send", response_model=DesignCustomerSubmissionDetail)
async def send_submission(submission_id: int, payload: DesignSubmissionSendPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "reviews", "customer_submissions", "submit")
    sub = _get(db, submission_id, lock=True, user=user)
    ensure(check_send(user, sub, is_head(db, user)))
    if not sub.lines:
        raise HTTPException(status_code=400, detail=f"{sub.submission_number} has no drawings. Add the approved drawing revisions before sending it.")
    _validate_lines(db, sub, [line.revision_id for line in sub.lines])  # still approved, not on another open submission
    sent = payload.sent_date or date.today()
    if sent > date.today():
        raise HTTPException(status_code=400, detail="The sent date can't be in the future.")
    sub.status, sub.sent_date, sub.sent_by_id = "sent", sent, user.id
    sub.response_due_date = sent + timedelta(days=get_settings(db).customer_response_days)
    add_event(db, "submission_sent", user, submission_id=sub.id, comment=f"Response due {sub.response_due_date:%d-%m-%Y}")
    for line in sub.lines:
        add_event(db, "sent_to_customer", user, document_id=line.document_id, revision_id=line.revision_id,
                  comment=f"{sub.submission_number} to {sub.customer_name}")
    db.commit()
    return _detail(db, sub, user)


@router.post("/{submission_id}/response", response_model=DesignCustomerSubmissionDetail)
async def record_response(submission_id: int, payload: DesignSubmissionResponsePayload, background_tasks: BackgroundTasks,
                          db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "reviews", "customer_response", "edit")
    sub = _get(db, submission_id, lock=True, user=user)
    ensure(check_record(user, sub, is_head(db, user)))
    if payload.response_date > date.today():
        raise HTTPException(status_code=400, detail="The response date can't be in the future.")
    if sub.sent_date and payload.response_date < sub.sent_date:
        raise HTTPException(status_code=400, detail=f"The response date is before the date it was sent ({sub.sent_date:%d-%m-%Y}).")
    lines = {line.id: line for line in sub.lines}
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Record the customer's verdict for at least one drawing.")
    revs = {r.id: r for r in db.query(DesignDocumentRevision).filter(DesignDocumentRevision.id.in_([line.revision_id for line in sub.lines])).all()}
    docs = {d.id: d for d in db.query(DesignDocument).filter(DesignDocument.id.in_([line.document_id for line in sub.lines])).all()}
    approved, rejected, approved_doc_ids = [], [], []
    for row in payload.lines:
        line = lines.get(row.line_id)
        if not line:
            raise HTTPException(status_code=400, detail=f"Line #{row.line_id} isn't on {sub.submission_number}. Reload and try again.")
        if row.response not in DESIGN_CUSTOMER_RESPONSES or row.response == "pending":
            raise HTTPException(status_code=400, detail=f"'{row.response}' isn't a customer verdict. Use Approved, Approved with comments or Rejected.")
        if line.response != "pending":
            continue  # already recorded; responses are final
        comment = (row.comment or "").strip() or None
        doc, rev = docs[line.document_id], revs[line.revision_id]
        ref_ = f"{doc.doc_number} {rev.revision_label}"
        if row.response in ("approved_with_comments", "rejected") and not comment:
            raise HTTPException(status_code=400, detail=f"Write down the customer's comments for {ref_} — the designer needs them for the next revision.")
        line.response, line.response_comment = row.response, comment
        if row.response == "rejected":
            if rev.status == "approved":
                rev.status = "customer_rejected"
            rejected.append(ref_)
            add_event(db, "customer_rejected", user, document_id=doc.id, revision_id=rev.id, comment=f"{sub.submission_number}: {comment}")
            for recipient in {rev.created_by_id, doc.owner_id}:
                notify(db, recipient, user, f"Customer rejected {ref_}",
                       f"{sub.customer_name} rejected {ref_} on {sub.submission_number}: {comment}. Start the next revision to address it.",
                       "design_customer_rejected", "design_document", doc.id)
        else:
            approved.append(ref_)
            approved_doc_ids.append(doc.id)
            add_event(db, "customer_approved", user, document_id=doc.id, revision_id=rev.id,
                      comment=f"{sub.submission_number}" + (f": {comment}" if comment else ""))
            for recipient in {rev.approver_id, doc.owner_id, *head_ids(db)}:
                notify(db, recipient, user, f"Customer approved {ref_}",
                       f"{sub.customer_name} approved {ref_}" + (" with comments" if comment else "") + " — it can now be released.",
                       "design_customer_approved", "design_document", doc.id)
            if comment:
                db.add(DesignSubmissionComment(
                    submission_id=sub.id, document_id=doc.id, comment=comment, assigned_to_id=doc.owner_id or rev.created_by_id,
                    status="open", created_by_id=user.id,
                ))
    sub.response_date = payload.response_date
    sub.response_remarks = (payload.remarks or "").strip() or sub.response_remarks
    sub.recorded_by_id = user.id
    if all(line.response != "pending" for line in sub.lines):
        sub.status = "closed"
    summary = "; ".join(x for x in (f"approved {', '.join(approved)}" if approved else "", f"rejected {', '.join(rejected)}" if rejected else "") if x)
    add_event(db, "customer_response", user, submission_id=sub.id, comment=summary or None)
    # The heads (and each drawing's author / owner / approver) got direct per-drawing notices above.
    told = set(head_ids(db))
    notify_design_event(
        db, background_tasks, "customer_response_recorded", sub, entity_type=_NOTIFY_ENTITY, actor=user, team_only=True,
        title=f"Customer response: {sub.submission_number}",
        message=f"{user_name(user)} recorded {sub.customer_name}'s response to {sub.submission_number}"
                + (f" — {summary}." if summary else "."),
        skip=told,
    )
    if approved_doc_ids:
        # Order Projects whose drawings are now all customer-approved: the
        # order's drawing-approval billing milestone falls due.
        db.flush()
        on_customer_approval(db, approved_doc_ids, on=payload.response_date, actor=user)
    db.commit()
    return _detail(db, sub, user)


@router.post("/{submission_id}/cancel", response_model=DesignCustomerSubmissionDetail)
async def cancel_submission(submission_id: int, payload: DesignSubmissionCancelPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "reviews", "customer_submissions", "cancel")
    sub = _get(db, submission_id, lock=True, user=user)
    ensure(check_cancel(user, sub, is_head(db, user)))
    if any(line.response != "pending" for line in sub.lines):
        raise HTTPException(status_code=409, detail=f"The customer has already answered part of {sub.submission_number}, so it can't be cancelled — record the remaining responses instead.")
    sub.status, sub.cancel_reason = "cancelled", payload.reason.strip()
    add_event(db, "submission_cancelled", user, submission_id=sub.id, comment=sub.cancel_reason)
    db.commit()
    return _detail(db, sub, user)


@router.post("/{submission_id}/letter", response_model=DesignCustomerSubmissionDetail)
async def upload_letter(submission_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    sub = _get(db, submission_id, user=user)
    require_head(db, user, "attach the customer's letter")
    ensure_design_feature(user, "reviews", "customer_response", "edit")
    if sub.status not in ("sent", "closed"):
        raise HTTPException(status_code=409, detail=f"{sub.submission_number} is {_phrase(sub)} — attach the customer's letter once it has been sent.")
    old = sub.letter_path
    stored = await store_file(f"Design-media/Submissions/{sanitize_folder_name(sub.submission_number)}", file)
    sub.letter_file_name, sub.letter_path, sub.letter_size = stored["name"], stored["path"], stored["size"]
    add_event(db, "letter_attached", user, submission_id=sub.id, comment=stored["name"])
    db.commit()
    if old and old != stored["path"]:
        await remove_file(old)
    return _detail(db, sub, user)


@router.get("/{submission_id}/letter")
async def get_letter(submission_id: int, download: bool = False, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "see customer submissions")
    ensure_design_feature(user, "reviews", "customer_submissions", "view")
    sub = _get(db, submission_id, user=user)
    return await stream_file(sub.letter_path, sub.letter_file_name or "letter", download)


@router.post("/{submission_id}/comments", response_model=DesignCustomerSubmissionDetail)
async def add_action(submission_id: int, payload: DesignSubmissionCommentCreate, background_tasks: BackgroundTasks,
                     db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """A customer comment as an action item for a designer."""
    sub = _get(db, submission_id, user=user)
    require_team(db, user, "add customer comment actions")
    ensure_design_feature(user, "reviews", "comment_actions", "create")
    if payload.document_id and payload.document_id not in {line.document_id for line in sub.lines}:
        raise HTTPException(status_code=400, detail=f"That drawing isn't on {sub.submission_number}.")
    if payload.assigned_to_id:
        get_workflow_user(db, payload.assigned_to_id, "assignee")
        ensure_assignee_rule(db, user, COMMENT_RULE, payload.assigned_to_id)
    db.add(DesignSubmissionComment(
        submission_id=sub.id, document_id=payload.document_id, comment=payload.comment.strip(),
        assigned_to_id=payload.assigned_to_id, status="open", created_by_id=user.id,
    ))
    add_event(db, "comment", user, submission_id=sub.id, document_id=payload.document_id, comment=payload.comment)
    notify(db, payload.assigned_to_id, user, f"Customer comment to address: {sub.submission_number}",
           f"{user_name(user)} assigned you a customer comment from {sub.customer_name}: {payload.comment.strip()[:200]}",
           "design_customer_comment", _NOTIFY_ENTITY, sub.id)
    notify_design_event(
        db, background_tasks, "comment_action_added", sub, entity_type=_NOTIFY_ENTITY, actor=user, team_only=True,
        title=f"Customer comment action: {sub.submission_number}",
        message=f"{user_name(user)} logged a customer comment from {sub.customer_name} as an action: {payload.comment.strip()[:200]}",
        skip={payload.assigned_to_id},
    )
    db.commit()
    return _detail(db, sub, user)


@router.post("/comments/{comment_id}/close", response_model=DesignCustomerSubmissionDetail)
async def close_action(comment_id: int, payload: DesignSubmissionCommentClosePayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "reviews", "comment_actions", "edit")
    c = db.query(DesignSubmissionComment).filter(DesignSubmissionComment.id == comment_id).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Customer comment #{comment_id} not found.")
    if c.status != "open":
        raise HTTPException(status_code=409, detail="This comment is already closed.")
    if not (user.id == c.assigned_to_id or is_head(db, user) or is_admin(user)):
        raise HTTPException(status_code=403, detail="Only the designer it's assigned to or the Design head can close this comment.")
    c.status, c.resolution, c.closed_by_id, c.closed_at = "done", payload.resolution.strip(), user.id, utcnow()
    add_event(db, "comment_closed", user, submission_id=c.submission_id, document_id=c.document_id, comment=c.resolution)
    db.commit()
    return _detail(db, _get(db, c.submission_id, user=user), user)
