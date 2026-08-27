import json
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.stage_log import CrmStageLog
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.schemas.inquiry import InquiryCreate, InquiryUpdate, InquiryResponse, StageLogEntry
from app.modules.crm.schemas.workflow import StageLogResponse
from app.modules.crm.schemas.activity import MomExportRequest
from app.modules.crm.schemas.document import TechnicalOfferRequestBody
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.reports.mom_docx import build_mom_docx, mom_rows_from_activity
from app.modules.crm.reports.mom_pdf import build_mom_pdf
from app.modules.crm.reports.technical_offer_pdf import build_technical_offer_pdf
from app.utils.notifications import broadcast_notification, notify_user
from app.utils.email import send_technical_offer_request_email
from app.utils.sharepoint import upload_bytes_to_sharepoint, build_sharepoint_folder_path
from app.core.config import settings
from fastapi.responses import Response

router = APIRouter(prefix="/crm/inquiries", tags=["CRM - Inquiries"])

INQ_STAGES = [
    "Customer Requirement", "Design", "R&D", "Costing", "Management Approval",
    "Quotation Submission", "Purchase Order", "Project", "Manufacturing",
    "Inspection", "Dispatch", "Installation", "Commissioning", "Warranty", "Service",
]


def _write_audit(db: Session, inquiry_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="inquiry", entity_id=inquiry_id, action=action, performed_by_id=user.id, summary=summary))


def _write_spec_revision(db: Session, inquiry_id: int, user: User, old_vals: dict, new_vals: dict):
    db.add(AuditLog(
        entity_type="inquiry_spec", entity_id=inquiry_id, action="spec_revision",
        old_value=json.dumps(old_vals, default=str), new_value=json.dumps(new_vals, default=str),
        summary=f"{user.name or user.email} updated requirement spec: {', '.join(new_vals.keys())}.",
        performed_by_id=user.id,
    ))


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


def _generate_universal_id(db: Session) -> str:
    today = date.today().strftime("%Y%m%d")
    seq = db.query(func.count(Inquiry.id)).scalar() + 1
    return f"INQ-{today}-{seq:04d}"


def _log_stage(db: Session, inquiry_id: int, universal_id: str, stage: str, user: User, notes: str | None = None):
    db.add(CrmStageLog(
        related_module="inquiry", related_id=inquiry_id, universal_id=universal_id, stage=stage,
        entered_by_id=user.id, entered_by_name=user.name or user.email,
        notes=notes, created_at=datetime.now(timezone.utc),
    ))


@router.get("", response_model=list[InquiryResponse])
async def list_inquiries(
    search: str | None = None,
    status: str | None = None,
    org_id: int | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    query = db.query(Inquiry).filter(Inquiry.is_deleted == False)  # noqa: E712
    if status:
        query = query.filter(Inquiry.status == status)
    if org_id:
        query = query.filter(Inquiry.org_id == org_id)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Inquiry.universal_id.ilike(like)) | (Inquiry.product.ilike(like)) | (Inquiry.bd_owner.ilike(like))
            | (Inquiry.sales_engineer.ilike(like)) | (Inquiry.railway_zone.ilike(like)) | (Inquiry.division.ilike(like))
            | (Inquiry.lead_source.ilike(like)) | (Inquiry.status.ilike(like)) | (Inquiry.current_stage.ilike(like))
            | (Inquiry.product_category.ilike(like)) | (Inquiry.delivery_location.ilike(like))
            | (Inquiry.requirement_desc.ilike(like)) | (Inquiry.detailed_requirement.ilike(like))
            | (Inquiry.followup_assigned_to.ilike(like)) | (Inquiry.priority.ilike(like))
        )
    inquiries = query.order_by(Inquiry.id.desc()).offset(skip).limit(limit).all()
    creator_ids = {i.created_by_id for i in inquiries if i.created_by_id}
    names_by_id = {}
    if creator_ids:
        for u in db.query(User).filter(User.id.in_(creator_ids)).all():
            names_by_id[u.id] = u.name or u.email
    results = []
    for i in inquiries:
        resp = InquiryResponse.model_validate(i)
        resp.created_by_name = names_by_id.get(i.created_by_id)
        results.append(resp)
    return results


@router.post("", response_model=InquiryResponse, status_code=201)
async def create_inquiry(
    payload: InquiryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    org = db.query(Organization).filter(Organization.id == payload.org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if payload.org_contact_id is not None:
        contact = db.query(OrgContact).filter(OrgContact.id == payload.org_contact_id, OrgContact.org_id == payload.org_id).first()
        if not contact:
            raise HTTPException(status_code=422, detail="org_contact_id does not belong to the specified organization")

    inquiry = None
    for attempt in range(5):
        try:
            universal_id = _generate_universal_id(db)
            inquiry = Inquiry(**payload.model_dump(), universal_id=universal_id, created_by_id=user.id)
            db.add(inquiry)
            db.flush()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 4:
                raise HTTPException(status_code=500, detail="Could not allocate an inquiry ID, please retry")

    _log_stage(db, inquiry.id, universal_id, "Inquiry created", user)
    if inquiry.next_followup_date:
        db.add(Activity(
            activity_type="Follow-up", org_id=inquiry.org_id, related_module="inquiry", related_id=inquiry.id,
            universal_id=universal_id, next_followup=inquiry.next_followup_date,
            assigned_to=inquiry.followup_assigned_to, created_by_id=user.id,
        ))
    _write_audit(db, inquiry.id, "created", user, summary=f"Inquiry {universal_id} created by {user.name or user.email}.")
    broadcast_notification(
        db, title="New Inquiry Raised", message=f"Inquiry '{universal_id}' was created by {user.name or user.email}.",
        notification_type="inquiry_created", entity_type="inquiry", entity_id=inquiry.id, exclude_user_id=user.id,
    )
    notify_user(
        db, user_id=user.id, title="Inquiry Created", message=f"You created inquiry '{universal_id}'.",
        notification_type="inquiry_created", entity_type="inquiry", entity_id=inquiry.id,
    )
    db.commit()
    db.refresh(inquiry)
    return inquiry


@router.get("/{inquiry_id}", response_model=InquiryResponse)
async def get_inquiry(
    inquiry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    return inquiry


@router.patch("/{inquiry_id}", response_model=InquiryResponse)
async def update_inquiry(
    inquiry_id: int,
    payload: InquiryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    if not _can_modify(inquiry, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this inquiry.")

    updates = payload.model_dump(exclude_unset=True)
    stage_changed = "current_stage" in updates and updates["current_stage"] != inquiry.current_stage
    changed = [f for f, v in updates.items() if str(getattr(inquiry, f, None)) != str(v)]
    # Stage changes get their own timeline entry (_log_stage below) — everything else
    # that changed in this single save is combined into ONE info-update entry, so a
    # multi-field edit shows as one timeline row instead of one per field.
    info_changed = [f for f in changed if f != "current_stage"]
    info_old = {f: getattr(inquiry, f, None) for f in info_changed}
    info_new = {f: updates[f] for f in info_changed}
    for field, value in updates.items():
        setattr(inquiry, field, value)

    if info_changed:
        _write_spec_revision(db, inquiry.id, user, info_old, info_new)
    if stage_changed:
        _log_stage(db, inquiry.id, inquiry.universal_id, "Stage updated", user, notes=f"Moved to {inquiry.current_stage}")
        broadcast_notification(
            db, title="Inquiry Stage Updated",
            message=f"Inquiry '{inquiry.universal_id}' moved to '{inquiry.current_stage}' by {user.name or user.email}.",
            notification_type="inquiry_stage_updated", entity_type="inquiry", entity_id=inquiry.id,
            exclude_user_id=user.id,
        )
        notify_user(
            db, user_id=user.id, title="Inquiry Stage Updated",
            message=f"You moved inquiry '{inquiry.universal_id}' to '{inquiry.current_stage}'.",
            notification_type="inquiry_stage_updated", entity_type="inquiry", entity_id=inquiry.id,
        )

    db.commit()
    db.refresh(inquiry)
    return inquiry


@router.delete("/{inquiry_id}", status_code=204)
async def delete_inquiry(
    inquiry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can delete this inquiry.")

    inquiry.is_deleted = True
    inquiry.deleted_at = datetime.now(timezone.utc)
    _write_audit(db, inquiry.id, "deleted", user, summary=f"Inquiry {inquiry.universal_id} deleted by {user.name or user.email}.")
    broadcast_notification(
        db, title="Inquiry Deleted", message=f"Inquiry '{inquiry.universal_id}' was deleted by {user.name or user.email}.",
        notification_type="inquiry_deleted", entity_type="inquiry", entity_id=inquiry.id, exclude_user_id=user.id,
    )
    notify_user(
        db, user_id=user.id, title="Inquiry Deleted",
        message=f"You deleted inquiry '{inquiry.universal_id}'.",
        notification_type="inquiry_deleted", entity_type="inquiry", entity_id=inquiry.id,
    )
    db.commit()


@router.get("/{inquiry_id}/audit")
async def get_inquiry_audit(
    inquiry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "inquiry", AuditLog.entity_id == inquiry_id
    ).order_by(AuditLog.performed_at.asc()).all()
    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"
    return [
        {
            "id": log.id, "action": log.action, "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]


@router.post("/{inquiry_id}/technical-offer-request", response_model=InquiryResponse)
async def create_technical_offer_request(
    inquiry_id: int,
    body: TechnicalOfferRequestBody = TechnicalOfferRequestBody(),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")

    org = db.query(Organization).filter(Organization.id == inquiry.org_id).first()
    contact = db.query(OrgContact).filter(OrgContact.id == inquiry.org_contact_id).first() if inquiry.org_contact_id else None
    suffix = inquiry.universal_id.split("INQ-")[-1] if inquiry.universal_id else str(inquiry.id)
    offer_number = f"TOR-{suffix}"

    raised_by = user.name or user.email
    now = datetime.now(timezone.utc)

    ctx = {
        "offer_number": offer_number, "universal_id": inquiry.universal_id,
        "org_name": org.name if org else None, "org_type": org.org_type if org else None,
        "org_address": org.address if org else None, "org_gst_number": org.gst_number if org else None,
        "org_city": org.city if org else None, "org_state": org.state if org else None,
        "contact_name": contact.name if contact else None, "contact_designation": contact.designation if contact else None,
        "contact_department": contact.department if contact else None, "contact_mobile": contact.mobile if contact else None,
        "contact_email": contact.email if contact else None,
        "product_category": inquiry.product_category, "product": inquiry.product,
        "quantity_display": f"{inquiry.quantity:g} {inquiry.unit or ''}".strip() if inquiry.quantity is not None else None,
        "inspection_req": inquiry.inspection_req, "product_spec": inquiry.product_spec,
        "requirement_desc": inquiry.requirement_desc, "detailed_requirement": inquiry.detailed_requirement,
        "project_details": inquiry.project_details, "raised_by": raised_by,
        "raised_at": now.strftime("%d %b %Y, %I:%M %p"),
    }
    offer_filename = f"{offer_number}.pdf"
    offer_bytes = build_technical_offer_pdf(ctx).read()

    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    folder_path = build_sharepoint_folder_path(raised_by, org.name if org else "General", f"crm/inquiry/{inquiry.universal_id}/technical-offer", root_folder="CRM-media")
    upload_result = await upload_bytes_to_sharepoint(
        settings.SHAREPOINT_SITE_ID, folder_path, offer_filename, "application/pdf", offer_bytes,
    )
    # Link to the just-uploaded Technical Offer Request document itself — this is what
    # goes in the email to R&D, distinct from existing_docs_link inside the doc's content.
    tor_doc_link = upload_result.get("webUrl") or ""

    reference_documents = []
    if body.document_ids:
        selected_docs = db.query(CrmDocument).filter(
            CrmDocument.id.in_(body.document_ids),
            CrmDocument.related_module == "inquiry", CrmDocument.related_id == inquiry.id,
            CrmDocument.is_deleted == False,  # noqa: E712
        ).all()
        reference_documents = [{"name": d.file_name, "url": d.sharepoint_url} for d in selected_docs]

    success, error = await send_technical_offer_request_email(
        db, entity_type="inquiry", entity_id=inquiry.id, offer_number=offer_number,
        universal_id=inquiry.universal_id, org_name=org.name if org else "", project_name=inquiry.product or "",
        documents_link=tor_doc_link, actor_id=user.id, actor_name=raised_by,
        reference_documents=reference_documents, actor_email=user.email,
    )
    if not success:
        db.commit()
        raise HTTPException(status_code=502, detail=f"Failed to send Technical Offer Request email. {error}")

    inquiry.technical_offer_number = offer_number
    inquiry.technical_offer_sent_at = now
    db.commit()
    db.refresh(inquiry)
    return inquiry


@router.get("/{inquiry_id}/spec-revisions")
async def list_inquiry_spec_revisions(
    inquiry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "inquiry_spec", AuditLog.entity_id == inquiry_id
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
            "revision_id": f"Rev-{seq}",
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
            "changes": [
                {"field": f, "old": old_vals.get(f), "new": new_vals.get(f)}
                for f in new_vals.keys()
            ],
        })
    result.reverse()
    return result


@router.get("/{inquiry_id}/stages", response_model=list[StageLogResponse])
async def list_inquiry_stages(
    inquiry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    return db.query(CrmStageLog).filter(
        CrmStageLog.related_module == "inquiry", CrmStageLog.related_id == inquiry_id
    ).order_by(CrmStageLog.created_at.asc()).all()


@router.post("/{inquiry_id}/stages", response_model=StageLogResponse, status_code=201)
async def add_inquiry_stage(
    inquiry_id: int,
    payload: StageLogEntry,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    if not _can_modify(inquiry, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can change this inquiry's stage.")
    if payload.stage not in INQ_STAGES:
        raise HTTPException(status_code=422, detail=f"Invalid stage. Must be one of: {', '.join(INQ_STAGES)}")
    entry = CrmStageLog(
        related_module="inquiry", related_id=inquiry_id, universal_id=inquiry.universal_id, stage=payload.stage,
        entered_by_id=user.id, entered_by_name=user.name or user.email, notes=payload.notes,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    inquiry.current_stage = payload.stage
    db.commit()
    db.refresh(entry)
    return entry


def _build_mom_ctx(inquiry_id: int, payload: MomExportRequest, db: Session) -> tuple[dict, "Organization | None"]:
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")

    org = db.query(Organization).filter(Organization.id == inquiry.org_id).first()

    activities_query = db.query(Activity).filter(
        Activity.related_module == "inquiry", Activity.related_id == inquiry_id, Activity.is_deleted == False,  # noqa: E712
    )
    if payload.activity_ids:
        activities_query = activities_query.filter(Activity.id.in_(payload.activity_ids))
    activities = activities_query.order_by(Activity.id.asc()).all()

    pew_members = (
        db.query(User).filter(User.id.in_(payload.pew_member_ids)).all() if payload.pew_member_ids else []
    )
    client_contacts = (
        db.query(OrgContact).filter(OrgContact.id.in_(payload.client_contact_ids)).all()
        if payload.client_contact_ids else []
    )

    # Responsibility on the MOM defaults to the inquiry's BD Owner (PEW side)
    # when an activity has no explicit per-row responsibility set. An activity
    # with `mom_items` expands into one MOM row per item (letting a single
    # activity carry a whole multi-row MOM on its own); activities without
    # mom_items fall back to the legacy single-row behavior.
    rows = []
    for a in activities:
        if a.mom_items:
            for item in a.mom_items:
                rows.append({
                    "observation": item.get("observation"),
                    "action_plan": item.get("action_plan"),
                    "responsibility": item.get("responsibility") or inquiry.bd_owner,
                    "target": item.get("target_date"),
                })
        else:
            target = a.next_followup.strftime("%d.%m.%Y") if a.next_followup else None
            rows.extend(mom_rows_from_activity(a.remarks, a.action_plan, inquiry.bd_owner, target))

    ctx = {
        "org_name": org.name if org else None,
        "subject": payload.subject,
        "meeting_date": payload.meeting_date.strftime("%d.%m.%Y"),
        "pew_members": [{"name": u.name, "designation": u.designation} for u in pew_members],
        "client_members": [{"name": c.name, "designation": c.designation} for c in client_contacts],
        "activities": rows,
    }
    return ctx, org


@router.post("/{inquiry_id}/mom-docx")
async def export_inquiry_mom(
    inquiry_id: int,
    payload: MomExportRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    """Export this inquiry's logged activities as a Minutes-of-Meeting .docx.
    Client name/contacts and organization are pulled from the already-linked
    records rather than re-entered — only the meeting-specific fields
    (subject, date, who was present, which activities to include) are asked
    for at export time."""
    ctx, org = _build_mom_ctx(inquiry_id, payload, db)
    buf = build_mom_docx(ctx)

    org_slug = (org.name if org else "Inquiry").replace(" ", "_").replace("/", "-")
    filename = f"MOM_{org_slug}_{payload.meeting_date.strftime('%Y%m%d')}.docx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{inquiry_id}/mom-pdf")
async def export_inquiry_mom_pdf(
    inquiry_id: int,
    payload: MomExportRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    """Export this inquiry's logged activities as a Minutes-of-Meeting .pdf,
    built directly with reportlab (no DOCX-to-PDF conversion step)."""
    ctx, org = _build_mom_ctx(inquiry_id, payload, db)
    buf = build_mom_pdf(ctx)

    org_slug = (org.name if org else "Inquiry").replace(" ", "_").replace("/", "-")
    filename = f"MOM_{org_slug}_{payload.meeting_date.strftime('%Y%m%d')}.pdf"
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
