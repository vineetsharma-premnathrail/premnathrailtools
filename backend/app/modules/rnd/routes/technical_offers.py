"""R&D › Requirements › Technical Offers: R&D prepares the Technical Offer
on a requirement (draft + Word document on the letterhead), the creator
sends it to the R&D head (frozen), the head approves it to the BD team or
returns it for changes, and CRM then quotes against it (Quotation ›
Technical Offer picker). Maker-checker: nothing reaches BD unapproved.

A change after release is a new revision, never an edit — CRM may already
have sent a quotation that cites the released number. A creator asks for a
revision; the R&D head approves (the new draft opens for the requester) or
declines. The head may also revise directly.
"""
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.crm.models.inquiry import Inquiry, Quotation
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.main.services import managed_documents
from app.modules.rnd.models.technical_offer import RndTechnicalOffer
from app.modules.rnd.routes.requirement_work import _require_requirement_side, _record, _users, _name
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import technical_offers as to
from app.modules.rnd.services import events as rnd_events
from app.utils.notifications import notify_user

router = APIRouter(
    prefix="/requirement-work", tags=["RnD Technical Offers"],
    dependencies=[Depends(_require_requirement_side)],
)

Source = Literal["inquiry", "tender"]
STATUS_TEXT = {"submitted": "waiting for the R&D head's approval", "released": "already sent to the BD team",
               "superseded": "superseded by a later revision"}


class TechnicalOfferPayload(BaseModel):
    """Everything optional: "New Technical Offer" only picks the TOR — the
    offer starts from the requirement and is written in the Word template."""
    title: str | None = Field(default=None, max_length=255)
    offer_date: date | None = None
    scope: str | None = None
    technical_details: str | None = None
    deviations: str | None = None
    exclusions: str | None = None


class TechnicalOfferUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    offer_date: date | None = None
    scope: str | None = None
    technical_details: str | None = None
    deviations: str | None = None
    exclusions: str | None = None


class TechnicalOfferRevisePayload(BaseModel):
    reason: str = Field(min_length=1)


class TechnicalOfferDecision(BaseModel):
    approve: bool
    note: str | None = None


def _serialize(db: Session, offers: list[RndTechnicalOffer]) -> list[dict]:
    people = _users(db, [o.created_by_id for o in offers] + [o.released_by_id for o in offers]
                    + [o.submitted_by_id for o in offers] + [o.revision_requested_by_id for o in offers])
    quoted: dict[int, list[str]] = {}
    ids = [o.id for o in offers]
    if ids:
        for q in db.query(Quotation.technical_offer_id, Quotation.quot_number).filter(Quotation.technical_offer_id.in_(ids)).all():
            quoted.setdefault(q.technical_offer_id, []).append(q.quot_number or "Quotation")
    return [{
        "id": o.id, "offer_number": o.offer_number, "revision": o.revision, "offer_date": o.offer_date.isoformat(),
        "title": o.title, "scope": o.scope, "technical_details": o.technical_details, "deviations": o.deviations,
        "exclusions": o.exclusions, "revision_reason": o.revision_reason, "status": o.status,
        "created_by": _name(people.get(o.created_by_id)), "created_at": o.created_at.isoformat() if o.created_at else None,
        "released_by": _name(people.get(o.released_by_id)) if o.released_by_id else None,
        "released_at": o.released_at.isoformat() if o.released_at else None,
        "quoted_in": quoted.get(o.id, []),
        "submitted_by": _name(people.get(o.submitted_by_id)) if o.submitted_by_id else None,
        "submitted_at": o.submitted_at.isoformat() if o.submitted_at else None,
        "returned_reason": o.returned_reason,
        "revision_request": {
            "reason": o.revision_request_reason, "requested_by": _name(people.get(o.revision_requested_by_id)),
            "requested_by_id": o.revision_requested_by_id,
            "requested_at": o.revision_requested_at.isoformat() if o.revision_requested_at else None,
        } if o.revision_requested_at else None,
    } for o in offers]


def _offers(db: Session, source: str, record_id: int) -> list[RndTechnicalOffer]:
    return db.query(RndTechnicalOffer).filter(
        RndTechnicalOffer.source == source, RndTechnicalOffer.record_id == record_id,
    ).order_by(RndTechnicalOffer.id.desc()).all()


def _offer(db: Session, offer_id: int) -> RndTechnicalOffer:
    offer = db.query(RndTechnicalOffer).filter(RndTechnicalOffer.id == offer_id).first()
    if not offer:
        raise HTTPException(status_code=404, detail="This Technical Offer was deleted — refresh the page.")
    _record(db, offer.source, offer.record_id)
    return offer


def _ensure_draft(offer: RndTechnicalOffer, what: str) -> None:
    if offer.status != "draft":
        hint = ("Ask the R&D head to return it for changes." if offer.status == "submitted"
                else "Use 'Ask for revision' — once the R&D head approves, a new revision opens for editing.")
        raise HTTPException(status_code=409, detail=f"Technical Offer {offer.offer_number} is {STATUS_TEXT.get(offer.status, offer.status)}, so you can't {what} it. {hint}")


def _audit(db: Session, offer: RndTechnicalOffer, action: str, user: User, summary: str) -> None:
    db.add(AuditLog(entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id, action=action, module_key="rnd",
                    summary=summary, performed_by_id=user.id))


@router.get("/{source}/{record_id}/technical-offers")
async def list_technical_offers(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "view")
    return _serialize(db, _offers(db, source, record_id))


@router.get("/technical-offers/tor-options")
async def technical_offer_tor_options(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The TORs (Technical Offer Requests from CRM) "New Technical Offer" can
    start from — every requirement sent to R&D, with its offer if it has one."""
    to.ensure_creator(db, user)
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "create")
    latest: dict[tuple[str, int], RndTechnicalOffer] = {}
    for o in db.query(RndTechnicalOffer).order_by(RndTechnicalOffer.id.asc()).all():
        latest[(o.source, o.record_id)] = o
    rows = []
    for source, model in (("inquiry", Inquiry), ("tender", Tender)):
        q = db.query(model, Organization.name).outerjoin(Organization, Organization.id == model.org_id).filter(
            model.is_deleted == False, model.technical_offer_sent_at.isnot(None),  # noqa: E712
        )
        for rec, org_name in q.all():
            o = latest.get((source, rec.id))
            rows.append({
                "source": source, "record_id": rec.id, "tor_number": rec.technical_offer_number,
                "universal_id": rec.universal_id, "title": to.prefill(source, rec)["title"], "org_name": org_name,
                "sent_at": rec.technical_offer_sent_at.isoformat() if rec.technical_offer_sent_at else None,
                "offer_number": o.offer_number if o else None, "offer_status": o.status if o else None,
            })
    rows.sort(key=lambda r: r["sent_at"] or "", reverse=True)
    return rows


@router.post("/{source}/{record_id}/technical-offers", status_code=201)
async def create_technical_offer(source: Source, record_id: int, payload: TechnicalOfferPayload | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    payload = payload or TechnicalOfferPayload()
    record = _record(db, source, record_id)
    to.ensure_can_prepare(db, user, source, record_id)
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "create")
    existing = _offers(db, source, record_id)
    if existing:
        latest = existing[0]
        hint = {"draft": "finish or delete that draft", "submitted": "it is waiting for the R&D head's approval"}.get(
            latest.status, "use 'Ask for revision' on it to get the next revision")
        raise HTTPException(status_code=409, detail=f"This requirement already has Technical Offer {latest.offer_number} ({latest.status}) — {hint}.")
    base = to.number_base(source, record)
    start = to.prefill(source, record)
    offer = RndTechnicalOffer(
        source=source, record_id=record_id, offer_number_base=base, revision=0, offer_number=to.number_for(base, 0),
        offer_date=payload.offer_date or today_ist(), title=((payload.title or "").strip() or start["title"])[:255],
        scope=payload.scope or start["scope"], technical_details=payload.technical_details or start["technical_details"],
        deviations=payload.deviations, exclusions=payload.exclusions,
        status="draft", created_by_id=user.id,
    )
    db.add(offer)
    db.flush()
    _audit(db, offer, "technical_offer_created", user, f"{_name(user)} started Technical Offer {offer.offer_number}.")
    db.commit()
    # The offer is written in Word, so its template exists from the start.
    word_error = await to.create_template_document(db, offer, user)
    return {**_serialize(db, [offer])[0], "word_error": word_error}


@router.patch("/technical-offers/{offer_id}")
async def update_technical_offer(offer_id: int, payload: TechnicalOfferUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    offer = _offer(db, offer_id)
    to.ensure_can_prepare(db, user, offer.source, offer.record_id)
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "edit")
    _ensure_draft(offer, "edit")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "title":
            if not value:
                raise HTTPException(status_code=422, detail="Subject can't be empty — say what the offer is for, e.g. 'Rail Grinding Machine RGM-25'.")
            value = value.strip()
        if field == "offer_date" and value is None:
            continue
        setattr(offer, field, value)
    db.commit()
    return _serialize(db, [offer])[0]


@router.delete("/technical-offers/{offer_id}")
async def delete_technical_offer(offer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    offer = _offer(db, offer_id)
    to.ensure_can_prepare(db, user, offer.source, offer.record_id)
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "delete")
    _ensure_draft(offer, "delete")
    _audit(db, offer, "technical_offer_deleted", user, f"{_name(user)} deleted the draft Technical Offer {offer.offer_number}.")
    db.delete(offer)
    db.commit()
    return {"ok": True}


@router.post("/technical-offers/{offer_id}/release")
async def release_technical_offer(offer_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """R&D head's sign-off: a submitted offer (or the head's own draft)
    becomes the offer CRM quotes against, and the previously released
    revision is superseded."""
    offer = _offer(db, offer_id)
    ra.ensure_head(db, user, "approve a Technical Offer and send it to the BD team")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "approve")
    if offer.status not in ("draft", "submitted"):
        _ensure_draft(offer, "send")
    if not managed_documents.get_active(db, to.ENTITY, offer.id):
        raise HTTPException(status_code=400, detail=f"Create the Word document for {offer.offer_number} first ('Save & Edit in Word'), review it, then send it to the BD team.")
    for prev in db.query(RndTechnicalOffer).filter(
        RndTechnicalOffer.source == offer.source, RndTechnicalOffer.record_id == offer.record_id,
        RndTechnicalOffer.status == "released",
    ).all():
        prev.status = "superseded"
    offer.status = "released"
    offer.released_by_id = user.id
    offer.released_at = datetime.now(timezone.utc)
    offer.returned_reason = None
    _audit(db, offer, "technical_offer_released", user, f"{_name(user)} approved Technical Offer {offer.offer_number} and sent it to the BD team.")
    if offer.submitted_by_id and offer.submitted_by_id != user.id:
        notify_user(db, offer.submitted_by_id, title=f"Technical Offer {offer.offer_number} approved",
                    message=f"{_name(user)} approved {offer.offer_number} and sent it to the BD team.",
                    notification_type="rnd_technical_offer_released", entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id)

    record = _record(db, offer.source, offer.record_id)
    label = "inquiry" if offer.source == "inquiry" else "tender"
    if record.created_by_id and record.created_by_id != user.id:
        notify_user(db, record.created_by_id, title=f"Technical Offer {offer.offer_number} received from R&D",
                    message=f"R&D sent Technical Offer {offer.offer_number} for {record.universal_id or label}. Pick it in the quotation's Technical Offer field.",
                    notification_type="rnd_technical_offer_released", entity_type=offer.source, entity_id=offer.record_id)
    rnd_events.requirement_event(
        db, "technical_offer_released", offer.source, offer.record_id,
        title=f"Technical Offer {offer.offer_number} sent to the BD team",
        message=f"{_name(user)} sent Technical Offer {offer.offer_number} ({offer.title}) for {record.universal_id or label} to the BD team.",
        actor=user, skip_user_ids={record.created_by_id} if record.created_by_id else None, background_tasks=background_tasks,
    )
    db.commit()
    return _serialize(db, [offer])[0]


def _notify_heads(db: Session, offer: RndTechnicalOffer, actor: User, title: str, message: str, kind: str) -> None:
    for uid in ra.head_ids(db):
        if uid != actor.id:
            notify_user(db, uid, title=title, message=message, notification_type=kind,
                        entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id)


def _latest_released(db: Session, offer: RndTechnicalOffer, what: str) -> None:
    latest = _offers(db, offer.source, offer.record_id)[0]
    if latest.id != offer.id or offer.status != "released":
        raise HTTPException(status_code=409, detail=f"Only the latest offer sent to the BD team can be {what} — that's {latest.offer_number} ({STATUS_TEXT.get(latest.status, latest.status)}).")


async def _start_revision(db: Session, offer: RndTechnicalOffer, reason: str, owner_id: int, actor: User) -> RndTechnicalOffer:
    """Next revision as a draft, copied from the latest released one —
    including its Word document, renumbered. `owner_id` edits it."""
    revision = offer.revision + 1
    new = RndTechnicalOffer(
        source=offer.source, record_id=offer.record_id, offer_number_base=offer.offer_number_base, revision=revision,
        offer_number=to.number_for(offer.offer_number_base, revision), offer_date=today_ist(), title=offer.title,
        scope=offer.scope, technical_details=offer.technical_details, deviations=offer.deviations, exclusions=offer.exclusions,
        revision_reason=reason, status="draft", created_by_id=owner_id,
    )
    offer.revision_request_reason = offer.revision_requested_by_id = offer.revision_requested_at = None
    db.add(new)
    db.flush()
    _audit(db, new, "technical_offer_revised", actor, f"{_name(actor)} opened revision {new.offer_number} of Technical Offer {offer.offer_number}: {reason}")
    db.commit()
    await to.carry_forward_document(db, offer, new, actor)
    return new


@router.post("/technical-offers/{offer_id}/submit")
async def submit_technical_offer(offer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The creator sends the finished draft to the R&D head. From now on it
    is frozen until the head approves it (to BD) or returns it."""
    offer = _offer(db, offer_id)
    to.ensure_can_prepare(db, user, offer.source, offer.record_id)
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "edit")
    _ensure_draft(offer, "send")
    if not managed_documents.get_active(db, to.ENTITY, offer.id):
        raise HTTPException(status_code=400, detail=f"Create the Word document for {offer.offer_number} first ('Edit in Word'), write the offer, then send it.")
    offer.status = "submitted"
    offer.submitted_by_id = user.id
    offer.submitted_at = datetime.now(timezone.utc)
    offer.returned_reason = None
    _audit(db, offer, "technical_offer_submitted", user, f"{_name(user)} sent Technical Offer {offer.offer_number} to the R&D head for approval.")
    _notify_heads(db, offer, user, f"Technical Offer {offer.offer_number} needs your approval",
                  f"{_name(user)} sent {offer.offer_number} ({offer.title}) for approval. Approve it to the BD team, or return it for changes.",
                  "rnd_technical_offer_submitted")
    db.commit()
    return _serialize(db, [offer])[0]


@router.post("/technical-offers/{offer_id}/return")
async def return_technical_offer(offer_id: int, payload: TechnicalOfferRevisePayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """R&D head sends a submitted offer back to draft so it can be corrected."""
    offer = _offer(db, offer_id)
    ra.ensure_head(db, user, "return a Technical Offer for changes")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "approve")
    if offer.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Technical Offer {offer.offer_number} is {STATUS_TEXT.get(offer.status, offer.status)} — only an offer waiting for approval can be returned.")
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say what must be changed — the creator sees it on the offer.")
    offer.status = "draft"
    offer.returned_reason = reason
    _audit(db, offer, "technical_offer_returned", user, f"{_name(user)} returned Technical Offer {offer.offer_number} for changes: {reason}")
    if offer.submitted_by_id and offer.submitted_by_id != user.id:
        notify_user(db, offer.submitted_by_id, title=f"Technical Offer {offer.offer_number} returned for changes",
                    message=f"{_name(user)}: {reason}", notification_type="rnd_technical_offer_returned",
                    entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id)
    db.commit()
    return _serialize(db, [offer])[0]


@router.post("/technical-offers/{offer_id}/request-revision")
async def request_technical_offer_revision(offer_id: int, payload: TechnicalOfferRevisePayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A creator asks the R&D head to reopen a released offer as a new revision."""
    offer = _offer(db, offer_id)
    to.ensure_can_prepare(db, user, offer.source, offer.record_id)
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "create")
    _latest_released(db, offer, "revised")
    if offer.revision_requested_at:
        raise HTTPException(status_code=409, detail=f"A revision of {offer.offer_number} was already asked for — wait for the R&D head's decision.")
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail=f"Say why {offer.offer_number} must be revised (e.g. 'Customer asked for 25 t axle load').")
    offer.revision_request_reason = reason
    offer.revision_requested_by_id = user.id
    offer.revision_requested_at = datetime.now(timezone.utc)
    _audit(db, offer, "technical_offer_revision_requested", user, f"{_name(user)} asked to revise Technical Offer {offer.offer_number}: {reason}")
    _notify_heads(db, offer, user, f"Revision of {offer.offer_number} requested",
                  f"{_name(user)} asks to revise {offer.offer_number}: {reason}. Approve to open a new revision, or decline.",
                  "rnd_technical_offer_revision_requested")
    db.commit()
    return _serialize(db, [offer])[0]


@router.post("/technical-offers/{offer_id}/revision-request/decide")
async def decide_technical_offer_revision(offer_id: int, payload: TechnicalOfferDecision, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """R&D head: approve (a new draft revision opens for the requester) or decline."""
    offer = _offer(db, offer_id)
    ra.ensure_head(db, user, "decide a Technical Offer revision request")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "approve")
    if not offer.revision_requested_at:
        raise HTTPException(status_code=409, detail=f"Nobody has asked to revise {offer.offer_number} — refresh the page.")
    _latest_released(db, offer, "revised")
    requester_id, reason = offer.revision_requested_by_id, offer.revision_request_reason or ""
    note = (payload.note or "").strip()
    if payload.approve:
        new = await _start_revision(db, offer, reason, requester_id or user.id, user)
        if requester_id and requester_id != user.id:
            notify_user(db, requester_id, title=f"Revision {new.offer_number} approved",
                        message=f"{_name(user)} approved your revision request — {new.offer_number} is open for editing.",
                        notification_type="rnd_technical_offer_revision_decided", entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id)
            db.commit()
        return _serialize(db, [new])[0]
    if not note:
        raise HTTPException(status_code=422, detail="Say why the revision is declined — the requester sees it.")
    offer.revision_request_reason = offer.revision_requested_by_id = offer.revision_requested_at = None
    _audit(db, offer, "technical_offer_revision_declined", user, f"{_name(user)} declined the revision of {offer.offer_number}: {note}")
    if requester_id and requester_id != user.id:
        notify_user(db, requester_id, title=f"Revision of {offer.offer_number} declined",
                    message=f"{_name(user)}: {note}", notification_type="rnd_technical_offer_revision_decided",
                    entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id)
    db.commit()
    return _serialize(db, [offer])[0]


@router.post("/technical-offers/{offer_id}/revise", status_code=201)
async def revise_technical_offer(offer_id: int, payload: TechnicalOfferRevisePayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """R&D head revises a released offer directly (others use 'Ask for revision')."""
    offer = _offer(db, offer_id)
    ra.ensure_head(db, user, "revise a Technical Offer directly — use 'Ask for revision' instead")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "create")
    _latest_released(db, offer, "revised")
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail=f"Say why {offer.offer_number} is being revised (e.g. 'Customer asked for 25 t axle load') — the reason is printed on the revision record.")
    new = await _start_revision(db, offer, payload.reason.strip(), user.id, user)
    return _serialize(db, [new])[0]
