"""R&D › Requirements › Technical Offers: R&D prepares the Technical Offer
on a requirement (draft + Word document), the R&D head releases it, and
CRM then quotes against it (Quotation › Technical Offer picker).

A change after release is a new revision ("Revise"), never an edit — CRM may
already have sent a quotation that cites the released number.
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
STATUS_TEXT = {"released": "already sent to the BD team", "superseded": "superseded by a later revision"}


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


def _serialize(db: Session, offers: list[RndTechnicalOffer]) -> list[dict]:
    people = _users(db, [o.created_by_id for o in offers] + [o.released_by_id for o in offers])
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
        raise HTTPException(status_code=409, detail=f"Technical Offer {offer.offer_number} is {STATUS_TEXT.get(offer.status, offer.status)}, so you can't {what} it. Click 'Revise' to make a new revision instead.")


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
        hint = "finish or delete that draft" if latest.status == "draft" else "use 'Revise' on it to make the next revision"
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
    """R&D head's sign-off: the draft becomes the offer CRM quotes against,
    and the previously released revision is superseded."""
    offer = _offer(db, offer_id)
    ra.ensure_head(db, user, "send a Technical Offer to the BD team")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "approve")
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
    _audit(db, offer, "technical_offer_released", user, f"{_name(user)} sent Technical Offer {offer.offer_number} to the BD team.")

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


@router.post("/technical-offers/{offer_id}/revise", status_code=201)
async def revise_technical_offer(offer_id: int, payload: TechnicalOfferRevisePayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Next revision as a draft, copied from the latest released one —
    including its Word document, renumbered."""
    offer = _offer(db, offer_id)
    to.ensure_can_prepare(db, user, offer.source, offer.record_id)
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "create")
    latest = _offers(db, offer.source, offer.record_id)[0]
    if latest.id != offer.id or offer.status != "released":
        raise HTTPException(status_code=409, detail=f"Only the latest offer sent to the BD team can be revised — that's {latest.offer_number} ({latest.status}).")
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail=f"Say why {offer.offer_number} is being revised (e.g. 'Customer asked for 25 t axle load') — the reason is printed on the revision record.")
    revision = offer.revision + 1
    new = RndTechnicalOffer(
        source=offer.source, record_id=offer.record_id, offer_number_base=offer.offer_number_base, revision=revision,
        offer_number=to.number_for(offer.offer_number_base, revision), offer_date=today_ist(), title=offer.title,
        scope=offer.scope, technical_details=offer.technical_details, deviations=offer.deviations, exclusions=offer.exclusions,
        revision_reason=payload.reason.strip(), status="draft", created_by_id=user.id,
    )
    db.add(new)
    db.flush()
    _audit(db, new, "technical_offer_revised", user, f"{_name(user)} started revision {new.offer_number} of Technical Offer {offer.offer_number}: {new.revision_reason}")
    db.commit()
    await to.carry_forward_document(db, offer, new, user)
    return _serialize(db, [new])[0]
