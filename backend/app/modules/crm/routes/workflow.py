import json
import re
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session, object_session, selectinload

from app.db.session import get_db
from app.core.permission_registry import can_feature
from app.core.permissions import ensure_can_delete, ensure_feature_action, require_feature_action, require_tab_access
from app.core.data_scope import apply_scope, ensure_in_scope
import app.modules.crm.access  # noqa: F401 — registers the CRM data-scope models
from app.modules.crm.access import QUOTATION_LINE_MONEY_FIELDS, QUOTATION_MONEY_FIELDS, blank, sees_quotation_prices
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization as OrgModel
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.tender import Tender
from app.modules.crm.schemas.workflow import (
    QuotationCreate, QuotationUpdate, QuotationResponse, QuotationLineItemPayload,
)
from app.modules.products.models.product import FinishedProduct
from app.modules.crm.reports.quotation_pdf import build_quotation_pdf
from app.modules.crm.reports.quotation_docx import build_quotation_docx
from app.modules.main.services import managed_documents
from app.utils.document_merge import merge_docx, merge_pdf
from app.modules.rnd.models.technical_offer import RndTechnicalOffer
from app.modules.rnd.services import technical_offers
from app.modules.crm.services import quotation_status as qstatus

QUOTATION_ENTITY = "crm_quotation"

router = APIRouter(prefix="/crm", tags=["CRM - Workflow"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


def _load_live_inquiry(db: Session, inquiry_id: int, user: User, lock: bool = False) -> Inquiry:
    """The inquiry a quotation belongs to, only while it is not soft-deleted —
    quotations of a deleted inquiry must not be listed, revised, downloaded or deleted —
    and only when it is in the user's CRM data scope."""
    q = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    inquiry = q.first()
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found or deleted — restore it before working on its quotations.")
    ensure_in_scope(db, user, inquiry)
    return inquiry


def quotation_out(quot: Quotation, user: User) -> QuotationResponse:
    """A quotation as the API returns it — prices blanked for a user without
    CRM › Inquiries & Tenders › Prices & margins (access.sees_quotation_prices)."""
    out = QuotationResponse.model_validate(quot)
    _fill_line_names(object_session(quot), out)
    if not sees_quotation_prices(user):
        blank(out, QUOTATION_MONEY_FIELDS)
        for it in out.items:
            blank(it, QUOTATION_LINE_MONEY_FIELDS)
    return out


QUOTABLE_PRODUCT_STATUSES = ("active", "development")


def _fill_line_names(db: Session | None, out: QuotationResponse) -> None:
    """Product code / name and application name for display on each line (old lines stay blank)."""
    if db is None:
        return
    pids = {it.product_id for it in out.items if it.product_id}
    aids = {it.application_id for it in out.items if it.application_id}
    prods = {p.id: p for p in db.query(FinishedProduct).filter(FinishedProduct.id.in_(pids)).all()} if pids else {}
    apps = {a.id: a for a in db.query(FinishedProduct).filter(FinishedProduct.id.in_(aids)).all()} if aids else {}
    for it in out.items:
        p = prods.get(it.product_id) if it.product_id else None
        a = apps.get(it.application_id) if it.application_id else None
        it.product_code, it.product_name = (p.code, p.name) if p else (None, None)
        it.application_name = a.name if a else None


def _line_is_blank(it: QuotationLineItemPayload) -> bool:
    return not (it.product_id or it.application_id or (it.description or "").strip() or (it.model_number or "").strip()
                or it.quantity or it.unit_price or (it.details or "").strip())


def prepare_quotation_lines(db: Session, items: list[QuotationLineItemPayload]) -> list[QuotationLineItemPayload]:
    """Every quotation line is chosen from the Product master: a Product is required
    (an application / attachment is picked as its own line). The legacy per-line
    application_id is still checked for old quotations. Description / model number fill from
    the product when left blank. Entirely blank rows are dropped. Raises 422 naming
    the line and how to fix it."""
    kept = [it for it in items if not _line_is_blank(it)]
    for n, it in enumerate(kept, start=1):
        if not it.product_id:
            raise HTTPException(status_code=422, detail=(
                f"Line {n}: pick the product — every quotation line is chosen from the Product master (including Paid services). "
                "Open the line and choose a Product; if it is missing, ask Products to add it."))
        product = db.query(FinishedProduct).filter(FinishedProduct.id == it.product_id).first()
        if not product:
            raise HTTPException(status_code=422, detail=f"Line {n}: product #{it.product_id} does not exist — pick the product again from the list.")
        # An application / attachment is quoted as its own line (owner, 2026-10-28).
        if product.status not in QUOTABLE_PRODUCT_STATUSES:
            raise HTTPException(status_code=422, detail=(
                f"Line {n}: {product.name} is {product.status.replace('_', ' ')} and can't be quoted. "
                "Pick an active or in-development product, or ask Products to reactivate it."))
        # Application / attachment is optional (sold with the product only if the customer asks).
        # It is a Product-master row of type "application", not tied to the product.
        if it.application_id:
            app_row = db.query(FinishedProduct).filter(FinishedProduct.id == it.application_id).first()
            if not app_row or app_row.product_type != "application":
                raise HTTPException(status_code=422, detail=(
                    f"Line {n}: that is not an application / attachment in the Product master. "
                    "Pick one from the Application / attachment list, or clear it if the customer did not ask for one."))
            if app_row.status not in QUOTABLE_PRODUCT_STATUSES:
                raise HTTPException(status_code=422, detail=(
                    f"Line {n}: {app_row.name} is {app_row.status.replace('_', ' ')} and can't be quoted. "
                    "Pick an active or in-development application, or ask Products to reactivate it."))
        if not (it.description or "").strip():
            it.description = product.name
        if not (it.model_number or "").strip() and product.model_number:
            it.model_number = product.model_number
    return kept


@router.get("/quotation-products")
async def list_quotation_products(db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "view"))):
    """Product master choices for the quotation line editor: active and in-development
    products (type other than application), plus the applications / attachments (type application) as a separate list. CRM users may
    not have the Products app, so this lookup sits under the quotation permission."""
    rows = db.query(FinishedProduct).filter(FinishedProduct.status.in_(QUOTABLE_PRODUCT_STATUSES)).order_by(FinishedProduct.code.asc()).all()

    def row(p: FinishedProduct) -> dict:
        return {"id": p.id, "code": p.code, "name": p.name, "model_number": p.model_number, "product_type": p.product_type}
    return {
        "products": [row(p) for p in rows if p.product_type != "application"],
        "applications": [row(p) for p in rows if p.product_type == "application"],
    }


@router.get("/inquiries/{inquiry_id}/quotation-products/{product_id}/price")
async def quotation_product_price(inquiry_id: int, product_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "view"))):
    """The price the Product master's pricing conditions give this customer today — prefills the
    unit price on a quotation line (a typed different price still needs a reason, see
    products/linking.py). Blank for a user without CRM › Prices & margins."""
    from app.modules.products import pricing
    inquiry = _load_live_inquiry(db, inquiry_id, _user)
    if not sees_quotation_prices(_user):
        return {"price": None}
    if not db.query(FinishedProduct.id).filter(FinishedProduct.id == product_id).first():
        raise HTTPException(status_code=404, detail="Product not found — pick the product again from the list.")
    r = pricing.resolve(db, product_id=product_id, customer_id=inquiry.org_id)
    return {"price": r["price"], "price_source": r["price_source"]}


def ensure_quotation_prices(user: User) -> None:
    """A quotation PDF / Word document is the priced offer — it opens only for
    someone who may see quotation prices."""
    if not sees_quotation_prices(user):
        raise HTTPException(status_code=403, detail=(
            "The quotation document shows its prices, and you don't have CRM › Inquiries & Tenders › Prices & margins. "
            "Ask an admin to add it to one of your roles (Organization › Role & Permissions)."))


def _user_label(db: Session, user_id: int | None) -> str:
    if not user_id:
        return "the inquiry owner"
    u = db.query(User).filter(User.id == user_id).first()
    return (u.name or u.email) if u else f"user #{user_id}"


# ── Technical Offers (picked on a quotation) ─────────────────────────────
# R&D's released offers and BD's own uploads (origin "bd"). An offer is an uploaded Word / PDF file
# (rnd/services/technical_offers.py); offers written in Word before uploads existed keep their managed document.

def _offer_dict(db: Session, o: RndTechnicalOffer, user: User | None = None) -> dict:
    doc = db.get(CrmDocument, o.document_id) if o.document_id else None
    ext = technical_offers._extension(doc.file_name) if doc else ".docx"   # legacy offers are Word documents
    return {"id": o.id, "offer_number": o.offer_number, "offer_date": o.offer_date.isoformat(), "title": o.title,
            "revision": o.revision, "status": o.status, "status_label": technical_offers.status_label(o),
            "released_at": o.released_at.isoformat() if o.released_at else None,
            "origin": o.origin, "notes": o.notes,
            "label": "Uploaded by BD, not reviewed by R&D" if o.origin == "bd" else None,
            "based_on_earlier_revision": _based_on_earlier_revision(db, o),
            "file_type": ext.lstrip("."),
            # A Word offer is stacked on top of the quotation Word file; a PDF is attached separately (AC-33).
            "stacked_in_quotation": ext == ".docx",
            "file_name": doc.file_name if doc else f"{o.offer_number}.docx",
            "file_size": doc.file_size if doc else None,
            "uploaded_by": _user_label(db, o.created_by_id) if o.created_by_id else None,
            "uploaded_at": o.created_at.isoformat() if o.created_at else None,
            "quoted_in": [q.quot_number or f"quotation #{q.id}" for q in db.query(Quotation).filter(Quotation.technical_offer_id == o.id).all()],
            # BD deletes its own upload while no quotation uses it (AC-32).
            "can_delete": bool(user and o.origin == "bd" and can_feature(user, "crm", "inquiries_tenders", "technical_offer", "delete")
                               and not db.query(Quotation.id).filter(Quotation.technical_offer_id == o.id).first())}


def _based_on_earlier_revision(db: Session, o: RndTechnicalOffer) -> bool:
    if o.origin != "rnd" or o.requirement_revision_no is None:
        return False
    from app.modules.rnd.models.requirement import RndRequirement
    req = db.query(RndRequirement).filter(RndRequirement.source == o.source, RndRequirement.record_id == o.record_id).first()
    return bool(req and o.requirement_revision_no < req.current_revision)


def _quotable_offer(db: Session, inquiry: Inquiry, offer_id: int) -> RndTechnicalOffer:
    offer = db.query(RndTechnicalOffer).filter(RndTechnicalOffer.id == offer_id).first()
    if not offer or offer.source != "inquiry" or offer.record_id != inquiry.id:
        raise HTTPException(status_code=422, detail="That Technical Offer doesn't belong to this inquiry — reopen the quotation form and pick one from the list.")
    if offer.status not in ("released", "superseded"):
        waiting = ("waiting for the R&D head's release" if offer.status == "submitted"
                   else "returned by the R&D head — R&D has to upload a corrected file" if offer.returned_reason
                   else "not uploaded yet")
        raise HTTPException(status_code=422, detail=f"Technical Offer {offer.offer_number} isn't released yet ({waiting}). Ask R&D to release it (R&D › Requirements), then pick it again.")
    return offer


def _load_live_tender(db: Session, tender_id: int, user: User, lock: bool = False) -> Tender:
    q = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    tender = q.first()
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found or deleted — restore it before working on its Technical Offers.")
    ensure_in_scope(db, user, tender)
    return tender


def _record_offers(db: Session, source: str, record_id: int, user: User | None = None) -> list[dict]:
    """Released R&D offers and BD's uploads for the record, newest first (superseded ones stay listed
    for quoting against an older revision). Pending / returned R&D offers are never listed (AC-30)."""
    offers = db.query(RndTechnicalOffer).filter(
        RndTechnicalOffer.source == source, RndTechnicalOffer.record_id == record_id,
        RndTechnicalOffer.status.in_(("released", "superseded")),
    ).order_by(RndTechnicalOffer.id.desc()).all()
    return [_offer_dict(db, o, user) for o in offers]


@router.get("/inquiries/{inquiry_id}/technical-offers")
async def list_inquiry_technical_offers(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("crm", "inquiries_tenders"))):
    """Offers a quotation can quote against: R&D's released ones and BD's own uploads (latest first)."""
    _load_live_inquiry(db, inquiry_id, _user)
    return _record_offers(db, "inquiry", inquiry_id, _user)


@router.get("/tenders/{tender_id}/technical-offers")
async def list_tender_technical_offers(tender_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("crm", "inquiries_tenders"))):
    _load_live_tender(db, tender_id, _user)
    return _record_offers(db, "tender", tender_id, _user)


def _rnd_requirement_out(db: Session, source: str, record_id: int) -> dict | None:
    """BD's view of the R&D intake state: R&D ID, current revision and status, why R&D returned it,
    and every revision (who sent / reviewed it). None until the requirement was sent to R&D."""
    from app.modules.rnd.services import requirements as intake
    req = intake.get(db, source, record_id)
    if req is None:
        return None
    rev = intake.latest_revision(db, req)
    revisions = intake.revisions_out(db, req, None)
    latest = revisions[0] if revisions else {}
    return {
        **intake.requirement_out(db, req, rev),
        "review_remarks": latest.get("review_remarks"), "return_reason": latest.get("return_reason") if req.status == "returned" else None,
        "reviewed_by": latest.get("reviewed_by"), "reviewed_at": latest.get("reviewed_at"),
        "can_resend": True,   # a re-send is always allowed — after a return it opens the next revision even if nothing changed
        "revisions": revisions,
    }


@router.get("/inquiries/{inquiry_id}/rnd-requirement")
async def get_inquiry_rnd_requirement(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("crm", "inquiries_tenders"))):
    _load_live_inquiry(db, inquiry_id, _user)
    return _rnd_requirement_out(db, "inquiry", inquiry_id)


@router.get("/tenders/{tender_id}/rnd-requirement")
async def get_tender_rnd_requirement(tender_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("crm", "inquiries_tenders"))):
    _load_live_tender(db, tender_id, _user)
    return _rnd_requirement_out(db, "tender", tender_id)


def _parse_offer_date(value: str | None) -> date:
    if not (value or "").strip():
        raise HTTPException(status_code=422, detail="Enter the offer date — it is printed on the quotation next to the offer number.")
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Offer date '{value}' isn't a valid date — pick it from the calendar.") from None


async def _upload_bd_offer(db: Session, user: User, source: str, record, file: UploadFile | None, title: str | None,
                           offer_date: str | None, notes: str | None) -> dict:
    """BD's own Technical Offer: no R&D requirement needed, quotable at once (status released),
    numbered BTO-…[-Rn]; a newer BD upload supersedes the previous one."""
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Give the offer a title — what it is for, e.g. 'Rail Grinding Machine RGM-25'.")
    if len(title) > 255:
        raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 255.")
    when = _parse_offer_date(offer_date)
    upload = await technical_offers.read_upload(file)
    latest, revision = technical_offers.next_revision(db, source, record.id, "bd")
    now = datetime.now(timezone.utc)
    base = technical_offers.number_base(source, record, technical_offers.BD_PREFIX)
    offer = RndTechnicalOffer(
        source=source, record_id=record.id, origin="bd", offer_number_base=base, revision=revision,
        offer_number=technical_offers.number_for(base, revision), offer_date=when, title=title[:255],
        notes=(notes or "").strip() or None, status="released", created_by_id=user.id,
        released_by_id=user.id, released_at=now, submitted_by_id=user.id, submitted_at=now,
        revision_reason=(f"Replaces {latest.offer_number}" if latest else None),
    )
    db.add(offer)
    technical_offers.flush_offer(db)
    for prev in db.query(RndTechnicalOffer).filter(
        RndTechnicalOffer.source == source, RndTechnicalOffer.record_id == record.id, RndTechnicalOffer.origin == "bd",
        RndTechnicalOffer.status == "released", RndTechnicalOffer.id != offer.id,
    ).all():
        prev.status = "superseded"
    await technical_offers.store_file(db, source=source, record=record, offer=offer, file=upload, user=user)
    db.add(AuditLog(entity_type=source, entity_id=record.id, action="technical_offer_uploaded", module_key="crm",
                    summary=f"{user.name or user.email} uploaded Technical Offer {offer.offer_number} ({upload.filename}) — BD's own offer.",
                    performed_by_id=user.id))
    db.commit()
    db.refresh(offer)
    return _offer_dict(db, offer, user)


@router.post("/inquiries/{inquiry_id}/technical-offers", status_code=201)
async def upload_inquiry_technical_offer(
    inquiry_id: int, file: UploadFile | None = File(None), title: str | None = Form(None), offer_date: str | None = Form(None),
    notes: str | None = Form(None), db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("crm", "inquiries_tenders", "technical_offer", "create")),
):
    """Upload BD's own Technical Offer (Word .docx or PDF) on an inquiry."""
    inquiry = _load_live_inquiry(db, inquiry_id, user)
    return await _upload_bd_offer(db, user, "inquiry", inquiry, file, title, offer_date, notes)


@router.post("/tenders/{tender_id}/technical-offers", status_code=201)
async def upload_tender_technical_offer(
    tender_id: int, file: UploadFile | None = File(None), title: str | None = Form(None), offer_date: str | None = Form(None),
    notes: str | None = Form(None), db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("crm", "inquiries_tenders", "technical_offer", "create")),
):
    """Upload BD's own Technical Offer (Word .docx or PDF) on a tender."""
    tender = _load_live_tender(db, tender_id, user)
    return await _upload_bd_offer(db, user, "tender", tender, file, title, offer_date, notes)


@router.delete("/technical-offers/{offer_id}")
async def delete_bd_technical_offer(offer_id: int, db: Session = Depends(get_db),
                                    user: User = Depends(require_feature_action("crm", "inquiries_tenders", "technical_offer", "delete"))):
    """Delete BD's own offer — refused while a quotation uses it (AC-32). R&D's offers are R&D's to manage."""
    offer = db.query(RndTechnicalOffer).filter(RndTechnicalOffer.id == offer_id).first()
    if not offer:
        raise HTTPException(status_code=404, detail="This Technical Offer was already deleted — refresh the page.")
    record = _load_live_inquiry(db, offer.record_id, user) if offer.source == "inquiry" else _load_live_tender(db, offer.record_id, user)
    if offer.origin != "bd":
        raise HTTPException(status_code=403, detail=f"{offer.offer_number} is R&D's offer — only R&D manages it (R&D › Requirements › Technical Offers).")
    using = [q.quot_number or f"quotation #{q.id}" for q in db.query(Quotation).filter(Quotation.technical_offer_id == offer.id).all()]
    if using:
        raise HTTPException(status_code=409, detail=f"Used by quotation {', '.join(using)} — remove it from the quotation first.")
    if offer.document_id:
        doc = db.get(CrmDocument, offer.document_id)
        if doc:
            doc.is_deleted = True
    db.add(AuditLog(entity_type=offer.source, entity_id=record.id, action="technical_offer_deleted", module_key="crm",
                    summary=f"{user.name or user.email} deleted BD's Technical Offer {offer.offer_number}.", performed_by_id=user.id))
    db.delete(offer)
    db.commit()
    return {"message": f"Technical Offer {offer.offer_number} deleted."}


async def _offer_response(db: Session, offer: RndTechnicalOffer):
    content, filename, mime = await technical_offers.offer_file(db, offer)
    return Response(content=content, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/inquiries/{inquiry_id}/technical-offers/{offer_id}/file")
async def download_inquiry_technical_offer(inquiry_id: int, offer_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "technical_offer", "view"))):
    """The offer's file (as uploaded). The offer must be on this inquiry and quotable — released or superseded."""
    inquiry = _load_live_inquiry(db, inquiry_id, _user)
    return await _offer_response(db, _quotable_offer(db, inquiry, offer_id))


@router.get("/tenders/{tender_id}/technical-offers/{offer_id}/file")
async def download_tender_technical_offer(tender_id: int, offer_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "technical_offer", "view"))):
    tender = _load_live_tender(db, tender_id, _user)
    offer = db.query(RndTechnicalOffer).filter(RndTechnicalOffer.id == offer_id).first()
    if not offer or offer.source != "tender" or offer.record_id != tender.id:
        raise HTTPException(status_code=404, detail="That Technical Offer isn't on this tender — refresh the page.")
    if offer.status not in ("released", "superseded"):
        raise HTTPException(status_code=422, detail=f"Technical Offer {offer.offer_number} isn't released yet — R&D has to release it first.")
    return await _offer_response(db, offer)


# ── Quotations ───────────────────────────────────────────────────────────

@router.get("/inquiries/{inquiry_id}/quotations", response_model=list[QuotationResponse])
async def list_quotations(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "view"))):
    _load_live_inquiry(db, inquiry_id, _user)
    if qstatus.expire_due(db):  # validity ended since the daily job last ran
        db.commit()
    return [quotation_out(q, _user) for q in db.query(Quotation).filter(Quotation.inquiry_id == inquiry_id).order_by(Quotation.id.desc()).all()]


@router.get("/past-quotations", response_model=list[QuotationResponse])
async def list_past_quotations(q: str | None = None, limit: int = 30, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "view"))):
    """Recent quotations across every live inquiry in the user's CRM data scope —
    the "Fill from a past quotation" picker on the quotation form copies one of
    these (items, prices, terms) into a new quotation. Optional search on the
    quotation number, client name or a line item's name / model number."""
    inquiries = apply_scope(db.query(Inquiry.id).filter(Inquiry.is_deleted == False), _user, Inquiry, db)  # noqa: E712
    query = db.query(Quotation).options(selectinload(Quotation.items)).filter(Quotation.inquiry_id.in_(inquiries.statement))
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(or_(
            Quotation.quot_number.ilike(like), Quotation.client_name.ilike(like),
            Quotation.items.any(or_(QuotationLineItem.description.ilike(like), QuotationLineItem.model_number.ilike(like))),
        ))
    rows = query.order_by(Quotation.id.desc()).limit(max(1, min(limit, 100))).all()
    return [quotation_out(r, _user) for r in rows]


QUOT_SEQ_RE = re.compile(r"-(\d+)$")


def _next_quot_number(db: Session, inquiry: Inquiry) -> str:
    # Every quotation row is its own "quote lineage" — revisions mutate the row in place
    # (see update_quotation). The next number is max(existing or deleted sequence) + 1, never a
    # row count: a count re-issues a number after a delete, giving two legal documents (and two
    # SharePoint folders) the same number. The caller locks the inquiry row so two concurrent
    # saves on one inquiry serialise here.
    suffix = inquiry.universal_id.split("INQ-")[-1] if inquiry.universal_id else str(inquiry.id)
    prefix = f"QT-{suffix}-"
    bases = [
        (base or (number or "").split("-r")[0])
        for base, number in db.query(Quotation.quot_number_base, Quotation.quot_number)
        .filter(Quotation.inquiry_id == inquiry.id).all()
    ]
    # Numbers of deleted quotations stay burnt (recorded on delete, see delete_quotation).
    bases += [
        v for (v,) in db.query(AuditLog.old_value).filter(
            AuditLog.entity_type == "quotation_revision", AuditLog.action == "delete",
            AuditLog.old_value.like(f"{prefix}%"),
        ).all()
    ]
    seq = 0
    for base in bases:
        if base and base.startswith(prefix):
            m = QUOT_SEQ_RE.search(base)
            if m:
                seq = max(seq, int(m.group(1)))
    return f"{prefix}{seq + 1:02d}"


# A revision may change any content field and the line items; customer_response /
# submitted_date are status tracking and never count as a revision on their own.
QUOTATION_NON_NULL_FIELDS = {"quotation_type", "gst_type", "pricing_mode"}
QUOTATION_TRACKING_FIELDS = {"customer_response", "submitted_date"}


def _write_quotation_revision(db: Session, quot_id: int, user: User, old_vals: dict, new_vals: dict):
    db.add(AuditLog(
        entity_type="quotation_revision", entity_id=quot_id, action="revision",
        old_value=json.dumps(old_vals, default=str), new_value=json.dumps(new_vals, default=str),
        summary=f"{user.name or user.email} revised: {', '.join(new_vals.keys())}.",
        performed_by_id=user.id,
    ))


@router.post("/inquiries/{inquiry_id}/quotations", response_model=QuotationResponse, status_code=201)
async def create_quotation(inquiry_id: int, payload: QuotationCreate, db: Session = Depends(get_db), user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "create"))):
    inquiry = _load_live_inquiry(db, inquiry_id, user, lock=True)
    if user.role != "admin" and inquiry.created_by_id != user.id:
        raise HTTPException(
            status_code=403,
            detail=f"Only the inquiry owner or an admin can create a quotation on this inquiry — ask {_user_label(db, inquiry.created_by_id)} or an admin.",
        )
    payload.items = prepare_quotation_lines(db, payload.items)
    quot_number = _next_quot_number(db, inquiry)
    data = payload.model_dump(exclude={"items"})
    if payload.technical_offer_id:
        offer = _quotable_offer(db, inquiry, payload.technical_offer_id)
        data["technical_offer_number"], data["technical_offer_date"] = offer.offer_number, offer.offer_date
    if data.get("quotation_type") == "Export":
        data["lump_sum_gst_percent"] = None
        for item in payload.items:
            item.gst_percent = None
    if data.get("pricing_mode") == "lumpsum":
        # A lump-sum offer prices the whole package — per-line prices would contradict it.
        for item in payload.items:
            item.unit_price = item.gst_percent = None
        # Same as a revision: the lump-sum price is the negotiated package price — no header discount on top.
        data["discount"] = data["discount_type"] = None
    else:
        data["price"] = data["lump_sum_gst_percent"] = None
    # A new quotation is a draft: it is submitted for approval and sent from the
    # status actions (routes/quotation_status.py), never created as "Accepted".
    data["customer_response"] = qstatus.AWAITING
    quot = Quotation(
        **data, inquiry_id=inquiry_id, quot_number=quot_number, quot_number_base=quot_number, revision_number=0,
        created_by_id=user.id, created_at=datetime.now(timezone.utc), status="draft",
    )
    # subtotal/total are server-computed, never trusted from the client — this quote is a
    # legally-facing document, so its totals can't be tampered with via the create payload.
    items = []
    for i, item in enumerate(payload.items):
        item_data = item.model_dump(exclude={"subtotal", "total"})
        subtotal = (item_data.get("quantity") or 0) * (item_data.get("unit_price") or 0)
        total = subtotal if data.get("quotation_type") == "Export" else subtotal * (1 + (item_data.get("gst_percent") or 0) / 100)
        items.append(QuotationLineItem(**item_data, subtotal=round(subtotal, 2), total=round(total, 2), sort_order=i))
    quot.items = items
    db.add(quot)
    db.commit()
    db.refresh(quot)
    return quotation_out(quot, user)


def _line_summary(it) -> str:
    """One line item as text, for the revision history (old → new)."""
    parts = [it.description or "Item"]
    if it.model_number:
        parts.append(f"({it.model_number})")
    if it.quantity is not None:
        parts.append(f"× {it.quantity:g}")
    if it.unit_price is not None:
        parts.append(f"@ {it.unit_price:g}")
    if it.gst_percent is not None:
        parts.append(f"GST {it.gst_percent:g}%")
    if it.details:
        parts.append(f"— {it.details}")
    return " ".join(parts)


def _ensure_not_ordered(db: Session, quot: Quotation, action: str) -> None:
    """A quotation a live HISTORIC sales order was raised from is that order's reference
    document (prices / terms were copied from it) — it can't be revised or deleted
    afterwards. Sales Orders were retired on 2026-10-30; only old orders still guard their
    quotation. A new offer to the customer is a new quotation."""
    from app.modules.sales.models.order import SalesOrder, SALES_ORDER_LIVE_STATUSES
    so = db.query(SalesOrder).filter(
        SalesOrder.source_quotation_id == quot.id, SalesOrder.is_deleted == False,  # noqa: E712
        SalesOrder.status.in_(SALES_ORDER_LIVE_STATUSES),
    ).first()
    if so:
        raise HTTPException(status_code=409, detail=(
            f"Quotation {quot.quot_number} can't be {action}: historic sales order {so.display_number} was raised from it — "
            "make a new quotation instead."))


@router.patch("/inquiries/{inquiry_id}/quotations/{quot_id}", response_model=QuotationResponse)
async def update_quotation(inquiry_id: int, quot_id: int, payload: QuotationUpdate, db: Session = Depends(get_db), user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "edit"))):
    inquiry = _load_live_inquiry(db, inquiry_id, user)
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found — it may have been deleted. Refresh the inquiry.")

    updates = payload.model_dump(exclude_unset=True, exclude={"items"})
    for f in QUOTATION_NON_NULL_FIELDS:
        if updates.get(f, "") is None:
            updates.pop(f)
    # customer_response / submitted_date are status tracking, not content: the inquiry owner
    # may record them too. Any content revision stays with the quotation creator or an admin.
    tracking_only = set(updates) <= QUOTATION_TRACKING_FIELDS and payload.items is None
    # A finalised (approved) quotation is locked for everyone, admins included —
    # a changed offer is a new quotation (Create Quote), never an edit of this one.
    if not tracking_only and quot.status not in ("draft", "submitted"):
        raise HTTPException(status_code=409, detail=(
            f"Quotation {quot.quot_number} is finalised ({quot.status}) and can't be edited by anyone. "
            "To offer different prices or terms, use 'Create revision from this quotation' (or + Create Quote) on this inquiry."))
    if not _can_modify(quot, user) and not (tracking_only and inquiry.created_by_id == user.id):
        if tracking_only:
            detail = (f"Only the inquiry owner, the quotation's creator or an admin can record the customer response — "
                      f"ask {_user_label(db, quot.created_by_id)} or an admin.")
        else:
            detail = (f"Only the quotation's creator or an admin can revise this quotation — "
                      f"ask {_user_label(db, quot.created_by_id)} or an admin.")
        raise HTTPException(status_code=403, detail=detail)

    # The quotation as it will be after this revision — validated as a whole.
    after = {f: updates.get(f, getattr(quot, f)) for f in QuotationUpdate.model_fields if f != "items"}
    if after["valid_until"] and after["quote_date"] and after["valid_until"] < after["quote_date"]:
        raise HTTPException(status_code=422, detail=(
            f"Valid Until ({after['valid_until'].isoformat()}) is before the Quote Date ({after['quote_date'].isoformat()}). "
            "Set Valid Until on or after the quote date."))
    if after["discount"] and (after["discount_type"] or "percent") == "percent" and after["discount"] > 100:
        raise HTTPException(status_code=422, detail=(
            f"Discount is {after['discount']}% — a percent discount cannot exceed 100%. "
            "Enter 100 or less, or switch the discount type to a flat amount."))
    lumpsum = after["pricing_mode"] == "lumpsum"
    export = after["quotation_type"] == "Export"
    if lumpsum and not after["price"]:
        raise HTTPException(status_code=422, detail=(
            "Pricing is Lump sum but Total Price is empty. Enter the total price for the whole offer, or switch Pricing to Item-wise."))
    if payload.items is not None:
        payload.items = prepare_quotation_lines(db, payload.items)
    if payload.items is not None and not any((it.description or "").strip() for it in payload.items):
        raise HTTPException(status_code=422, detail="A quotation needs at least one line item with a Product and Application — add one before saving the revision.")
    if "technical_offer_id" in updates and updates["technical_offer_id"] != quot.technical_offer_id:
        if updates["technical_offer_id"]:
            offer = _quotable_offer(db, inquiry, updates["technical_offer_id"])
            updates["technical_offer_number"], updates["technical_offer_date"] = offer.offer_number, offer.offer_date
        else:
            updates["technical_offer_number"] = updates["technical_offer_date"] = None
    # Same normalisation as create: Export has no GST; lump sum prices the whole package.
    if export:
        updates["lump_sum_gst_percent"] = None
    if lumpsum:
        updates["discount"] = updates["discount_type"] = None
    else:
        updates["price"] = updates["lump_sum_gst_percent"] = None

    if quot.status == "submitted" and set(updates) - QUOTATION_TRACKING_FIELDS | ({"items"} if payload.items is not None else set()):
        raise HTTPException(status_code=409, detail=(
            f"Quotation {quot.quot_number} is waiting for approval — withdraw it from approval before revising it."))
    old_vals: dict = {}
    new_vals: dict = {}
    response_value = updates.pop("customer_response", None)
    old_response_check = {"customer_response": quot.customer_response} if response_value is not None else {}
    for field, value in updates.items():
        old = getattr(quot, field, None)
        is_content = field not in QUOTATION_TRACKING_FIELDS and field not in ("technical_offer_number", "technical_offer_date")
        if is_content and (old or None) != (value or None) and str(old) != str(value):
            old_vals[field] = old
            new_vals[field] = value
        setattr(quot, field, value)

    old_lines = [_line_summary(it) for it in quot.items]
    if payload.items is not None:
        quot.items = [
            QuotationLineItem(**it.model_dump(exclude={"subtotal", "total"}), sort_order=i)
            for i, it in enumerate(x for x in payload.items if (x.description or "").strip())
        ]
    # Totals are always server-computed — also after a type / pricing change with the same lines.
    for item in quot.items:
        if export or lumpsum:
            item.gst_percent = None
        if lumpsum:
            item.unit_price = None
        subtotal = (item.quantity or 0) * (item.unit_price or 0)
        item.subtotal = round(subtotal, 2)
        item.total = round(subtotal * (1 + (item.gst_percent or 0) / 100), 2)
    new_lines = [_line_summary(it) for it in quot.items]
    if new_lines != old_lines:
        old_vals["items"] = "\n".join(old_lines) or "—"
        new_vals["items"] = "\n".join(new_lines) or "—"

    if new_vals:
        # Only a real content change is blocked — recording the customer response stays possible.
        _ensure_not_ordered(db, quot, "revised")
        quot.revision_number += 1
        quot.quot_number = f"{quot.quot_number_base or quot.quot_number}-r{quot.revision_number}"
        # The customer accepted / rejected the previous revision, not this one — a revised
        # offer is a new offer: back to draft, approval again before it is sent
        # (otherwise the Sales order prefill would copy the new prices as "accepted").
        if quot.status != "draft" or quot.customer_response != qstatus.AWAITING:
            old_vals["status"], new_vals["status"] = quot.status, "draft"
        qstatus.on_revised(db, quot, user)
        _write_quotation_revision(db, quot.id, user, old_vals, new_vals)
    elif response_value is not None and response_value != old_response_check["customer_response"]:
        # The response of the quotation a live sales order was raised from is part of that
        # order's reference — it can't be flipped to Rejected / Negotiating afterwards.
        _ensure_not_ordered(db, quot, "given a different customer response")
        # The old "Customer response" select, mapped onto the status flow (draft →
        # approved → sent → accepted / lost) — never a free-text outcome.
        qstatus.apply_customer_response(db, quot, inquiry, user, response_value)

    db.commit()
    db.refresh(quot)
    return quotation_out(quot, user)


@router.get("/inquiries/{inquiry_id}/quotations/{quot_id}/revisions")
async def list_quotation_revisions(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "view"))):
    _load_live_inquiry(db, inquiry_id, _user)
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    # Only "revision" rows — the same entity_type also holds "delete" rows (burnt quotation
    # numbers, plain text old_value) that must never be parsed or shown as a revision.
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "quotation_revision", AuditLog.entity_id == quot_id,
        AuditLog.action == "revision",
    ).order_by(AuditLog.performed_at.asc()).all()
    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"
    result = []
    for seq, log in enumerate(logs, start=1):
        old_vals = json.loads(log.old_value) if log.old_value else {}
        new_vals = json.loads(log.new_value) if log.new_value else {}
        result.append({
            "id": log.id,
            "revision_id": f"r{seq}",
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
            "changes": [
                {"field": f, "old": old_vals.get(f), "new": new_vals.get(f)}
                for f in new_vals.keys()
            ],
        })
    result.reverse()
    if not sees_quotation_prices(_user):
        # Line items' text carries "@ price" — blank them with the money fields.
        for r in result:
            for c in r["changes"]:
                if c["field"] in (*QUOTATION_MONEY_FIELDS, "items"):
                    c["old"] = c["new"] = None
    return result


def quotation_document_context(db: Session, quot: Quotation) -> dict:
    """Data for the quotation PDF/Word builders — shared so both always print
    the same client block, numbers and terms."""
    inquiry = db.query(Inquiry).filter(Inquiry.id == quot.inquiry_id).first()
    org = db.query(OrgModel).filter(OrgModel.id == inquiry.org_id).first() if inquiry else None
    client_address_parts = [p for p in [org.address if org else None, org.city if org else None, org.state if org else None, org.pin_code if org else None] if p]
    return {
        "quot_number": quot.quot_number,
        "revision_number": quot.revision_number,
        "quotation_type": quot.quotation_type,
        "gst_type": quot.gst_type,
        "quote_date": quot.quote_date.isoformat() if quot.quote_date else None,
        "technical_offer_number": quot.technical_offer_number,
        "technical_offer_date": quot.technical_offer_date.isoformat() if quot.technical_offer_date else None,
        "client_name": quot.client_name,
        "client_address": ", ".join(client_address_parts) or None,
        "client_gst_number": org.gst_number if org else None,
        "client_contact_name": quot.client_contact_name,
        "client_contact_email": quot.client_contact_email,
        "client_contact_phone": quot.client_contact_phone,
        "valid_until": quot.valid_until.isoformat() if quot.valid_until else None,
        "pricing_mode": quot.pricing_mode or "itemwise",
        "price": quot.price,
        "lump_sum_gst_percent": quot.lump_sum_gst_percent,
        "delivery_time": quot.delivery_time,
        "payment_terms": quot.payment_terms,
        "notes": quot.notes,
        "discount": getattr(quot, "discount", None),
        "discount_type": getattr(quot, "discount_type", None),
        "quote_conditions": getattr(quot, "quote_conditions", None),
        "currency_symbol": "$" if quot.quotation_type == "Export" else "Rs.",
        "items": [
            {
                "description": item.description,
                "model_number": item.model_number,
                "details": item.details,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "gst_percent": item.gst_percent,
                "subtotal": item.subtotal,
                "total": item.total,
            }
            for item in quot.items
        ],
    }


@router.get("/inquiries/{inquiry_id}/quotations/{quot_id}/pdf")
async def download_quotation_pdf(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "print"))):
    _load_live_inquiry(db, inquiry_id, _user)
    ensure_quotation_prices(_user)
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    filename = f"{quot.quot_number or f'Quotation-{quot.id}'}.pdf"
    # Once a Word document exists for this revision it is the document of
    # record: the PDF is its latest version (with any edits made in Word),
    # not a fresh render from the quotation data.
    word = managed_documents.active_for_revision(db, QUOTATION_ENTITY, quot.id, quot.revision_number)
    if word:
        content = await managed_documents.current_pdf(word)
    else:
        # No Word document yet: the Technical Offer's PDF on top (an uploaded PDF, or a legacy Word offer
        # rendered to PDF), then the commercial quotation. An uploaded Word offer can't be rendered here — it is
        # stacked into the Word file and otherwise attached separately (technical-offer-file).
        content = build_quotation_pdf(quotation_document_context(db, quot)).getvalue()
        offer_pdf = await _technical_offer_pdf(db, quot)
        if offer_pdf:
            content = merge_pdf(offer_pdf, content)
    return Response(
        content=content, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/inquiries/{inquiry_id}/quotations/{quot_id}")
async def delete_quotation(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "delete"))):
    _load_live_inquiry(db, inquiry_id, user)
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    # Quotations are legal offers — only an admin deletes one (and never one an order was raised from).
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can delete this quotation.")
    ensure_can_delete(user, quot, "crm", "inquiries_tenders", what="quotation")
    _ensure_not_ordered(db, quot, "deleted")
    # Keep the number burnt so _next_quot_number never re-issues it to a new quotation.
    db.add(AuditLog(
        entity_type="quotation_revision", entity_id=quot.id, action="delete", module_key="crm",
        field_name="quot_number_base", old_value=quot.quot_number_base or (quot.quot_number or "").split("-r")[0],
        summary=f"{user.name or user.email} deleted quotation {quot.quot_number}.", performed_by_id=user.id,
    ))
    db.delete(quot)
    db.commit()
    return {"message": "Quotation deleted"}


# ── Quotation as an editable Word document (generic routes: main/routes/documents.py) ──

def _quotation_document_target(db: Session, quot_id: int, user: User, modify: bool) -> managed_documents.DocumentTarget:
    quot = db.query(Quotation).filter(Quotation.id == quot_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found — it may have been deleted. Refresh the inquiry.")
    inquiry = db.query(Inquiry).filter(Inquiry.id == quot.inquiry_id).first()
    if not inquiry or inquiry.is_deleted:
        raise HTTPException(status_code=404, detail="Inquiry not found or deleted — restore it before working on its quotations.")
    ensure_in_scope(db, user, inquiry)
    # Opening/downloading the Word document = View; creating/editing/uploading it = Edit
    # (Inquiries & Tenders › Quotations feature), and it shows the prices.
    if modify:
        ensure_feature_action(user, "crm", "inquiries_tenders", "quotations", "edit")
    else:
        ensure_feature_action(user, "crm", "inquiries_tenders", "quotations", "view")
    ensure_quotation_prices(user)
    if modify and not _can_modify(quot, user):
        raise HTTPException(status_code=403, detail="Only the quotation's creator or an admin can change its Word document.")
    # Finalised quotation: its Word document is locked like the quotation itself (view / download only).
    if modify and quot.status not in ("draft", "submitted"):
        raise HTTPException(status_code=409, detail=(
            f"Quotation {quot.quot_number} is finalised ({quot.status}), so its Word document can't be created or changed by anyone — "
            "open or download it, or use Download PDF. For a changed offer use + Create Quote."))
    number = quot.quot_number or f"Quotation-{quot.id}"
    return managed_documents.DocumentTarget(
        entity_id=quot.id, revision=quot.revision_number, title=f"Quotation {number}",
        folder=managed_documents.sharepoint_folder("CRM-Quotations", quot.quot_number_base or number),
        filename_stem=managed_documents.safe_filename(number),
        build_docx=lambda: _quotation_docx(db, quot),
    )


def _quotation_offer(db: Session, quot: Quotation) -> RndTechnicalOffer | None:
    """The Technical Offer this quotation quotes against, if any."""
    if not quot.technical_offer_id:
        return None
    return db.get(RndTechnicalOffer, quot.technical_offer_id)


async def _technical_offer_docx(db: Session, quot: Quotation) -> bytes | None:
    """The offer as Word bytes when it can be stacked on top of the quotation: an uploaded .docx, or an
    offer written in Word before uploads existed. None for an uploaded PDF (attached separately)."""
    offer = _quotation_offer(db, quot)
    if offer is None:
        return None
    if not offer.document_id:
        legacy = managed_documents.get_active(db, technical_offers.ENTITY, offer.id)
        return await managed_documents.current_docx(legacy) if legacy else None
    content, filename, _ = await technical_offers.offer_file(db, offer)
    return content if filename.lower().endswith(".docx") else None


async def _technical_offer_pdf(db: Session, quot: Quotation) -> bytes | None:
    offer = _quotation_offer(db, quot)
    if offer is None:
        return None
    if not offer.document_id:
        legacy = managed_documents.get_active(db, technical_offers.ENTITY, offer.id)
        return await managed_documents.current_pdf(legacy) if legacy else None
    content, filename, _ = await technical_offers.offer_file(db, offer)
    return content if filename.lower().endswith(".pdf") else None


@router.get("/inquiries/{inquiry_id}/quotations/{quot_id}/technical-offer-file")
async def download_quotation_technical_offer(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "print"))):
    """The Technical Offer file attached to this quotation, for an offer that can't be stacked into the
    quotation document (an uploaded PDF) — it goes to the customer as a separate attachment."""
    _load_live_inquiry(db, inquiry_id, _user)
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found — it may have been deleted. Refresh the inquiry.")
    offer = _quotation_offer(db, quot)
    if offer is None:
        raise HTTPException(status_code=404, detail=f"Quotation {quot.quot_number} doesn't quote a Technical Offer — pick one in the quotation first.")
    return await _offer_response(db, offer)


async def _quotation_docx(db: Session, quot: Quotation) -> bytes:
    """Owner, 2026-10-27: the quotation the customer gets is one Word file — the Technical
    Offer on top (an uploaded .docx, or a legacy Word offer as R&D last saved it), the commercial
    quotation below, editable together in Word. An uploaded PDF offer is not stacked: it is attached
    separately (technical-offer-file) and the screen says so (AC-33)."""
    commercial = build_quotation_docx(quotation_document_context(db, quot)).getvalue()
    offer_docx = await _technical_offer_docx(db, quot)
    if not offer_docx:
        return commercial
    return merge_docx(offer_docx, commercial)


managed_documents.register(managed_documents.DocumentAdapter(entity_type=QUOTATION_ENTITY, app="crm", load=_quotation_document_target,
    view_grant="crm:inquiries_tenders.quotations:view", edit_grant="crm:inquiries_tenders.quotations:edit"))
