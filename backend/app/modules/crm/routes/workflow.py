import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization as OrgModel
from app.modules.crm.schemas.workflow import (
    QuotationCreate, QuotationUpdate, QuotationResponse,
)
from app.modules.crm.reports.quotation_pdf import build_quotation_pdf

router = APIRouter(prefix="/crm", tags=["CRM - Workflow"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


# ── Quotations ───────────────────────────────────────────────────────────

@router.get("/inquiries/{inquiry_id}/quotations", response_model=list[QuotationResponse])
async def list_quotations(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(Quotation).filter(Quotation.inquiry_id == inquiry_id).order_by(Quotation.id.desc()).all()


def _next_quot_number(db: Session, inquiry: Inquiry) -> str:
    # Every quotation row is its own "quote lineage" now — revisions mutate the row in place
    # (see update_quotation) instead of creating a new one, so this is a simple running count.
    seq = db.query(Quotation).filter(Quotation.inquiry_id == inquiry.id).count() + 1
    suffix = inquiry.universal_id.split("INQ-")[-1] if inquiry.universal_id else str(inquiry.id)
    return f"QT-{suffix}-{seq:02d}"


# Fields a revision is allowed to touch (top-level; line-item unit_price is handled
# separately below). Anything else about a quotation is fixed once created — a bigger change
# means creating a new quotation for the inquiry instead.
QUOTATION_REVISION_FIELDS = {"payment_terms", "valid_until", "delivery_time"}


def _write_quotation_revision(db: Session, quot_id: int, user: User, old_vals: dict, new_vals: dict):
    db.add(AuditLog(
        entity_type="quotation_revision", entity_id=quot_id, action="revision",
        old_value=json.dumps(old_vals, default=str), new_value=json.dumps(new_vals, default=str),
        summary=f"{user.name or user.email} revised: {', '.join(new_vals.keys())}.",
        performed_by_id=user.id,
    ))


@router.post("/inquiries/{inquiry_id}/quotations", response_model=QuotationResponse, status_code=201)
async def create_quotation(inquiry_id: int, payload: QuotationCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    quot_number = _next_quot_number(db, inquiry)
    data = payload.model_dump(exclude={"items"})
    if data.get("quotation_type") == "Export":
        for item in payload.items:
            item.gst_percent = None
    quot = Quotation(
        **data, inquiry_id=inquiry_id, quot_number=quot_number, quot_number_base=quot_number, revision_number=0,
        created_by_id=user.id, created_at=datetime.now(timezone.utc),
    )
    # subtotal/total are server-computed, never trusted from the client — this quote is a
    # legally-facing document, so its totals can't be tampered with via the create payload.
    items = []
    for i, item in enumerate(payload.items):
        item_data = item.model_dump(exclude={"subtotal", "total"})
        subtotal = (item_data.get("quantity") or 0) * (item_data.get("unit_price") or 0)
        total = subtotal if data.get("quotation_type") == "Export" else subtotal * (1 + (item_data.get("gst_percent") or 0) / 100)
        items.append(QuotationLineItem(**item_data, subtotal=subtotal, total=total, sort_order=i))
    quot.items = items
    db.add(quot)
    db.commit()
    db.refresh(quot)
    return quot


@router.patch("/inquiries/{inquiry_id}/quotations/{quot_id}", response_model=QuotationResponse)
async def update_quotation(inquiry_id: int, quot_id: int, payload: QuotationUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not _can_modify(quot, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can revise this quotation.")

    updates = payload.model_dump(exclude_unset=True, exclude={"items"})
    old_vals: dict = {}
    new_vals: dict = {}
    for field, value in updates.items():
        if field in QUOTATION_REVISION_FIELDS and str(getattr(quot, field, None)) != str(value):
            old_vals[field] = getattr(quot, field, None)
            new_vals[field] = value
        setattr(quot, field, value)

    if payload.items:
        items_by_id = {it.id: it for it in quot.items}
        for upd in payload.items:
            item = items_by_id.get(upd.id)
            if not item or upd.unit_price is None or item.unit_price == upd.unit_price:
                continue
            old_vals[f"item_{item.id}_unit_price"] = f"{item.description or 'Item'}: {item.unit_price}"
            new_vals[f"item_{item.id}_unit_price"] = f"{item.description or 'Item'}: {upd.unit_price}"
            item.unit_price = upd.unit_price
            item.subtotal = (item.quantity or 0) * upd.unit_price
            item.total = item.subtotal * (1 + (item.gst_percent or 0) / 100) if quot.quotation_type != "Export" else item.subtotal

    if new_vals:
        quot.revision_number += 1
        quot.quot_number = f"{quot.quot_number_base or quot.quot_number}-r{quot.revision_number}"
        _write_quotation_revision(db, quot.id, user, old_vals, new_vals)

    db.commit()
    db.refresh(quot)
    return quot


@router.get("/inquiries/{inquiry_id}/quotations/{quot_id}/revisions")
async def list_quotation_revisions(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "quotation_revision", AuditLog.entity_id == quot_id
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
    return result


@router.get("/inquiries/{inquiry_id}/quotations/{quot_id}/pdf")
async def download_quotation_pdf(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    org = db.query(OrgModel).filter(OrgModel.id == inquiry.org_id).first() if inquiry else None
    client_address_parts = [p for p in [org.address if org else None, org.city if org else None, org.state if org else None, org.pin_code if org else None] if p]
    ctx = {
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
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "gst_percent": item.gst_percent,
                "subtotal": item.subtotal,
                "total": item.total,
            }
            for item in quot.items
        ],
    }
    buf = build_quotation_pdf(ctx)
    filename = f"{quot.quot_number or f'Quotation-{quot.id}'}.pdf"
    return Response(
        content=buf.getvalue(), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/inquiries/{inquiry_id}/quotations/{quot_id}")
async def delete_quotation(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can delete this quotation.")
    db.delete(quot)
    db.commit()
    return {"message": "Quotation deleted"}
