"""R&D › Requirements — the R&D side of CRM's "Send Technical Requirement to R&D".

Read-only inbox of every CRM Inquiry/Tender whose requirement has been sent to
R&D, with the full send history (see crm/services/requirement_movement.py). The
CRM record stays the single source of truth — nothing is copied into R&D
tables, so a re-send from CRM shows up here immediately.

Gated on the R&D app + the "requirements" sub-tab only (not on 'crm'): R&D
engineers usually have no CRM access, and these are exactly the records CRM
chose to hand over. The TOR PDF and attached client documents open through
/crm/documents/{id}/content, which already allows shared_via_tor documents.
"""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permission_registry import can_feature
from app.core.permissions import ensure_feature_action, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.rnd_request import CrmRndRequest
from app.utils.sharepoint import build_sharepoint_folder_path, upload_file_to_sharepoint
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.services import requirement_movement
from app.modules.rnd.services import requirement_access as ra

router = APIRouter(
    prefix="/requirements", tags=["RnD Requirements"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "requirements"))],
)

Source = Literal["inquiry", "tender"]


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _edited_after_send(record) -> bool:
    """The CRM requirement changed after R&D last received it — a re-send is due."""
    return bool(record.updated_at and record.technical_offer_sent_at and record.updated_at > record.technical_offer_sent_at)


def _send_stats(db: Session, source: str, ids: list[int]) -> dict[int, tuple[int, str | None]]:
    """record id -> (number of logged sends, name of whoever sent the latest one)."""
    if not ids:
        return {}
    entity_type = f"{source}_tor"
    counts = dict(db.query(AuditLog.entity_id, func.count(AuditLog.id)).filter(
        AuditLog.entity_type == entity_type, AuditLog.action == requirement_movement.ACTION,
        AuditLog.entity_id.in_(ids),
    ).group_by(AuditLog.entity_id).all())
    latest_summary: dict[int, str | None] = {}
    for entity_id, summary in db.query(AuditLog.entity_id, AuditLog.summary).filter(
        AuditLog.entity_type == entity_type, AuditLog.action == requirement_movement.ACTION,
        AuditLog.entity_id.in_(ids),
    ).order_by(AuditLog.performed_at.asc()).all():
        latest_summary[entity_id] = summary
    out = {}
    for i in ids:
        summary = latest_summary.get(i)
        sender = summary.split(" sent Technical Offer Request")[0] if summary else None
        out[i] = (counts.get(i, 0), sender)
    return out


@router.get("")
async def list_requirements(
    search: str | None = None,
    source: Source | None = None,
    mine: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows: list[dict] = []
    term = f"%{search.strip()}%" if search and search.strip() else None

    if source in (None, "inquiry"):
        q = db.query(Inquiry, Organization.name).outerjoin(Organization, Organization.id == Inquiry.org_id).filter(
            Inquiry.is_deleted == False, Inquiry.technical_offer_sent_at.isnot(None),  # noqa: E712
        )
        if term:
            q = q.filter(or_(
                Inquiry.universal_id.ilike(term), Inquiry.technical_offer_number.ilike(term),
                Inquiry.product.ilike(term), Inquiry.product_category.ilike(term), Organization.name.ilike(term),
            ))
        inquiries = q.all()
        stats = _send_stats(db, "inquiry", [i.id for i, _ in inquiries])
        reqs = requirement_movement.latest_requests(db, "inquiry", [i.id for i, _ in inquiries])
        for inq, org_name in inquiries:
            count, sender = stats.get(inq.id, (0, None))
            rows.append({
                "source": "inquiry", "record_id": inq.id, "universal_id": inq.universal_id,
                "offer_number": inq.technical_offer_number, "org_name": org_name,
                "product": inq.product, "category": inq.product_category,
                "quantity": f"{inq.quantity:g}" if inq.quantity is not None else None,
                "required_by": inq.required_delivery_date.isoformat() if inq.required_delivery_date else None,
                "priority": inq.priority, "bd_owner": inq.bd_owner,
                "last_sent_at": _iso(inq.technical_offer_sent_at), "last_sent_by": sender,
                "send_count": max(count, 1), "edited_after_send": _edited_after_send(inq),
                "rnd_request": reqs.get(inq.id),
            })

    if source in (None, "tender"):
        q = db.query(Tender, Organization.name).outerjoin(Organization, Organization.id == Tender.org_id).filter(
            Tender.is_deleted == False, Tender.technical_offer_sent_at.isnot(None),  # noqa: E712
        )
        if term:
            q = q.filter(or_(
                Tender.universal_id.ilike(term), Tender.technical_offer_number.ilike(term),
                Tender.tender_name.ilike(term), Tender.tender_number.ilike(term), Organization.name.ilike(term),
            ))
        tenders = q.all()
        stats = _send_stats(db, "tender", [t.id for t, _ in tenders])
        reqs = requirement_movement.latest_requests(db, "tender", [t.id for t, _ in tenders])
        for tnd, org_name in tenders:
            count, sender = stats.get(tnd.id, (0, None))
            rows.append({
                "source": "tender", "record_id": tnd.id, "universal_id": tnd.universal_id,
                "offer_number": tnd.technical_offer_number, "org_name": org_name,
                "product": tnd.tender_name, "category": tnd.tender_category,
                "quantity": None,
                "required_by": tnd.submission_date.isoformat() if tnd.submission_date else None,
                "priority": tnd.priority, "bd_owner": tnd.bd_owner,
                "last_sent_at": _iso(tnd.technical_offer_sent_at), "last_sent_by": sender,
                "send_count": max(count, 1), "edited_after_send": _edited_after_send(tnd),
                "rnd_request": reqs.get(tnd.id),
            })

    # Heads/admins see every requirement; others only those the head opened to
    # them (R&D access) or where they have a task.
    visible = ra.visible_keys(db, user)
    if visible is not None:
        rows = [r for r in rows if (r["source"], r["record_id"]) in visible]
    head = ra.is_head(db, user)
    for r in rows:
        r["can_respond"] = head or ra.access_for(db, user, r["source"], r["record_id"])["respond"]
    if mine:
        # Requests to the R&D head(s) are "mine" when I hold the Respond right.
        rows = [r for r in rows if r["rnd_request"] and (
            r["can_respond"] if r["rnd_request"]["assigned_to_id"] is None else r["rnd_request"]["assigned_to_id"] == user.id)]
    # Sections a role may not see (Organization › Role & Permissions › R&D ›
    # Requirements) are blanked in the list too, so they can't be read here.
    see_customer = can_feature(user, "rnd", "requirements", "customer", "view")
    see_crm = can_feature(user, "rnd", "requirements", "crm_info", "view")
    see_product = can_feature(user, "rnd", "requirements", "product_requirement", "view")
    for r in rows:
        if not see_customer:
            r["org_name"] = None
        if not see_crm:
            r["bd_owner"] = r["priority"] = None
        if not see_product:
            r["product"] = r["category"] = r["quantity"] = r["required_by"] = None
    rows.sort(key=lambda r: r["last_sent_at"] or "", reverse=True)
    return rows


def requirement_summary(db: Session, source: str, record) -> dict:
    """The requirement as R&D received it — header, customer, contact and the
    requirement fields. Also shown read-only to the departments R&D shares it
    with (routes/department_requirements.py)."""
    org = db.query(Organization).filter(Organization.id == record.org_id).first()
    contact = db.query(OrgContact).filter(OrgContact.id == record.org_contact_id).first() if record.org_contact_id else None

    if source == "inquiry":
        fields = [
            ("Product", record.product), ("Category", record.product_category),
            ("Quantity", f"{record.quantity:g}" if record.quantity is not None else None),
            ("Required Delivery", record.required_delivery_date.isoformat() if record.required_delivery_date else None),
            ("Delivery Location", record.delivery_location), ("Inspection Req.", record.inspection_req),
            ("Warranty Req.", record.warranty_req), ("Specification", record.product_spec),
            ("Requirement Summary", record.requirement_desc), ("Project Details", record.project_details),
        ]
        title = record.product or record.universal_id
    else:
        fields = [
            ("Tender Name", record.tender_name), ("Tender No.", record.tender_number),
            ("Category", record.tender_category), ("Authority", record.tender_authority),
            ("Tender Value", f"{record.currency} {record.tender_value:,.2f}" if record.tender_value is not None else None),
            ("Submission Date", record.submission_date.isoformat() if record.submission_date else None),
            ("Pre-bid Meeting", record.pre_bid_meeting_date.isoformat() if record.pre_bid_meeting_date else None),
        ]
        title = record.tender_name or record.universal_id

    return {
        "source": source, "record_id": record.id, "universal_id": record.universal_id, "title": title,
        "offer_number": record.technical_offer_number, "last_sent_at": _iso(record.technical_offer_sent_at),
        "edited_after_send": _edited_after_send(record),
        "priority": record.priority, "bd_owner": record.bd_owner, "crm_status": record.status,
        "organization": {
            "name": org.name if org else None, "type": org.org_type if org else None,
            "city": org.city if org else None, "state": org.state if org else None,
        },
        "contact": {
            "name": contact.name, "designation": contact.designation, "department": contact.department,
            "mobile": contact.mobile, "email": contact.email,
        } if contact else None,
        "requirement": [{"label": label, "value": value} for label, value in fields],
    }


@router.get("/{source}/{record_id}")
async def get_requirement(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    model = Inquiry if source == "inquiry" else Tender
    record = db.query(model).filter(model.id == record_id, model.is_deleted == False).first()  # noqa: E712
    if not record or not record.technical_offer_sent_at:
        raise HTTPException(
            status_code=404,
            detail=f"This {source} hasn't been sent to R&D (or was deleted in CRM). Only records sent via "
                   "\"Send Technical Requirement to R&D\" appear under R&D › Requirements.",
        )
    my_access = ra.ensure(db, user, source, record_id, "view")
    out = {
        **requirement_summary(db, source, record),
        "movements": requirement_movement.list_movements(db, module=source, record=record),
        "my_access": my_access,
    }
    _mask_sections(out, user, source)
    return out


def _mask_sections(out: dict, user: User, source: str) -> None:
    """Blank the requirement sections this user's roles don't include
    (R&D › Requirements features). The keys stay, so the response shape is
    unchanged; `hidden_sections` tells the page which blocks to leave out."""
    hidden = []
    if not can_feature(user, "rnd", "requirements", "customer", "view"):
        hidden.append("customer")
        out["organization"] = {"name": None, "type": None, "city": None, "state": None}
        out["contact"] = None
    if not can_feature(user, "rnd", "requirements", "crm_info", "view"):
        hidden.append("crm_info")
        out["bd_owner"] = out["crm_status"] = out["priority"] = None
        if source == "tender":
            out["requirement"] = [f for f in out["requirement"] if f["label"] != "Tender Value"]
    if not can_feature(user, "rnd", "requirements", "product_requirement", "view"):
        hidden.append("product_requirement")
        out["requirement"] = []
    if not can_feature(user, "rnd", "requirements", "crm_request", "view"):
        hidden.append("crm_request")
        out["movements"] = []
    # "View requirement as sent" / "Changed since previous send" repeat the
    # same fields — drop the ones from hidden sections there too.
    dropped = set()
    if "customer" in hidden:
        dropped |= _CUSTOMER_SNAPSHOT_FIELDS
    if "product_requirement" in hidden:
        dropped |= set(requirement_movement.SNAPSHOT_FIELDS) - _CUSTOMER_SNAPSHOT_FIELDS
    if dropped:
        for m in out["movements"]:
            m["snapshot"] = [f for f in m.get("snapshot") or [] if f.get("field") not in dropped]
            m["changes"] = [c for c in m.get("changes") or [] if c.get("field") not in dropped]
    out["hidden_sections"] = hidden


_CUSTOMER_SNAPSHOT_FIELDS = {"org_name", "contact_name"}


@router.post("/requests/{request_id}/respond")
async def respond_to_request(
    request_id: int,
    remarks: str | None = Form(None),
    delay_reason: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """R&D's answer to a CRM request: remarks and/or documents, plus a delay
    reason when answered after the due date. Documents are filed with the
    CRM record (Documents tab) and flagged shared_via_tor so both sides can open them."""
    req = db.query(CrmRndRequest).filter(CrmRndRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="This R&D request no longer exists — refresh the page.")
    model = Inquiry if req.source == "inquiry" else Tender
    record = db.query(model).filter(model.id == req.record_id, model.is_deleted == False).first()  # noqa: E712
    if not record:
        raise HTTPException(status_code=404, detail=f"The CRM {req.source} behind this request was deleted, so it can't be answered.")

    ra.ensure(db, user, req.source, req.record_id, "respond")
    ensure_feature_action(user, "rnd", "requirements", "crm_request", "submit")
    files = [f for f in (files or []) if f and f.filename]
    requirement_movement.mark_responded(
        db, req=req, user=user, remarks=remarks, delay_reason=delay_reason, has_files=bool(files),
    )

    if files:
        if not settings.SHAREPOINT_SITE_ID:
            raise HTTPException(status_code=503, detail="SharePoint isn't configured on the server, so response documents can't be stored. Ask IT to set SHAREPOINT_SITE_ID, or respond with remarks only.")
        org = db.query(Organization).filter(Organization.id == record.org_id).first()
        folder_path = build_sharepoint_folder_path(
            user.name or user.email or "", org.name if org else "General",
            f"crm/{req.source}/{record.universal_id or record.id}/rnd-response", root_folder="CRM-media",
        )
        for f in files:
            result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
            db.add(CrmDocument(
                related_module=req.source, related_id=record.id,
                related_sub_module="rnd_request", related_sub_id=req.id,
                universal_id=record.universal_id, folder_type="technical_offer",
                doc_category=requirement_movement.RESPONSE_DOC_CATEGORY,
                file_name=result["name"], file_path=result["path"], sharepoint_path=result["path"],
                sharepoint_url=result.get("webUrl"), file_size=result.get("size"), mime_type=f.content_type,
                description=f"R&D response to {req.offer_number or 'Technical Offer Request'}",
                uploaded_by_name=user.name or user.email, org_id=record.org_id, created_by_id=user.id,
                shared_via_tor=True,
            ))
    db.add(AuditLog(
        entity_type=req.source, entity_id=record.id, action="rnd_responded", module_key="crm",
        summary=f"{user.name or user.email} (R&D) responded to {req.offer_number or 'the Technical Offer Request'}"
                + (" after the due date." if req.delay_reason else "."),
        performed_by_id=user.id,
    ))
    db.commit()
    return requirement_movement.serialize_requests(db, [req])[req.id]
