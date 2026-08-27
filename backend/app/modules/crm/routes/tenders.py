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
from app.modules.crm.models.tender import Tender
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.stage_log import CrmStageLog
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.schemas.tender import TenderCreate, TenderUpdate, TenderResponse
from app.modules.crm.schemas.inquiry import StageLogEntry
from app.modules.crm.schemas.workflow import StageLogResponse
from app.modules.crm.schemas.document import TechnicalOfferRequestBody
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.reports.technical_offer_pdf import build_technical_offer_pdf
from app.utils.notifications import broadcast_notification, notify_user
from app.utils.email import send_technical_offer_request_email
from app.utils.sharepoint import upload_bytes_to_sharepoint, build_sharepoint_folder_path
from app.core.config import settings

router = APIRouter(prefix="/crm/tenders", tags=["CRM - Tenders"])

TND_STAGES = [
    "Tender Published", "Documents Downloaded", "Participate Decision", "Design Started",
    "Costing Completed", "Technical Offer Prepared", "Commercial Offer Prepared",
    "Management Approval", "Bid Submitted", "Technical Qualified", "Financial Opened", "Awarded / Lost",
]


def _write_audit(db: Session, tender_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="tender", entity_id=tender_id, action=action, performed_by_id=user.id, summary=summary))


# Stage changes get their own timeline entry (_log_stage) — everything else is combined
# into one info-update revision entry per save.
TENDER_SPEC_EXCLUDE = {"current_stage"}


def _write_spec_revision(db: Session, tender_id: int, user: User, old_vals: dict, new_vals: dict):
    db.add(AuditLog(
        entity_type="tender_spec", entity_id=tender_id, action="spec_revision",
        old_value=json.dumps(old_vals, default=str), new_value=json.dumps(new_vals, default=str),
        summary=f"{user.name or user.email} updated tender details: {', '.join(new_vals.keys())}.",
        performed_by_id=user.id,
    ))


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


def _generate_universal_id(db: Session) -> str:
    today = date.today().strftime("%Y%m%d")
    seq = db.query(func.count(Tender.id)).scalar() + 1
    return f"TND-{today}-{seq:04d}"


def _log_stage(db: Session, tender_id: int, universal_id: str, stage: str, user: User, notes: str | None = None):
    db.add(CrmStageLog(
        related_module="tender", related_id=tender_id, universal_id=universal_id, stage=stage,
        entered_by_id=user.id, entered_by_name=user.name or user.email,
        notes=notes, created_at=datetime.now(timezone.utc),
    ))


@router.get("", response_model=list[TenderResponse])
async def list_tenders(
    search: str | None = None,
    status: str | None = None,
    org_id: int | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    query = db.query(Tender).filter(Tender.is_deleted == False)  # noqa: E712
    if status:
        query = query.filter(Tender.status == status)
    if org_id:
        query = query.filter(Tender.org_id == org_id)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Tender.universal_id.ilike(like)) | (Tender.tender_number.ilike(like)) | (Tender.tender_name.ilike(like))
            | (Tender.tender_authority.ilike(like)) | (Tender.tender_portal.ilike(like)) | (Tender.tender_type.ilike(like))
            | (Tender.tender_category.ilike(like)) | (Tender.status.ilike(like)) | (Tender.current_stage.ilike(like))
            | (Tender.railway_zone.ilike(like)) | (Tender.division.ilike(like)) | (Tender.workshop.ilike(like))
        )
    tenders = query.order_by(Tender.id.desc()).offset(skip).limit(limit).all()
    creator_ids = {t.created_by_id for t in tenders if t.created_by_id}
    names_by_id = {}
    if creator_ids:
        for u in db.query(User).filter(User.id.in_(creator_ids)).all():
            names_by_id[u.id] = u.name or u.email
    results = []
    for t in tenders:
        resp = TenderResponse.model_validate(t)
        resp.created_by_name = names_by_id.get(t.created_by_id)
        results.append(resp)
    return results


@router.post("", response_model=TenderResponse, status_code=201)
async def create_tender(
    payload: TenderCreate,
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

    if payload.tender_number:
        clash = db.query(Tender).filter(
            Tender.is_deleted == False,  # noqa: E712
            Tender.tender_number == payload.tender_number,
            Tender.railway_zone == payload.railway_zone,
            Tender.division == payload.division,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="A tender with this number already exists for this zone/division")

    tender = None
    for attempt in range(5):
        try:
            universal_id = _generate_universal_id(db)
            tender = Tender(**payload.model_dump(), universal_id=universal_id, created_by_id=user.id)
            db.add(tender)
            db.flush()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 4:
                raise HTTPException(status_code=500, detail="Could not allocate a tender ID, please retry")

    _log_stage(db, tender.id, universal_id, "Tender created", user)
    if tender.submission_date:
        db.add(Activity(
            activity_type="Submission", org_id=tender.org_id, related_module="tender", related_id=tender.id,
            universal_id=universal_id, next_followup=tender.submission_date, created_by_id=user.id,
        ))

    _write_audit(db, tender.id, "created", user, summary=f"Tender {universal_id} created by {user.name or user.email}.")
    broadcast_notification(
        db, title="New Tender Added", message=f"Tender '{universal_id}' was created by {user.name or user.email}.",
        notification_type="tender_created", entity_type="tender", entity_id=tender.id, exclude_user_id=user.id,
    )
    notify_user(
        db, user_id=user.id, title="Tender Created", message=f"You created tender '{universal_id}'.",
        notification_type="tender_created", entity_type="tender", entity_id=tender.id,
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.get("/{tender_id}", response_model=TenderResponse)
async def get_tender(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    return tender


@router.patch("/{tender_id}", response_model=TenderResponse)
async def update_tender(
    tender_id: int,
    payload: TenderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    if not _can_modify(tender, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this tender.")

    updates = payload.model_dump(exclude_unset=True)
    stage_changed = "current_stage" in updates and updates["current_stage"] != tender.current_stage
    changed = [f for f, v in updates.items() if str(getattr(tender, f, None)) != str(v)]
    spec_old = {f: getattr(tender, f, None) for f in changed if f not in TENDER_SPEC_EXCLUDE}
    spec_new = {f: updates[f] for f in changed if f not in TENDER_SPEC_EXCLUDE}
    for field, value in updates.items():
        setattr(tender, field, value)

    if spec_new:
        _write_spec_revision(db, tender.id, user, spec_old, spec_new)
    if stage_changed:
        _log_stage(db, tender.id, tender.universal_id, "Stage updated", user, notes=f"Moved to {tender.current_stage}")
        broadcast_notification(
            db, title="Tender Stage Updated",
            message=f"Tender '{tender.universal_id}' moved to '{tender.current_stage}' by {user.name or user.email}.",
            notification_type="tender_stage_updated", entity_type="tender", entity_id=tender.id,
            exclude_user_id=user.id,
        )
        notify_user(
            db, user_id=user.id, title="Tender Stage Updated",
            message=f"You moved tender '{tender.universal_id}' to '{tender.current_stage}'.",
            notification_type="tender_stage_updated", entity_type="tender", entity_id=tender.id,
        )

    db.commit()
    db.refresh(tender)
    return tender


@router.delete("/{tender_id}", status_code=204)
async def delete_tender(
    tender_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can delete this tender.")

    tender.is_deleted = True
    tender.deleted_at = datetime.now(timezone.utc)
    _write_audit(db, tender.id, "deleted", user, summary=f"Tender {tender.universal_id} deleted by {user.name or user.email}.")
    broadcast_notification(
        db, title="Tender Deleted", message=f"Tender '{tender.universal_id}' was deleted by {user.name or user.email}.",
        notification_type="tender_deleted", entity_type="tender", entity_id=tender.id, exclude_user_id=user.id,
    )
    notify_user(
        db, user_id=user.id, title="Tender Deleted",
        message=f"You deleted tender '{tender.universal_id}'.",
        notification_type="tender_deleted", entity_type="tender", entity_id=tender.id,
    )
    db.commit()


@router.get("/{tender_id}/audit")
async def get_tender_audit(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "tender", AuditLog.entity_id == tender_id
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


@router.post("/{tender_id}/technical-offer-request", response_model=TenderResponse)
async def create_technical_offer_request(
    tender_id: int,
    body: TechnicalOfferRequestBody = TechnicalOfferRequestBody(),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")

    org = db.query(Organization).filter(Organization.id == tender.org_id).first()
    contact = db.query(OrgContact).filter(OrgContact.id == tender.org_contact_id).first() if tender.org_contact_id else None
    suffix = tender.universal_id.split("TND-")[-1] if tender.universal_id else str(tender.id)
    offer_number = f"TOR-{suffix}"

    raised_by = user.name or user.email
    now = datetime.now(timezone.utc)

    ctx = {
        "offer_number": offer_number, "universal_id": tender.universal_id,
        "org_name": org.name if org else None, "org_type": org.org_type if org else None,
        "org_address": org.address if org else None, "org_gst_number": org.gst_number if org else None,
        "org_city": org.city if org else None, "org_state": org.state if org else None,
        "contact_name": contact.name if contact else None, "contact_designation": contact.designation if contact else None,
        "contact_department": contact.department if contact else None, "contact_mobile": contact.mobile if contact else None,
        "contact_email": contact.email if contact else None,
        "project_details": tender.tender_authority,
        "product_category": tender.tender_category, "product": tender.tender_name,
        "quantity_display": f"{tender.currency} {tender.tender_value:,.2f}" if tender.tender_value is not None else None,
        "inspection_req": None,
        "product_spec": None, "requirement_desc": tender.reason_no_participate, "detailed_requirement": None,
        "raised_by": raised_by,
        "raised_at": now.strftime("%d %b %Y, %I:%M %p"),
    }
    offer_filename = f"{offer_number}.pdf"
    offer_bytes = build_technical_offer_pdf(ctx).read()

    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    folder_path = build_sharepoint_folder_path(raised_by, org.name if org else "General", f"crm/tender/{tender.universal_id}/technical-offer", root_folder="CRM-media")
    upload_result = await upload_bytes_to_sharepoint(
        settings.SHAREPOINT_SITE_ID, folder_path, offer_filename,
        "application/pdf", offer_bytes,
    )
    # Link to the just-uploaded Technical Offer Request document itself — this is what
    # goes in the email to R&D, distinct from existing_docs_link inside the doc's content.
    tor_doc_link = upload_result.get("webUrl") or ""

    reference_documents = []
    if body.document_ids:
        selected_docs = db.query(CrmDocument).filter(
            CrmDocument.id.in_(body.document_ids),
            CrmDocument.related_module == "tender", CrmDocument.related_id == tender.id,
            CrmDocument.is_deleted == False,  # noqa: E712
        ).all()
        reference_documents = [{"name": d.file_name, "url": d.sharepoint_url} for d in selected_docs]

    success, error = await send_technical_offer_request_email(
        db, entity_type="tender", entity_id=tender.id, offer_number=offer_number,
        universal_id=tender.universal_id, org_name=org.name if org else "", project_name=tender.tender_name or "",
        documents_link=tor_doc_link, actor_id=user.id, actor_name=raised_by,
        reference_documents=reference_documents, actor_email=user.email,
    )
    if not success:
        db.commit()
        raise HTTPException(status_code=502, detail=f"Failed to send Technical Offer Request email. {error}")

    tender.technical_offer_number = offer_number
    tender.technical_offer_sent_at = now
    db.commit()
    db.refresh(tender)
    return tender


@router.get("/{tender_id}/spec-revisions")
async def list_tender_spec_revisions(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "tender_spec", AuditLog.entity_id == tender_id
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


@router.get("/{tender_id}/stages", response_model=list[StageLogResponse])
async def list_tender_stages(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    return db.query(CrmStageLog).filter(
        CrmStageLog.related_module == "tender", CrmStageLog.related_id == tender_id
    ).order_by(CrmStageLog.created_at.asc()).all()


@router.post("/{tender_id}/stages", response_model=StageLogResponse, status_code=201)
async def add_tender_stage(
    tender_id: int,
    payload: StageLogEntry,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    if not _can_modify(tender, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can change this tender's stage.")
    if payload.stage not in TND_STAGES:
        raise HTTPException(status_code=422, detail=f"Invalid stage. Must be one of: {', '.join(TND_STAGES)}")
    entry = CrmStageLog(
        related_module="tender", related_id=tender_id, universal_id=tender.universal_id, stage=payload.stage,
        entered_by_id=user.id, entered_by_name=user.name or user.email, notes=payload.notes,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    tender.current_stage = payload.stage
    db.commit()
    db.refresh(entry)
    return entry
