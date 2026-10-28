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
from app.modules.crm.access import INQUIRY_MONEY_FIELDS, blank, can_open_record, drop_money_updates, ensure_parent_in_scope, mask_revision_changes, sees_prices
from app.core.sequential_id import next_sequential_id
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.inquiry import Inquiry, InquiryLineItem
from app.modules.crm.services.cascade import cascade_delete_children
from app.modules.crm.services import requirement_movement, technical_offer
from app.modules.crm.services.stage_guard import check_stage_move, ensure_deletable, ensure_no_live_order, ensure_not_with_sales
from app.modules.crm.services import opportunity as opp
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
from app.utils.notifications import broadcast_notification, notify_user
from app.utils.email import send_technical_offer_request_email
from app.utils.sharepoint import upload_bytes_to_sharepoint, build_sharepoint_folder_path
from app.auth.jwt_handler import create_document_share_token
from app.core.config import settings
from fastapi.responses import Response

router = APIRouter(prefix="/crm/inquiries", tags=["CRM - Inquiries"])


def _out(inquiry: Inquiry, user: User, db: Session | None = None) -> InquiryResponse:
    """A inquiry as the API returns it — money fields blanked for a user without
    CRM › Inquiries & Tenders › Prices & margins. With `db`, also names the live
    sales order it was sent to Sales as (the record is then read-only)."""
    resp = InquiryResponse.model_validate(inquiry)
    if db is not None:
        from app.modules.sales import service as sales_svc
        order = sales_svc.live_order_for_source(db, inquiry.id, None)
        resp.sales_order_number = order.display_number if order else None
    return resp if sees_prices(user) else blank(resp, INQUIRY_MONEY_FIELDS)

# Pre-sales stages only — mirrors INQ_STAGES in frontend/src/components/crm/constants.ts.
# Post-PO stages (Project, Manufacturing, Dispatch, ...) belong to Sales/Projects,
# not CRM (plan §5), so they were trimmed from this list.
INQ_STAGES = [
    "Requirement Received", "Requirement Qualified", "Quotation Sent",
    "Negotiation", "Order Received", "Closed – Not Ordered",
]

# Mirrors INQUIRY_STATUSES in frontend/src/components/crm/constants.ts.
INQ_STATUSES = [
    "Lead", "Requirement Received", "R&D / Technical Review", "Qualified", "Quotation Sent",
    "Order Received", "Closed - Ordered", "Closed - Not Ordered",
]

# The stage is no longer shown or picked in CRM (owner, 2026-10-27): it follows the
# status, so the Sales handoff (needs stage 'Order Received') and lost/won logic keep working.
STATUS_STAGE = {
    "Lead": "Requirement Received", "Requirement Received": "Requirement Received",
    "R&D / Technical Review": "Requirement Received", "Qualified": "Requirement Qualified",
    "Quotation Sent": "Quotation Sent", "Order Received": "Order Received",
    "Closed - Ordered": "Order Received", "Closed - Not Ordered": "Closed – Not Ordered",
}


def _check_choice(updates: dict, record, field: str, allowed: list[str], label: str) -> None:
    """422 when a PATCH changes `field` to a value outside the coded list.
    A legacy value that is sent back unchanged still passes, so old records
    stay editable."""
    if field not in updates or updates[field] is None:
        return
    value = updates[field]
    if value == getattr(record, field, None) or value in allowed:
        return
    raise HTTPException(
        status_code=422,
        detail=f"'{value}' is not a valid {label}. Pick one of: {', '.join(allowed)}.",
    )


def _check_probability(value) -> None:
    if value is not None and not (0 <= int(value) <= 100):
        raise HTTPException(status_code=422, detail=f"Probability is {value}% — enter a win probability between 0 and 100%.")


def _check_org_and_contact(db: Session, org_id: int, contact_id: int | None, record_label: str = "record") -> None:
    """Same organization/contact checks as create, reused on PATCH."""
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(
            status_code=404,
            detail=f"Customer Organization #{org_id} was not found or is in the recycle bin — pick an active customer organization.",
        )
    if contact_id is not None:
        # Look the contact up without the org filter so the message can name
        # the organization it really belongs to.
        contact = db.query(OrgContact).filter(OrgContact.id == contact_id).first()
        if not contact:
            raise HTTPException(
                status_code=422,
                detail=f"Contact #{contact_id} no longer exists — pick one of {org.name}'s contacts, or leave the contact empty.",
            )
        if contact.org_id != org_id:
            other = db.query(Organization).filter(Organization.id == contact.org_id).first()
            other_name = other.name if other else f"customer organization #{contact.org_id}"
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Contact '{contact.name}' belongs to {other_name}, not {org.name}. "
                    f"When moving this {record_label} to {org.name}, also pick one of its contacts."
                ),
            )


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


def _check_doc_date(value: date | None) -> None:
    if value and value > date.today():
        raise HTTPException(status_code=422, detail=f"Inquiry Date {value.strftime('%d-%m-%Y')} is in the future. Enter the day it was actually received (today or earlier).")


def _generate_universal_id(db: Session) -> str:
    today = date.today().strftime("%Y%m%d")
    return next_sequential_id(db, prefix=f"INQ-{today}-", column=Inquiry.universal_id)


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
    _user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    query = apply_scope(db.query(Inquiry).filter(Inquiry.is_deleted == False), _user, Inquiry)  # noqa: E712
    if status:
        query = query.filter(Inquiry.status == status)
    if org_id:
        query = query.filter(Inquiry.org_id == org_id)
    if search:
        like = f"%{search}%"
        matching_org_ids = [
            row[0] for row in db.query(Organization.id).filter(Organization.name.ilike(like)).all()
        ]
        query = query.filter(
            (Inquiry.universal_id.ilike(like)) | (Inquiry.product.ilike(like)) | (Inquiry.bd_owner.ilike(like))
            | (Inquiry.sales_engineer.ilike(like)) | (Inquiry.railway_zone.ilike(like)) | (Inquiry.division.ilike(like))
            | (Inquiry.lead_source.ilike(like)) | (Inquiry.status.ilike(like)) | (Inquiry.current_stage.ilike(like))
            | (Inquiry.product_category.ilike(like)) | (Inquiry.delivery_location.ilike(like))
            | (Inquiry.requirement_desc.ilike(like))
            | (Inquiry.followup_assigned_to.ilike(like)) | (Inquiry.priority.ilike(like))
            | (Inquiry.org_id.in_(matching_org_ids) if matching_org_ids else False)
        )
    inquiries = query.order_by(Inquiry.id.desc()).offset(skip).limit(limit).all()
    creator_ids = {i.created_by_id for i in inquiries if i.created_by_id}
    names_by_id = {}
    if creator_ids:
        for u in db.query(User).filter(User.id.in_(creator_ids)).all():
            names_by_id[u.id] = u.name or u.email
    results = []
    for i in inquiries:
        resp = _out(i, _user)
        resp.created_by_name = names_by_id.get(i.created_by_id)
        results.append(resp)
    return results


@router.post("", response_model=InquiryResponse, status_code=201)
async def create_inquiry(
    payload: InquiryCreate,
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
    # Same coded lists as PATCH — a typo'd or made-up stage/status would otherwise be
    # saved and then break the forward-only stage order and the Sales handoff check.
    _check_choice({"current_stage": payload.current_stage}, None, "current_stage", INQ_STAGES, "inquiry stage")
    _check_choice({"status": payload.status}, None, "status", INQ_STATUSES, "inquiry status")

    data = payload.model_dump(exclude={"additional_items"})
    data["current_stage"] = STATUS_STAGE.get(data.get("status"), data.get("current_stage"))
    data["inquiry_date"] = data.get("inquiry_date") or date.today()
    _check_doc_date(data["inquiry_date"])
    # The BD owner is always the person who logs the inquiry — not picked on the form.
    data["bd_owner_id"] = user.id
    data["bd_owner"] = user.name or user.email
    _check_probability(data.get("probability"))
    opp.check_lost_code(data.get("lost_reason_code"))
    opp.apply_owners(db, None, data, user)
    opp.ensure_lost_details(data)
    universal_id = _generate_universal_id(db)
    inquiry = Inquiry(**data, universal_id=universal_id, created_by_id=user.id)
    opp.stamp_closed(inquiry)
    db.add(inquiry)
    db.flush()

    if payload.additional_items:
        inquiry.additional_items = [
            InquiryLineItem(**item.model_dump(), sort_order=i) for i, item in enumerate(payload.additional_items)
        ]

    _log_stage(db, inquiry.id, universal_id, "Inquiry created", user)
    if inquiry.next_followup_date:
        db.add(Activity(
            activity_type="Follow-up", org_id=inquiry.org_id, related_module="inquiry", related_id=inquiry.id,
            universal_id=universal_id, next_followup=inquiry.next_followup_date,
            assigned_to=inquiry.followup_assigned_to, created_by_id=user.id,
        ))
    _write_audit(db, inquiry.id, "created", user, summary=f"Inquiry {universal_id} created by {user.name or user.email}.")
    # Role event (Organization › Roles › Notifications); whoever it reached is left out of the broadcast / rule.
    reached = notify_event(
        db, background_tasks, "crm", "inquiry_received",
        title=f"New inquiry {universal_id} — {org.name}",
        message=f"{user.name or user.email} logged inquiry {universal_id} for {org.name}"
                + (f" ({inquiry.product})" if inquiry.product else "") + ". Open it to qualify the requirement.",
        entity_type="inquiry", entity_id=inquiry.id, actor=user, can_open=can_open_record(db, inquiry),
        details=[("Inquiry", universal_id), ("Customer Organization", org.name), ("Product", inquiry.product or ""),
                 ("Priority", inquiry.priority or "")],
    )
    broadcast_except(
        db, reached, title="New Inquiry Raised", message=f"Inquiry '{universal_id}' was created by {user.name or user.email}.",
        notification_type="inquiry_created", entity_type="inquiry", entity_id=inquiry.id, exclude_user_id=user.id,
    )
    notify_user(
        db, user_id=user.id, title="Inquiry Created", message=f"You created inquiry '{universal_id}'.",
        notification_type="inquiry_created", entity_type="inquiry", entity_id=inquiry.id,
    )
    fire_rule(db, background_tasks, "crm", "inquiry_create", "New Inquiry Created",
              f"Inquiry '{universal_id}' for {org.name} was created by {user.name or user.email}.", "inquiry", inquiry.id, user,
              [("Inquiry", universal_id), ("Customer Organization", org.name), ("Product", inquiry.product or ""),
               ("Category", inquiry.product_category or ""), ("Priority", inquiry.priority or ""), ("Created by", user.name or user.email)],
              skip_user_ids=reached)
    db.commit()
    db.refresh(inquiry)
    return _out(inquiry, user)


@router.get("/{inquiry_id}", response_model=InquiryResponse)
async def get_inquiry(
    inquiry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    ensure_in_scope(db, _user, inquiry)
    return _out(inquiry, _user, db)


@router.patch("/{inquiry_id}", response_model=InquiryResponse)
async def update_inquiry(
    inquiry_id: int,
    payload: InquiryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("crm", "inquiries_tenders", "edit")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    ensure_in_scope(db, user, inquiry)
    if not _can_modify(inquiry, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this inquiry.")
    ensure_not_with_sales(db, inquiry_id=inquiry.id, label="inquiry")

    updates = payload.model_dump(exclude_unset=True, exclude={"additional_items", "stage_reason"})
    if "inquiry_date" in updates:
        if updates["inquiry_date"] is None:
            updates.pop("inquiry_date")  # the date is always kept; clearing it is ignored
        else:
            _check_doc_date(updates["inquiry_date"])
    # BD owner = the creator, fixed for the inquiry's life. The form sends the
    # current values back (fine); asking for a different owner is refused.
    if updates.get("bd_owner_id") is not None and updates["bd_owner_id"] != inquiry.bd_owner_id:
        raise HTTPException(status_code=422, detail=(
            f"The BD owner of inquiry {inquiry.universal_id} is the person who created it "
            f"({inquiry.bd_owner or 'not recorded'}) and can't be changed."))
    updates.pop("bd_owner", None)
    updates.pop("bd_owner_id", None)
    _check_choice(updates, inquiry, "current_stage", INQ_STAGES, "inquiry stage")
    _check_choice(updates, inquiry, "status", INQ_STATUSES, "inquiry status")
    drop_money_updates(user, updates, INQUIRY_MONEY_FIELDS)
    if "current_stage" in updates and updates["current_stage"] != inquiry.current_stage:
        ensure_feature_action(user, "crm", "inquiries_tenders", "stage", "edit")
    moved_back = False
    if updates.get("current_stage") is not None:
        moved_back = check_stage_move(db, stages=INQ_STAGES, old=inquiry.current_stage, new=updates["current_stage"], user=user,
                                      reason=payload.stage_reason, label="inquiry", inquiry_id=inquiry.id)
    if "status" in updates and updates["status"] != inquiry.status:
        ensure_no_live_order(db, inquiry_id=inquiry.id, label="inquiry", what="status")
    _check_probability(updates.get("probability"))
    opp.check_lost_code(updates.get("lost_reason_code"))
    opp.apply_owners(db, inquiry, updates, user)
    opp.ensure_lost_details({f: updates.get(f, getattr(inquiry, f)) for f in
                             ("current_stage", "status", "lost_reason_code", "lost_to_competitor", "lost_remarks")})
    if "org_id" in updates and updates["org_id"] != inquiry.org_id:
        ensure_no_live_order(db, inquiry_id=inquiry.id, label="inquiry", what="customer")
    if ("org_id" in updates and updates["org_id"] != inquiry.org_id) or (
        "org_contact_id" in updates and updates["org_contact_id"] != inquiry.org_contact_id
    ):
        _check_org_and_contact(db, updates.get("org_id") or inquiry.org_id, updates.get("org_contact_id", inquiry.org_contact_id), "inquiry")
    # The stage follows the status (STATUS_STAGE); a status change already passed
    # ensure_no_live_order above, so no separate forward-only stage check here.
    if ("status" in updates and "current_stage" not in updates
            and STATUS_STAGE.get(updates["status"], inquiry.current_stage) != inquiry.current_stage):
        updates["current_stage"] = STATUS_STAGE[updates["status"]]
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

    # additional_items is a full-replace: whatever the form last submitted becomes
    # the complete list, same as how a quotation's line items are handled on save.
    if payload.additional_items is not None:
        inquiry.additional_items = [
            InquiryLineItem(**item.model_dump(), sort_order=i) for i, item in enumerate(payload.additional_items)
        ]

    opp.stamp_closed(inquiry)
    if info_changed:
        _write_spec_revision(db, inquiry.id, user, info_old, info_new)
    if stage_changed:
        _log_stage(db, inquiry.id, inquiry.universal_id, "Stage moved back" if moved_back else "Stage updated", user,
                   notes=f"Moved back to {inquiry.current_stage} — reason: {payload.stage_reason.strip()}" if moved_back else f"Moved to {inquiry.current_stage}")
        broadcast_notification(
            db, title="Inquiry Stage Updated",
            message=f"Inquiry '{inquiry.universal_id}' moved to '{inquiry.current_stage}' by {user.name or user.email}.",
            notification_type="inquiry_stage_updated", entity_type="inquiry", entity_id=inquiry.id,
            exclude_user_id=user.id, app_name="crm",
        )
        notify_user(
            db, user_id=user.id, title="Inquiry Stage Updated",
            message=f"You moved inquiry '{inquiry.universal_id}' to '{inquiry.current_stage}'.",
            notification_type="inquiry_stage_updated", entity_type="inquiry", entity_id=inquiry.id,
        )

    db.commit()
    db.refresh(inquiry)
    return _out(inquiry, user)


@router.delete("/{inquiry_id}", status_code=204)
async def delete_inquiry(
    inquiry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    ensure_in_scope(db, user, inquiry)
    ensure_can_delete(user, inquiry, "crm", "inquiries_tenders", what="inquiry")
    ensure_deletable(db, inquiry_id=inquiry.id, label="inquiry")

    now = datetime.now(timezone.utc)
    inquiry.is_deleted = True
    inquiry.deleted_at = now
    # Takes this inquiry's own follow-ups/documents with it — the organization and
    # its other records are untouched.
    cascade_delete_children(db, "inquiry", inquiry_id, now)
    _write_audit(db, inquiry.id, "deleted", user, summary=f"Inquiry {inquiry.universal_id} deleted by {user.name or user.email}.")
    broadcast_notification(
        db, title="Inquiry Deleted", message=f"Inquiry '{inquiry.universal_id}' was deleted by {user.name or user.email}.",
        notification_type="inquiry_deleted", entity_type="inquiry", entity_id=inquiry.id, exclude_user_id=user.id,
        app_name="crm",
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
    _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "timeline", "view")),
):
    ensure_parent_in_scope(db, _user, "inquiry", inquiry_id)
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
    user: User = Depends(require_feature_action("crm", "inquiries_tenders", "send_tor", "create")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    ensure_in_scope(db, user, inquiry)
    ensure_not_with_sales(db, inquiry_id=inquiry.id, label="inquiry")
    missing = [label for label, ok in (
        ("Product", bool(inquiry.product)),
        ("Specification", bool(inquiry.product_spec)),
    ) if not ok]
    if missing:
        raise HTTPException(status_code=422, detail=f"Fill {' and '.join(missing)} on inquiry {inquiry.universal_id} (click Edit) before sending the Technical Requirement to R&D — otherwise R&D gets a document with no requirement details.")
    team = requirement_movement.validate_request(db, body.response_due_date)

    raised_by = user.name or user.email
    now = datetime.now(timezone.utc)
    ctx, org = technical_offer.build_context(db, "inquiry", inquiry, user, now)
    offer_number = ctx["offer_number"]
    offer_filename = f"{offer_number}.pdf"
    # The Word draft (edited by the BD owner before sending) when there is one for this send.
    offer_bytes, _edited = await technical_offer.send_pdf(db, "inquiry", inquiry, ctx)

    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    folder_path = build_sharepoint_folder_path(raised_by, org.name if org else "General", f"crm/inquiry/{inquiry.universal_id}/technical-offer", root_folder="CRM-media")
    upload_result = await upload_bytes_to_sharepoint(
        settings.SHAREPOINT_SITE_ID, folder_path, offer_filename, "application/pdf", offer_bytes,
    )
    tor_doc = CrmDocument(
        related_module="inquiry", related_id=inquiry.id, universal_id=inquiry.universal_id,
        folder_type="internal", doc_category=technical_offer.DOC_CATEGORY,
        file_name=offer_filename, file_path=upload_result["path"], sharepoint_path=upload_result["path"],
        sharepoint_url=upload_result.get("webUrl"), file_size=upload_result.get("size"),
        mime_type="application/pdf", uploaded_by_name=raised_by, org_id=org.id if org else None,
        created_by_id=user.id, shared_via_tor=True,
    )
    db.add(tor_doc)
    db.flush()
    db.refresh(tor_doc)
    # Recipients (e.g. external vendors) often have no portal account and no
    # SharePoint access at all, so the link can't require an app login or
    # rely on SharePoint's own sharing (which depends on tenant/site policy
    # we don't control and, if opened up, would risk exposing the whole
    # document library). Instead this is our own signed, time-limited,
    # single-document token — verified by get_shared_document_content in
    # documents.py, which fetches the bytes server-side with the app-only
    # Graph token. SharePoint's own sharing settings are irrelevant to it.
    tor_doc_link = f"{settings.APP_BASE_URL}/api/v1/crm/documents/{tor_doc.id}/shared-content?token={create_document_share_token('crm_document', tor_doc.id)}"

    reference_documents = []
    selected_docs: list[CrmDocument] = []
    if body.document_ids:
        selected_docs = db.query(CrmDocument).filter(
            CrmDocument.id.in_(body.document_ids),
            CrmDocument.related_module == "inquiry", CrmDocument.related_id == inquiry.id,
            CrmDocument.is_deleted == False,  # noqa: E712
        ).all()
        for d in selected_docs:
            d.shared_via_tor = True
        reference_documents = [
            {"name": d.file_name, "url": f"{settings.APP_BASE_URL}/api/v1/crm/documents/{d.id}/shared-content?token={create_document_share_token('crm_document', d.id)}"}
            for d in selected_docs
        ]

    success, error = await send_technical_offer_request_email(
        db, entity_type="inquiry", entity_id=inquiry.id, offer_number=offer_number,
        universal_id=inquiry.universal_id, org_name=org.name if org else "", project_name=inquiry.product or "",
        documents_link=tor_doc_link, actor_id=user.id, actor_name=raised_by,
        reference_documents=reference_documents, actor_email=user.email,
        attachment_bytes=offer_bytes, attachment_filename=offer_filename,
    )
    if not success:
        db.commit()
        raise HTTPException(status_code=502, detail=f"Failed to send Technical Offer Request email. {error}")

    inquiry.technical_offer_number = offer_number
    inquiry.technical_offer_sent_at = now
    movement_log = requirement_movement.record_movement(
        db, module="inquiry", record_id=inquiry.id, user=user, offer_number=offer_number,
        ctx=ctx, tor_doc=tor_doc, reference_docs=selected_docs,
    )
    requirement_movement.create_rnd_request(
        db, module="inquiry", record=inquiry, user=user, log=movement_log, offer_number=offer_number,
        team=team, due_date=body.response_due_date, remarks=body.remarks,
    )
    db.commit()
    db.refresh(inquiry)
    return _out(inquiry, user)


@router.get("/{inquiry_id}/requirement-movements")
async def list_inquiry_requirement_movements(
    inquiry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    ensure_in_scope(db, _user, inquiry)
    return requirement_movement.list_movements(db, module="inquiry", record=inquiry)


# The Info tab's Revision selector only counts edits to the requirement text itself;
# every other info edit still lands in the same log and shows on the Timeline.
REQUIREMENT_REVISION_FIELDS = ("product_spec", "requirement_desc", "project_details")


@router.get("/{inquiry_id}/spec-revisions")
async def list_inquiry_spec_revisions(
    inquiry_id: int,
    requirement_only: bool = False,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("crm", "inquiries_tenders")),
):
    ensure_parent_in_scope(db, _user, "inquiry", inquiry_id)
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "inquiry_spec", AuditLog.entity_id == inquiry_id
    ).order_by(AuditLog.performed_at.asc()).all()
    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"
    result = []
    seq = 0
    for log in logs:
        old_vals = json.loads(log.old_value) if log.old_value else {}
        new_vals = json.loads(log.new_value) if log.new_value else {}
        if requirement_only:
            new_vals = {f: v for f, v in new_vals.items() if f in REQUIREMENT_REVISION_FIELDS}
            if not new_vals:
                continue
        seq += 1
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
    return mask_revision_changes(_user, result, INQUIRY_MONEY_FIELDS)


@router.get("/{inquiry_id}/stages", response_model=list[StageLogResponse])
async def list_inquiry_stages(
    inquiry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "timeline", "view")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found — it may have been deleted. Refresh the list.")
    ensure_in_scope(db, _user, inquiry)
    return db.query(CrmStageLog).filter(
        CrmStageLog.related_module == "inquiry", CrmStageLog.related_id == inquiry_id
    ).order_by(CrmStageLog.created_at.asc()).all()


@router.post("/{inquiry_id}/stages", response_model=StageLogResponse, status_code=201)
async def add_inquiry_stage(
    inquiry_id: int,
    payload: StageLogEntry,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("crm", "inquiries_tenders", "stage", "edit")),
):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    ensure_in_scope(db, user, inquiry)
    if not _can_modify(inquiry, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can change this inquiry's stage.")
    if payload.stage not in INQ_STAGES:
        raise HTTPException(status_code=422, detail=f"Invalid stage. Must be one of: {', '.join(INQ_STAGES)}")
    check_stage_move(db, stages=INQ_STAGES, old=inquiry.current_stage, new=payload.stage, user=user,
                     reason=payload.notes, label="inquiry", inquiry_id=inquiry.id)
    # Closing as not ordered from the timeline needs the lost reason on the inquiry first.
    opp.ensure_lost_details({"current_stage": payload.stage, "status": inquiry.status, "lost_reason_code": inquiry.lost_reason_code,
                             "lost_to_competitor": inquiry.lost_to_competitor, "lost_remarks": inquiry.lost_remarks})
    entry = CrmStageLog(
        related_module="inquiry", related_id=inquiry_id, universal_id=inquiry.universal_id, stage=payload.stage,
        entered_by_id=user.id, entered_by_name=user.name or user.email, notes=payload.notes,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    inquiry.current_stage = payload.stage
    opp.stamp_closed(inquiry)
    db.commit()
    db.refresh(entry)
    return entry


def _build_mom_ctx(inquiry_id: int, payload: MomExportRequest, db: Session, user: User) -> tuple[dict, "Organization | None"]:
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    ensure_in_scope(db, user, inquiry)

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
    # Only contacts of this inquiry's own organization — never another customer's people.
    client_contacts = (
        db.query(OrgContact).filter(OrgContact.id.in_(payload.client_contact_ids), OrgContact.org_id == inquiry.org_id).all()
        if payload.client_contact_ids else []
    )
    if len(client_contacts) != len(set(payload.client_contact_ids or [])):
        raise HTTPException(status_code=422, detail="A picked client contact doesn't belong to this inquiry's customer organization (or was deleted) — reopen the MoM dialog and pick the contacts again.")

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
    _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "followups", "print")),
):
    """Export this inquiry's logged activities as a Minutes-of-Meeting .docx.
    Client name/contacts and organization are pulled from the already-linked
    records rather than re-entered — only the meeting-specific fields
    (subject, date, who was present, which activities to include) are asked
    for at export time."""
    ctx, org = _build_mom_ctx(inquiry_id, payload, db, _user)
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
    _user: User = Depends(require_feature_action("crm", "inquiries_tenders", "followups", "print")),
):
    """Export this inquiry's logged activities as a Minutes-of-Meeting .pdf,
    built directly with reportlab (no DOCX-to-PDF conversion step)."""
    ctx, org = _build_mom_ctx(inquiry_id, payload, db, _user)
    buf = build_mom_pdf(ctx)

    org_slug = (org.name if org else "Inquiry").replace(" ", "_").replace("/", "-")
    filename = f"MOM_{org_slug}_{payload.meeting_date.strftime('%Y%m%d')}.pdf"
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
