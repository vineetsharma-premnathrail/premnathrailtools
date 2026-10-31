"""R&D › Requirements — the R&D side of CRM's "Send Technical Requirement to R&D".

Inbox of every CRM Inquiry/Tender whose requirement has been sent to R&D, with
its R&D ID (RDR-YYYY-NNNN), revisions (-R0, -R1 …) and the review state. R&D
accepts a revision (rnd/services/requirements.py); Return to BD was removed 2026-10-30.
The CRM record stays the single source of truth for the requirement itself — a
re-send from CRM shows up here at once as a new revision.

Who sees what: the R&D side (R&D app + View on Requirements) sees every
requirement; people outside R&D see only the requirements they hold a task on
(rnd/services/requirement_access.py). The TOR PDF and attached client documents
open through requirement_work's /documents/{id}/content, which checks that
access first.
"""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permission_registry import can_feature
from app.core.permissions import ensure_feature_action
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
from app.modules.rnd.models.requirement_work import RndRequirementAccess
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import requirements as intake


def _require_requirement_user(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """The R&D side (R&D › Requirements › View), or someone who holds a task on
    a requirement. What each person may open is decided per record (ra.ensure)."""
    if not ra.has_requirement_side(db, user):
        raise HTTPException(
            status_code=403,
            detail="Requirements need 'View' on R&D › Requirements, or a task on the requirement. "
                   "Ask an admin to add it to one of your roles (Organization › Role & Permissions), or ask the R&D head "
                   f"({ra._head_names(db)}) to give you a task on it.",
        )
    return user


router = APIRouter(
    prefix="/requirements", tags=["RnD Requirements"],
    dependencies=[Depends(_require_requirement_user)],
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


def _intake_fields(state: tuple | None, can_review: bool) -> dict:
    req, rev = state if state else (None, None)
    return {
        "requirement_id": req.id if req else None,
        "rd_number": req.rd_number if req else None,
        "status": req.status if req else None,
        "status_label": intake.STATUS_LABELS.get(req.status) if req else None,
        "current_revision": req.current_revision if req else None,
        "revision_code": (rev.revision_code if rev else f"{req.rd_number}-R{req.current_revision}") if req else None,
        "last_received_at": _iso(req.last_received_at) if req else None,
        "needs_my_review": bool(req and req.status == "submitted" and can_review),
    }


@router.get("")
async def list_requirements(
    search: str | None = None,
    source: Source | None = None,
    mine: bool = False,
    needs_my_review: bool = False,
    status: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every requirement the user may see — needs-my-review first, then by R&D ID ascending.
    Filters: search, source, mine (requests I may respond to), needs_my_review, status
    (submitted / accepted / returned / responded)."""
    if status and status not in ("submitted", "accepted", "returned", "responded"):
        raise HTTPException(status_code=422, detail=f"Status '{status}' isn't valid — pick submitted, accepted, returned or responded.")
    rows: list[dict] = []
    term = f"%{search.strip()}%" if search and search.strip() else None
    visible = ra.visible_keys(db, user)  # None = all
    can_review = ra.can_accept(db, user)

    def allowed(src: str):
        if visible is None:
            return None
        return [rid for (s, rid) in visible if s == src]

    def build(src: str, model, search_cols, product_of, category_of, quantity_of, required_by_of):
        ids = allowed(src)
        if ids is not None and not ids:
            return
        q = db.query(model, Organization.name).outerjoin(Organization, Organization.id == model.org_id).filter(
            model.is_deleted == False, model.technical_offer_sent_at.isnot(None),  # noqa: E712
        )
        if ids is not None:
            q = q.filter(model.id.in_(ids))
        if term:
            q = q.filter(or_(*[c.ilike(term) for c in search_cols], Organization.name.ilike(term)))
        records = q.all()
        stats = _send_stats(db, src, [r.id for r, _ in records])
        reqs = requirement_movement.latest_requests(db, src, [r.id for r, _ in records])
        states = intake.state_map(db, src, [r.id for r, _ in records])
        for rec, org_name in records:
            count, sender = stats.get(rec.id, (0, None))
            rows.append({
                "source": src, "record_id": rec.id, "universal_id": rec.universal_id,
                "offer_number": rec.technical_offer_number, "org_name": org_name,
                "product": product_of(rec), "category": category_of(rec), "quantity": quantity_of(rec),
                "required_by": required_by_of(rec),
                "priority": rec.priority, "bd_owner": rec.bd_owner,
                "last_sent_at": _iso(rec.technical_offer_sent_at), "last_sent_by": sender,
                "send_count": max(count, 1), "edited_after_send": _edited_after_send(rec),
                "rnd_request": reqs.get(rec.id),
                **_intake_fields(states.get(rec.id), can_review),
            })

    if source in (None, "inquiry"):
        build("inquiry", Inquiry,
              [Inquiry.universal_id, Inquiry.technical_offer_number, Inquiry.product, Inquiry.product_category],
              lambda r: r.product, lambda r: r.product_category,
              lambda r: f"{r.quantity:g}" if r.quantity is not None else None,
              lambda r: r.required_delivery_date.isoformat() if r.required_delivery_date else None)
    if source in (None, "tender"):
        build("tender", Tender,
              [Tender.universal_id, Tender.technical_offer_number, Tender.tender_name, Tender.tender_number],
              lambda r: r.tender_name, lambda r: r.tender_category, lambda r: None,
              lambda r: r.submission_date.isoformat() if r.submission_date else None)

    head = ra.is_head(db, user)
    ticks = {(a.source, a.record_id) for a in db.query(RndRequirementAccess).filter(
        RndRequirementAccess.user_id == user.id, RndRequirementAccess.can_respond == True).all()}  # noqa: E712
    for r in rows:
        r["can_respond"] = bool(head or (r["source"], r["record_id"]) in ticks)
    if needs_my_review:
        rows = [r for r in rows if r["needs_my_review"]]
    if status:
        rows = [r for r in rows if r["status"] == status]
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
    # Needs-my-review first, then the R&D ID ascending (requirements without one — legacy — last).
    rows.sort(key=lambda r: (not r["needs_my_review"], r["rd_number"] is None, r["rd_number"] or "", r["universal_id"] or ""))
    return rows


def requirement_summary(db: Session, source: str, record) -> dict:
    """The requirement as R&D received it — header, customer, contact and the
    requirement fields."""
    org = db.query(Organization).filter(Organization.id == record.org_id).first()
    contact = db.query(OrgContact).filter(OrgContact.id == record.org_contact_id).first() if record.org_contact_id else None

    if source == "inquiry":
        fields = [
            ("Product", record.product),
            ("Specification", record.product_spec),
            ("Project Details", record.project_details),
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


def _live_record(db: Session, source: str, record_id: int):
    model = Inquiry if source == "inquiry" else Tender
    record = db.query(model).filter(model.id == record_id, model.is_deleted == False).first()  # noqa: E712
    if not record or not record.technical_offer_sent_at:
        raise HTTPException(
            status_code=404,
            detail=f"This {source} hasn't been sent to R&D (or was deleted in CRM). Only records sent via "
                   "\"Send Technical Requirement to R&D\" appear under R&D › Requirements.",
        )
    return record


@router.get("/{source}/{record_id}")
async def get_requirement(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record = _live_record(db, source, record_id)
    my_access = ra.ensure(db, user, source, record_id, "view")
    req = intake.get(db, source, record_id)
    rev = intake.latest_revision(db, req) if req else None
    movements = requirement_movement.list_movements(db, module=source, record=record)
    out = {
        **requirement_summary(db, source, record),
        "movements": movements,
        "my_access": my_access,
        "intake": intake.requirement_out(db, req, rev),
        "can_accept": my_access["view"] and ra.can_accept(db, user),
        "can_return": my_access["view"] and ra.can_return(db, user),
    }
    _mask_sections(out, user, source)
    out["revisions"] = intake.revisions_out(db, req, out["movements"], mask=out.pop("_dropped_fields", None))
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
    dropped = dropped_snapshot_fields(hidden)
    if dropped:
        for m in out["movements"]:
            m["snapshot"] = [f for f in m.get("snapshot") or [] if f.get("field") not in dropped]
            m["changes"] = [c for c in m.get("changes") or [] if c.get("field") not in dropped]
    out["hidden_sections"] = hidden
    out["_dropped_fields"] = dropped


_CUSTOMER_SNAPSHOT_FIELDS = {"org_name", "contact_name"}


def dropped_snapshot_fields(hidden_sections: list[str]) -> set[str]:
    """Snapshot fields (revision diffs) that belong to the hidden sections."""
    dropped: set[str] = set()
    if "customer" in hidden_sections:
        dropped |= _CUSTOMER_SNAPSHOT_FIELDS
    if "product_requirement" in hidden_sections:
        dropped |= set(requirement_movement.SNAPSHOT_FIELDS) - _CUSTOMER_SNAPSHOT_FIELDS
    return dropped


def hidden_sections_for(user: User) -> list[str]:
    hidden = []
    if not can_feature(user, "rnd", "requirements", "customer", "view"):
        hidden.append("customer")
    if not can_feature(user, "rnd", "requirements", "product_requirement", "view"):
        hidden.append("product_requirement")
    return hidden


class AcceptPayload(BaseModel):
    remarks: str | None = None
    # The revision the page was showing; a newer send makes this a 409 (AC-13).
    revision_no: int | None = None


def _review_out(db: Session, source: str, record_id: int, user: User) -> dict:
    req = intake.get(db, source, record_id)
    rev = intake.latest_revision(db, req) if req else None
    return {
        "intake": intake.requirement_out(db, req, rev),
        "revisions": intake.revisions_out(db, req, None),
    }


@router.post("/{source}/{record_id}/accept")
async def accept_requirement(source: Source, record_id: int, payload: AcceptPayload | None = None,
                             db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Accept the latest revision (R&D head, admin, or R&D › Requirements › Review › Approve)."""
    payload = payload or AcceptPayload()
    record = _live_record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "view")
    intake.accept(db, source=source, record=record, user=user, remarks=payload.remarks, revision_no=payload.revision_no)
    db.commit()
    return _review_out(db, source, record_id, user)


# Return to BD was removed (owner, 2026-10-30): R&D only accepts a requirement.


@router.post("/requests/{request_id}/respond")
async def respond_to_request(
    request_id: int,
    remarks: str | None = Form(None),
    delay_reason: str | None = Form(None),
    ask_details: bool = Form(False),
    files: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """`ask_details=true`: R&D asks BD for more details in `remarks` — the request stays open
    (requirement_movement.ask_details); no files or delay reason.

    Otherwise R&D's answer to a CRM request: remarks and/or documents, plus a delay
    reason when answered after the due date. Only an accepted revision can be
    answered. Documents are filed with the CRM record (Documents tab) and
    flagged shared_via_tor so both sides can open them."""
    req = db.query(CrmRndRequest).filter(CrmRndRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="This R&D request no longer exists — refresh the page.")
    model = Inquiry if req.source == "inquiry" else Tender
    record = db.query(model).filter(model.id == req.record_id, model.is_deleted == False).first()  # noqa: E712
    if not record:
        raise HTTPException(status_code=404, detail=f"The CRM {req.source} behind this request was deleted, so it can't be answered.")

    ra.ensure(db, user, req.source, req.record_id, "respond")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "crm_request", "submit")
    files = [f for f in (files or []) if f and f.filename]
    if ask_details:
        if files:
            raise HTTPException(status_code=400, detail="A question to BD carries no documents — remove the files, or attach them to the final response.")
        requirement_movement.ask_details(db, req=req, record=record, user=user, remarks=remarks)
        db.commit()
        return requirement_movement.serialize_requests(db, [req])[req.id]
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
