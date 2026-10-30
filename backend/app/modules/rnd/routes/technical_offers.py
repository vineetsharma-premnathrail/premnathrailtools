"""R&D › Requirements › Technical Offers: R&D UPLOADS the Technical Offer for a
requirement (Word .docx or PDF), the R&D head releases it to the BD team or
returns it with a reason, and CRM then quotes against it (Quotation ›
Technical Offer picker). Maker-checker: nothing reaches BD unreviewed.

Creating an offer in Word, "Edit in Word" and the TOR picker were removed on
2026-10-30. A change after release is a new upload, which becomes the next
revision (TO-…-R1) — CRM may already have sent a quotation that cites the
released number. A returned offer is corrected the same way.

BD's own offers (origin "bd") are uploaded from the inquiry / tender
(crm/routes/workflow.py) and are listed here read-only. The R&D release /
return / upload endpoints refuse them.
"""
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Quotation
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.technical_offer import RndTechnicalOffer
from app.modules.rnd.routes.requirement_work import _name, _record, _require_requirement_side, _users
from app.modules.rnd.services import events as rnd_events
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import requirements as intake
from app.modules.rnd.services import technical_offers as to
from app.utils.notifications import notify_user

router = APIRouter(
    prefix="/requirement-work", tags=["RnD Technical Offers"],
    dependencies=[Depends(_require_requirement_side)],
)

Source = Literal["inquiry", "tender"]
STATUS_TEXT = {"submitted": "waiting for the R&D head's release", "released": "already released to the BD team",
               "superseded": "superseded by a later revision", "draft": "waiting for the file to be uploaded"}


class TechnicalOfferUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    offer_date: date | None = None
    notes: str | None = None


class TechnicalOfferReturn(BaseModel):
    reason: str = Field(min_length=1)


def _used_by(db: Session, offer_ids: list[int]) -> dict[int, list[str]]:
    quoted: dict[int, list[str]] = {}
    if offer_ids:
        for q in db.query(Quotation.technical_offer_id, Quotation.quot_number).filter(Quotation.technical_offer_id.in_(offer_ids)).all():
            quoted.setdefault(q.technical_offer_id, []).append(q.quot_number or "Quotation")
    return quoted


def serialize(db: Session, offers: list[RndTechnicalOffer], user: User | None = None) -> list[dict]:
    people = _users(db, [o.created_by_id for o in offers] + [o.released_by_id for o in offers] + [o.submitted_by_id for o in offers])
    quoted = _used_by(db, [o.id for o in offers])
    docs = {d.id: d for d in db.query(CrmDocument).filter(CrmDocument.id.in_([o.document_id for o in offers if o.document_id])).all()} \
        if any(o.document_id for o in offers) else {}
    current: dict[tuple[str, int], int] = {}
    for o in offers:
        key = (o.source, o.record_id)
        if key not in current:
            req = intake.get(db, o.source, o.record_id)
            current[key] = req.current_revision if req else 0
    head = bool(user and ra.is_head(db, user))
    out = []
    for o in offers:
        doc = docs.get(o.document_id) if o.document_id else None
        out.append({
            "id": o.id, "offer_number": o.offer_number, "origin": o.origin, "revision": o.revision,
            "offer_date": o.offer_date.isoformat(), "title": o.title, "notes": o.notes,
            "status": o.status, "status_label": to.status_label(o),
            "created_by": _name(people.get(o.created_by_id)), "created_at": o.created_at.isoformat() if o.created_at else None,
            "released_by": _name(people.get(o.released_by_id)) if o.released_by_id else None,
            "released_at": o.released_at.isoformat() if o.released_at else None,
            "submitted_by": _name(people.get(o.submitted_by_id)) if o.submitted_by_id else None,
            "submitted_at": o.submitted_at.isoformat() if o.submitted_at else None,
            "returned_reason": o.returned_reason,
            "requirement_revision_no": o.requirement_revision_no,
            "based_on_earlier_revision": bool(o.origin == "rnd" and o.requirement_revision_no is not None
                                              and o.requirement_revision_no < current.get((o.source, o.record_id), 0)),
            "quoted_in": quoted.get(o.id, []),
            "file": {"name": doc.file_name if doc else f"{o.offer_number}.docx", "file_size": doc.file_size if doc else None,
                     "mime_type": doc.mime_type if doc else None} if (doc or to.has_file(db, o)) else None,
            "label": "Uploaded by BD, not reviewed by R&D" if o.origin == "bd" else None,
            "file_name": doc.file_name if doc else (f"{o.offer_number}.docx" if to.has_file(db, o) else None),
            # R&D can delete its own upload until it is released (the uploader or the head); BD deletes its own on the inquiry / tender.
            "can_delete": bool(user and o.origin == "rnd" and o.status in ("draft", "submitted") and (head or o.created_by_id == user.id)),
        })
    return out


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


def _ensure_rnd_offer(offer: RndTechnicalOffer, what: str) -> None:
    if offer.origin != "rnd":
        raise HTTPException(status_code=403, detail=f"{offer.offer_number} was uploaded by BD — it is quotable at once and R&D can't {what} it. "
                                                    "BD manages its own offers on the inquiry / tender.")


def _audit(db: Session, offer: RndTechnicalOffer, action: str, user: User, summary: str) -> None:
    db.add(AuditLog(entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id, action=action, module_key="rnd",
                    summary=summary, performed_by_id=user.id))


def _parse_offer_date(value: str | None) -> date:
    if not (value or "").strip():
        raise HTTPException(status_code=422, detail="Enter the offer date — it is printed on the quotation next to the offer number.")
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Offer date '{value}' isn't a valid date — pick it from the calendar.") from None


@router.get("/{source}/{record_id}/technical-offers")
async def list_technical_offers(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "view")
    return serialize(db, _offers(db, source, record_id), user)


@router.post("/{source}/{record_id}/technical-offers", status_code=201)
async def upload_technical_offer(
    source: Source, record_id: int, background_tasks: BackgroundTasks,
    file: UploadFile | None = File(None), title: str | None = Form(None), offer_date: str | None = Form(None),
    notes: str | None = Form(None), revise_of_id: int | None = Form(None),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """Upload R&D's Technical Offer (Word .docx or PDF) on an accepted requirement. It waits for the
    R&D head's release. Uploading again after a release or a return is the next revision."""
    record = _record(db, source, record_id)
    to.ensure_can_prepare(db, user, source, record_id)
    ensure_feature_action(user, "rnd", "requirements", "technical_offers", "create")
    revision = intake.require_accepted(db, source, record_id, "upload a Technical Offer")
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Give the offer a title — what it is for, e.g. 'Rail Grinding Machine RGM-25'.")
    if len(title) > 255:
        raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 255.")
    when = _parse_offer_date(offer_date)
    upload = await to.read_upload(file)

    latest, next_rev = to.next_revision(db, source, record_id, "rnd")
    if revise_of_id is not None and (latest is None or latest.id != revise_of_id):
        raise HTTPException(status_code=409, detail="That offer isn't the latest one on this requirement any more — refresh the page and revise the latest offer.")
    completing = bool(latest and latest.status == "draft" and not to.has_file(db, latest))
    if latest and latest.status == "submitted":
        raise HTTPException(status_code=409, detail=f"Technical Offer {latest.offer_number} is {STATUS_TEXT['submitted']} — wait for the R&D head's decision "
                                                    "(release or return) before uploading a new revision.")
    now = datetime.now(timezone.utc)
    if completing:
        offer = latest
        offer.title, offer.offer_date, offer.notes = title[:255], when, (notes or "").strip() or None
    else:
        base = to.number_base(source, record)
        offer = RndTechnicalOffer(
            source=source, record_id=record_id, origin="rnd", offer_number_base=base, revision=next_rev,
            offer_number=to.number_for(base, next_rev), offer_date=when, title=title[:255], notes=(notes or "").strip() or None,
            status="draft", created_by_id=user.id,
            revision_reason=(f"Replaces {latest.offer_number}" if latest else None),
        )
        db.add(offer)
        to.flush_offer(db)
    await to.store_file(db, source=source, record=record, offer=offer, file=upload, user=user)
    offer.status = "submitted"
    offer.submitted_by_id, offer.submitted_at = user.id, now
    offer.returned_reason = None
    offer.requirement_revision_no = revision.revision_no if revision else None
    _audit(db, offer, "technical_offer_uploaded", user, f"{_name(user)} uploaded Technical Offer {offer.offer_number} ({upload.filename}) — pending release.")
    for uid in ra.head_ids(db):
        if uid != user.id:
            notify_user(db, uid, title=f"Technical Offer {offer.offer_number} needs your release",
                        message=f"{_name(user)} uploaded {offer.offer_number} ({offer.title}). Release it to the BD team, or return it with a reason.",
                        notification_type="rnd_technical_offer_submitted", entity_type=f"rnd_req_{source}", entity_id=record_id)
    db.commit()
    return serialize(db, [offer], user)[0]


@router.patch("/technical-offers/{offer_id}")
async def update_technical_offer(offer_id: int, payload: TechnicalOfferUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Change the title, offer date or notes — only while the offer isn't released."""
    offer = _offer(db, offer_id)
    _ensure_rnd_offer(offer, "change")
    to.ensure_can_prepare(db, user, offer.source, offer.record_id)
    ensure_feature_action(user, "rnd", "requirements", "technical_offers", "edit")
    if offer.status in ("released", "superseded"):
        raise HTTPException(status_code=409, detail=f"Technical Offer {offer.offer_number} is {STATUS_TEXT[offer.status]}, so it can't be changed. "
                                                    "Upload a new revision instead (Technical Offers › Upload).")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "title":
            value = (value or "").strip()
            if not value:
                raise HTTPException(status_code=422, detail="Title can't be empty — say what the offer is for, e.g. 'Rail Grinding Machine RGM-25'.")
        if field == "offer_date" and value is None:
            continue
        if field == "notes":
            value = (value or "").strip() or None
        setattr(offer, field, value)
    db.commit()
    return serialize(db, [offer], user)[0]


@router.delete("/technical-offers/{offer_id}")
async def delete_technical_offer(offer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Delete an upload that was not released yet (pending or returned)."""
    offer = _offer(db, offer_id)
    _ensure_rnd_offer(offer, "delete")
    to.ensure_can_prepare(db, user, offer.source, offer.record_id)
    ensure_feature_action(user, "rnd", "requirements", "technical_offers", "delete")
    if offer.status in ("released", "superseded"):
        raise HTTPException(status_code=409, detail=f"Technical Offer {offer.offer_number} is {STATUS_TEXT[offer.status]} — a quotation may already cite it, so it can't be deleted. "
                                                    "Upload a new revision instead.")
    if offer.created_by_id != user.id and not ra.is_head(db, user):
        raise HTTPException(status_code=403, detail="Only the person who uploaded this offer, or the R&D head, can delete it.")
    _audit(db, offer, "technical_offer_deleted", user, f"{_name(user)} deleted the unreleased Technical Offer {offer.offer_number}.")
    if offer.document_id:
        doc = db.get(CrmDocument, offer.document_id)
        if doc:
            doc.is_deleted = True
    db.delete(offer)
    db.commit()
    return {"ok": True}


@router.get("/technical-offers/{offer_id}/file")
async def technical_offer_file(offer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The offer's uploaded file (offer → requirement → Download access first, so an id can't be walked)."""
    offer = _offer(db, offer_id)
    ra.ensure(db, user, offer.source, offer.record_id, "download")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "view")
    content, filename, mime = await to.offer_file(db, offer)
    return Response(content=content, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/technical-offers/{offer_id}/release")
async def release_technical_offer(offer_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """R&D head's sign-off: an uploaded offer waiting for release becomes the offer CRM
    quotes against, and the previously released R&D revision is superseded."""
    offer = _offer(db, offer_id)
    _ensure_rnd_offer(offer, "release")
    ra.ensure_head(db, user, "release a Technical Offer to the BD team")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "approve")
    if offer.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Technical Offer {offer.offer_number} is {STATUS_TEXT.get(offer.status, offer.status)} — only an uploaded offer "
                                                    "pending release can be released.")
    if not to.has_file(db, offer):
        raise HTTPException(status_code=400, detail=f"{offer.offer_number} has no file — ask the uploader to upload the offer file first.")
    for prev in db.query(RndTechnicalOffer).filter(
        RndTechnicalOffer.source == offer.source, RndTechnicalOffer.record_id == offer.record_id,
        RndTechnicalOffer.origin == "rnd", RndTechnicalOffer.status == "released", RndTechnicalOffer.id != offer.id,
    ).all():
        prev.status = "superseded"
    offer.status = "released"
    offer.released_by_id = user.id
    offer.released_at = datetime.now(timezone.utc)
    offer.returned_reason = None
    _audit(db, offer, "technical_offer_released", user, f"{_name(user)} released Technical Offer {offer.offer_number} to the BD team.")
    if offer.submitted_by_id and offer.submitted_by_id != user.id:
        notify_user(db, offer.submitted_by_id, title=f"Technical Offer {offer.offer_number} released",
                    message=f"{_name(user)} released {offer.offer_number} to the BD team.",
                    notification_type="rnd_technical_offer_released", entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id)
    record = _record(db, offer.source, offer.record_id)
    label = "inquiry" if offer.source == "inquiry" else "tender"
    if record.created_by_id and record.created_by_id != user.id:
        notify_user(db, record.created_by_id, title=f"Technical Offer {offer.offer_number} received from R&D",
                    message=f"R&D released Technical Offer {offer.offer_number} for {record.universal_id or label}. Pick it in the quotation's Technical Offer field.",
                    notification_type="rnd_technical_offer_released", entity_type=offer.source, entity_id=offer.record_id)
    rnd_events.requirement_event(
        db, "technical_offer_released", offer.source, offer.record_id,
        title=f"Technical Offer {offer.offer_number} released to the BD team",
        message=f"{_name(user)} released Technical Offer {offer.offer_number} ({offer.title}) for {record.universal_id or label} to the BD team.",
        actor=user, skip_user_ids={record.created_by_id} if record.created_by_id else None, background_tasks=background_tasks,
    )
    db.commit()
    return serialize(db, [offer], user)[0]


@router.post("/technical-offers/{offer_id}/return")
async def return_technical_offer(offer_id: int, payload: TechnicalOfferReturn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """R&D head sends an uploaded offer back with the reason; the uploader uploads a corrected file (next revision)."""
    offer = _offer(db, offer_id)
    _ensure_rnd_offer(offer, "return")
    ra.ensure_head(db, user, "return a Technical Offer for changes")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "technical_offers", "approve")
    if offer.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Technical Offer {offer.offer_number} is {STATUS_TEXT.get(offer.status, offer.status)} — only an offer pending release can be returned.")
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say what must be corrected — the person who uploaded the offer sees it on the offer.")
    offer.status = "draft"
    offer.returned_reason = reason
    _audit(db, offer, "technical_offer_returned", user, f"{_name(user)} returned Technical Offer {offer.offer_number} for correction: {reason}")
    if offer.submitted_by_id and offer.submitted_by_id != user.id:
        notify_user(db, offer.submitted_by_id, title=f"Technical Offer {offer.offer_number} returned",
                    message=f"{_name(user)}: {reason} Upload a corrected file.", notification_type="rnd_technical_offer_returned",
                    entity_type=f"rnd_req_{offer.source}", entity_id=offer.record_id)
    db.commit()
    return serialize(db, [offer], user)[0]
