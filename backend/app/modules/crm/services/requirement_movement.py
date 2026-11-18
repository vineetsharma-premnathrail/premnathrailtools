"""Requirement Movement — the history of a CRM requirement being sent to R&D.

Each successful "Send Technical Requirement to R&D" writes one AuditLog row
(entity_type "<module>_tor") with a snapshot of exactly what R&D received:
the requirement fields printed on the TOR PDF, the generated PDF document and
any client documents attached. The Requirement Movement tab reads these back
in order and diffs each send against the previous one, so the BD owner can see
what changed between the first request and every re-send.

The send itself stays an AuditLog row (an audit trail of an outbound send).
The two-way part — who in R&D owns the answer, by when, and what they replied —
lives in CrmRndRequest (one per send), linked back via movement_log_id.
"""
import json
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.rnd_request import CrmRndRequest, CrmRndRequestQuery
from app.utils.notifications import notify_user

IST = ZoneInfo("Asia/Kolkata")
RESPONSE_DOC_CATEGORY = "rnd_response"
QUERY_DOC_SUB_MODULE = "rnd_query"   # files BD attaches to its reply to an R&D question

ACTION = "technical_offer_sent"
# A send's log row that a same-revision correction replaced (kept for the audit trail, no longer listed as a send).
CORRECTED_ACTION = "technical_offer_sent_corrected"

CHANGE_REASONS = ("customer_changed", "bd_correction", "other")
CHANGE_REASON_LABELS = {
    "customer_changed": "Customer changed the requirement",
    "bd_correction": "BD corrected what was sent",
    "other": "Other reason",
}
ANSWER_CHANNELS = ("portal", "phone", "email", "meeting")
MIN_NOTE = 10

# Requirement fields captured from the TOR PDF context, in display order.
SNAPSHOT_FIELDS: dict[str, str] = {
    "org_name": "Customer Organization",
    "product": "Product",
    "product_category": "Category",
    "quantity_display": "Quantity",
    "product_spec": "Specification",
    "project_details": "Project Details",
}


def _entity_type(module: str) -> str:
    return f"{module}_tor"


def record_movement(
    db: Session, *, module: str, record_id: int, user: User, offer_number: str | None,
    ctx: dict, tor_doc: CrmDocument | None, reference_docs: list[CrmDocument],
) -> AuditLog:
    """Call after the TOR email went out successfully, before commit. `tor_doc` is None
    since 2026-10-30 (no Technical Offer document); older sends still carry one."""
    payload = {
        "offer_number": offer_number,
        "snapshot": {k: ctx.get(k) for k in SNAPSHOT_FIELDS},
        "requirements": customer_requirements(ctx),
        "tor_document": {"id": tor_doc.id, "name": tor_doc.file_name, "file_size": tor_doc.file_size} if tor_doc else None,
        "reference_documents": [{"id": d.id, "name": d.file_name, "file_size": d.file_size} for d in reference_docs],
    }
    log = AuditLog(
        entity_type=_entity_type(module), entity_id=record_id, action=ACTION,
        new_value=json.dumps(payload, default=str), module_key="crm",
        summary=f"{user.name or user.email} sent the requirement to R&D" + (f" as {offer_number}." if offer_number else "."),
        performed_by_id=user.id,
    )
    db.add(log)
    db.flush()
    return log


def customer_requirements(ctx: dict) -> list[str]:
    """Every Customer Requirement text on the record (first product + each '+' product),
    whitespace-normalised, so a re-send can be compared with the last one."""
    texts = [ctx.get("product_spec"), *((it or {}).get("product_spec") for it in ctx.get("additional_items") or [])]
    return [" ".join(str(t).split()) for t in texts if t and str(t).strip()]


def rnd_work_started(db: Session, *, module: str, record_id: int) -> list[str]:
    """What R&D already did on this requirement: tasks (any but cancelled), files it
    uploaded (requirement-level or on a task), technical offers it drafted. Empty =
    R&D has not started, so BD may still take the requirement back."""
    from app.modules.rnd.models.requirement_work import RndRequirementTask
    from app.modules.rnd.models.technical_offer import RndTechnicalOffer

    out: list[str] = []
    tasks = db.query(RndRequirementTask.id).filter(
        RndRequirementTask.source == module, RndRequirementTask.record_id == record_id,
        RndRequirementTask.status != "cancelled").count()
    if tasks:
        out.append(f"{tasks} R&D task{'s' if tasks != 1 else ''}")
    docs = db.query(CrmDocument.id).filter(
        CrmDocument.related_module == module, CrmDocument.related_id == record_id,
        CrmDocument.related_sub_module.in_(("rnd_requirement", "rnd_task")), CrmDocument.is_deleted == False).count()  # noqa: E712
    if docs:
        out.append(f"{docs} document{'s' if docs != 1 else ''} uploaded by R&D")
    offers = db.query(RndTechnicalOffer.id).filter(
        RndTechnicalOffer.source == module, RndTechnicalOffer.record_id == record_id).count()
    if offers:
        out.append(f"{offers} technical offer{'s' if offers != 1 else ''}")
    return out


def take_back_on_move_back(db: Session, *, module: str, record, user: User, reason: str | None, label: str) -> str | None:
    """BD moved the record's status / stage back while R&D still holds the requirement
    (owner, 2026-11-03): the requirement is taken back from R&D — but only while R&D has
    not started (no tasks, no uploaded documents, no technical offer); otherwise the
    move back is refused. Returns a timeline note when something was taken back.
    Caller commits."""
    req = db.query(CrmRndRequest).filter(
        CrmRndRequest.source == module, CrmRndRequest.record_id == record.id,
    ).order_by(CrmRndRequest.id.desc()).first()
    if req is None or req.status != "open":
        return None
    ref = req.offer_number or record.technical_offer_number or "the R&D requirement"
    work = rnd_work_started(db, module=module, record_id=record.id)
    if work:
        raise HTTPException(status_code=409, detail=(
            f"This {label} can't move back: R&D has already started on {ref} ({', '.join(work)}). "
            f"Let R&D finish and respond, or ask the R&D head to close the request without a response — then move the {label} back."))
    from app.modules.rnd.services import requirements as rnd_requirements
    why = (reason or "").strip() or f"{label} moved back"
    req.status = "withdrawn"
    req.response_remarks = f"Taken back by BD: {why}"
    req.responded_by_id = user.id
    req.responded_at = datetime.now(timezone.utc)
    rnd_requirements.on_withdrawn(db, req, user)
    # Off R&D › Requirements (the list is every record with a send date); a later send re-opens it as the next revision.
    record.technical_offer_sent_at = None
    who = user.name or user.email
    db.add(AuditLog(
        entity_type=module, entity_id=record.id, action="rnd_withdrawn", module_key="crm",
        summary=f"{who} took {ref} back from R&D ({label} moved back): {why}", performed_by_id=user.id,
    ))
    for head in rnd_team(db):
        if head.id != user.id:
            notify_user(
                db, head.id, title=f"{ref} taken back by BD",
                message=f"{who} moved {label} {record.universal_id} back, so {ref} is no longer with R&D: {why} "
                        "Nothing is needed from R&D unless BD sends it again.",
                notification_type="rnd_request_withdrawn", entity_type=module, entity_id=record.id,
            )
    return f"{ref} taken back from R&D"


def ensure_requirement_changed(db: Session, *, module: str, record, ctx: dict) -> None:
    """A requirement goes to R&D again only when its Customer Requirement changed
    since the last send (owner, 2026-10-31) — nothing else re-opens it for R&D.
    Exception: R&D closed the last request without a response ("nothing to share");
    BD may then send the same requirement again when R&D work turns out to be needed."""
    latest = db.query(CrmRndRequest).filter(
        CrmRndRequest.source == module, CrmRndRequest.record_id == record.id,
    ).order_by(CrmRndRequest.id.desc()).first()
    if latest is not None and latest.status in ("closed", "withdrawn"):
        return
    last = db.query(AuditLog).filter(
        AuditLog.entity_type == _entity_type(module), AuditLog.entity_id == record.id, AuditLog.action == ACTION,
    ).order_by(AuditLog.performed_at.desc(), AuditLog.id.desc()).first()
    if not last:
        return
    data = json.loads(last.new_value) if last.new_value else {}
    # Sends before 2026-10-31 stored only the first product's requirement.
    prev = data.get("requirements")
    if prev is None:
        spec = (data.get("snapshot") or {}).get("product_spec")
        prev, now = ([" ".join(str(spec).split())] if spec else []), customer_requirements(ctx)[:1]
    else:
        now = customer_requirements(ctx)
    if prev == now:
        sent = last.performed_at.astimezone(IST).strftime("%d %b %Y") if last.performed_at else "earlier"
        ref = data.get("offer_number")
        how = ("use Change requirement on the R&D tab to send the new text as a new revision with a reason"
               if module == "inquiry" else "click Edit, update the requirement, save, then send")
        raise HTTPException(status_code=409, detail=(
            f"R&D already has this Customer Requirement (sent{f' as {ref}' if ref else ''} on {sent}). "
            f"Send it again only after the customer's requirement changes: {how}. "
            f"Other changes (dates, documents, remarks, status) don't need a new send to R&D."))


def reason_text(change_reason: str | None, change_note: str | None) -> str:
    """"Customer changed the requirement — <note>" for notices and the timeline."""
    label = CHANGE_REASON_LABELS.get(change_reason or "", change_reason or "")
    note = (change_note or "").strip()
    return f"{label} — {note}" if note and label else (label or note)


def has_earlier_send(db: Session, *, module: str, record_id: int) -> bool:
    return db.query(CrmRndRequest.id).filter(
        CrmRndRequest.source == module, CrmRndRequest.record_id == record_id).first() is not None


def check_change_reason(
    db: Session, *, module: str, record_id: int, change_reason: str | None, change_note: str | None,
) -> tuple[str | None, str | None]:
    """A re-send must say why the requirement goes to R&D again (owner, 2026-11-17). Required
    whenever an earlier send exists for the record; 'other' also needs a note. On the first
    send nothing is asked and nothing is stored. Run BEFORE any change is made."""
    if not has_earlier_send(db, module=module, record_id=record_id):
        return None, None
    note = (change_note or "").strip() or None
    if change_reason not in CHANGE_REASONS:
        raise HTTPException(status_code=422, detail=(
            "Say why this requirement goes to R&D again — pick \"Customer changed the requirement\", "
            "\"BD corrected what was sent\" or \"Other\" as the reason, so R&D knows what to expect."))
    if change_reason == "other" and (not note or len(note) < MIN_NOTE):
        raise HTTPException(status_code=422, detail=(
            f"Write the reason for sending this to R&D again (at least {MIN_NOTE} characters) — "
            "e.g. \"Drawing revision received from the customer\"."))
    return change_reason, note


def diff_snapshots(prev: dict, snap: dict) -> list[dict]:
    """Fields that differ between two sends' snapshots, in display order."""
    return [
        {"field": k, "label": label, "old": prev.get(k), "new": snap.get(k)}
        for k, label in SNAPSHOT_FIELDS.items() if (prev.get(k) or None) != (snap.get(k) or None)
    ]


def list_movements(db: Session, *, module: str, record) -> list[dict]:
    """Oldest-first list of sends, each with the changes since the previous send."""
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == _entity_type(module), AuditLog.entity_id == record.id,
        AuditLog.action == ACTION,
    ).order_by(AuditLog.performed_at.asc(), AuditLog.id.asc()).all()

    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"

    # Sends made before this history existed left no snapshot — surface the
    # last one from the record itself so the tab isn't empty for old leads.
    if not logs and record.technical_offer_sent_at:
        tor_doc = db.query(CrmDocument).filter(
            CrmDocument.related_module == module, CrmDocument.related_id == record.id,
            CrmDocument.doc_category.in_(["technical_offer_request", "Technical Offer Request"]),
            CrmDocument.shared_via_tor == True, CrmDocument.is_deleted == False,  # noqa: E712
        ).order_by(CrmDocument.id.desc()).first()
        return [{
            "id": 0, "sequence": 1, "offer_number": record.technical_offer_number,
            "sent_by": tor_doc.uploaded_by_name if tor_doc else None,
            "sent_at": _iso(record.technical_offer_sent_at),
            "snapshot": [], "changes": [], "reference_documents": [],
            "tor_document": {"id": tor_doc.id, "name": tor_doc.file_name, "file_size": tor_doc.file_size} if tor_doc else None,
            "legacy": True, "rnd_request": None,
        }]

    req_by_log = {
        r.movement_log_id: r for r in db.query(CrmRndRequest).filter(
            CrmRndRequest.movement_log_id.in_([log.id for log in logs]),
        ).all()
    } if logs else {}
    req_json = serialize_requests(db, list(req_by_log.values()))

    result: list[dict] = []
    prev: dict | None = None
    for seq, log in enumerate(logs, start=1):
        data = json.loads(log.new_value) if log.new_value else {}
        snap = data.get("snapshot") or {}
        changes = diff_snapshots(prev, snap) if prev is not None else []
        result.append({
            "id": log.id, "sequence": seq, "offer_number": data.get("offer_number"),
            "sent_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "sent_at": _iso(log.performed_at),
            "snapshot": [{"field": k, "label": label, "value": snap.get(k)} for k, label in SNAPSHOT_FIELDS.items()],
            "changes": changes,
            "tor_document": data.get("tor_document"),
            "reference_documents": data.get("reference_documents") or [],
            "legacy": False,
            "rnd_request": req_json.get(req_by_log[log.id].id) if log.id in req_by_log else None,
        })
        prev = snap
    return result


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


# ── CRM ↔ R&D channel ──────────────────────────────────────────────────────

def today_ist() -> date:
    return datetime.now(IST).date()


def rnd_team(db: Session) -> list[User]:
    """Who a new request goes to: the R&D head(s) from Organization › Department, R&D head.
    They accept or return it and hand out tasks. With no R&D head set, the
    admins only — never every R&D user (2026-11-03)."""
    from app.modules.rnd.services.requirement_access import heads  # rnd imports crm models
    return heads(db)


def validate_request(db: Session, due_date: date | None) -> list[User]:
    """Run BEFORE the PDF upload / email so a bad request never half-sends. Returns the R&D team."""
    if not due_date:
        raise HTTPException(status_code=400, detail="Set the Response Due Date — the date R&D must reply by.")
    if due_date < today_ist():
        raise HTTPException(status_code=400, detail=f"Response Due Date {due_date.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    team = rnd_team(db)
    if not team:
        raise HTTPException(
            status_code=400,
            detail="Nobody could receive this request: no active R&D head is set (Organization › Department, R&D department › Head) "
                   "and there is no active admin to receive it instead. Ask an admin to set the R&D department head, then send again.",
        )
    return team


def create_rnd_request(
    db: Session, *, module: str, record, user: User, log: AuditLog, offer_number: str | None,
    team: list[User], due_date: date, remarks: str | None,
    change_reason: str | None = None, change_note: str | None = None,
) -> CrmRndRequest:
    """Opens the R&D ask for this send (to the R&D head(s)); any still-open ask on the same record is superseded.

    Same transaction: R&D's intake record gets its R&D ID (first send) and a new
    revision (rnd/services/requirements.on_bd_submit). The heads and the roles
    subscribed to "New requirement received" get a bell notice (no Teams) that
    names the R&D ID and the due date; the sender is never told."""
    db.query(CrmRndRequest).filter(
        CrmRndRequest.source == module, CrmRndRequest.record_id == record.id, CrmRndRequest.status == "open",
    ).update({CrmRndRequest.status: "superseded"}, synchronize_session=False)
    req = CrmRndRequest(
        source=module, record_id=record.id, movement_log_id=log.id, offer_number=offer_number,
        assigned_to_id=None, due_date=due_date, crm_remarks=(remarks or "").strip() or None,
        requested_by_id=user.id, status="open",
    )
    db.add(req)
    db.flush()
    from app.modules.rnd.services import events as rnd_events
    from app.modules.rnd.services import requirements as rnd_requirements  # rnd imports crm models
    revision = rnd_requirements.on_bd_submit(
        db, source=module, record=record, user=user, crm_request=req, movement_log=log,
        change_reason=change_reason, change_note=change_note)
    if not offer_number:
        # No separate TOR number (owner, 2026-10-30): the send is known by its R&D revision code.
        offer_number = revision.revision_code
        req.offer_number = offer_number
        data = json.loads(log.new_value) if log.new_value else {}
        data["offer_number"] = offer_number
        log.new_value = json.dumps(data, default=str)
        log.summary = f"{user.name or user.email} sent the requirement to R&D as {offer_number}."
    told: set[int] = set()
    for member in team:
        if member.id == user.id or member.id in told:
            continue
        told.add(member.id)
        notify_user(
            db, member.id,
            title=f"New requirement {revision.revision_code} for R&D",
            message=f"{user.name or user.email} sent {revision.revision_code} — response due {due_date.strftime('%d %b %Y')}. "
                    "Open it in R&D › Requirements and accept it."
                    + (f" Reason: {reason_text(change_reason, change_note)}." if change_reason and revision.revision_no > 0 else "")
                    + (f" Remark: {req.crm_remarks}" if req.crm_remarks else ""),
            notification_type="rnd_request_assigned", entity_type=f"rnd_req_{module}", entity_id=record.id,
        )
    # Role-based notice (Organization › Roles › Notifications) to R&D roles
    # subscribed to "New requirement received" — the heads above are already told.
    rnd_events.tor_received(db, source=module, record=record, offer_number=offer_number, due_date=due_date,
                            actor=user, skip_user_ids={m.id for m in team}, rd_number=revision.revision_code)
    return req


def is_late(req: CrmRndRequest, waiting_on_bd: bool = False, excused: bool = False) -> bool:
    """`waiting_on_bd`: R&D's clock is paused while BD owes an answer. `excused`: R&D answered after
    the due date only because it had waited on BD (it recorded BD's answer and gave no delay reason)."""
    if waiting_on_bd or excused:
        return False
    if req.status == "closed":
        return False  # nothing was delivered, so there is no late delivery
    if req.responded_at:
        return req.responded_at.astimezone(IST).date() > req.due_date
    return req.status == "open" and today_ist() > req.due_date


def serialize_requests(db: Session, reqs: list[CrmRndRequest]) -> dict[int, dict]:
    if not reqs:
        return {}
    user_ids = {i for r in reqs for i in (r.assigned_to_id, r.requested_by_id, r.responded_by_id) if i}
    names = {u.id: (u.name or u.email or f"User #{u.id}") for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    docs: dict[int, list[dict]] = {}
    for d in db.query(CrmDocument).filter(
        CrmDocument.related_sub_module == "rnd_request", CrmDocument.related_sub_id.in_([r.id for r in reqs]),
        CrmDocument.is_deleted == False,  # noqa: E712
    ).order_by(CrmDocument.id.asc()).all():
        docs.setdefault(d.related_sub_id, []).append({"id": d.id, "name": d.file_name, "file_size": d.file_size})
    # R&D intake state of each send (R&D ID, revision, who reviewed / why it was returned).
    from app.modules.rnd.models.requirement import RndRequirement, RndRequirementRevision
    revs = {rv.crm_rnd_request_id: rv for rv in db.query(RndRequirementRevision).filter(
        RndRequirementRevision.crm_rnd_request_id.in_([r.id for r in reqs])).all()}
    rd_numbers = {rq.id: rq.rd_number for rq in db.query(RndRequirement).filter(
        RndRequirement.id.in_({rv.requirement_id for rv in revs.values()})).all()} if revs else {}
    # R&D's "Ask BD for more details" questions (they leave the request open), oldest first.
    query_rows = db.query(CrmRndRequestQuery).filter(
        CrmRndRequestQuery.request_id.in_([r.id for r in reqs]),
    ).order_by(CrmRndRequestQuery.asked_at.asc(), CrmRndRequestQuery.id.asc()).all()
    queries: dict[int, list[CrmRndRequestQuery]] = {}
    for q in query_rows:
        queries.setdefault(q.request_id, []).append(q)
    query_docs: dict[int, list[dict]] = {}
    if query_rows:
        for d in db.query(CrmDocument).filter(
            CrmDocument.related_sub_module == QUERY_DOC_SUB_MODULE, CrmDocument.related_sub_id.in_([q.id for q in query_rows]),
            CrmDocument.is_deleted == False,  # noqa: E712
        ).order_by(CrmDocument.id.asc()).all():
            query_docs.setdefault(d.related_sub_id, []).append({"id": d.id, "name": d.file_name, "file_size": d.file_size})
    people_ids = {i for q in query_rows for i in (q.asked_by_id, q.answered_by_id) if i}
    reviewer_ids = {rv.reviewed_by_id for rv in revs.values() if rv.reviewed_by_id} | people_ids | {rv.corrected_by_id for rv in revs.values() if rv.corrected_by_id}
    names.update({u.id: (u.name or u.email or f"User #{u.id}") for u in db.query(User).filter(User.id.in_(reviewer_ids)).all()} if reviewer_ids else {})

    def waiting(r: CrmRndRequest) -> bool:
        return r.status == "open" and any(q.answer is None for q in queries.get(r.id, []))

    def excused(r: CrmRndRequest) -> bool:
        # Responded after the due date with no delay reason can only be the "BD told R&D" path (a late
        # response otherwise demands a reason), where the waiting time doesn't count against R&D.
        return r.status == "responded" and not r.delay_reason and any(q.answered_side == "rnd" for q in queries.get(r.id, []))

    def intake(r: CrmRndRequest) -> dict:
        rv = revs.get(r.id)
        if rv is None:
            return {"rd_number": None, "revision_no": None, "revision_code": None, "review_status": None, "review_remarks": None,
                    "return_reason": None, "reviewed_by": None, "reviewed_at": None,
                    "change_reason": None, "change_note": None, "corrected_at": None}
        return {
            "rd_number": rd_numbers.get(rv.requirement_id), "revision_no": rv.revision_no, "revision_code": rv.revision_code,
            "review_status": rv.status, "review_remarks": rv.review_remarks, "return_reason": rv.return_reason,
            "reviewed_by": names.get(rv.reviewed_by_id) if rv.reviewed_by_id else None, "reviewed_at": _iso(rv.reviewed_at),
            "change_reason": rv.change_reason, "change_note": rv.change_note, "corrected_at": _iso(rv.corrected_at),
        }

    return {
        r.id: {
            **intake(r),
            "id": r.id, "status": r.status, "offer_number": r.offer_number,
            "assigned_to_id": r.assigned_to_id, "assigned_to": names.get(r.assigned_to_id),
            "due_date": r.due_date.isoformat() if r.due_date else None,
            "crm_remarks": r.crm_remarks,
            "requested_by": names.get(r.requested_by_id) if r.requested_by_id else None,
            "requested_at": _iso(r.created_at),
            "response_remarks": r.response_remarks, "delay_reason": r.delay_reason,
            "responded_by": names.get(r.responded_by_id) if r.responded_by_id else None,
            "responded_at": _iso(r.responded_at),
            "is_late": is_late(r, waiting(r), excused(r)),
            "waiting_on": "bd" if waiting(r) else None,
            "response_documents": docs.get(r.id, []),
            "queries": [{
                "id": q.id, "remarks": q.question, "asked_by": names.get(q.asked_by_id) if q.asked_by_id else None,
                "asked_at": _iso(q.asked_at), "answer": q.answer, "answer_channel": q.answer_channel,
                "answered_by": names.get(q.answered_by_id) if q.answered_by_id else None, "answered_at": _iso(q.answered_at),
                "answered_side": q.answered_side,
                "due_date_before": q.due_date_before.isoformat() if q.due_date_before else None,
                "due_date_after": q.due_date_after.isoformat() if q.due_date_after else None,
                "answer_documents": query_docs.get(q.id, []),
            } for q in queries.get(r.id, [])],
        }
        for r in reqs
    }


def latest_requests(db: Session, module: str, record_ids: list[int]) -> dict[int, dict]:
    """record id -> serialized latest R&D ask, for list views."""
    if not record_ids:
        return {}
    latest: dict[int, CrmRndRequest] = {}
    for r in db.query(CrmRndRequest).filter(
        CrmRndRequest.source == module, CrmRndRequest.record_id.in_(record_ids),
    ).order_by(CrmRndRequest.id.asc()).all():
        latest[r.record_id] = r
    ser = serialize_requests(db, list(latest.values()))
    return {rid: ser[r.id] for rid, r in latest.items()}


ASK_DETAILS_ACTION = "rnd_asked_details"
ANSWER_ACTION = "rnd_query_answered"


def unanswered_query(db: Session, request_id: int) -> CrmRndRequestQuery | None:
    """The question BD still owes an answer on (at most one at a time), oldest first."""
    return db.query(CrmRndRequestQuery).filter(
        CrmRndRequestQuery.request_id == request_id, CrmRndRequestQuery.answer.is_(None),
    ).order_by(CrmRndRequestQuery.asked_at.asc(), CrmRndRequestQuery.id.asc()).first()


def _day(d: date | datetime | None) -> str:
    if isinstance(d, datetime):
        d = d.astimezone(IST).date()
    return d.strftime("%d %b %Y") if d else "—"


def ask_details(db: Session, *, req: CrmRndRequest, record, user: User, remarks: str | None) -> None:
    """R&D asks BD for more details (owner, 2026-10-30). Unlike a response it does NOT close
    the request: it stays open, but R&D's clock is paused (waiting_on = 'bd') until BD replies on
    the same request ("Reply to R&D", answer_query) or R&D records what BD told it outside the
    portal (mark_responded). One open question at a time. Caller commits."""
    if req.status != "open":
        raise HTTPException(status_code=409, detail="This request is no longer open — only an open request can get a question. Answer the latest request instead.")
    from app.modules.rnd.services import requirements as rnd_requirements
    rnd_requirements.require_accepted_for_request(db, req)
    if req.assigned_to_id and user.role != "admin" and req.assigned_to_id != user.id:
        raise HTTPException(status_code=403, detail="Only the engineer this request is assigned to can ask BD about it.")
    remarks = (remarks or "").strip()
    if len(remarks) < 10:
        raise HTTPException(status_code=400, detail="Write which details R&D needs from BD (at least 10 characters) — e.g. \"Axle load and gauge are missing\".")
    pending = unanswered_query(db, req.id)
    if pending is not None:
        raise HTTPException(status_code=409, detail=(
            f"BD has not answered R&D's earlier question yet (asked {_day(pending.asked_at)}: \"{pending.question}\"). "
            "Wait for BD's reply on the R&D tab — or, if BD already told you by phone, email or in a meeting, "
            "give the final response and record what BD said."))
    ref = getattr(record, "universal_id", None) or f"{req.source} #{req.record_id}"
    db.add(CrmRndRequestQuery(
        request_id=req.id, question=remarks, asked_by_id=user.id, asked_at=datetime.now(timezone.utc),
        due_date_before=req.due_date,
    ))
    db.add(AuditLog(
        entity_type=req.source, entity_id=req.record_id, action=ASK_DETAILS_ACTION, module_key="crm",
        new_value=json.dumps({"request_id": req.id, "remarks": remarks}),
        summary=f"{user.name or user.email} (R&D) asked for more details on {req.offer_number or ref}: {remarks}",
        performed_by_id=user.id,
    ))
    db.flush()
    if req.requested_by_id:
        notify_user(
            db, req.requested_by_id,
            title=f"R&D needs more details on {req.offer_number or ref}",
            message=f"{user.name or user.email}: {remarks} — reply to R&D on {ref} (Reply to R&D on the R&D tab).",
            notification_type="rnd_request_details_asked", entity_type=req.source, entity_id=req.record_id,
        )


def parse_answer_date(value: str | None) -> date:
    """BD's new R&D due date for the reply form (YYYY-MM-DD, today or later in IST)."""
    text = (value or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Set R&D's new due date — the date R&D must reply by now that BD has answered (today or later).")
    try:
        due = date.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"'{text}' is not a valid date — use the date picker (YYYY-MM-DD).") from None
    if due < today_ist():
        raise HTTPException(status_code=400, detail=f"R&D's new due date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    return due


def answer_query(
    db: Session, *, req: CrmRndRequest, query: CrmRndRequestQuery, record, user: User,
    answer: str | None, channel: str | None, due_date: date,
) -> None:
    """BD answers R&D's question on the SAME request (owner, 2026-11-17): the answer is stored on
    the question, R&D's due date is replaced and R&D is told. No re-send, no new revision.
    The caller has checked permission + data scope, uploads the files and commits."""
    ref = getattr(record, "universal_id", None) or f"{req.source} #{req.record_id}"
    if req.status != "open":
        raise HTTPException(status_code=409, detail=(
            f"{req.offer_number or 'This request'} is {req.status}, so R&D's question can't be answered on it any more. "
            "Open the latest request on the R&D tab instead."))
    if query.answer is not None:
        by_rnd = " by R&D, who recorded what BD told them" if query.answered_side == "rnd" else ""
        raise HTTPException(status_code=409, detail=(
            f"This question was already answered ({_day(query.answered_at)}{by_rnd}) — nothing more to send. Refresh the R&D tab."))
    answer = (answer or "").strip()
    if len(answer) < MIN_NOTE:
        raise HTTPException(status_code=400, detail=f"Write your answer to R&D (at least {MIN_NOTE} characters) — e.g. \"Axle load is 22.5 t, gauge 1676 mm\".")
    if channel not in ANSWER_CHANNELS:
        raise HTTPException(status_code=400, detail="Say how you are answering — pick Portal, Phone, Email or Meeting as the channel.")
    now = datetime.now(timezone.utc)
    query.answer, query.answer_channel, query.answered_side = answer, channel, "bd"
    query.answered_by_id, query.answered_at = user.id, now
    query.due_date_after = due_date
    req.due_date = due_date
    who = user.name or user.email
    code = req.offer_number or ref
    db.add(AuditLog(
        entity_type=req.source, entity_id=req.record_id, action=ANSWER_ACTION, module_key="crm",
        new_value=json.dumps({"request_id": req.id, "query_id": query.id, "channel": channel, "due_date": due_date.isoformat()}),
        summary=f"{who} replied to R&D's question on {code} by {channel}; R&D due {due_date.strftime('%d %b %Y')}.",
        performed_by_id=user.id,
    ))
    db.add(AuditLog(
        entity_type=f"rnd_req_{req.source}", entity_id=req.record_id, action="requirement_query_answered", module_key="rnd",
        summary=f"{who} (BD) answered R&D's question on {code} by {channel}: {answer} — R&D due {due_date.strftime('%d %b %Y')}.",
        performed_by_id=user.id,
    ))
    recipients: set[int] = {query.asked_by_id} if query.asked_by_id else set()
    if req.assigned_to_id:
        recipients.add(req.assigned_to_id)
    elif not recipients:
        recipients = {h.id for h in rnd_team(db)}
    for uid in recipients - {user.id}:
        notify_user(
            db, uid, title=f"BD replied to R&D's question on {code}",
            message=f"{who}: {answer} — R&D's new due date is {due_date.strftime('%d %b %Y')}. Open {code} in R&D › Requirements.",
            notification_type="rnd_query_answered", entity_type=f"rnd_req_{req.source}", entity_id=req.record_id,
        )


def mark_responded(
    db: Session, *, req: CrmRndRequest, user: User, remarks: str | None, delay_reason: str | None, has_files: bool,
    bd_told_channel: str | None = None, bd_told_note: str | None = None,
) -> CrmRndRequestQuery | None:
    """Validates and records R&D's answer. Caller uploads files + commits. Returns the question
    this answer closed on BD's behalf (None when none was open).

    While BD still owes an answer to R&D's question the final response must also record how
    BD told R&D (bd_told_channel + bd_told_note); that closes the question. R&D is not late for the
    time it waited on BD: it is late only if the request was already past due when it asked (then a
    delay reason is needed). The due date itself is never moved here."""
    if req.status == "returned":
        raise HTTPException(
            status_code=409,
            detail=f"{req.offer_number or 'This request'} was returned to BD — it can't be answered until BD fixes it and sends it again.",
        )
    if req.status == "superseded":
        raise HTTPException(
            status_code=409,
            detail=f"CRM re-sent this requirement after {req.offer_number or 'this request'} — answer the latest request instead, "
                   "since the requirement may have changed.",
        )
    if req.status == "responded":
        raise HTTPException(status_code=409, detail="This request has already been answered. Ask CRM to re-send it if a revised answer is needed.")
    if req.status == "closed":
        raise HTTPException(
            status_code=409,
            detail="R&D closed this request without a response — ask BD to re-send it if R&D work is needed now.",
        )
    # R&D answers only what it accepted (rnd/services/requirements.py).
    from app.modules.rnd.services import requirements as rnd_requirements
    rnd_requirements.require_accepted_for_request(db, req)
    # Team-queue requests (no assignee) can be answered by anyone in R&D; older
    # requests that named an engineer stay with that engineer.
    if req.assigned_to_id and user.role != "admin" and req.assigned_to_id != user.id:
        assignee = db.query(User).filter(User.id == req.assigned_to_id).first()
        who = (assignee.name or assignee.email) if assignee else "the assigned engineer"
        raise HTTPException(status_code=403, detail=f"Only {who} can answer this request — CRM assigned it to them.")
    remarks = (remarks or "").strip() or None
    delay_reason = (delay_reason or "").strip() or None
    if not remarks and not has_files:
        raise HTTPException(status_code=400, detail="Add response remarks or attach at least one response document.")
    pending = unanswered_query(db, req.id)
    if pending is not None:
        bd_told_note = (bd_told_note or "").strip()
        if bd_told_channel not in ANSWER_CHANNELS or len(bd_told_note) < MIN_NOTE:
            raise HTTPException(status_code=400, detail=(
                f"BD has not answered R&D's question yet (asked {_day(pending.asked_at)}: \"{pending.question}\"). Either wait for BD's reply on the R&D tab, "
                f"or — if BD told you the answer by phone, email or in a meeting — choose how BD told you and write what BD said "
                f"(at least {MIN_NOTE} characters), then submit the response."))
    if pending is not None:
        # R&D's clock stopped when it asked: it is late only if the request was ALREADY past its due
        # date at that moment (the time spent waiting on BD never counts against R&D).
        asked_on = pending.asked_at.astimezone(IST).date() if pending.asked_at.tzinfo else pending.asked_at.date()
        late = pending.due_date_before is not None and asked_on > pending.due_date_before
        due_for_message = pending.due_date_before or req.due_date
    else:
        late = today_ist() > req.due_date
        due_for_message = req.due_date
    if late and not delay_reason:
        raise HTTPException(
            status_code=400,
            detail=f"This response is late — it was due on {due_for_message.strftime('%d %b %Y')}. Enter the reason for the delay before submitting.",
        )
    if pending is not None:
        pending.answer, pending.answer_channel, pending.answered_side = bd_told_note, bd_told_channel, "rnd"
        pending.answered_by_id, pending.answered_at = user.id, datetime.now(timezone.utc)
        pending.due_date_after = req.due_date  # unchanged: only BD's own answer sets a new due date
    req.status = "responded"
    req.response_remarks = remarks
    req.delay_reason = delay_reason if late else None
    req.responded_by_id = user.id
    req.responded_at = datetime.now(timezone.utc)
    rnd_requirements.on_responded(db, req, user)
    if req.requested_by_id:
        notify_user(
            db, req.requested_by_id,
            title=f"R&D responded to {req.offer_number or 'your Technical Offer Request'}",
            message=f"{user.name or user.email} responded" + (" late — delay reason given." if late else " on time."),
            notification_type="rnd_request_responded", entity_type=req.source, entity_id=req.record_id,
        )
    # Role event for the rest of BD (core/events/crm.py); the requester was told directly above.
    from app.core.notification_events import notify_event
    from app.modules.crm.access import can_open_record, parent_record
    record = parent_record(db, req.source, req.record_id)
    if record is not None:
        ref = record.universal_id or f"{req.source} #{req.record_id}"
        notify_event(
            db, None, "crm", "tor_responded",
            title=f"R&D answered {req.offer_number or 'the Technical Requirement'} ({ref})",
            message=f"{user.name or user.email} sent R&D's response for {ref}" + (" — late, with a delay reason." if late else ".")
                    + " Open the record's Documents / Discussion to review it and prepare the quotation.",
            entity_type=req.source, entity_id=req.record_id, actor=user, can_open=can_open_record(db, record),
            skip_user_ids={req.requested_by_id} if req.requested_by_id else None,
        )
    return pending


MIN_CLOSE_REASON = 10


def mark_closed(db: Session, *, req: CrmRndRequest, user: User, reason: str | None) -> None:
    """R&D closes the request WITHOUT a response (owner, 2026-11-02): nothing to deliver, BD
    continues on its own. A reason is mandatory (audit: why no R&D work was needed). The
    request must be open; BD can re-send the requirement later, which opens a new revision.
    Caller commits."""
    ref = req.offer_number or "This request"
    if req.status == "returned":
        raise HTTPException(
            status_code=409,
            detail=f"{ref} was returned to BD — it can't be closed until BD fixes it and sends it again.",
        )
    if req.status == "superseded":
        raise HTTPException(
            status_code=409,
            detail=f"CRM re-sent this requirement after {req.offer_number or 'this request'} — close the latest request instead, "
                   "since the requirement may have changed.",
        )
    if req.status == "responded":
        raise HTTPException(status_code=409, detail="R&D already answered this request, so it can't be closed without a response. Ask CRM to re-send it if R&D work is needed again.")
    if req.status == "closed":
        raise HTTPException(status_code=409, detail="R&D already closed this request without a response — ask BD to re-send it if R&D work is needed now.")
    if req.status != "open":
        raise HTTPException(status_code=409, detail=f"{ref} is {req.status}, so it can't be closed — only an open request can be closed.")
    if req.assigned_to_id and user.role != "admin" and req.assigned_to_id != user.id:
        assignee = db.query(User).filter(User.id == req.assigned_to_id).first()
        who = (assignee.name or assignee.email) if assignee else "the assigned engineer"
        raise HTTPException(status_code=403, detail=f"Only {who} can close this request — CRM assigned it to them.")
    reason = (reason or "").strip()
    if len(reason) < MIN_CLOSE_REASON:
        raise HTTPException(
            status_code=422,
            detail=f"Write why R&D is closing this without a response (at least {MIN_CLOSE_REASON} characters) — "
                   "e.g. \"Standard product, no R&D input needed\".",
        )
    from app.modules.rnd.services import requirements as rnd_requirements
    req.status = "closed"
    req.response_remarks = reason
    req.delay_reason = None
    req.responded_by_id = user.id
    req.responded_at = datetime.now(timezone.utc)
    rnd_requirements.on_closed(db, req, user)
    who_name = user.name or user.email
    if req.requested_by_id:
        notify_user(
            db, req.requested_by_id,
            title=f"R&D closed {req.offer_number or 'your Technical Offer Request'} without a response",
            message=f"{who_name} closed it — no R&D input needed: {reason} You can continue on the record; "
                    "send the requirement to R&D again if R&D work is needed later.",
            notification_type="rnd_request_closed", entity_type=req.source, entity_id=req.record_id,
        )
    # Role event for the rest of BD (core/events/crm.py); the requester was told directly above.
    from app.core.notification_events import notify_event
    from app.modules.crm.access import can_open_record, parent_record
    record = parent_record(db, req.source, req.record_id)
    if record is not None:
        rec_ref = record.universal_id or f"{req.source} #{req.record_id}"
        notify_event(
            db, None, "crm", "tor_closed",
            title=f"R&D closed {req.offer_number or 'the Technical Requirement'} without a response ({rec_ref})",
            message=f"{who_name} closed the requirement for {rec_ref} — no R&D input needed: {reason} "
                    "BD can continue; send it to R&D again if R&D work is needed later.",
            entity_type=req.source, entity_id=req.record_id, actor=user, can_open=can_open_record(db, record),
            skip_user_ids={req.requested_by_id} if req.requested_by_id else None,
        )
