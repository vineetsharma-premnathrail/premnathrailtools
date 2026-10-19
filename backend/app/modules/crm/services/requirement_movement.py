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
from app.modules.crm.models.rnd_request import CrmRndRequest
from app.utils.notifications import notify_user

IST = ZoneInfo("Asia/Kolkata")
RESPONSE_DOC_CATEGORY = "rnd_response"

ACTION = "technical_offer_sent"

# Requirement fields captured from the TOR PDF context, in display order.
SNAPSHOT_FIELDS: dict[str, str] = {
    "org_name": "Customer Organization",
    "contact_name": "Contact Person",
    "product": "Product",
    "product_category": "Category",
    "quantity_display": "Quantity",
    "inspection_req": "Inspection Req.",
    "product_spec": "Specification",
    "requirement_desc": "Requirement Summary",
    "project_details": "Project Details",
}


def _entity_type(module: str) -> str:
    return f"{module}_tor"


def record_movement(
    db: Session, *, module: str, record_id: int, user: User, offer_number: str,
    ctx: dict, tor_doc: CrmDocument, reference_docs: list[CrmDocument],
) -> AuditLog:
    """Call after the TOR email went out successfully, before commit."""
    payload = {
        "offer_number": offer_number,
        "snapshot": {k: ctx.get(k) for k in SNAPSHOT_FIELDS},
        "tor_document": {"id": tor_doc.id, "name": tor_doc.file_name, "file_size": tor_doc.file_size},
        "reference_documents": [{"id": d.id, "name": d.file_name, "file_size": d.file_size} for d in reference_docs],
    }
    log = AuditLog(
        entity_type=_entity_type(module), entity_id=record_id, action=ACTION,
        new_value=json.dumps(payload, default=str), module_key="crm",
        summary=f"{user.name or user.email} sent Technical Offer Request {offer_number} to R&D.",
        performed_by_id=user.id,
    )
    db.add(log)
    db.flush()
    return log


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
        changes = []
        if prev is not None:
            changes = [
                {"field": k, "label": label, "old": prev.get(k), "new": snap.get(k)}
                for k, label in SNAPSHOT_FIELDS.items() if (prev.get(k) or None) != (snap.get(k) or None)
            ]
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
    They open it to others (Access tab) and hand out tasks. Before the team is
    set up, every R&D user (admins only when nobody else has R&D)."""
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
            detail="Nobody could receive this request: there is no active R&D head (Organization › Department, R&D head) and no active user "
                   "with R&D access. Ask an admin to set up the R&D team or grant R&D access in User Management, then send again.",
        )
    return team


def create_rnd_request(
    db: Session, *, module: str, record, user: User, log: AuditLog, offer_number: str,
    team: list[User], due_date: date, remarks: str | None,
) -> CrmRndRequest:
    """Opens the R&D ask for this send (to the R&D head(s)); any still-open ask on the same record is superseded."""
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
    for member in team:
        if member.id == user.id:
            continue
        notify_user(
            db, member.id,
            title=f"Technical Offer Request {offer_number} for R&D",
            message=f"{user.name or user.email} needs R&D's response by {due_date.strftime('%d %b %Y')}."
                    + (f" Remark: {req.crm_remarks}" if req.crm_remarks else ""),
            notification_type="rnd_request_assigned", entity_type=f"rnd_req_{module}", entity_id=record.id,
        )
    # Role-based notice (Organization › Roles › Notifications) to R&D roles
    # subscribed to "TOR received" — the heads above are already told.
    from app.modules.rnd.services import events as rnd_events
    rnd_events.tor_received(db, source=module, record=record, offer_number=offer_number, due_date=due_date,
                            actor=user, skip_user_ids={m.id for m in team})
    return req


def is_late(req: CrmRndRequest) -> bool:
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
    return {
        r.id: {
            "id": r.id, "status": r.status, "offer_number": r.offer_number,
            "assigned_to_id": r.assigned_to_id, "assigned_to": names.get(r.assigned_to_id),
            "due_date": r.due_date.isoformat() if r.due_date else None,
            "crm_remarks": r.crm_remarks,
            "requested_by": names.get(r.requested_by_id) if r.requested_by_id else None,
            "requested_at": _iso(r.created_at),
            "response_remarks": r.response_remarks, "delay_reason": r.delay_reason,
            "responded_by": names.get(r.responded_by_id) if r.responded_by_id else None,
            "responded_at": _iso(r.responded_at),
            "is_late": is_late(r),
            "response_documents": docs.get(r.id, []),
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


def mark_responded(
    db: Session, *, req: CrmRndRequest, user: User, remarks: str | None, delay_reason: str | None, has_files: bool,
) -> None:
    """Validates and records R&D's answer. Caller uploads files + commits."""
    if req.status == "superseded":
        raise HTTPException(
            status_code=409,
            detail=f"CRM re-sent this requirement after {req.offer_number or 'this request'} — answer the latest request instead, "
                   "since the requirement may have changed.",
        )
    if req.status == "responded":
        raise HTTPException(status_code=409, detail="This request has already been answered. Ask CRM to re-send it if a revised answer is needed.")
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
    late = today_ist() > req.due_date
    if late and not delay_reason:
        raise HTTPException(
            status_code=400,
            detail=f"This response is late — it was due on {req.due_date.strftime('%d %b %Y')}. Enter the reason for the delay before submitting.",
        )
    req.status = "responded"
    req.response_remarks = remarks
    req.delay_reason = delay_reason if late else None
    req.responded_by_id = user.id
    req.responded_at = datetime.now(timezone.utc)
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
