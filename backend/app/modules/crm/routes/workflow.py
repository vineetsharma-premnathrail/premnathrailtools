import json
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import ensure_can_delete, ensure_feature_action, require_feature_action, require_tab_access, require_tab_action
from app.core.data_scope import ensure_in_scope
import app.modules.crm.access  # noqa: F401 — registers the CRM data-scope models
from app.modules.crm.access import QUOTATION_LINE_MONEY_FIELDS, QUOTATION_MONEY_FIELDS, blank, sees_quotation_prices
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization as OrgModel
from app.modules.crm.schemas.workflow import (
    QuotationCreate, QuotationUpdate, QuotationResponse,
)
from app.modules.crm.reports.quotation_pdf import build_quotation_pdf
from app.modules.crm.reports.quotation_docx import build_quotation_docx
from app.modules.main.services import managed_documents
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
    if not sees_quotation_prices(user):
        blank(out, QUOTATION_MONEY_FIELDS)
        for it in out.items:
            blank(it, QUOTATION_LINE_MONEY_FIELDS)
    return out


def ensure_quotation_prices(user: User) -> None:
    """A quotation PDF / Word document is the priced offer — it opens only for
    someone who may see quotation prices."""
    if not sees_quotation_prices(user):
        raise HTTPException(status_code=403, detail=(
            "The quotation document shows its prices, and you don't have CRM › Inquiries & Tenders › Prices & margins "
            "(crm:inquiries_tenders.prices:view). Ask an admin to add it to one of your roles (Organization › Role & Permissions)."))


def _user_label(db: Session, user_id: int | None) -> str:
    if not user_id:
        return "the inquiry owner"
    u = db.query(User).filter(User.id == user_id).first()
    return (u.name or u.email) if u else f"user #{user_id}"


# ── R&D Technical Offers (picked on a quotation) ─────────────────────────

def _offer_dict(o: RndTechnicalOffer) -> dict:
    return {"id": o.id, "offer_number": o.offer_number, "offer_date": o.offer_date.isoformat(), "title": o.title,
            "revision": o.revision, "status": o.status, "released_at": o.released_at.isoformat() if o.released_at else None}


def _quotable_offer(db: Session, inquiry: Inquiry, offer_id: int) -> RndTechnicalOffer:
    offer = db.query(RndTechnicalOffer).filter(RndTechnicalOffer.id == offer_id).first()
    if not offer or offer.source != "inquiry" or offer.record_id != inquiry.id:
        raise HTTPException(status_code=422, detail="That Technical Offer doesn't belong to this inquiry — reopen the quotation form and pick one from the list.")
    if offer.status not in ("released", "superseded"):
        raise HTTPException(status_code=422, detail=f"Technical Offer {offer.offer_number} isn't approved yet ({'waiting for the R&D head' if offer.status == 'submitted' else 'still a draft'}). Ask the R&D head to approve it (R&D › Requirements), then pick it again.")
    return offer


@router.get("/inquiries/{inquiry_id}/technical-offers")
async def list_inquiry_technical_offers(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("crm", "inquiries_tenders"))):
    """R&D's released Technical Offers for this inquiry (latest revision first;
    superseded ones stay listed for quoting against an older revision)."""
    _load_live_inquiry(db, inquiry_id, _user)
    offers = db.query(RndTechnicalOffer).filter(
        RndTechnicalOffer.source == "inquiry", RndTechnicalOffer.record_id == inquiry_id,
        RndTechnicalOffer.status.in_(("released", "superseded")),
    ).order_by(RndTechnicalOffer.id.desc()).all()
    return [_offer_dict(o) for o in offers]


@router.get("/inquiries/{inquiry_id}/technical-offers/{offer_id}/pdf")
async def download_inquiry_technical_offer(inquiry_id: int, offer_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("crm", "inquiries_tenders", "print"))):
    inquiry = _load_live_inquiry(db, inquiry_id, _user)
    offer = _quotable_offer(db, inquiry, offer_id)
    doc = managed_documents.get_active(db, technical_offers.ENTITY, offer.id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Technical Offer {offer.offer_number} has no Word document on record — ask R&D to create it.")
    return Response(content=await managed_documents.current_pdf(doc), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{offer.offer_number}.pdf"'})


# ── Quotations ───────────────────────────────────────────────────────────

@router.get("/inquiries/{inquiry_id}/quotations", response_model=list[QuotationResponse])
async def list_quotations(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "view"))):
    _load_live_inquiry(db, inquiry_id, _user)
    if qstatus.expire_due(db):  # validity ended since the daily job last ran
        db.commit()
    return [quotation_out(q, _user) for q in db.query(Quotation).filter(Quotation.inquiry_id == inquiry_id).order_by(Quotation.id.desc()).all()]


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
    """A quotation a live sales order was raised from is that order's reference
    document (prices / terms were copied from it) — it can't be revised or deleted
    afterwards, or the order and its reference would disagree. A new offer to the
    customer is a new quotation; a change of the order is a Sales amendment."""
    from app.modules.sales.models.order import SalesOrder, SALES_ORDER_LIVE_STATUSES
    so = db.query(SalesOrder).filter(
        SalesOrder.source_quotation_id == quot.id, SalesOrder.is_deleted == False,  # noqa: E712
        SalesOrder.status.in_(SALES_ORDER_LIVE_STATUSES),
    ).first()
    if so:
        raise HTTPException(status_code=409, detail=(
            f"Quotation {quot.quot_number} can't be {action}: sales order {so.display_number} was raised from it. "
            f"Change the order through a Sales amendment instead, or cancel {so.display_number} first."))


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
            "To offer different prices or terms, use + Create Quote on this inquiry."))
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
    if payload.items is not None and not any((it.description or "").strip() for it in payload.items):
        raise HTTPException(status_code=422, detail="A quotation needs at least one line item with an Item Name — add one before saving the revision.")
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
    content = await managed_documents.pdf_of_record(
        db, QUOTATION_ENTITY, quot.id, quot.revision_number,
        render=lambda: build_quotation_pdf(quotation_document_context(db, quot)).getvalue(),
    )
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
        build_docx=lambda: build_quotation_docx(quotation_document_context(db, quot)).getvalue(),
    )


managed_documents.register(managed_documents.DocumentAdapter(entity_type=QUOTATION_ENTITY, app="crm", load=_quotation_document_target,
    view_grant="crm:inquiries_tenders.quotations:view", edit_grant="crm:inquiries_tenders.quotations:edit"))
