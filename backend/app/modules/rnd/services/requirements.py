"""R&D requirement intake: the R&D ID, revisions, and Accept / Return.

A requirement is still the CRM Inquiry / Tender (single source of truth).
This module owns the small R&D-side record on top of it:

* `rnd_requirements` — one row per (source, record_id): the R&D ID
  (RDR-YYYY-NNNN, never changes) and the status of the latest revision.
* `rnd_requirement_revisions` — one row per BD send: R0 at the first send,
  R1, R2 … at every re-send, each carrying the review state.

State machine (per revision)::

    BD sends ──► submitted ──Accept(head)──► accepted ──Respond(R&D)──► responded
                    │ Return(head, reason)      │ Return(head, reason; only before Respond)
                    ▼                           ▼
                 returned  ◄────────────────────┘
    BD re-sends ──► new revision = submitted; the previous revision, if still
    submitted / accepted (unanswered), becomes superseded.

Accept / Return are one head's act of accepting work (no stages, no amount),
so they are NOT routed through the central approval engine; the audit trail
and the Timeline record who did what.

Until a revision is accepted R&D cannot create requirement tasks, upload an
R&D Technical Offer or respond to CRM (`require_accepted`).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.sequential_id import next_sequential_id
from app.modules.crm.models.rnd_request import CrmRndRequest
from app.modules.crm.services import requirement_movement
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.rnd.models.requirement import RndRequirement, RndRequirementRevision
from app.modules.rnd.services import requirement_access as ra
from app.utils.notifications import notify_user

STATUS_LABELS = {
    "submitted": "Submitted — waiting for R&D review",
    "accepted": "Accepted",
    "returned": "Returned to BD",
    "responded": "Responded",
    "superseded": "Superseded by a newer revision",
}
SHORT_LABELS = {"submitted": "Submitted", "accepted": "Accepted", "returned": "Returned", "responded": "Responded", "superseded": "Superseded"}
UNANSWERED = ("submitted", "accepted")
# Work (tasks, offers) may start once the latest revision was accepted — and
# continues after R&D has responded to CRM.
WORK_OPEN = ("accepted", "responded")
MIN_RETURN_REASON = 10
REMINDER_AFTER_WORKING_DAYS = 2
REMINDER_EVERY_DAYS = 3


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _name(u: User | None) -> str | None:
    return (u.name or u.email) if u else None


# ── lookups ───────────────────────────────────────────────────────────────

def get(db: Session, source: str, record_id: int, *, lock: bool = False) -> RndRequirement | None:
    q = db.query(RndRequirement).filter(RndRequirement.source == source, RndRequirement.record_id == record_id)
    if lock:
        q = q.with_for_update()
    return q.first()


def revisions_of(db: Session, req: RndRequirement) -> list[RndRequirementRevision]:
    return db.query(RndRequirementRevision).filter(RndRequirementRevision.requirement_id == req.id).order_by(
        RndRequirementRevision.revision_no.asc()).all()


def latest_revision(db: Session, req: RndRequirement, *, lock: bool = False) -> RndRequirementRevision | None:
    q = db.query(RndRequirementRevision).filter(RndRequirementRevision.requirement_id == req.id).order_by(
        RndRequirementRevision.revision_no.desc())
    if lock:
        q = q.with_for_update()
    return q.first()


def state_map(db: Session, source: str, record_ids: list[int]) -> dict[int, tuple[RndRequirement, RndRequirementRevision | None]]:
    """record id -> (requirement, latest revision) for list views."""
    if not record_ids:
        return {}
    reqs = db.query(RndRequirement).filter(RndRequirement.source == source, RndRequirement.record_id.in_(record_ids)).all()
    if not reqs:
        return {}
    latest: dict[int, RndRequirementRevision] = {}
    for rev in db.query(RndRequirementRevision).filter(
        RndRequirementRevision.requirement_id.in_([r.id for r in reqs])).order_by(RndRequirementRevision.revision_no.asc()).all():
        latest[rev.requirement_id] = rev
    return {r.record_id: (r, latest.get(r.id)) for r in reqs}


def revision_for_request(db: Session, crm_request_id: int) -> RndRequirementRevision | None:
    return db.query(RndRequirementRevision).filter(RndRequirementRevision.crm_rnd_request_id == crm_request_id).first()


# ── BD send / re-send ─────────────────────────────────────────────────────

def _ist_year() -> int:
    return requirement_movement.today_ist().year


def _snapshot_of(db: Session, log_id: int | None) -> dict:
    log = db.get(AuditLog, log_id) if log_id else None
    if not log or not log.new_value:
        return {}
    try:
        return (json.loads(log.new_value) or {}).get("snapshot") or {}
    except ValueError:
        return {}


def on_bd_submit(
    db: Session, *, source: str, record, user: User, crm_request: CrmRndRequest, movement_log: AuditLog | None,
) -> RndRequirementRevision:
    """BD sent / re-sent the requirement (same transaction as the send).

    First send: creates the requirement with its R&D ID and revision R0.
    Re-send: a new revision; a previous revision still unanswered
    (submitted / accepted) becomes superseded; returned / responded ones keep
    their status. The requirement shows the status of the latest revision."""
    now = _now()
    req = get(db, source, record.id, lock=True)
    previous = latest_revision(db, req, lock=True) if req else None
    if req is None:
        rd_number = next_sequential_id(db, prefix=f"RDR-{_ist_year()}-", column=RndRequirement.rd_number)
        req = RndRequirement(
            rd_number=rd_number, source=source, record_id=record.id, status="submitted", current_revision=0,
            first_received_at=now, last_received_at=now,
        )
        db.add(req)
        db.flush()
        revision_no = 0
    else:
        revision_no = (previous.revision_no + 1) if previous else (req.current_revision + 1)
        if previous and previous.status in UNANSWERED:
            previous.status = "superseded"
    changed = []
    if previous is not None:
        changed = [c["label"] for c in requirement_movement.diff_snapshots(
            _snapshot_of(db, previous.movement_log_id), _snapshot_of(db, movement_log.id if movement_log else None))]
    rev = RndRequirementRevision(
        requirement_id=req.id, revision_no=revision_no, revision_code=f"{req.rd_number}-R{revision_no}", status="submitted",
        crm_rnd_request_id=crm_request.id, movement_log_id=movement_log.id if movement_log else None,
        changed_fields=changed or None, submitted_by_id=user.id, submitted_at=now, created_at=now,
    )
    db.add(rev)
    req.status = "submitted"
    req.current_revision = revision_no
    req.last_received_at = now
    db.flush()
    db.add(AuditLog(
        entity_type=f"rnd_req_{source}", entity_id=record.id, action="requirement_submitted", module_key="rnd",
        summary=f"{_name(user)} sent {rev.revision_code} to R&D" + (f" — changed: {', '.join(changed)}." if changed else "."),
        performed_by_id=user.id,
    ))
    return rev


# ── gates ─────────────────────────────────────────────────────────────────

def accept_first_message(rev: RndRequirementRevision, what: str) -> str:
    label = SHORT_LABELS.get(rev.status, rev.status).lower()
    hint = {
        "submitted": "R&D must review it first (Accept it from the requirement page).",
        "returned": "BD must fix what was returned and send it again.",
    }.get(rev.status, "")
    return f"Accept the requirement first ({rev.revision_code} is {label}) before you {what}. {hint}".strip()


def require_accepted(db: Session, source: str, record_id: int, what: str) -> RndRequirementRevision | None:
    """409 until the latest revision is accepted (or already responded to). A
    requirement with no intake row (an old one the backfill missed) is not blocked."""
    req = get(db, source, record_id)
    if req is None:
        return None
    rev = latest_revision(db, req)
    if rev is None or rev.status in WORK_OPEN:
        return rev
    raise HTTPException(status_code=409, detail=accept_first_message(rev, what))


def require_accepted_for_request(db: Session, crm_request: CrmRndRequest) -> RndRequirementRevision | None:
    """The respond gate: only an accepted revision can be answered. A superseded
    one falls through to requirement_movement.mark_responded, which names the newer send."""
    rev = revision_for_request(db, crm_request.id)
    if rev is None or rev.status in ("accepted", "superseded"):
        return rev
    if rev.status == "responded":
        return rev  # mark_responded explains that it was already answered
    raise HTTPException(status_code=409, detail=accept_first_message(rev, "respond to CRM"))


def on_responded(db: Session, crm_request: CrmRndRequest, user: User) -> None:
    rev = revision_for_request(db, crm_request.id)
    if rev is None:
        return
    rev.status = "responded"
    rev.responded_at = _now()
    req = db.get(RndRequirement, rev.requirement_id)
    if req and req.current_revision == rev.revision_no:
        req.status = "responded"
    db.add(AuditLog(
        entity_type=f"rnd_req_{req.source}" if req else "rnd_req", entity_id=req.record_id if req else None, action="requirement_responded",
        module_key="rnd", summary=f"{_name(user)} responded to CRM on {rev.revision_code}.", performed_by_id=user.id,
    ))


# ── accept / return ───────────────────────────────────────────────────────

def _locked_latest(db: Session, source: str, record_id: int, revision_no: int | None) -> tuple[RndRequirement, RndRequirementRevision]:
    req = get(db, source, record_id, lock=True)
    if req is None:
        raise HTTPException(
            status_code=404,
            detail="This requirement has no R&D ID yet — BD has to use 'Send Technical Requirement to R&D' on the inquiry / tender first.",
        )
    rev = latest_revision(db, req, lock=True)
    if rev is None:
        raise HTTPException(status_code=404, detail=f"{req.rd_number} has no revision on record — ask BD to send it to R&D again.")
    if revision_no is not None and revision_no != rev.revision_no:
        raise HTTPException(status_code=409, detail=f"R{rev.revision_no} is newer — review the latest revision ({rev.revision_code}).")
    return req, rev


def _bd_people(db: Session, record, rev: RndRequirementRevision) -> set[int]:
    """The BD requester (who sent this revision) and the BD owner (the record's creator)."""
    ids = {rev.submitted_by_id, getattr(record, "created_by_id", None)}
    crm_req = db.get(CrmRndRequest, rev.crm_rnd_request_id) if rev.crm_rnd_request_id else None
    if crm_req:
        ids.add(crm_req.requested_by_id)
    ids.discard(None)
    return ids


def _tell_bd(db: Session, record, source: str, rev: RndRequirementRevision, actor: User, *, event: str, title: str, message: str) -> None:
    people = _bd_people(db, record, rev) - {actor.id}
    for uid in people:
        # Types the bell knows (NotificationBell): rnd_requirement_accepted / rnd_requirement_returned, with
        # entity_type rnd_req_inquiry / rnd_req_tender and the inquiry / tender id.
        notify_user(db, uid, title=title, message=message, notification_type=f"rnd_requirement_{event}",
                    entity_type=f"rnd_req_{source}", entity_id=record.id)
    # Role subscribers (Organization › Roles › Notifications) who can open the record; the two above are told directly.
    from app.core.notification_events import notify_event
    from app.modules.crm.access import can_open_record
    notify_event(db, None, "crm", f"rnd_{event}", title=title, message=message, entity_type=source, entity_id=record.id,
                 actor=actor, can_open=can_open_record(db, record), skip_user_ids=people)


def accept(db: Session, *, source: str, record, user: User, remarks: str | None, revision_no: int | None) -> RndRequirementRevision:
    ra.ensure_can_review(db, user, "accept")
    req, rev = _locked_latest(db, source, record.id, revision_no)
    if rev.status != "submitted":
        detail = {
            "accepted": f"{rev.revision_code} is already accepted.",
            "returned": f"{rev.revision_code} was returned to BD — wait for BD to fix it and send it again.",
            "responded": f"{rev.revision_code} is already answered — nothing left to accept.",
        }.get(rev.status, f"{rev.revision_code} is {rev.status}, so it can't be accepted.")
        raise HTTPException(status_code=409, detail=detail)
    rev.status = "accepted"
    rev.reviewed_by_id, rev.reviewed_at = user.id, _now()
    rev.review_remarks = (remarks or "").strip() or None
    rev.return_reason = None
    req.status = "accepted"
    note = f" Remark: {rev.review_remarks}" if rev.review_remarks else ""
    db.add(AuditLog(entity_type=f"rnd_req_{source}", entity_id=record.id, action="requirement_accepted", module_key="rnd",
                    summary=f"{_name(user)} accepted {rev.revision_code}.{note}", performed_by_id=user.id))
    ref = getattr(record, "universal_id", None) or f"{source} #{record.id}"
    _tell_bd(db, record, source, rev, user, event="accepted", title=f"R&D accepted {rev.revision_code} ({ref})",
             message=f"{_name(user)} accepted the requirement as {rev.revision_code}.{note}")
    db.flush()
    return rev


def return_to_bd(db: Session, *, source: str, record, user: User, reason: str | None, revision_no: int | None) -> RndRequirementRevision:
    ra.ensure_can_review(db, user, "return")
    req, rev = _locked_latest(db, source, record.id, revision_no)
    if rev.status == "responded":
        raise HTTPException(status_code=409, detail="Already answered — ask BD to re-send if it must change.")
    if rev.status == "returned":
        raise HTTPException(status_code=409, detail=f"{rev.revision_code} was already returned to BD — BD must fix it and send it again.")
    if rev.status not in UNANSWERED:
        raise HTTPException(status_code=409, detail=f"{rev.revision_code} is {rev.status}, so it can't be returned.")
    reason = (reason or "").strip()
    if len(reason) < MIN_RETURN_REASON:
        raise HTTPException(status_code=422, detail=f"Enter the reason BD must fix (at least {MIN_RETURN_REASON} characters).")
    rev.status = "returned"
    rev.reviewed_by_id, rev.reviewed_at = user.id, _now()
    rev.return_reason = reason
    req.status = "returned"
    crm_req = db.get(CrmRndRequest, rev.crm_rnd_request_id) if rev.crm_rnd_request_id else None
    if crm_req and crm_req.status in ("open",):
        crm_req.status = "returned"
    db.add(AuditLog(entity_type=f"rnd_req_{source}", entity_id=record.id, action="requirement_returned", module_key="rnd",
                    summary=f"{_name(user)} returned {rev.revision_code} to BD: {reason}", performed_by_id=user.id))
    ref = getattr(record, "universal_id", None) or f"{source} #{record.id}"
    _tell_bd(db, record, source, rev, user, event="returned", title=f"R&D returned {rev.revision_code} ({ref})",
             message=f"{_name(user)} returned the requirement: {reason} Fix it and use 'Re-send to R&D'.")
    db.flush()
    return rev


def changed_flags(db: Session, tasks: list) -> dict[int, bool]:
    """task id -> "requirement changed since the task was created": a newer
    revision arrived and has not been accepted yet (AC-16)."""
    states: dict[tuple[str, int], tuple[int, str] | None] = {}
    out: dict[int, bool] = {}
    for t in tasks:
        if t.revision_no is None:
            out[t.id] = False
            continue
        key = (t.source, t.record_id)
        if key not in states:
            req = get(db, t.source, t.record_id)
            rev = latest_revision(db, req) if req else None
            states[key] = (rev.revision_no, rev.status) if rev else None
        state = states[key]
        out[t.id] = bool(state and state[0] > t.revision_no and state[1] not in WORK_OPEN)
    return out


# ── serialisation ─────────────────────────────────────────────────────────

def requirement_out(db: Session, req: RndRequirement | None, rev: RndRequirementRevision | None) -> dict | None:
    if req is None:
        return None
    return {
        "id": req.id, "rd_number": req.rd_number, "source": req.source, "record_id": req.record_id,
        "status": req.status, "status_label": STATUS_LABELS.get(req.status, req.status),
        "current_revision": req.current_revision, "revision_code": rev.revision_code if rev else f"{req.rd_number}-R{req.current_revision}",
        "first_received_at": _iso(req.first_received_at), "last_received_at": _iso(req.last_received_at),
    }


def revisions_out(db: Session, req: RndRequirement | None, movements: list[dict] | None = None, *, mask: set[str] | None = None) -> list[dict]:
    """Revisions newest first, each with who sent / reviewed it and the fields
    that changed against the previous send (from the movement snapshot, with the
    hidden fields — see requirements route — removed)."""
    if req is None:
        return []
    revs = revisions_of(db, req)
    ids = {i for r in revs for i in (r.submitted_by_id, r.reviewed_by_id) if i}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    by_log = {m["id"]: m for m in (movements or [])}
    by_label = {label: field for field, label in requirement_movement.SNAPSHOT_FIELDS.items()}
    out = []
    for r in revs:
        mv = by_log.get(r.movement_log_id) if r.movement_log_id else None
        changes = [c for c in (mv or {}).get("changes", []) if not mask or c.get("field") not in mask]
        out.append({
            "revision_no": r.revision_no, "revision_code": r.revision_code, "status": r.status,
            "status_label": SHORT_LABELS.get(r.status, r.status),
            "submitted_by": _name(users.get(r.submitted_by_id)), "submitted_at": _iso(r.submitted_at),
            "reviewed_by": _name(users.get(r.reviewed_by_id)), "reviewed_at": _iso(r.reviewed_at),
            "review_remarks": r.review_remarks, "return_reason": r.return_reason,
            "responded_at": _iso(r.responded_at),
            "changed_fields": [c["label"] for c in changes] if mv is not None else [
                lab for lab in (r.changed_fields or []) if not mask or by_label.get(lab) not in mask],
            "changes": changes,
        })
    out.reverse()
    return out


# ── reminders ─────────────────────────────────────────────────────────────

def working_days_between(start: date, end: date) -> int:
    """Mon–Fri days elapsed from `start` (exclusive) up to `end` (inclusive)."""
    days, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() < 5:
            days += 1
    return days
