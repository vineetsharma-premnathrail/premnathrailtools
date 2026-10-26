import json
from datetime import datetime, timezone, date
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.core.notify_rules import fire_rule
from app.core.notification_events import notify_event
from app.modules.crm.services.notify import broadcast_except
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import ensure_can_delete, ensure_feature_action, require_feature_action, require_tab_access, require_tab_action
from app.core.data_scope import apply_scope, ensure_in_scope
from app.modules.crm.access import TENDER_MONEY_FIELDS, blank, can_open_record, drop_money_updates, ensure_parent_in_scope, mask_revision_changes, sees_prices
from app.core.sequential_id import next_sequential_id
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.tender import Tender
from app.modules.crm.services.cascade import cascade_delete_children
from app.modules.crm.services import requirement_movement, technical_offer
from app.modules.crm.services.stage_guard import check_stage_move, ensure_deletable, ensure_no_live_order
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.stage_log import CrmStageLog
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.schemas.tender import TenderCreate, TenderUpdate, TenderResponse
from app.modules.crm.routes.inquiries import _check_choice, _check_org_and_contact
from app.modules.crm.schemas.inquiry import StageLogEntry
from app.modules.crm.schemas.workflow import StageLogResponse
from app.modules.crm.schemas.document import TechnicalOfferRequestBody
from app.modules.crm.schemas.activity import MomExportRequest
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.reports.mom_docx import build_mom_docx, mom_rows_from_activity
from app.modules.crm.reports.mom_pdf import build_mom_pdf
from app.utils.notifications import broadcast_notification, notify_user
from app.utils.email import send_technical_offer_request_email
from app.utils.sharepoint import upload_bytes_to_sharepoint, build_sharepoint_folder_path
from app.auth.jwt_handler import create_document_share_token
from app.core.config import settings
from fastapi.responses import Response

router = APIRouter(prefix="/crm/tenders", tags=["CRM - Tenders"])


def _out(tender: Tender, user: User) -> TenderResponse:
    """A tender as the API returns it — money fields blanked for a user without
    CRM › Inquiries & Tenders › Prices & margins."""
    resp = TenderResponse.model_validate(tender)
    return resp if sees_prices(user) else blank(resp, TENDER_MONEY_FIELDS)

TND_STAGES = [
    "Tender Published", "Documents Downloaded", "Participate Decision", "Design Started",
    "Costing Completed", "Technical Offer Prepared", "Commercial Offer Prepared",
    "Management Approval", "Bid Submitted", "Technical Qualified", "Financial Opened", "Awarded / Lost",
]

# Mirrors TENDER_STATUSES in frontend/src/components/crm/constants.ts.
TND_STATUSES = [
    "Requirement Received", "Tender Published", "Tender Participation", "Tender Submitted",
    "Technical Evaluation", "Commercial Evaluation", "Negotiation", "LOA / Order Received",
    "Closed – Ordered", "Closed – Not Ordered", "Tender Cancelled",
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
    return next_sequential_id(db, prefix=f"TND-{today}-", column=Tender.universal_id)


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
    _user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    query = apply_scope(db.query(Tender).filter(Tender.is_deleted == False), _user, Tender)  # noqa: E712
    if status:
        query = query.filter(Tender.status == status)
    if org_id:
        query = query.filter(Tender.org_id == org_id)
    if search:
        like = f"%{search}%"
        matching_org_ids = [
            row[0] for row in db.query(Organization.id).filter(Organization.name.ilike(like)).all()
        ]
        query = query.filter(
            (Tender.universal_id.ilike(like)) | (Tender.tender_number.ilike(like)) | (Tender.tender_name.ilike(like))
            | (Tender.tender_authority.ilike(like)) | (Tender.tender_portal.ilike(like)) | (Tender.tender_type.ilike(like))
            | (Tender.tender_category.ilike(like)) | (Tender.status.ilike(like)) | (Tender.current_stage.ilike(like))
            | (Tender.railway_zone.ilike(like)) | (Tender.division.ilike(like)) | (Tender.workshop.ilike(like))
            | (Tender.org_id.in_(matching_org_ids) if matching_org_ids else False)
        )
    tenders = query.order_by(Tender.id.desc()).offset(skip).limit(limit).all()
    creator_ids = {t.created_by_id for t in tenders if t.created_by_id}
    names_by_id = {}
    if creator_ids:
        for u in db.query(User).filter(User.id.in_(creator_ids)).all():
            names_by_id[u.id] = u.name or u.email
    results = []
    for t in tenders:
        resp = _out(t, _user)
        resp.created_by_name = names_by_id.get(t.created_by_id)
        results.append(resp)
    return results


@router.post("", response_model=TenderResponse, status_code=201)
async def create_tender(
    payload: TenderCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("crm", "inquiries_tenders", "create")),
):
    org = db.query(Organization).filter(Organization.id == payload.org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Customer Organization not found")
    if payload.org_contact_id is not None:
        contact = db.query(OrgContact).filter(OrgContact.id == payload.org_contact_id, OrgContact.org_id == payload.org_id).first()
        if not contact:
            raise HTTPException(status_code=422, detail="org_contact_id does not belong to the specified customer organization")
    _check_choice({"current_stage": payload.current_stage}, None, "current_stage", TND_STAGES, "tender stage")
    _check_choice({"status": payload.status}, None, "status", TND_STATUSES, "tender status")

    if payload.tender_number:
        clash = db.query(Tender).filter(
            Tender.is_deleted == False,  # noqa: E712
            Tender.tender_number == payload.tender_number,
            Tender.railway_zone == payload.railway_zone,
            Tender.division == payload.division,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="A tender with this number already exists for this zone/division")

    universal_id = _generate_universal_id(db)
    data = payload.model_dump()
    # The BD owner is always the person who logs the tender — not picked on the form.
    data["bd_owner"] = user.name or user.email
    tender = Tender(**data, universal_id=universal_id, created_by_id=user.id)
    db.add(tender)
    db.flush()

    _log_stage(db, tender.id, universal_id, "Tender created", user)
    if tender.submission_date:
        db.add(Activity(
            activity_type="Submission", org_id=tender.org_id, related_module="tender", related_id=tender.id,
            universal_id=universal_id, next_followup=tender.submission_date, created_by_id=user.id,
        ))

    _write_audit(db, tender.id, "created", user, summary=f"Tender {universal_id} created by {user.name or user.email}.")
    # Role event (Organization › Roles › Notifications); whoever it reached is left out of the broadcast / rule.
    due = tender.submission_date.strftime("%d-%m-%Y") if tender.submission_date else None
    reached = notify_event(
        db, background_tasks, "crm", "tender_received",
        title=f"New tender {universal_id} — {org.name}",
        message=f"{user.name or user.email} added tender {tender.tender_name or tender.tender_number or universal_id} for {org.name}"
                + (f"; submission due {due}" if due else "") + ". Open it to decide participation.",
        entity_type="tender", entity_id=tender.id, actor=user, can_open=can_open_record(db, tender),
        details=[("Tender", universal_id), ("Tender no.", tender.tender_number or ""), ("Customer Organization", org.name),
                 ("Submission date", due or "")],
    )
    broadcast_except(
        db, reached, title="New Tender Added", message=f"Tender '{universal_id}' was created by {user.name or user.email}.",
        notification_type="tender_created", entity_type="tender", entity_id=tender.id, exclude_user_id=user.id,
    )
    notify_user(
        db, user_id=user.id, title="Tender Created", message=f"You created tender '{universal_id}'.",
        notification_type="tender_created", entity_type="tender", entity_id=tender.id,
    )
    fire_rule(db, background_tasks, "crm", "tender_create", "New Tender Created",
              f"Tender '{universal_id}' for {org.name} was created by {user.name or user.email}.", "tender", tender.id, user,
              [("Tender", universal_id), ("Tender name", tender.tender_name or ""), ("Tender no.", tender.tender_number or ""),
               ("Customer Organization", org.name), ("Submission date", tender.submission_date.strftime("%d-%m-%Y") if tender.submission_date else ""),
               ("Created by", user.name or user.email)],
              skip_user_ids=reached)
    db.commit()
    db.refresh(tender)
    return _out(tender, user)


@router.get("/{tender_id}", response_model=TenderResponse)
async def get_tender(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    ensure_in_scope(db, _user, tender)
    return _out(tender, _user)


@router.patch("/{tender_id}", response_model=TenderResponse)
async def update_tender(
    tender_id: int,
    payload: TenderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("crm", "inquiries_tenders", "edit")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    ensure_in_scope(db, user, tender)
    if not _can_modify(tender, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this tender.")

    updates = payload.model_dump(exclude_unset=True, exclude={"stage_reason"})
    # BD owner = the creator, fixed for the tender's life. The form sends the
    # current value back (fine); asking for a different owner is refused.
    if updates.get("bd_owner") and updates["bd_owner"] != tender.bd_owner:
        raise HTTPException(status_code=422, detail=(
            f"The BD owner of tender {tender.universal_id} is the person who created it "
            f"({tender.bd_owner or 'not recorded'}) and can't be changed."))
    updates.pop("bd_owner", None)
    _check_choice(updates, tender, "current_stage", TND_STAGES, "tender stage")
    _check_choice(updates, tender, "status", TND_STATUSES, "tender status")
    drop_money_updates(user, updates, TENDER_MONEY_FIELDS)
    if "current_stage" in updates and updates["current_stage"] != tender.current_stage:
        ensure_feature_action(user, "crm", "inquiries_tenders", "stage", "edit")
    moved_back = False
    if updates.get("current_stage") is not None:
        moved_back = check_stage_move(db, stages=TND_STAGES, old=tender.current_stage, new=updates["current_stage"], user=user,
                                      reason=payload.stage_reason, label="tender", tender_id=tender.id)
    if "status" in updates and updates["status"] != tender.status:
        ensure_no_live_order(db, tender_id=tender.id, label="tender", what="status")
    if "org_id" in updates and updates["org_id"] != tender.org_id:
        ensure_no_live_order(db, tender_id=tender.id, label="tender", what="customer")
    if ("org_id" in updates and updates["org_id"] != tender.org_id) or (
        "org_contact_id" in updates and updates["org_contact_id"] != tender.org_contact_id
    ):
        _check_org_and_contact(db, updates.get("org_id") or tender.org_id, updates.get("org_contact_id", tender.org_contact_id), "tender")
    # Same duplicate rule as create: one live tender per number within a zone / division.
    if {"tender_number", "railway_zone", "division"} & set(updates):
        number = updates.get("tender_number", tender.tender_number)
        zone, division = updates.get("railway_zone", tender.railway_zone), updates.get("division", tender.division)
        clash = number and db.query(Tender).filter(
            Tender.is_deleted == False, Tender.id != tender.id,  # noqa: E712
            Tender.tender_number == number, Tender.railway_zone == zone, Tender.division == division,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail=(
                f"Tender number {number} is already used by tender {clash.universal_id} in {zone or 'no zone'} / {division or 'no division'} — "
                f"check the number, or edit that tender instead."))
    stage_changed = "current_stage" in updates and updates["current_stage"] != tender.current_stage
    changed = [f for f, v in updates.items() if str(getattr(tender, f, None)) != str(v)]
    spec_old = {f: getattr(tender, f, None) for f in changed if f not in TENDER_SPEC_EXCLUDE}
    spec_new = {f: updates[f] for f in changed if f not in TENDER_SPEC_EXCLUDE}
    for field, value in updates.items():
        setattr(tender, field, value)

    if spec_new:
        _write_spec_revision(db, tender.id, user, spec_old, spec_new)
    if stage_changed:
        _log_stage(db, tender.id, tender.universal_id, "Stage moved back" if moved_back else "Stage updated", user,
                   notes=f"Moved back to {tender.current_stage} — reason: {payload.stage_reason.strip()}" if moved_back else f"Moved to {tender.current_stage}")
        broadcast_notification(
            db, title="Tender Stage Updated",
            message=f"Tender '{tender.universal_id}' moved to '{tender.current_stage}' by {user.name or user.email}.",
            notification_type="tender_stage_updated", entity_type="tender", entity_id=tender.id,
            exclude_user_id=user.id, app_name="crm",
        )
        notify_user(
            db, user_id=user.id, title="Tender Stage Updated",
            message=f"You moved tender '{tender.universal_id}' to '{tender.current_stage}'.",
            notification_type="tender_stage_updated", entity_type="tender", entity_id=tender.id,
        )

    db.commit()
    db.refresh(tender)
    return _out(tender, user)


@router.delete("/{tender_id}", status_code=204)
async def delete_tender(
    tender_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    ensure_in_scope(db, user, tender)
    ensure_can_delete(user, tender, "crm", "inquiries_tenders", what="tender")
    ensure_deletable(db, tender_id=tender.id, label="tender")

    now = datetime.now(timezone.utc)
    tender.is_deleted = True
    tender.deleted_at = now
    # Takes this tender's own follow-ups/documents with it — the organization and
    # its other records are untouched.
    cascade_delete_children(db, "tender", tender_id, now)
    _write_audit(db, tender.id, "deleted", user, summary=f"Tender {tender.universal_id} deleted by {user.name or user.email}.")
    broadcast_notification(
        db, title="Tender Deleted", message=f"Tender '{tender.universal_id}' was deleted by {user.name or user.email}.",
        notification_type="tender_deleted", entity_type="tender", entity_id=tender.id, exclude_user_id=user.id,
        app_name="crm",
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
    _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "timeline", "view")),
):
    ensure_parent_in_scope(db, _user, "tender", tender_id)
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
    user: User = Depends(require_feature_action("crm", "inquiries_tenders", "send_tor", "create")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    ensure_in_scope(db, user, tender)
    team = requirement_movement.validate_request(db, body.response_due_date)

    raised_by = user.name or user.email
    now = datetime.now(timezone.utc)
    ctx, org = technical_offer.build_context(db, "tender", tender, user, now)
    offer_number = ctx["offer_number"]
    offer_filename = f"{offer_number}.pdf"
    # The Word draft (edited by the BD owner before sending) when there is one for this send.
    offer_bytes, _edited = await technical_offer.send_pdf(db, "tender", tender, ctx)

    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    folder_path = build_sharepoint_folder_path(raised_by, org.name if org else "General", f"crm/tender/{tender.universal_id}/technical-offer", root_folder="CRM-media")
    upload_result = await upload_bytes_to_sharepoint(
        settings.SHAREPOINT_SITE_ID, folder_path, offer_filename,
        "application/pdf", offer_bytes,
    )
    tor_doc = CrmDocument(
        related_module="tender", related_id=tender.id, universal_id=tender.universal_id,
        folder_type="internal", doc_category=technical_offer.DOC_CATEGORY,
        file_name=offer_filename, file_path=upload_result["path"], sharepoint_path=upload_result["path"],
        sharepoint_url=upload_result.get("webUrl"), file_size=upload_result.get("size"),
        mime_type="application/pdf", uploaded_by_name=raised_by, org_id=org.id if org else None,
        created_by_id=user.id, shared_via_tor=True,
    )
    db.add(tor_doc)
    db.flush()
    db.refresh(tor_doc)
    # See the matching comment in inquiries.py — our own signed, time-limited,
    # single-document token, not SharePoint's own sharing (tenant/site policy
    # we don't control) and not the raw SharePoint webUrl.
    tor_doc_link = f"{settings.APP_BASE_URL}/api/v1/crm/documents/{tor_doc.id}/shared-content?token={create_document_share_token('crm_document', tor_doc.id)}"

    reference_documents = []
    selected_docs: list[CrmDocument] = []
    if body.document_ids:
        selected_docs = db.query(CrmDocument).filter(
            CrmDocument.id.in_(body.document_ids),
            CrmDocument.related_module == "tender", CrmDocument.related_id == tender.id,
            CrmDocument.is_deleted == False,  # noqa: E712
        ).all()
        for d in selected_docs:
            d.shared_via_tor = True
        reference_documents = [
            {"name": d.file_name, "url": f"{settings.APP_BASE_URL}/api/v1/crm/documents/{d.id}/shared-content?token={create_document_share_token('crm_document', d.id)}"}
            for d in selected_docs
        ]

    success, error = await send_technical_offer_request_email(
        db, entity_type="tender", entity_id=tender.id, offer_number=offer_number,
        universal_id=tender.universal_id, org_name=org.name if org else "", project_name=tender.tender_name or "",
        documents_link=tor_doc_link, actor_id=user.id, actor_name=raised_by,
        reference_documents=reference_documents, actor_email=user.email,
        attachment_bytes=offer_bytes, attachment_filename=offer_filename,
    )
    if not success:
        db.commit()
        raise HTTPException(status_code=502, detail=f"Failed to send Technical Offer Request email. {error}")

    tender.technical_offer_number = offer_number
    tender.technical_offer_sent_at = now
    movement_log = requirement_movement.record_movement(
        db, module="tender", record_id=tender.id, user=user, offer_number=offer_number,
        ctx=ctx, tor_doc=tor_doc, reference_docs=selected_docs,
    )
    requirement_movement.create_rnd_request(
        db, module="tender", record=tender, user=user, log=movement_log, offer_number=offer_number,
        team=team, due_date=body.response_due_date, remarks=body.remarks,
    )
    db.commit()
    db.refresh(tender)
    return _out(tender, user)


@router.get("/{tender_id}/requirement-movements")
async def list_tender_requirement_movements(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    ensure_in_scope(db, _user, tender)
    return requirement_movement.list_movements(db, module="tender", record=tender)


@router.get("/{tender_id}/spec-revisions")
async def list_tender_spec_revisions(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    ensure_parent_in_scope(db, _user, "tender", tender_id)
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
    return mask_revision_changes(_user, result, TENDER_MONEY_FIELDS)


@router.get("/{tender_id}/stages", response_model=list[StageLogResponse])
async def list_tender_stages(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "timeline", "view")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found — it may have been deleted. Refresh the list.")
    ensure_in_scope(db, _user, tender)
    return db.query(CrmStageLog).filter(
        CrmStageLog.related_module == "tender", CrmStageLog.related_id == tender_id
    ).order_by(CrmStageLog.created_at.asc()).all()


@router.post("/{tender_id}/stages", response_model=StageLogResponse, status_code=201)
async def add_tender_stage(
    tender_id: int,
    payload: StageLogEntry,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("crm", "inquiries_tenders", "stage", "edit")),
):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    ensure_in_scope(db, user, tender)
    if not _can_modify(tender, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can change this tender's stage.")
    if payload.stage not in TND_STAGES:
        raise HTTPException(status_code=422, detail=f"Invalid stage. Must be one of: {', '.join(TND_STAGES)}")
    check_stage_move(db, stages=TND_STAGES, old=tender.current_stage, new=payload.stage, user=user,
                     reason=payload.notes, label="tender", tender_id=tender.id)
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


def _build_mom_ctx(tender_id: int, payload: MomExportRequest, db: Session, user: User) -> tuple[dict, "Organization | None"]:
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    ensure_in_scope(db, user, tender)

    org = db.query(Organization).filter(Organization.id == tender.org_id).first()

    activities_query = db.query(Activity).filter(
        Activity.related_module == "tender", Activity.related_id == tender_id, Activity.is_deleted == False,  # noqa: E712
    )
    if payload.activity_ids:
        activities_query = activities_query.filter(Activity.id.in_(payload.activity_ids))
    activities = activities_query.order_by(Activity.id.asc()).all()

    pew_members = (
        db.query(User).filter(User.id.in_(payload.pew_member_ids)).all() if payload.pew_member_ids else []
    )
    # Only contacts of this tender's own organization — never another customer's people.
    client_contacts = (
        db.query(OrgContact).filter(OrgContact.id.in_(payload.client_contact_ids), OrgContact.org_id == tender.org_id).all()
        if payload.client_contact_ids else []
    )
    if len(client_contacts) != len(set(payload.client_contact_ids or [])):
        raise HTTPException(status_code=422, detail="A picked client contact doesn't belong to this tender's customer organization (or was deleted) — reopen the MoM dialog and pick the contacts again.")

    rows = []
    for a in activities:
        if a.mom_items:
            for item in a.mom_items:
                rows.append({
                    "observation": item.get("observation"),
                    "action_plan": item.get("action_plan"),
                    "responsibility": item.get("responsibility") or tender.bd_owner,
                    "target": item.get("target_date"),
                })
        else:
            target = a.next_followup.strftime("%d.%m.%Y") if a.next_followup else None
            rows.extend(mom_rows_from_activity(a.remarks, a.action_plan, tender.bd_owner, target))

    ctx = {
        "org_name": org.name if org else None,
        "subject": payload.subject,
        "meeting_date": payload.meeting_date.strftime("%d.%m.%Y"),
        "pew_members": [{"name": u.name, "designation": u.designation} for u in pew_members],
        "client_members": [{"name": c.name, "designation": c.designation} for c in client_contacts],
        "activities": rows,
    }
    return ctx, org


@router.post("/{tender_id}/mom-docx")
async def export_tender_mom(
    tender_id: int,
    payload: MomExportRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "followups", "print")),
):
    """Export this tender's logged activities as a Minutes-of-Meeting .docx.
    See the matching inquiries.py endpoint — same context-building and
    template, just scoped to a tender's activities instead of an inquiry's."""
    ctx, org = _build_mom_ctx(tender_id, payload, db, _user)
    buf = build_mom_docx(ctx)

    org_slug = (org.name if org else "Tender").replace(" ", "_").replace("/", "-")
    filename = f"MOM_{org_slug}_{payload.meeting_date.strftime('%Y%m%d')}.docx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{tender_id}/mom-pdf")
async def export_tender_mom_pdf(
    tender_id: int,
    payload: MomExportRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "followups", "print")),
):
    """Export this tender's logged activities as a Minutes-of-Meeting .pdf,
    built directly with reportlab (no DOCX-to-PDF conversion step)."""
    ctx, org = _build_mom_ctx(tender_id, payload, db, _user)
    buf = build_mom_pdf(ctx)

    org_slug = (org.name if org else "Tender").replace(" ", "_").replace("/", "-")
    filename = f"MOM_{org_slug}_{payload.meeting_date.strftime('%Y%m%d')}.pdf"
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
