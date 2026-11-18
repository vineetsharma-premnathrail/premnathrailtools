"""Changing an inquiry's Customer Requirement after it went to R&D (owner, 2026-11-17).

Once a requirement was sent to R&D (any send that was not taken back), its Customer Requirement
text — the first product's Specification and each additional product's Specification — is locked
in the normal Edit. BD changes it with "Change requirement":

* ``revision``   — the new text goes to R&D as the next revision (R1, R2 …) with a reason; the
                   send itself is the normal technical-offer-request flow (routes/inquiries.py).
* ``correction`` — a typo / mistake fixed in the SAME revision, only while R&D has not accepted it
                   (latest revision still ``submitted``). R&D sees the corrected text, is told, and
                   the revision shows when it was corrected. No new revision, due date unchanged.

This module holds what both routes share: reading / applying the texts, the edit lock and the
correction itself. The send (with the email) stays in routes/inquiries.py.
"""
import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.rnd_request import CrmRndRequest
from app.modules.crm.services import requirement_movement, technical_offer
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.utils.notifications import notify_user


def _norm(text: str | None) -> str:
    return " ".join(str(text).split()) if text and str(text).strip() else ""


def current_texts(inquiry: Inquiry) -> list[str]:
    """[first product's spec, each additional product's spec in order], whitespace-normalised
    (empty string = none), so two saves can be compared."""
    return [_norm(inquiry.product_spec), *(_norm(it.product_spec) for it in inquiry.additional_items)]


def live_send(db: Session, *, module: str, record_id: int) -> CrmRndRequest | None:
    """The latest send to R&D that was not taken back — what locks the requirement text."""
    return db.query(CrmRndRequest).filter(
        CrmRndRequest.source == module, CrmRndRequest.record_id == record_id, CrmRndRequest.status != "withdrawn",
    ).order_by(CrmRndRequest.id.desc()).first()


def ensure_requirement_not_locked(db: Session, inquiry: Inquiry, new_main: str | None, new_items: list[str | None] | None) -> None:
    """409 when an Edit would change the Customer Requirement of an inquiry R&D already has.
    `new_main` = the first product's spec after the save; `new_items` = the additional products'
    specs the form submits (None = the list is not sent, so it stays)."""
    sent = live_send(db, module="inquiry", record_id=inquiry.id)
    if sent is None:
        return
    old = requirement_movement.customer_requirements({
        "product_spec": inquiry.product_spec, "additional_items": [{"product_spec": it.product_spec} for it in inquiry.additional_items]})
    items = [it.product_spec for it in inquiry.additional_items] if new_items is None else new_items
    new = requirement_movement.customer_requirements({
        "product_spec": new_main,
        "additional_items": [{"product_spec": t} for t in items]})
    if old == new:
        return
    ref = sent.offer_number or inquiry.technical_offer_number or "the R&D requirement"
    raise HTTPException(status_code=409, detail=(
        f"Customer Requirement was sent to R&D as {ref} — change it with \"Change requirement\" on the R&D tab, "
        "so R&D gets the change as a new revision with a reason."))


def new_texts(inquiry: Inquiry, product_spec: str, item_specs: list[str | None] | None) -> list[str]:
    """The requirement texts after "Change requirement" (normalised, same shape as current_texts).
    `item_specs`: None = the list is not sent (all kept); per additional product None = keep that
    product's text, "" = clear its requirement. The first product's text can't be cleared."""
    main = (product_spec or "").strip()
    if not main:
        raise HTTPException(status_code=422, detail=(
            "The Customer Requirement can't be empty — write the specification R&D should work from "
            f"(inquiry {inquiry.universal_id})."))
    count = len(inquiry.additional_items)
    if item_specs is None:
        items = [it.product_spec for it in inquiry.additional_items]
    else:
        if len(item_specs) != count:
            raise HTTPException(status_code=400, detail=(
                f"This inquiry has {count} additional product{'s' if count != 1 else ''} but {len(item_specs)} "
                "specification text(s) were sent — reload the inquiry and open Change requirement again."))
        items = [(old.product_spec if new is None else new) for old, new in zip(inquiry.additional_items, item_specs)]  # "" clears
    return [_norm(main), *(_norm(t) for t in items)]


def apply_texts(db: Session, inquiry: Inquiry, user: User, product_spec: str, item_specs: list[str | None] | None) -> None:
    """Writes the new texts on the inquiry and logs them in the Info tab's revision list."""
    old = {"product_spec": inquiry.product_spec}
    new = {"product_spec": product_spec.strip()}
    inquiry.product_spec = product_spec.strip()
    if item_specs is not None:
        for n, (item, text) in enumerate(zip(inquiry.additional_items, item_specs), start=1):
            if text is None or _norm(text) == _norm(item.product_spec):
                continue
            old[f"additional_product_{n}_spec"], new[f"additional_product_{n}_spec"] = item.product_spec, text.strip() or None
            item.product_spec = text.strip() or None  # "" clears this product's requirement
    changed = {k: v for k, v in new.items() if _norm(old.get(k)) != _norm(v)}
    if changed:
        db.add(AuditLog(
            entity_type="inquiry_spec", entity_id=inquiry.id, action="spec_revision",
            old_value=json.dumps({k: old[k] for k in changed}, default=str), new_value=json.dumps(changed, default=str),
            summary=f"{user.name or user.email} updated requirement spec: {', '.join(changed)}.",
            performed_by_id=user.id,
        ))


def correct_in_place(db: Session, *, inquiry: Inquiry, user: User, note: str | None) -> None:
    """Same-revision correction. Call AFTER apply_texts (the inquiry holds the corrected text);
    caller commits. Refuses (409) once R&D accepted / answered / closed the revision."""
    from app.modules.rnd.models.requirement import RndRequirementRevision
    from app.modules.rnd.services import requirements as rnd_requirements  # rnd imports crm models
    req = rnd_requirements.get(db, "inquiry", inquiry.id, lock=True)
    rev = rnd_requirements.latest_revision(db, req, lock=True) if req else None
    if req is None or rev is None:
        raise HTTPException(status_code=409, detail=(
            f"Inquiry {inquiry.universal_id} has not been sent to R&D yet — use Edit to change the Customer Requirement, "
            "then Send Technical Requirement to R&D."))
    if rev.status != "submitted":
        if rev.status == "accepted":
            raise HTTPException(status_code=409, detail=f"R&D already accepted {rev.revision_code} — send the change as a new revision.")
        label = rnd_requirements.SHORT_LABELS.get(rev.status, rev.status).lower()
        raise HTTPException(status_code=409, detail=(
            f"{rev.revision_code} is {label}, so it can't be corrected in place — send the change as a new revision."))

    now = datetime.now(timezone.utc)
    old_log = db.get(AuditLog, rev.movement_log_id) if rev.movement_log_id else None
    old_payload = json.loads(old_log.new_value) if old_log and old_log.new_value else {}
    ref_ids = [d["id"] for d in old_payload.get("reference_documents") or [] if d.get("id")]
    reference_docs = db.query(CrmDocument).filter(CrmDocument.id.in_(ref_ids)).all() if ref_ids else []
    ctx, _org = technical_offer.build_context(db, "inquiry", inquiry, user, now)
    new_log = requirement_movement.record_movement(
        db, module="inquiry", record_id=inquiry.id, user=user, offer_number=old_payload.get("offer_number") or rev.revision_code,
        ctx=ctx, tor_doc=None, reference_docs=reference_docs,
    )
    if old_log is not None:
        # The corrected snapshot replaces the old one as THE send (same time, same sender); the
        # old row stays for the audit trail but is no longer listed as a send.
        new_log.performed_at, new_log.performed_by_id = old_log.performed_at, old_log.performed_by_id
        base = (old_log.summary or "Requirement sent to R&D").rstrip(".")
        new_log.summary = f"{base} (corrected before R&D accepted)."
        old_log.action = requirement_movement.CORRECTED_ACTION
        data = json.loads(new_log.new_value)
        data["corrected_from_log_id"] = old_log.id
        new_log.new_value = json.dumps(data, default=str)
    rev.movement_log_id = new_log.id
    if rev.crm_rnd_request_id:
        crm_req = db.get(CrmRndRequest, rev.crm_rnd_request_id)
        if crm_req is not None:
            crm_req.movement_log_id = new_log.id
    previous = db.query(RndRequirementRevision).filter(
        RndRequirementRevision.requirement_id == rev.requirement_id, RndRequirementRevision.revision_no < rev.revision_no,
    ).order_by(RndRequirementRevision.revision_no.desc()).first()
    if previous is not None:
        rev.changed_fields = [c["label"] for c in requirement_movement.diff_snapshots(
            rnd_requirements._snapshot_of(db, previous.movement_log_id), rnd_requirements._snapshot_of(db, new_log.id))] or None
    rev.corrected_at, rev.corrected_by_id = now, user.id
    # R&D has the corrected text as of now: the "edited after send" signals must not fire for the typo fix.
    inquiry.technical_offer_sent_at = now

    who = user.name or user.email
    note = (note or "").strip()
    suffix = f" Note: {note}" if note else ""
    db.add(AuditLog(
        entity_type="inquiry", entity_id=inquiry.id, action="requirement_corrected", module_key="crm",
        summary=f"{who} corrected the Customer Requirement of {rev.revision_code} before R&D accepted it.{suffix}",
        performed_by_id=user.id,
    ))
    db.add(AuditLog(
        entity_type="rnd_req_inquiry", entity_id=inquiry.id, action="requirement_corrected", module_key="rnd",
        summary=f"{who} (BD) corrected {rev.revision_code} before R&D accepted it.{suffix}", performed_by_id=user.id,
    ))
    told: set[int] = set()
    for member in requirement_movement.rnd_team(db):
        if member.id == user.id or member.id in told:
            continue
        told.add(member.id)
        notify_user(
            db, member.id, title=f"{rev.revision_code} corrected by BD",
            message=f"{who} corrected the Customer Requirement of {rev.revision_code} before you accepted it — "
                    f"open it in R&D › Requirements and review the corrected text.{suffix}",
            notification_type="rnd_requirement_corrected", entity_type="rnd_req_inquiry", entity_id=inquiry.id,
        )
