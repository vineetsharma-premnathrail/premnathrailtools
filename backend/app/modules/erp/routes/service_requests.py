from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Query, Request, UploadFile, File
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import (
    ensure_can_delete, ensure_feature_action, ensure_tab_action, has_erp_permission, require_app_access,
    require_feature_action, require_tab_access,
)
from app.core.permission_registry import can_access_module, is_admin_user
from app.core import assignee_rules
from app.db.session import SessionLocal, get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment
from app.modules.erp.schemas.service_request import (
    ServiceRequestCreate,
    ServiceRequestUpdate,
    ServiceRequestResponse,
    ServiceRequestAttachmentResponse,
    ServiceMaterialCreate,
    ServiceMaterialUpdate,
    ServiceMaterialResponse,
    ServiceMaterialAttachmentResponse,
    MaterialReceivePayload,
    ServiceMaterialIssuePayload,
    ServiceMaterialReturnPayload,
    ServiceInvoiceCreatePayload,
)
from app.modules.erp import billing as sr_billing, spares as sr_spares, warranty as sr_warranty
from app.modules.erp import sensitive as sr_sensitive
from app.modules.p2p.models.p2p_request import (
    P2PRequest, resolve_auto_buyer_id, P2P_CATEGORIES, P2P_REQUIREMENT_TYPES, P2P_REQUEST_PRIORITIES,
)
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.item_link import item_snapshot, purchasable_item
from app.modules.store.models.item import StoreItem
from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment, P2P_ATTACHMENT_DOC_TYPES
from app.modules.p2p.schemas.p2p_request import P2PRequestResponse
from app.modules.p2p.routes.p2p_requests import _refresh_stock_snapshot, _route_lines_on_approval
from app.modules.p2p.service import generate_p2p_number, _lock_number_series
from pydantic import BaseModel
from fastapi.responses import Response
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    get_preview_url, download_file_content,
)
from app.utils.email import send_client_sr_email, send_team_sr_notification, send_purchase_requisition_email
from app.utils.notifications import broadcast_notification, notify_user
from app.modules.erp.settings import get_setting as get_erp_setting
from app.modules.erp.notify import approver_ids, broadcast_except, fire_event, role_event
from app.modules.erp import access as erp_access
from app.core.data_scope import apply_scope, ensure_in_scope
from app.modules.organization.services import approval_engine as engine
from app.auth.microsoft import get_app_graph_token

router = APIRouter(prefix="/erp/service-requests", tags=["ERP - Service Requests"])


class RaisePurchaseRequestItem(BaseModel):
    """One line of the New-PR-style form on the SR Materials tab — same
    columns as the P2P New PR item table. The item is picked from the Store
    Item Master (store_item_id); name / part code / unit come from the master."""
    store_item_id: int | None = None
    item_name: str = ""
    make: str | None = None
    part_code: str | None = None
    unit: str | None = None
    quantity: float = 1
    project_inhouse: str | None = None
    category: str | None = None
    ship_to: str | None = None


class RaisePurchaseRequestPayload(BaseModel):
    """Payload for raising a P2P request out of this SR's Materials tab. Field
    shape kept identical to the old (now-deleted) purchase module's
    PurchaseRequisitionRaisePayload so the frontend call site is unaffected."""
    priority: str = "medium"
    required_by_date: date | None = None
    reason: str | None = None
    category_code: str | None = None
    requirement_type: str | None = None
    # Line items from the New-PR-style form. Each becomes an SR material
    # linked to the new PR. Empty = legacy behaviour (use the SR's existing
    # unlinked materials).
    items: list[RaisePurchaseRequestItem] = []
    # Ignored — service PRs need no PR approval. Kept so older clients that
    # still send it don't fail validation.
    approvers: dict[str, int] = {}

# Fields tracked in the audit log on PATCH, with a human-readable label
_TRACKED_FIELDS = {
    "status": "Status",
    "priority": "Priority",
    "service_type": "Service Type",
    "assigned_to_name": "Assigned To",
    "issue_title": "Issue Title",
    "issue_description": "Description",
    "issue_category": "Category",
    "sub_category": "Sub-Category",
    "failure_mode": "Failure Mode",
    "root_cause": "Root Cause",
    "resolution_description": "Resolution",
    "expected_date_to_attend": "Expected Attend Date",
    "expected_completion_date": "Expected Close Date",
    "service_report_notes": "Service Notes",
}


def _write_audit(
    db: Session,
    sr_id: int,
    action: str,
    user: User,
    request: Request | None = None,
    field_name: str | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
    summary: str | None = None,
):
    db.add(
        AuditLog(
            entity_type="service_request",
            entity_id=sr_id,
            action=action,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            summary=summary,
            performed_by_id=user.id,
        )
    )


def _recompute_billing(db: Session, sr: ServiceRequest) -> None:
    """Roll up this SR's billing fields from its real cost inputs — mirrors the
    subtotal/tax/grand-total pattern used elsewhere (see crm/routes/workflow.py
    and p2p/routes/rfq.py: subtotal = sum of line amounts, tax_amt = subtotal *
    pct/100, total = subtotal + tax_amt).

    `total_material_cost` is rolled up here from the SR's active materials
    (each material's `estimated_budget` is its own line total, there being no
    separate per-unit price field). `service_cost`/`transport_cost`/
    `accommodation_cost`/`miscellaneous_cost`/`tax_percentage` are plain
    manually-entered fields on the SR itself (settable via PATCH). Call this
    any time either of those input sets changes, before commit."""
    # Item Master lines are valued at what was really consumed (issued −
    # returned): unit_price for the customer bill (warranty-covered lines are
    # free), unit_cost for the SR's actual material cost. Legacy free-text
    # lines keep their estimated_budget.
    # Visits (erp/visits.py) drive travel / stay / other charges, the
    # labour charge (when a rate is set) and the attended date.
    from app.modules.erp.visits import apply_visit_rollup
    apply_visit_rollup(db, sr)
    material_total = 0.0
    actual_cost = 0.0
    for m in db.query(ServiceMaterial).filter(
        ServiceMaterial.service_request_id == sr.id, ServiceMaterial.is_deleted == False  # noqa: E712
    ).all():
        if m.store_item_id:
            net = m.net_issued
            actual_cost += net * (m.unit_cost or 0)
            if not m.is_warranty_covered:
                material_total += net * (m.unit_price or 0)
        else:
            material_total += m.estimated_budget or 0
    sr.total_material_cost = round(float(material_total), 2)
    sr.material_cost_actual = round(float(actual_cost), 2)

    subtotal = (
        (sr.service_cost or 0)
        + (sr.transport_cost or 0)
        + (sr.accommodation_cost or 0)
        + (sr.miscellaneous_cost or 0)
        + sr.total_material_cost
    )
    sr.tax_amount = subtotal * (sr.tax_percentage or 0) / 100
    sr.total_bill = subtotal + sr.tax_amount


def _current_financial_year() -> str:
    today = date.today()
    fy_start = today.year if today.month >= 4 else today.year - 1
    return f"{fy_start}-{str(fy_start + 1)[-2:]}"


def _generate_sr_number(db: Session) -> str:
    prefix = f"SR-{_current_financial_year()}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(ServiceRequest.request_number)).filter(ServiceRequest.request_number.like(f"{prefix}%")).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


async def _run_sr_emails_background(sr_id: int, event_type: str, actor_id: int, actor_name: str | None):
    """Runs after the request has already responded — opens its own DB session
    since the request-scoped one is already closed by then.

    Guarded by an atomic UPDATE ... WHERE flag=false so the "created"/"closed"
    notification is sent at most once per SR, even if this task path is ever
    triggered more than once for the same event."""
    flag_column = "created_notification_sent" if event_type == "created" else "closed_notification_sent"
    db = SessionLocal()
    try:
        result = db.execute(
            ServiceRequest.__table__.update()
            .where(ServiceRequest.id == sr_id, getattr(ServiceRequest, flag_column) == False)  # noqa: E712
            .values(**{flag_column: True})
        )
        db.commit()
        if result.rowcount == 0:
            return  # Already sent for this SR/event — nothing to do.

        sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False).first()  # noqa: E712
        if not sr:
            return
        project = db.query(Project).filter(Project.id == sr.project_id).first()
        await send_client_sr_email(db, sr, project, actor_id, actor_name, event_type)
        await send_team_sr_notification(db, sr, project, actor_id, actor_name, event_type)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


async def _send_purchase_requisition_email_background(pr_id: int, sr_id: int):
    """Best-effort email to the Purchase department mailbox (settings.PURCHASE_EMAIL),
    run after the PR has already been committed — mirrors `_run_sr_emails_background`'s
    pattern of opening its own DB session since the request-scoped one is
    closed by the time a BackgroundTask runs."""
    db = SessionLocal()
    try:
        if not settings.PURCHASE_EMAIL:
            return
        pr = db.query(P2PRequest).filter(P2PRequest.id == pr_id).first()
        sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id).first()
        if not pr or not sr:
            return
        project = db.query(Project).filter(Project.id == sr.project_id).first()
        materials = db.query(ServiceMaterial).filter(
            ServiceMaterial.pr_id == pr.id, ServiceMaterial.is_deleted == False  # noqa: E712
        ).all()
        await send_purchase_requisition_email(db, pr, sr, project, materials, [settings.PURCHASE_EMAIL])
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


# Fields that may still change once an SR is closed / cancelled (billing runs
# after closure). Everything else needs the SR reopened with a reason first.
_SR_POST_CLOSE_EDITABLE = frozenset({
    "service_cost", "transport_cost", "accommodation_cost", "miscellaneous_cost",
    "tax_percentage", "payment_status", "invoice_number", "is_chargeable", "chargeable_reason",
})


def _can_edit(sr: ServiceRequest, user: User) -> bool:
    """Admins always pass. The SR's assigned engineer passes too (they do the
    work, so they must be able to record RCA, materials and files — each
    route still checks its own feature permission). Everyone else must both
    own the SR (be its creator) and hold Service Requests › Edit in the
    Permission Matrix. Removing a child line (material, photo, attachment) is
    part of editing the SR, so it is decided here too — deleting the SR itself
    goes through ensure_can_delete."""
    if is_admin_user(user):
        return True
    if sr.assigned_service_person_id and sr.assigned_service_person_id == user.id:
        return True
    return sr.created_by_id == user.id and has_erp_permission(user, "sr_edit")


# Role "Assign to" rule for the engineer — same rule as the visit's engineer
# (core/assignee_rules.PICKERS, declared in core/features/erp.py).
_ENGINEER_RULE_KEY = "erp:service_requests.visits"


def _apply_engineer(db: Session, user: User, values: dict) -> None:
    """Validate `assigned_service_person_id` in a create / update payload and
    derive `assigned_to_name` from the user record (never trust a typed name).
    Clearing the engineer clears the name too."""
    if "assigned_service_person_id" not in values:
        values.pop("assigned_to_name", None)
        return
    eng_id = values["assigned_service_person_id"]
    if not eng_id:
        values["assigned_service_person_id"] = None
        values["assigned_to_name"] = None
        return
    eng = db.query(User).filter(User.id == eng_id).first()
    if not eng or not eng.is_active:
        raise HTTPException(
            status_code=422,
            detail=f"The selected engineer (user #{eng_id}) was not found or is inactive — pick another engineer from the list.",
        )
    if not can_access_module(eng, "erp"):
        raise HTTPException(
            status_code=422,
            detail=f"{eng.name or eng.email} has no access to the Service module, so can't be assigned the job. "
                   "Pick another engineer, or ask an admin to give them Service access in Users & Roles.",
        )
    if eng.id != user.id:
        assignee_rules.ensure_allowed(db, user, _ENGINEER_RULE_KEY, eng)
    values["assigned_to_name"] = eng.name or eng.email


def _sr_details(sr: ServiceRequest, project: Project | None, user: User) -> list[tuple[str, str]]:
    """Rows for the notification email."""
    return [
        ("Service request", sr.request_number),
        ("Issue", sr.issue_title or ""),
        ("Machine", f"{project.serial_number} {project.model_name or ''}".strip() if project else ""),
        ("Client", (project.client_company if project else None) or ""),
        ("Priority", (sr.priority or "").title()),
        ("Assigned to", sr.assigned_to_name or ""),
        ("Done by", user.name or user.email),
    ]


class SRCloseDecisionPayload(BaseModel):
    remarks: str | None = None


_SR_NOT_FOUND = "Service request not found — it may be in the Recycle Bin; restore it first."
_SHAREPOINT_MISSING = (
    "File storage (SharePoint) is not configured on the server — ask an admin to set "
    "SHAREPOINT_SITE_ID in the backend .env."
)
_SR_ATTACHMENT_NOT_FOUND = "File not found on this service request — it may have been deleted. Refresh the page."
_SR_LOCKED = (
    "This service request is locked, so its details, materials and files can't be changed. "
    "Ask an admin to unlock it first."
)


def _announce_assignment(db: Session, background_tasks, sr: ServiceRequest, user: User) -> None:
    """Tell the newly assigned engineer directly, and roles subscribed to
    erp.sr_assigned (skipping the engineer)."""
    eng = sr.assigned_service_person_id
    if not eng:
        return
    who = sr.assigned_to_name or "an engineer"
    if eng != user.id:
        notify_user(db, eng, f"{sr.request_number} assigned to you",
                    f"{user.name or user.email} assigned service request {sr.request_number} ({sr.issue_title}) to you — plan the visit.",
                    notification_type="sr_assigned", entity_type="service_request", entity_id=sr.id)
    role_event(db, background_tasks, "sr_assigned", title=f"{sr.request_number} assigned to {who}",
               message=f"{user.name or user.email} assigned service request {sr.request_number} ({sr.issue_title}) to {who}.",
               entity_type="service_request", entity_id=sr.id, actor=user, record=sr, skip_user_ids={eng})


def _announce_closed(db: Session, background_tasks, sr: ServiceRequest, actor: User, how: str) -> set[int]:
    """erp.sr_closed role event; returns who it reached (to skip in the old broadcast)."""
    return role_event(db, background_tasks, "sr_closed", title=f"{sr.request_number} closed",
                      message=f"Service request {sr.request_number} ({sr.issue_title}) was closed {how}.",
                      entity_type="service_request", entity_id=sr.id, actor=actor, record=sr,
                      skip_user_ids={sr.created_by_id} if sr.created_by_id else None)


def _get_live_sr(db: Session, sr_id: int, *, with_project: bool = False, user: User | None = None) -> ServiceRequest:
    """Load a service request that is NOT in the Recycle Bin, or 404. Every
    child route (attachments, materials, photos) goes through this so a
    deleted SR can't be changed and a made-up sr_id can't skip the
    permission check."""
    q = db.query(ServiceRequest)
    if with_project:
        q = q.options(selectinload(ServiceRequest.project))
    sr = q.filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False).first()  # noqa: E712
    if not sr:
        raise HTTPException(status_code=404, detail=_SR_NOT_FOUND)
    if user is not None:
        ensure_in_scope(db, user, sr)
    return sr


def _ensure_unlocked(sr: ServiceRequest) -> None:
    if sr.is_locked:
        raise HTTPException(status_code=423, detail=_SR_LOCKED)


def _ensure_open_for_purchase(sr: ServiceRequest) -> None:
    """No purchase activity on a finished job."""
    status = (sr.status or "").lower()
    if status in ("closed", "cancelled"):
        raise HTTPException(
            status_code=409,
            detail=f"{sr.request_number} is {status} — reopen it (set status back to In Progress) before raising or changing a purchase requisition.",
        )


def _ensure_open_for_materials(sr: ServiceRequest) -> None:
    """Spare-part lines are booked against a running job only — a closed or
    cancelled SR's material list is its final record (it feeds the bill)."""
    status = (sr.status or "").lower()
    if status in ("closed", "cancelled"):
        raise HTTPException(
            status_code=409,
            detail=f"{sr.request_number} is {status}, so its materials can't be added, changed or removed — "
                   "reopen it (set the status back to In Progress, with a reason) first.",
        )


def _get_live_material(db: Session, sr_id: int, mat_id: int) -> ServiceMaterial:
    mat = db.query(ServiceMaterial).filter(
        ServiceMaterial.id == mat_id, ServiceMaterial.service_request_id == sr_id,
        ServiceMaterial.is_deleted == False,  # noqa: E712
    ).first()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found on this service request — it may have been deleted. Refresh the page.")
    return mat


def _get_material_photo(db: Session, sr_id: int, mat_id: int, attachment_id: int) -> ServiceMaterialAttachment:
    """A material photo scoped to its material AND its (live) SR, so a photo
    can't be reached through someone else's sr_id."""
    attachment = db.query(ServiceMaterialAttachment).join(
        ServiceMaterial, ServiceMaterial.id == ServiceMaterialAttachment.service_material_id
    ).filter(
        ServiceMaterialAttachment.id == attachment_id,
        ServiceMaterial.id == mat_id,
        ServiceMaterial.service_request_id == sr_id,
        ServiceMaterial.is_deleted == False,  # noqa: E712
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Photo not found on this material — it may have been deleted. Refresh the page.")
    return attachment


@router.get("", response_model=list[ServiceRequestResponse])
async def list_service_requests(
    search: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    service_type: str | None = None,
    project_id: int | None = None,
    sla: str | None = Query(None, description="breached | at_risk | met"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "service_requests")),
):
    query = db.query(ServiceRequest).options(
        selectinload(ServiceRequest.attachments), selectinload(ServiceRequest.materials)
    ).filter(ServiceRequest.is_deleted == False)  # noqa: E712
    query = apply_scope(query, _user, ServiceRequest)

    if search:
        like = f"%{search}%"
        query = query.outerjoin(Project, ServiceRequest.project_id == Project.id).filter(
            ServiceRequest.request_number.ilike(like)
            | ServiceRequest.issue_title.ilike(like)
            | ServiceRequest.issue_description.ilike(like)
            | ServiceRequest.issue_category.ilike(like)
            | Project.serial_number.ilike(like)
            | Project.client_name.ilike(like)
        )
    if status:
        query = query.filter(ServiceRequest.status == status)
    if priority:
        query = query.filter(ServiceRequest.priority == priority)
    if service_type:
        query = query.filter(ServiceRequest.service_type == service_type)
    if project_id:
        query = query.filter(ServiceRequest.project_id == project_id)
    if sla:
        from app.modules.erp.sla import sla_filter
        query = sla_filter(query, ServiceRequest, sla)

    return sr_sensitive.srs_out(_user, query.order_by(ServiceRequest.created_at.desc()).offset(skip).limit(limit).all())


@router.post("", response_model=ServiceRequestResponse, status_code=201)
async def create_service_request(
    request: Request,
    background_tasks: BackgroundTasks,
    data: ServiceRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "sr_create"):
        raise HTTPException(status_code=403, detail="You need the 'Create service requests' ERP permission to raise an SR. Ask an admin to grant it in Users & Roles.")
    project = db.query(Project).filter(Project.id == data.project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="The selected machine was not found — it may have been deleted or moved to the Recycle Bin. Pick another machine or restore it first.")
    if (project.approval_status or "approved") != "approved":
        why = (f" It was rejected: {project.approval_remarks}. Correct the machine and save it to send it back for approval."
               if project.approval_status == "rejected" else
               " Its approvers (Organization › Approval Workflows › New machine) approve it on the machine's page.")
        raise HTTPException(status_code=409, detail=f"Machine {project.serial_number} is not approved yet, so service requests "
                                                    f"can't be raised on it.{why}")

    sr_number = _generate_sr_number(db)
    values = data.model_dump()
    chargeable, chargeable_reason = values.pop("is_chargeable", None), values.pop("chargeable_reason", None)
    _apply_engineer(db, user, values)  # active + permitted engineer; name comes from the user record
    sr = ServiceRequest(
        request_number=sr_number,
        created_by_id=user.id,
        opened_at=datetime.now(timezone.utc),
        **values,
    )
    # Warranty check (SAP CS): cover on the reported date decides the default
    # chargeability; a different choice needs a reason.
    override_note = sr_warranty.apply_warranty_check(db, sr, project, chargeable=chargeable, reason=chargeable_reason)
    db.add(sr)
    db.flush()
    # SLA clock from the covering contract's hours, else the priority's coded profile.
    from app.modules.erp import sla as sr_sla
    sr_sla.apply_profile(sr)
    # An SR raised already Assigned / In Progress counts as responded to now.
    sr_sla.on_status_change(sr, "open", sr.status)

    _write_audit(db, sr.id, "created", user, request, summary=f"Service request {sr.request_number} created by {user.name or user.email}. "
                 f"Machine {sr_warranty.WARRANTY_LABELS.get(sr.warranty_status, sr.warranty_status).lower()}; "
                 f"{'chargeable' if sr.is_chargeable else 'free of charge'}.")
    if override_note:
        _write_audit(db, sr.id, "chargeability_overridden", user, request, field_name="Chargeable", summary=override_note)
    reached = role_event(
        db, background_tasks, "sr_raised", title=f"New service request {sr.request_number}",
        message=f"{user.name or user.email} raised {sr.request_number} on machine {project.serial_number}"
                + (f" ({project.client_company})" if project.client_company else "")
                + f": {sr.issue_title}. Priority {(sr.priority or 'standard').title()}"
                + (f", assigned to {sr.assigned_to_name}." if sr.assigned_to_name else " — not assigned yet."),
        entity_type="service_request", entity_id=sr.id, actor=user, record=sr, details=_sr_details(sr, project, user),
    )
    broadcast_except(
        db, reached | {user.id},
        title="New Service Request Raised",
        message=f"Service request '{sr.request_number}' for issue '{sr.issue_title}' was created by {user.name or user.email}.",
        notification_type="sr_created",
        entity_type="service_request",
        entity_id=sr.id,
    )
    _announce_assignment(db, background_tasks, sr, user)
    notify_user(
        db,
        user_id=user.id,
        title="Service Request Created",
        message=f"Your service request '{sr.request_number}' for issue '{sr.issue_title}' has been raised.",
        notification_type="sr_created",
        entity_type="service_request",
        entity_id=sr.id,
    )
    fire_event(db, background_tasks, "sr_create", "New Service Request Raised",
               f"Service request '{sr.request_number}' ({sr.issue_title}) on machine '{project.serial_number}' was raised by {user.name or user.email}.",
               "service_request", sr.id, user, _sr_details(sr, project, user))
    db.commit()
    db.refresh(sr)

    background_tasks.add_task(_run_sr_emails_background, sr.id, "created", user.id, user.name)
    return sr_sensitive.sr_out(user, sr)


@router.get("/recycle-bin")
async def list_deleted_service_requests(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "recycle_bin")),
):
    RECYCLE_DAYS = 10
    srs = apply_scope(db.query(ServiceRequest).filter(ServiceRequest.is_deleted == True), _user, ServiceRequest).all()  # noqa: E712
    now = datetime.now(timezone.utc)
    items = []
    for sr in srs:
        deleted_at = sr.deleted_at
        if deleted_at and deleted_at.tzinfo is None:
            deleted_at = deleted_at.replace(tzinfo=timezone.utc)
        expires_at = (deleted_at + timedelta(days=RECYCLE_DAYS)) if deleted_at else None
        days_remaining = max(0, (expires_at - now).days) if expires_at else RECYCLE_DAYS
        items.append({
            "id": sr.id,
            "request_number": sr.request_number,
            "project_id": sr.project_id,
            "status": sr.status,
            "issue_description": sr.issue_description,
            "deleted_at": deleted_at.isoformat() if deleted_at else None,
            "days_remaining": days_remaining,
            "created_by_id": sr.created_by_id,
        })
    return items


@router.get("/pr-form-meta")
async def get_pr_form_meta(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "purchase_requisition", "view")),
):
    """Dropdown options for the New-PR-style form on the Materials tab —
    same lists as /p2p/requests/meta, served here because service users
    usually don't hold the p2p app."""
    from app.modules.store.routes.uoms import uom_options
    return {
        "categories": [{"code": k, "label": v} for k, v in P2P_CATEGORIES.items()],
        "requirement_types": list(P2P_REQUIREMENT_TYPES),
        "uoms": uom_options(db),
    }


@router.get("/warranty-check")
async def warranty_check(
    project_id: int,
    service_type: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "service_requests")),
):
    """What the SR form shows before saving: the machine's cover today and
    whether a job of this service type is chargeable by default."""
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="Machine not found — it may have been deleted. Pick another machine.")
    ensure_in_scope(db, _user, project)
    status = sr_warranty.warranty_status_on(db, project, date.today())
    start, end = sr_warranty.warranty_window(db, project)
    return {
        "warranty_status": status, "label": sr_warranty.WARRANTY_LABELS[status],
        "warranty_start": start, "warranty_end": end,
        "extended_warranty_end": project.extended_warranty_end if project.extended_warranty else None,
        "amc_end_date": project.amc_end_date,
        "default_chargeable": sr_warranty.default_chargeable(service_type, status),
        "customer_id": project.customer_id, "customer_name": project.customer_name,
    }


@router.get("/{sr_id}", response_model=ServiceRequestResponse)
async def get_service_request(
    sr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "service_requests")),
):
    sr = db.query(ServiceRequest).options(
        selectinload(ServiceRequest.attachments), selectinload(ServiceRequest.materials)
    ).filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False).first()  # noqa: E712
    if not sr:
        raise HTTPException(status_code=404, detail=_SR_NOT_FOUND)
    ensure_in_scope(db, _user, sr)
    if sr.ar_transaction_id:
        # Mirror the Finance invoice's number / collection state.
        sr_billing.sync_invoice(db, sr)
        db.commit()
        db.refresh(sr)
    return sr_sensitive.sr_out(_user, sr)


@router.patch("/{sr_id}", response_model=ServiceRequestResponse)
async def update_service_request(
    sr_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    data: ServiceRequestUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, user=user)
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) can edit this service request.")
    _ensure_unlocked(sr)

    changes = data.model_dump(exclude_unset=True)
    old_engineer = sr.assigned_service_person_id
    if "assigned_service_person_id" in changes and (changes["assigned_service_person_id"] or None) == old_engineer:
        changes.pop("assigned_service_person_id")  # unchanged — no re-check, no noise
        changes.pop("assigned_to_name", None)
    else:
        _apply_engineer(db, user, changes)
    # The form sends "" for an untouched text box; treat that as "no change from nothing"
    # so edits don't write "— → ''" audit lines.
    for k in list(changes):
        if changes[k] == "" and not getattr(sr, k, None) and k != "status_reason":
            changes.pop(k)
    # Charges need the sensitive switch; RCA text needs the Diagnostics & RCA › Edit feature.
    sr_sensitive.ensure_may_change(user, changes, sr, ("service_cost", "transport_cost", "accommodation_cost", "miscellaneous_cost"))
    if any(k in changes and (changes[k] or None) != (getattr(sr, k) or None) for k in ("root_cause", "resolution_description", "preventive_actions")):
        ensure_feature_action(user, "erp", "service_requests", "rca", "edit")
    status_reason = (changes.pop("status_reason", None) or "").strip()
    charge_keys = {"is_chargeable", "chargeable_reason"} & changes.keys()
    chargeable_in = changes.pop("is_chargeable", None)
    chargeable_reason_in = changes.pop("chargeable_reason", None)
    type_changed = "service_type" in changes and changes["service_type"] != sr.service_type
    # Invoice no. / payment status mirror the Finance (AR) invoice — they are
    # not typed here any more (unchanged values from the form are fine).
    typed_billing = [label for f, label in (("invoice_number", "Invoice no."), ("payment_status", "Payment status"))
                     if f in changes and str(changes[f] or "") != str(getattr(sr, f) or "")]
    if typed_billing:
        raise HTTPException(
            status_code=422,
            detail=f"{' and '.join(typed_billing)} can't be typed on the SR — they come from the Finance sales invoice. "
                   "Use 'Create invoice' in the Billing section; the number and payment state then follow the invoice.",
        )
    for f in ("invoice_number", "payment_status"):
        changes.pop(f, None)
    if (charge_keys or type_changed) and sr.ar_transaction_id:
        live = sr_billing.linked_invoice(db, sr)
        if live is not None and live.status in ("pending", "posted"):
            raise HTTPException(
                status_code=409,
                detail=f"{sr.request_number} is already invoiced ({live.invoice_number}), so its service type / chargeability "
                       "can't change. Ask Finance to cancel the draft (or raise a credit note on a posted invoice) first.",
            )
    old_status = (sr.status or "").lower()
    new_status = str(changes["status"]).lower() if changes.get("status") else old_status
    # Cancelling, and reopening a finished (closed / cancelled) SR, are
    # exception steps: they need a recorded reason, like SAP's status-change
    # reason on a notification.
    if new_status != old_status and (new_status == "cancelled" or old_status in ("closed", "cancelled")):
        if not status_reason:
            action = "cancel" if new_status == "cancelled" else "reopen"
            raise HTTPException(
                status_code=422,
                detail=f"Enter a reason to {action} {sr.request_number} — it is kept in the audit trail. "
                       "Use the status steps on the service request page, which ask for the reason.",
            )
    # A closed / cancelled SR is a finished document: its technical record
    # (issue, RCA, corrective action, dates, assignment) is frozen until it is
    # reopened with a reason. Billing (costs, tax, payment, invoice) stays
    # editable because invoicing normally happens after the job is closed.
    if old_status in ("closed", "cancelled") and new_status == old_status:
        frozen = [
            _TRACKED_FIELDS.get(f, f.replace("_", " ").title()) for f, v in changes.items()
            if f not in _SR_POST_CLOSE_EDITABLE and f != "status" and str(getattr(sr, f, None)) != str(v)
        ]
        if frozen:
            raise HTTPException(
                status_code=409,
                detail=f"{sr.request_number} is {old_status}, so {', '.join(frozen[:4])} can't be changed. "
                       "Reopen it first (set the status back to In Progress, with a reason), then edit — "
                       "only billing (costs, tax, payment status, invoice no.) can be changed on a closed SR.",
            )
    closing = changes.get("status") == "closed" and (sr.status or "").lower() != "closed"
    close_needs_approval = bool(get_erp_setting(db, "sr_close_approval_required"))
    # Closing goes through the approval workflow; only an admin may still
    # close directly (the admin stand-in of the approval engine).
    if closing and close_needs_approval and not is_admin_user(user):
        raise HTTPException(
            status_code=403,
            detail="Closing a service request needs approval. Set the status to 'Review' instead — the approvers in "
                   "Organization › Approval Workflows › Service request closure are asked to approve the closure.",
        )
    sent_for_review = (close_needs_approval and changes.get("status") == "review"
                       and (sr.status or "").lower() != "review")
    left_review = ((sr.status or "").lower() == "review" and "status" in changes
                   and str(changes["status"]).lower() != "review")
    if changes.get("status") == "closed" and (sr.status or "").lower() != "closed":
        resolution_after = changes["resolution_description"] if "resolution_description" in changes else sr.resolution_description
        if not (resolution_after or "").strip():
            raise HTTPException(
                status_code=400,
                detail="Fill Corrective Action on the Diagnostics & RCA tab before closing this service request.",
            )
    from app.modules.erp import sla as sr_sla, visits as sr_visits
    if sr_visits.visits_for(db, sr.id):
        rolled = dict(sr_visits.ROLLED_UP_FIELDS)
        if sr_visits.labour_from_visits(db):
            rolled["service_cost"] = "Service / labour cost"
        typed = [label for f, label in rolled.items()
                 if f in changes and abs(float(changes[f] or 0) - float(getattr(sr, f) or 0)) > 0.005]
        if typed:
            raise HTTPException(
                status_code=409,
                detail=f"{', '.join(typed)} come from the visit log once an SR has visits, so they can't be typed. "
                       "Edit the visit (Visits tab) — its travel, stay and other costs and hours roll up into the bill.",
            )
        for f in rolled:
            changes.pop(f, None)
    sla_old_status, sla_old_priority = (sr.status or "").lower(), sr.priority
    status_changed_to_closed = False
    changed_labels: list[str] = []
    for field, new_val in changes.items():
        old_val = getattr(sr, field, None)
        if str(old_val) != str(new_val):
            label = _TRACKED_FIELDS.get(field, field)
            _write_audit(
                db, sr.id, "field_updated", user, request,
                field_name=label,
                old_value=str(old_val) if old_val is not None else "—",
                new_value=str(new_val) if new_val is not None else "—",
                summary=f"{user.name or user.email} changed {label} from '{old_val}' to '{new_val}'."
                        + (f" Reason: {status_reason}" if field == "status" and status_reason else ""),
            )
            if field == "status" and str(new_val).lower() == "closed":
                status_changed_to_closed = True
                sr.closed_at = datetime.now(timezone.utc)
            elif field == "status" and str(old_val).lower() == "closed" and str(new_val).lower() != "closed":
                # Reopening a previously-closed SR — the old Closed Date is no longer valid.
                sr.closed_at = None
            changed_labels.append(label)
        setattr(sr, field, new_val)

    if charge_keys or type_changed:
        project_for_check = db.query(Project).filter(Project.id == sr.project_id).first()
        if chargeable_in is None and "is_chargeable" not in charge_keys and charge_keys:
            chargeable_in = sr.is_chargeable  # only the reason was edited
        before = sr.is_chargeable
        override_note = sr_warranty.apply_warranty_check(
            db, sr, project_for_check, chargeable=chargeable_in, reason=chargeable_reason_in, keep_override=not type_changed)
        if override_note or before != sr.is_chargeable:
            _write_audit(db, sr.id, "chargeability_changed", user, request, field_name="Chargeable",
                         old_value=str(before), new_value=str(sr.is_chargeable),
                         summary=override_note or f"{user.name or user.email} set the job "
                                                  f"{'chargeable' if sr.is_chargeable else 'free of charge'} (default for the machine's cover).")
        changed_labels.append("Chargeable")
        # Spares follow the job (free job → covered, chargeable → billed),
        # except lines whose cover was set by hand against the old default.
        if before != sr.is_chargeable:
            for m in db.query(ServiceMaterial).filter(ServiceMaterial.service_request_id == sr.id,
                                                      ServiceMaterial.is_deleted == False).all():  # noqa: E712
                if bool(m.is_warranty_covered) == (not before):
                    m.is_warranty_covered = not sr.is_chargeable
            _recompute_billing(db, sr)

    if "priority" in changes and changes["priority"] != sla_old_priority:
        sr_sla.apply_profile(sr, force=True)
    if (sr.status or "").lower() != sla_old_status:
        sr_sla.on_status_change(sr, sla_old_status, sr.status)
    _BILLING_FIELDS = {"service_cost", "transport_cost", "accommodation_cost", "miscellaneous_cost", "tax_percentage"}
    if _BILLING_FIELDS & changes.keys():
        _recompute_billing(db, sr)
    if status_changed_to_closed:
        commissioning_note = sr_warranty.on_sr_closed(db, sr, user.id)
        if commissioning_note:
            _write_audit(db, sr.id, "machine_commissioned", user, request, summary=commissioning_note)

    if left_review:
        # The engineer took it back out of Review (or an admin closed it) —
        # withdraw the open closure approval.
        erp_access.cancel_live(db, erp_access.SR_ENTITY, sr.id, user, f"status changed to {changes['status']}")
    if sent_for_review:
        closure_req = erp_access.submit_sr_closure(db, sr, user)
        role_event(db, background_tasks, "sr_closure_pending", title=f"{sr.request_number} waiting for closure approval",
                   message=f"{user.name or user.email} finished {sr.request_number} ({sr.issue_title}) and sent it for closure — "
                           "review the corrective action and approve or send it back.",
                   entity_type="service_request", entity_id=sr.id, actor=user, record=sr,
                   skip_user_ids=approver_ids(closure_req))
    if sr.assigned_service_person_id and sr.assigned_service_person_id != old_engineer:
        _announce_assignment(db, background_tasks, sr, user)
    if status_changed_to_closed:
        project = db.query(Project).filter(Project.id == sr.project_id).first()
        fire_event(db, background_tasks, "sr_close", "Service Request Closed",
                   f"Service request '{sr.request_number}' ({sr.issue_title}) was closed by {user.name or user.email}.",
                   "service_request", sr.id, user, _sr_details(sr, project, user))
        reached = _announce_closed(db, background_tasks, sr, user, f"by {user.name or user.email}")
        broadcast_except(
            db, reached | {user.id},
            title="Service Request Closed",
            message=f"Service request '{sr.request_number}' has been closed by {user.name or user.email}.",
            notification_type="sr_closed",
            entity_type="service_request",
            entity_id=sr.id,
        )
        notify_user(
            db,
            user_id=user.id,
            title="Service Request Closed",
            message=f"You closed service request '{sr.request_number}'.",
            notification_type="sr_closed",
            entity_type="service_request",
            entity_id=sr.id,
        )
    elif changed_labels:
        changed_summary = ", ".join(changed_labels[:3])
        if len(changed_labels) > 3:
            changed_summary += f" (+{len(changed_labels) - 3} more)"
        broadcast_notification(
            db,
            title="Service Request Updated",
            message=f"SR '{sr.request_number}' updated by {user.name or user.email}: {changed_summary}.",
            notification_type="sr_updated",
            entity_type="service_request",
            entity_id=sr.id,
            exclude_user_id=user.id,
        )
        if sr.created_by_id and sr.created_by_id != user.id:
            notify_user(
                db,
                user_id=sr.created_by_id,
                title="Your Service Request Was Updated",
                message=f"SR '{sr.request_number}' was updated by {user.name or user.email}: {changed_summary}.",
                notification_type="sr_updated",
                entity_type="service_request",
                entity_id=sr.id,
            )

    db.commit()
    db.refresh(sr)

    if status_changed_to_closed:
        background_tasks.add_task(_run_sr_emails_background, sr.id, "closed", user.id, user.name)

    return sr_sensitive.sr_out(user, sr)


def _closure_target(db: Session, sr_id: int, user: User) -> ServiceRequest:
    sr = _get_live_sr(db, sr_id, user=user)
    _ensure_unlocked(sr)
    if (sr.status or "").lower() != "review":
        raise HTTPException(status_code=409, detail=f"{sr.request_number} is not waiting for closure review (status: {sr.status}) — refresh the page.")
    return sr


def _decide_closure(db: Session, sr: ServiceRequest, user: User, decision: str, remarks: str | None) -> bool:
    """Route the decision to the central engine. False = in-flight legacy item
    (sent to Review before the cut-over) — the caller runs the old path."""
    req = engine.latest_request(db, erp_access.SR_ENTITY, sr.id)
    if req is None or req.workflow_key != erp_access.SR_CLOSE_KEY:
        return False
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"The closure approval of {sr.request_number} is already {req.status} — refresh the page.")
    engine.decide(db, req.id, user, decision, remarks)
    return True


def _legacy_closure_check(db: Session, sr: ServiceRequest, user: User) -> None:
    if not erp_access.legacy_is_approver(db, user, erp_access.SR_CLOSE_KEY):
        raise HTTPException(
            status_code=403,
            detail=f"{sr.request_number} was sent for closure review before approvals moved to Organization › Approval "
                   f"Workflows, so its original approvers decide it: {erp_access.legacy_approver_names(db, erp_access.SR_CLOSE_KEY)}.",
        )


@router.post("/{sr_id}/approve-close", response_model=ServiceRequestResponse)
async def approve_sr_close(
    sr_id: int,
    payload: SRCloseDecisionPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    # Compatibility route: the decision goes through the central approval
    # engine (Organization › Approval Workflows › Service request closure).
    _tab: User = Depends(require_tab_access("erp", "service_requests")),
):
    sr = _closure_target(db, sr_id, user)
    if not (sr.resolution_description or "").strip():
        raise HTTPException(status_code=400, detail="Corrective Action on the Diagnostics & RCA tab is empty — send the SR back "
                                                    "so the engineer fills it, then approve the closure.")
    remarks = (payload.remarks or "").strip()
    if _decide_closure(db, sr, user, "approve", remarks or None):
        db.commit()
        db.refresh(sr)
        return sr_sensitive.sr_out(user, sr)
    _legacy_closure_check(db, sr, user)
    sr.status = "closed"
    sr.closed_at = datetime.now(timezone.utc)
    if (note := sr_warranty.on_sr_closed(db, sr, user.id)):
        _write_audit(db, sr.id, "machine_commissioned", user, summary=note)
    _write_audit(db, sr.id, "field_updated", user, field_name="Status", old_value="review", new_value="closed",
                 summary=f"Closure approved by {user.name or user.email}." + (f" Remarks: {remarks}" if remarks else ""))
    project = db.query(Project).filter(Project.id == sr.project_id).first()
    fire_event(db, background_tasks, "sr_close", "Service Request Closed",
               f"Service request '{sr.request_number}' ({sr.issue_title}) was closed — closure approved by {user.name or user.email}.",
               "service_request", sr.id, user, _sr_details(sr, project, user))
    _announce_closed(db, background_tasks, sr, user, f"— closure approved by {user.name or user.email}")
    if sr.created_by_id and sr.created_by_id != user.id:
        notify_user(db, sr.created_by_id, "SR Closure Approved",
                    f"{user.name or user.email} approved closing '{sr.request_number}'." + (f" Remarks: {remarks}" if remarks else ""),
                    notification_type="sr_close_approved", entity_type="service_request", entity_id=sr.id)
    db.commit()
    db.refresh(sr)
    background_tasks.add_task(_run_sr_emails_background, sr.id, "closed", user.id, user.name)
    return sr_sensitive.sr_out(user, sr)


@router.post("/{sr_id}/reject-close", response_model=ServiceRequestResponse)
async def reject_sr_close(
    sr_id: int,
    payload: SRCloseDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "service_requests")),
):
    remarks = (payload.remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=422, detail="Enter what still needs to be done, so the engineer knows why the SR was sent back.")
    sr = _closure_target(db, sr_id, user)
    if _decide_closure(db, sr, user, "reject", remarks):
        db.commit()
        db.refresh(sr)
        return sr_sensitive.sr_out(user, sr)
    _legacy_closure_check(db, sr, user)
    sr.status = "in_progress"
    from app.modules.erp.sla import on_status_change as _sla_status
    _sla_status(sr, "review", "in_progress")  # back to work — the resolution clock runs again
    _write_audit(db, sr.id, "field_updated", user, field_name="Status", old_value="review", new_value="in_progress",
                 summary=f"Closure sent back by {user.name or user.email}: {remarks}")
    if sr.created_by_id and sr.created_by_id != user.id:
        notify_user(db, sr.created_by_id, "SR Closure Sent Back",
                    f"{user.name or user.email} sent '{sr.request_number}' back to In Progress: {remarks}",
                    notification_type="sr_close_rejected", entity_type="service_request", entity_id=sr.id)
    db.commit()
    db.refresh(sr)
    return sr_sensitive.sr_out(user, sr)


@router.delete("/{sr_id}", status_code=200)
async def delete_service_request(
    sr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, user=user)
    ensure_can_delete(user, sr, "erp", "service_requests", what="service request")
    _ensure_unlocked(sr)
    # A material already on a live purchase requisition is a follow-on
    # document: deleting the SR would leave that PR pointing at a job in the
    # Recycle Bin. Purchase must reject/cancel the PR first.
    for mat in db.query(ServiceMaterial).filter(
        ServiceMaterial.service_request_id == sr.id, ServiceMaterial.is_deleted == False,  # noqa: E712
        ServiceMaterial.pr_id.isnot(None),
    ).all():
        live_pr = _live_pr_for_material(db, mat)
        if live_pr:
            raise HTTPException(
                status_code=409,
                detail=f"{sr.request_number} can't be deleted: '{mat.material_name}' is on purchase requisition "
                       f"{live_pr.p2p_number} ({live_pr.status.replace('_', ' ')}). Ask Purchase to reject or cancel "
                       "that PR first — or cancel the SR (with a reason) instead of deleting it.",
            )

    erp_access.cancel_live(db, erp_access.SR_ENTITY, sr.id, user, "service request deleted")
    sr.is_deleted = True
    sr.deleted_at = datetime.now(timezone.utc)
    _write_audit(db, sr.id, "deleted", user, summary=f"Service request {sr.request_number} moved to recycle bin.")
    broadcast_notification(
        db,
        title="Service Request Deleted",
        message=f"Service request '{sr.request_number}' was deleted by {user.name or user.email}.",
        notification_type="sr_deleted",
        entity_type="service_request",
        entity_id=sr.id,
        exclude_user_id=user.id,
    )
    notify_user(
        db,
        user_id=user.id,
        title="Service Request Deleted",
        message=f"You deleted service request '{sr.request_number}'. It can be restored from the recycle bin for 10 days.",
        notification_type="sr_deleted",
        entity_type="service_request",
        entity_id=sr.id,
    )
    db.commit()
    return {"message": "Service request deleted"}


@router.post("/{sr_id}/restore")
async def restore_service_request(
    sr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == True).first()  # noqa: E712
    if not sr:
        raise HTTPException(status_code=404, detail="That service request is not in the Recycle Bin — it may already be restored or permanently removed. Refresh the Recycle Bin.")
    ensure_tab_action(user, "erp", "recycle_bin", "edit")  # restoring = Recycle Bin › Edit
    ensure_in_scope(db, user, sr)
    if not is_admin_user(user) and sr.created_by_id != user.id:
        raise HTTPException(
            status_code=403,
            detail=f"You can only restore a service request you created yourself — {sr.request_number} was created by someone else. "
                   "Ask its creator or an admin to restore it.",
        )
    machine = db.query(Project).filter(Project.id == sr.project_id).first()
    if machine and machine.is_deleted:
        raise HTTPException(
            status_code=409,
            detail=f"Machine {machine.serial_number} is in the Recycle Bin — restore the machine first (that also restores its SRs).",
        )
    sr.is_deleted = False
    sr.deleted_at = None
    _write_audit(db, sr.id, "restored", user, summary=f"Service request {sr.request_number} restored from recycle bin.")
    db.commit()
    return {"message": "Service request restored"}


@router.get("/{sr_id}/audit")
async def get_service_request_audit(
    sr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "audit_trail", "view")),
):
    if not db.query(ServiceRequest.id).filter(ServiceRequest.id == sr_id).first():
        raise HTTPException(status_code=404, detail=f"No service request with id {sr_id} — check the link or open it from the Service Requests list.")
    ensure_in_scope(db, _user, db.get(ServiceRequest, sr_id))
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "service_request", AuditLog.entity_id == sr_id
    ).order_by(AuditLog.performed_at.asc()).all()

    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"

    return [
        {
            "id": log.id,
            "action": log.action,
            "field_name": log.field_name,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]


# ── Attachments (SharePoint) ────────────────────────────────────────────────

@router.post("/{sr_id}/attachments")
async def upload_service_request_attachments(
    sr_id: int,
    request: Request,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, with_project=True, user=user)
    ensure_feature_action(user, "erp", "service_requests", "attachments", "create")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) can add attachments to this service request.")
    _ensure_unlocked(sr)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    project = sr.project
    project_name = (project.serial_number or project.model_name or str(sr.project_id)) if project else str(sr.project_id)
    folder_path = build_sharepoint_folder_path(user.name or user.email or "", project_name, sr.request_number)

    uploaded, failed = [], []
    for f in files:
        try:
            result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
            attachment = ServiceRequestAttachment(
                service_request_id=sr.id,
                filename=result["name"],
                content_type=f.content_type,
                size=result["size"],
                sharepoint_path=result["path"],
                sharepoint_url=result.get("webUrl"),
                created_by_id=user.id,
            )
            db.add(attachment)
            uploaded.append(attachment)
        except HTTPException as exc:
            failed.append({"filename": f.filename or "attachment", "error": exc.detail})

    if not uploaded and failed:
        raise HTTPException(status_code=502, detail=failed[0]["error"])

    if uploaded:
        db.flush()
        for a in uploaded:
            db.refresh(a)
        filenames = ", ".join(a.filename for a in uploaded)
        _write_audit(db, sr.id, "attachment_uploaded", user, request, summary=f"{user.name or user.email} uploaded {len(uploaded)} file(s): {filenames}")

    db.commit()
    return {
        "uploaded": [ServiceRequestAttachmentResponse.model_validate(a).model_dump() for a in uploaded],
        "failed": failed,
    }


@router.get("/{sr_id}/attachments/{attachment_id}/content")
async def get_service_request_attachment_content(
    sr_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "attachments", "view")),
):
    """Raw bytes for in-app preview (img/pdf/video tags on our own origin),
    fetched via the app-only Graph token — never the raw SharePoint webUrl."""
    ensure_in_scope(db, _user, db.get(ServiceRequest, sr_id))
    attachment = db.query(ServiceRequestAttachment).join(
        ServiceRequest, ServiceRequest.id == ServiceRequestAttachment.service_request_id
    ).filter(
        ServiceRequestAttachment.id == attachment_id, ServiceRequestAttachment.service_request_id == sr_id,
        ServiceRequest.is_deleted == False,  # noqa: E712
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail=_SR_ATTACHMENT_NOT_FOUND)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return Response(
        content=content,
        media_type=attachment.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.filename}"'},
    )


@router.get("/{sr_id}/attachments/{attachment_id}/preview")
async def preview_service_request_attachment(
    sr_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "attachments", "view")),
):
    """Fallback for formats the browser can't render natively (Office docs) —
    a short-lived Microsoft-viewer link, minted via the app-only token."""
    ensure_in_scope(db, _user, db.get(ServiceRequest, sr_id))
    attachment = db.query(ServiceRequestAttachment).join(
        ServiceRequest, ServiceRequest.id == ServiceRequestAttachment.service_request_id
    ).filter(
        ServiceRequestAttachment.id == attachment_id, ServiceRequestAttachment.service_request_id == sr_id,
        ServiceRequest.is_deleted == False,  # noqa: E712
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail=_SR_ATTACHMENT_NOT_FOUND)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    get_url = await get_preview_url(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return {"getUrl": get_url}


@router.delete("/{sr_id}/attachments/{attachment_id}")
async def delete_service_request_attachment(
    sr_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "attachments", "delete")
    if not _can_edit(sr, user):  # removing an attachment = editing the SR
        raise HTTPException(status_code=403, detail="Only the SR's creator (with Service Requests › Edit) or an admin can remove attachments from this service request.")
    _ensure_unlocked(sr)

    attachment = db.query(ServiceRequestAttachment).filter(
        ServiceRequestAttachment.id == attachment_id, ServiceRequestAttachment.service_request_id == sr_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found on this service request — it may have been deleted already. Refresh the page.")

    if settings.SHAREPOINT_SITE_ID and attachment.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    filename = attachment.filename
    db.delete(attachment)
    _write_audit(
        db, sr.id, "attachment_deleted", user,
        summary=f"{user.name or user.email} deleted attachment '{filename}'.",
    )
    db.commit()
    return {"message": "Attachment deleted"}


# ── Materials / spare parts ─────────────────────────────────────────────────

@router.get("/{sr_id}/materials", response_model=list[ServiceMaterialResponse])
async def list_materials(
    sr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "materials", "view")),
):
    _get_live_sr(db, sr_id, user=_user)
    return sr_sensitive.materials_out(_user, db.query(ServiceMaterial).filter(
        ServiceMaterial.service_request_id == sr_id, ServiceMaterial.is_deleted == False  # noqa: E712
    ).order_by(ServiceMaterial.id).all())


_DEAD_PR_STATUSES = ("rejected", "cancelled")


def _live_pr_for_material(db: Session, mat: ServiceMaterial) -> P2PRequest | None:
    """The P2P request this material line is on, if it is still live. A PR
    that Purchase rejected/cancelled (or that no longer exists) no longer
    holds the line, so it can be removed or re-quantified here. Refreshes the
    read-only `pr_status` mirror either way."""
    if not mat.pr_id:
        return None
    pr = db.query(P2PRequest).filter(P2PRequest.id == mat.pr_id).first()
    if not pr:
        mat.pr_status = None
        return None
    mat.pr_status = pr.status
    return None if pr.status in _DEAD_PR_STATUSES else pr


def _pr_hold_detail(mat: ServiceMaterial, pr: P2PRequest, action: str) -> str:
    return (
        f"'{mat.material_name}' is on purchase requisition {pr.p2p_number}, which is {pr.status.replace('_', ' ')} — "
        f"ask Purchase to reject or cancel that PR; once it is rejected or cancelled you can {action} here."
    )


@router.post("/{sr_id}/materials", response_model=ServiceMaterialResponse, status_code=201)
async def add_material(
    sr_id: int,
    payload: ServiceMaterialCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "materials", "create")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can add materials to this service request.")
    _ensure_unlocked(sr)
    _ensure_open_for_materials(sr)
    sr_sensitive.ensure_may_change(user, payload.model_dump(), None, sr_sensitive.MATERIAL_MONEY, "spare price / budget")

    if payload.unit_price is not None and payload.unit_price < 0:
        raise HTTPException(status_code=422, detail=f"Unit price can't be negative (got {payload.unit_price:g}) — enter 0 or more.")
    name, part, unit = payload.material_name, payload.part_number, payload.unit
    if payload.store_item_id is not None:
        item = db.query(StoreItem).filter(StoreItem.id == payload.store_item_id).first()
        if item is None:
            raise HTTPException(status_code=422, detail=f"Item Master item #{payload.store_item_id} wasn't found — pick the spare again from the list.")
        # Item Master lines by id: name / part code / unit come from the master.
        name, part, unit = item.item_name, item.item_code, item.uom or payload.unit
    elif not name:
        raise HTTPException(status_code=422, detail="Pick the spare from the Item Master (or enter a material name for a non-stock line).")
    covered = payload.is_warranty_covered if payload.is_warranty_covered is not None else (sr.is_chargeable is False)
    mat = ServiceMaterial(
        service_request_id=sr_id,
        store_item_id=payload.store_item_id,
        material_name=name,
        part_number=part,
        model_number=payload.model_number,
        description=payload.description,
        estimated_budget=payload.estimated_budget,
        reason=payload.reason,
        quantity=payload.quantity,
        unit=unit,
        status=payload.status or "pending",
        unit_price=payload.unit_price,
        is_warranty_covered=covered,
        qty_issued=0, qty_returned=0,
    )
    db.add(mat)
    db.flush()
    _recompute_billing(db, sr)
    _write_audit(db, sr_id, "material_added", user, summary=f"Material added: {mat.material_name} (qty: {mat.quantity} {mat.unit}).")
    db.commit()
    db.refresh(mat)
    return sr_sensitive.material_out(user, mat)


@router.patch("/{sr_id}/materials/{mat_id}", response_model=ServiceMaterialResponse)
async def update_material(
    sr_id: int,
    mat_id: int,
    payload: ServiceMaterialUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "materials", "edit")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can update materials on this service request.")
    _ensure_unlocked(sr)
    _ensure_open_for_materials(sr)
    mat = _get_live_material(db, sr_id, mat_id)

    changed_fields = payload.model_dump(exclude_unset=True)
    sr_sensitive.ensure_may_change(user, changed_fields, mat, sr_sensitive.MATERIAL_MONEY, "spare price / budget")
    # Required columns: leaving a field out keeps it, but null can't blank it.
    for field, label in (("material_name", "Material name"), ("quantity", "Quantity"), ("unit", "Unit")):
        if field in changed_fields and changed_fields[field] is None:
            raise HTTPException(status_code=400, detail=f"{label} can't be blank — enter a value or leave the field out to keep '{getattr(mat, field)}'.")
    if changed_fields.get("unit_price") is not None and changed_fields["unit_price"] < 0:
        raise HTTPException(status_code=422, detail=f"Unit price can't be negative (got {changed_fields['unit_price']:g}) — enter 0 or more.")
    if "is_warranty_covered" in changed_fields and changed_fields["is_warranty_covered"] is None:
        changed_fields.pop("is_warranty_covered")
    if mat.store_item_id:
        # Item Master line: identity comes from the master, quantities from Store.
        for f in ("material_name", "part_number", "unit"):
            if f in changed_fields and str(changed_fields[f] or "") != str(getattr(mat, f) or ""):
                raise HTTPException(status_code=422, detail=f"'{mat.material_name}' is an Item Master spare, so its name, part code and unit "
                                                            "come from the Item Master — remove the line and pick another item instead.")
            changed_fields.pop(f, None)
    new_qty = changed_fields.get("quantity")
    if new_qty is not None and new_qty < (mat.qty_issued or 0) - 1e-9:
        raise HTTPException(status_code=400, detail=f"Quantity can't be less than the {(mat.qty_issued or 0):g} {mat.unit} already issued from Store — "
                                                    "return the unused quantity instead.")
    received = mat.received_quantity or 0
    if new_qty is not None and new_qty < received:
        raise HTTPException(
            status_code=400,
            detail=f"Quantity can't be less than the {received:g} {mat.unit} already received — correct the received quantity first.",
        )
    if mat.pr_id and new_qty is not None and new_qty != mat.quantity:
        live_pr = _live_pr_for_material(db, mat)
        if live_pr:
            raise HTTPException(status_code=409, detail=_pr_hold_detail(mat, live_pr, "change its quantity"))
    for field, val in changed_fields.items():
        setattr(mat, field, val)
    if new_qty is not None:
        if received <= 0:
            mat.receiving_status = "pending"
        elif received < mat.quantity:
            mat.receiving_status = "partial"
        else:
            mat.receiving_status = "received"
    if {"estimated_budget", "unit_price", "is_warranty_covered"} & changed_fields.keys():
        db.flush()
        _recompute_billing(db, sr)
    _write_audit(db, sr_id, "material_updated", user, summary=f"Material updated: {mat.material_name}.")
    db.commit()
    db.refresh(mat)
    return sr_sensitive.material_out(user, mat)


@router.delete("/{sr_id}/materials/{mat_id}")
async def delete_material(
    sr_id: int,
    mat_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "materials", "delete")
    if not _can_edit(sr, user):  # removing a material line = editing the SR
        raise HTTPException(status_code=403, detail="Only the SR's creator (with Service Requests › Edit) or an admin can remove materials from this service request.")
    _ensure_unlocked(sr)
    _ensure_open_for_materials(sr)
    mat = _get_live_material(db, sr_id, mat_id)
    if (mat.qty_issued or 0) > 0:
        raise HTTPException(status_code=409, detail=f"'{mat.material_name}' was issued from Store on this SR, so the line is a stock record "
                                                    "and can't be removed. Return the unused quantity instead.")
    if mat.pr_id:
        live_pr = _live_pr_for_material(db, mat)
        if live_pr:
            raise HTTPException(status_code=409, detail=_pr_hold_detail(mat, live_pr, "remove this line"))

    mat_name = mat.material_name
    mat.is_deleted = True
    db.flush()
    _recompute_billing(db, sr)
    _write_audit(db, sr_id, "material_deleted", user, summary=f"Material deleted: {mat_name}.")
    db.commit()
    return {"message": "Material deleted"}


# ── Material photos (SharePoint) ────────────────────────────────────────────

@router.post("/{sr_id}/materials/{mat_id}/attachments")
async def upload_material_attachments(
    sr_id: int,
    mat_id: int,
    request: Request,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, with_project=True, user=user)
    ensure_feature_action(user, "erp", "service_requests", "materials", "create")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can add photos to this material.")
    _ensure_unlocked(sr)
    mat = _get_live_material(db, sr_id, mat_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is not an image — only photos can be attached to a material.")

    project = sr.project
    project_name = (project.serial_number or project.model_name or str(sr.project_id)) if project else str(sr.project_id)
    folder_path = build_sharepoint_folder_path(user.name or user.email or "", project_name, sr.request_number) + "/materials"

    uploaded, failed = [], []
    for f in files:
        try:
            result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
            attachment = ServiceMaterialAttachment(
                service_material_id=mat.id,
                filename=result["name"],
                content_type=f.content_type,
                size=result["size"],
                sharepoint_path=result["path"],
                sharepoint_url=result.get("webUrl"),
                created_by_id=user.id,
            )
            db.add(attachment)
            uploaded.append(attachment)
        except HTTPException as exc:
            failed.append({"filename": f.filename or "photo", "error": exc.detail})

    if not uploaded and failed:
        raise HTTPException(status_code=502, detail=failed[0]["error"])

    if uploaded:
        db.flush()
        for a in uploaded:
            db.refresh(a)
        _write_audit(
            db, sr_id, "material_photo_uploaded", user, request,
            summary=f"{user.name or user.email} added {len(uploaded)} photo(s) to material '{mat.material_name}'.",
        )

    db.commit()
    return {
        "uploaded": [ServiceMaterialAttachmentResponse.model_validate(a).model_dump() for a in uploaded],
        "failed": failed,
    }


@router.get("/{sr_id}/materials/{mat_id}/attachments/{attachment_id}/content")
async def get_material_attachment_content(
    sr_id: int,
    mat_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "materials", "view")),
):
    _get_live_sr(db, sr_id, user=_user)
    attachment = _get_material_photo(db, sr_id, mat_id, attachment_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return Response(
        content=content,
        media_type=attachment.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.filename}"'},
    )


@router.get("/{sr_id}/materials/{mat_id}/attachments/{attachment_id}/preview")
async def preview_material_attachment(
    sr_id: int,
    mat_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "materials", "view")),
):
    _get_live_sr(db, sr_id, user=_user)
    attachment = _get_material_photo(db, sr_id, mat_id, attachment_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    get_url = await get_preview_url(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return {"getUrl": get_url}


@router.delete("/{sr_id}/materials/{mat_id}/attachments/{attachment_id}")
async def delete_material_attachment(
    sr_id: int,
    mat_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "materials", "delete")
    if not _can_edit(sr, user):  # removing a photo = editing the SR
        raise HTTPException(status_code=403, detail="Only the SR's creator (with Service Requests › Edit) or an admin can remove photos from this material.")
    _ensure_unlocked(sr)
    attachment = _get_material_photo(db, sr_id, mat_id, attachment_id)
    mat_name = db.query(ServiceMaterial.material_name).filter(ServiceMaterial.id == mat_id).scalar() or f"#{mat_id}"

    if settings.SHAREPOINT_SITE_ID and attachment.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    filename = attachment.filename
    db.delete(attachment)
    _write_audit(
        db, sr.id, "material_photo_deleted", user,
        summary=f"{user.name or user.email} deleted photo '{filename}' from material '{mat_name}'.",
    )
    db.commit()
    return {"message": "Photo deleted"}


def _create_p2p_request_for_sr(
    db: Session,
    sr: "ServiceRequest",
    materials: list[ServiceMaterial],
    project_label: str,
    user: User,
    payload: "RaisePurchaseRequestPayload",
    line_extras: list[tuple["RaisePurchaseRequestItem", StoreItem]],
) -> P2PRequest:
    """Create a standalone P2PRequest directly from this ERP-raised SR's
    unlinked materials, so Purchase's P2P team sees it in their own queue.
    This is now the sole creation path for a PR raised out of an SR's
    Materials tab — there is no separate `purchase_requisitions` row."""
    category_code = payload.category_code or "OTH"
    auto_buyer_id = resolve_auto_buyer_id(db, category_code)
    # Service PRs skip the PR approval stage entirely (2026-10-01): the
    # requisition is created already 'approved' and goes straight to Purchase.

    request = P2PRequest(
        p2p_number=generate_p2p_number(db, category_code),
        category_code=category_code,
        project_label=project_label,
        required_date=payload.required_by_date,
        requirement_type=payload.requirement_type,
        request_date=date.today(),
        department=user.department,
        requested_by_id=user.id,
        priority=payload.priority,
        project_type="existing",
        assigned_buyer_id=auto_buyer_id,
        assignment_date=date.today() if auto_buyer_id else None,
        remarks=f"Raised from ERP Service Request {sr.request_number}."
        + (f" Reason: {payload.reason}" if payload.reason else ""),
        status="approved",
        approved_by_id=user.id,
        approved_at=datetime.now(timezone.utc),
    )
    db.add(request)
    db.flush()

    for idx, mat in enumerate(materials):
        extra, master = line_extras[idx]
        item_row = P2PRequestItem(
            p2p_request_id=request.id,
            **item_snapshot(master),
            make=(extra.make or "").strip() or master.make,
            quantity=mat.quantity,
            project_inhouse=extra.project_inhouse,
            ship_to=extra.ship_to,
        )
        db.add(item_row)
        mat.pr_id = request.id
        mat.pr_number = request.p2p_number
        mat.pr_status = request.status

    db.flush()
    db.expire(request, ["items"])
    # Same stock check + line routing a normal PR gets on final approval;
    # it also notifies the assigned buyer with the outcome.
    _route_lines_on_approval(db, request, user)
    return request


@router.post("/{sr_id}/raise-pr", response_model=P2PRequestResponse, status_code=201)
async def raise_purchase_requisition(
    sr_id: int,
    payload: RaisePurchaseRequestPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Raise a P2P request from this SR's materials that aren't already linked
    to one, notifying the Purchase department (in-app + email) that a request
    is waiting on them for this project/SR.

    Requester and department are always taken from the logged-in user;
    priority/required-by/reason are supplied by the caller and, once set,
    are not editable afterwards."""
    if payload.priority not in P2P_REQUEST_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{payload.priority}' — must be one of {', '.join(P2P_REQUEST_PRIORITIES)}")
    if payload.category_code and payload.category_code not in P2P_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category_code '{payload.category_code}'")
    if payload.requirement_type and payload.requirement_type not in P2P_REQUIREMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid requirement_type '{payload.requirement_type}'")

    sr = _get_live_sr(db, sr_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "purchase_requisition", "create")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can raise a purchase requisition for this service request.")
    _ensure_unlocked(sr)
    _ensure_open_for_purchase(sr)

    # Every PR line is an Item Master item (2026-10-11) — picked in the form,
    # never typed. A new part is added to Store › Item Master first.
    if not payload.items:
        raise HTTPException(status_code=400, detail="Add at least one item to the requisition — pick it from the Item Master. "
                                                    "If it's a new part, add it first in Store › Item Master.")
    line_extras: list[tuple[RaisePurchaseRequestItem, StoreItem]] = []
    for i, it in enumerate(payload.items, 1):
        master = purchasable_item(db, it.store_item_id, f"Line {i}")
        if it.project_inhouse not in ("Project", "Inhouse"):
            raise HTTPException(status_code=400, detail=f"Line {i} ({master.item_code} {master.item_name}): choose Project or Inhouse.")
        if not it.quantity or it.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Line {i} ({master.item_code} {master.item_name}): quantity must be more than 0.")
        line_extras.append((it, master))
    pr = _raise_sr_pr(db, background_tasks, sr, user, payload, line_extras)
    db.commit()
    db.refresh(pr)
    background_tasks.add_task(_send_purchase_requisition_email_background, pr.id, sr.id)

    resp = P2PRequestResponse.model_validate(pr)
    if pr.category_code:
        resp.category_label = P2P_CATEGORIES.get(pr.category_code, pr.category_code)
    resp.requested_by_name = user.name or user.email
    return resp


def _raise_sr_pr(
    db: Session,
    background_tasks: BackgroundTasks,
    sr: ServiceRequest,
    user: User,
    payload: RaisePurchaseRequestPayload,
    line_extras: list[tuple[RaisePurchaseRequestItem, StoreItem]],
) -> P2PRequest:
    """One SR material per line, the approved PR for them, audit + notices.
    Caller validates the lines, commits, and queues the Purchase email."""
    sr_id = sr.id
    materials = []
    for it, master in line_extras:
        mat = ServiceMaterial(
            service_request_id=sr_id,
            material_name=master.item_name,
            part_number=master.part_number or master.item_code,
            unit=master.uom or "pcs",
            quantity=it.quantity,
            description=payload.reason or None,
        )
        db.add(mat)
        materials.append(mat)
    db.flush()

    project = db.query(Project).filter(Project.id == sr.project_id).first()
    proj_name = f"{project.serial_number} — {project.model_name}" if project and project.model_name else (project.serial_number if project else f"Project #{sr.project_id}")

    pr = _create_p2p_request_for_sr(db, sr, materials, proj_name, user, payload, line_extras)

    detail_notes = [f"Priority: {payload.priority.title()}."]
    if payload.required_by_date:
        detail_notes.append(f"Required by: {payload.required_by_date.isoformat()}.")
    if payload.reason:
        detail_notes.append(f"Reason: {payload.reason}")
    _write_audit(
        db, sr.id, "pr_raised", user,
        summary=f"{user.name or user.email} raised purchase requisition {pr.p2p_number} with {len(materials)} material(s). " + " ".join(detail_notes),
    )

    role_event(db, background_tasks, "sr_pr_raised", title=f"PR {pr.p2p_number} raised for {sr.request_number}",
               message=f"{user.name or user.email} raised purchase requisition {pr.p2p_number} for {len(materials)} spare(s) on "
                       f"{sr.request_number} ({proj_name}). Purchase will source them.",
               entity_type="service_request", entity_id=sr.id, actor=user, record=sr)
    broadcast_notification(
        db,
        title="New Purchase Requisition",
        message=f"PR '{pr.p2p_number}' raised for SR '{sr.request_number}' ({proj_name}).",
        notification_type="pr_raised",
        entity_type="p2p_request",
        entity_id=pr.id,
        app_name="p2p",
    )
    return pr


class MaterialRequestLine(BaseModel):
    store_item_id: int
    quantity: float


class MaterialRequestPayload(BaseModel):
    """The SR's one "Material Request": the engineer only says what and how
    much. Store stock is checked here — what's in store is booked as a spare
    for Store to issue on a challan, the shortfall becomes an approved PR
    (Project line, requirement type Service) that goes straight to Purchase."""
    items: list[MaterialRequestLine]
    required_by_date: date | None = None
    priority: str = "medium"
    remarks: str | None = None


def _available_in_store(db: Session, item_id: int) -> float:
    from app.modules.p2p.routes.p2p_requests import _stock_balance_info
    return max(_stock_balance_info(db, item_id).available_qty, 0.0)


@router.get("/{sr_id}/material-request/stock")
async def material_request_stock(
    sr_id: int,
    item_ids: str = Query("", description="Comma-separated Item Master ids"),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Free store stock (on hand − reserved, all stores) per item, shown live
    on the Material Request form."""
    _get_live_sr(db, sr_id, user=user)
    ids = [int(x) for x in item_ids.split(",") if x.strip().isdigit()][:100]
    return {str(i): _available_in_store(db, i) for i in ids}


@router.post("/{sr_id}/material-request", status_code=201)
async def material_request(
    sr_id: int,
    payload: MaterialRequestPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if payload.priority not in P2P_REQUEST_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{payload.priority}' — must be one of {', '.join(P2P_REQUEST_PRIORITIES)}.")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Add at least one item — pick it from the Item Master.")
    sr = _get_live_sr(db, sr_id, user=user)
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can request material for this service request.")
    _ensure_unlocked(sr)
    _ensure_open_for_materials(sr)

    # The same item on two lines is one requirement — merge before the stock check.
    wanted: dict[int, float] = {}
    for i, ln in enumerate(payload.items, 1):
        if not ln.quantity or ln.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Line {i}: quantity must be more than 0.")
        wanted[ln.store_item_id] = wanted.get(ln.store_item_id, 0.0) + ln.quantity

    store_lines: list[tuple[StoreItem, float]] = []
    buy_lines: list[tuple[StoreItem, float, float]] = []  # item, shortfall, available
    for item_id, qty in wanted.items():
        item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
        if item is None:
            raise HTTPException(status_code=422, detail=f"Item Master item #{item_id} wasn't found — pick the item again from the list.")
        available = _available_in_store(db, item_id)
        from_store = min(qty, available)
        if from_store > 0:
            store_lines.append((item, from_store))
        if qty - from_store > 1e-9:
            buy_lines.append((item, qty - from_store, available))

    if store_lines:
        ensure_feature_action(user, "erp", "service_requests", "materials", "create")
    if buy_lines:
        try:
            ensure_feature_action(user, "erp", "service_requests", "purchase_requisition", "create")
        except HTTPException:
            short = "; ".join(f"{it.item_code} {it.item_name}: need {q + a:g}, {a:g} in store" for it, q, a in buy_lines)
            raise HTTPException(status_code=403, detail=(
                f"Not enough in store ({short}). Buying the shortfall needs the Service Requests › Purchase Requisition "
                "permission — ask your admin to grant it, or reduce the quantity to what is in store."))
        _ensure_open_for_purchase(sr)

    covered = sr.is_chargeable is False
    for item, qty in store_lines:
        db.add(ServiceMaterial(
            service_request_id=sr_id, store_item_id=item.id, material_name=item.item_name,
            part_number=item.item_code, unit=item.uom or "pcs", quantity=qty, status="pending",
            description=payload.remarks or None, is_warranty_covered=covered, qty_issued=0, qty_returned=0,
        ))
    if store_lines:
        db.flush()
        _recompute_billing(db, sr)
        _write_audit(db, sr_id, "material_added", user, summary="Material requested from store: "
                     + ", ".join(f"{it.item_name} ({q:g} {it.uom or 'pcs'})" for it, q in store_lines) + ".")

    pr = None
    if buy_lines:
        line_extras = [(RaisePurchaseRequestItem(store_item_id=it.id, quantity=q, project_inhouse="Project"),
                        purchasable_item(db, it.id, f"{it.item_code} {it.item_name}")) for it, q, _a in buy_lines]
        pr_payload = RaisePurchaseRequestPayload(priority=payload.priority, required_by_date=payload.required_by_date,
                                                 reason=payload.remarks, requirement_type="Service")
        pr = _raise_sr_pr(db, background_tasks, sr, user, pr_payload, line_extras)

    db.commit()
    if pr is not None:
        background_tasks.add_task(_send_purchase_requisition_email_background, pr.id, sr.id)
    return {
        "from_store": [{"item_name": it.item_name, "quantity": q, "unit": it.uom} for it, q in store_lines],
        "to_buy": [{"item_name": it.item_name, "quantity": q, "unit": it.uom} for it, q, _a in buy_lines],
        "pr_id": pr.id if pr else None,
        "pr_number": pr.p2p_number if pr else None,
    }


@router.post("/{sr_id}/materials/{mat_id}/receive", response_model=ServiceMaterialResponse)
async def receive_material(
    sr_id: int,
    mat_id: int,
    payload: MaterialReceivePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Mark a (possibly partial) physical receipt of a material at the service
    site. The material's own received_quantity/receiving_status/status fields
    are updated locally exactly as before. If the material is linked to a
    P2P request, `mat.pr_status` is mirrored (read-only) from that request's
    current status for display — the actual "received"/"closed" status
    transition is now entirely owned by P2P's own GRN/receiving flow
    (see p2p/routes/p2p_requests.py), not by ERP."""
    sr = _get_live_sr(db, sr_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "materials", "edit")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can mark materials received on this service request.")
    _ensure_unlocked(sr)
    _ensure_open_for_materials(sr)
    mat = _get_live_material(db, sr_id, mat_id)
    if payload.received_quantity < 0:
        raise HTTPException(status_code=400, detail=f"Received quantity can't be negative (got {payload.received_quantity:g}) — enter 0 or more.")
    if payload.received_quantity > mat.quantity:
        raise HTTPException(
            status_code=400,
            detail=f"Received quantity {payload.received_quantity:g} is more than the {mat.quantity:g} {mat.unit} ordered for '{mat.material_name}' — "
                   f"enter at most {mat.quantity:g}, or raise the material's quantity first.",
        )

    received_quantity = payload.received_quantity
    mat.received_quantity = received_quantity
    if received_quantity <= 0:
        mat.receiving_status = "pending"
    elif received_quantity < mat.quantity:
        mat.receiving_status = "partial"
    else:
        mat.receiving_status = "received"
        # Fully received means the part is now physically at the service site and
        # available for use, so the issue-status badge shouldn't stay "pending".
        mat.status = "issued"

    pr = None
    if mat.pr_id:
        pr = db.query(P2PRequest).filter(P2PRequest.id == mat.pr_id).first()
        if pr:
            mat.pr_status = pr.status

    _write_audit(
        db, sr_id, "material_received", user,
        summary=f"{user.name or user.email} marked {mat.received_quantity}/{mat.quantity} {mat.unit} of '{mat.material_name}' as received.",
    )

    # This will rarely fire now — P2P's own GRN flow drives the "received"
    # transition, not this endpoint (see the P2PRequest status mirror above).
    if pr and pr.status == "received" and sr:
        broadcast_notification(
            db,
            title="Purchase Requisition Fully Received",
            message=f"All items for PR '{pr.p2p_number}' (SR '{sr.request_number}') have been received and it's ready to close.",
            notification_type="pr_received",
            entity_type="p2p_request",
            entity_id=pr.id,
            app_name="p2p",
        )

    db.commit()
    db.refresh(mat)
    return sr_sensitive.material_out(user, mat)


# ── Spare consumption from Store (goods issue / return against the SR) ─────

def _material_target(db: Session, sr_id: int, mat_id: int, user: User) -> tuple[ServiceRequest, ServiceMaterial]:
    sr = _get_live_sr(db, sr_id, user=user)
    _ensure_unlocked(sr)
    return sr, _get_live_material(db, sr_id, mat_id)


@router.post("/{sr_id}/materials/{mat_id}/issue", response_model=ServiceMaterialResponse)
async def issue_material_from_store(
    sr_id: int,
    mat_id: int,
    payload: ServiceMaterialIssuePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Store issues the spare to site against this SR: a Material Issue of
    type Service (with challan) posts the stock out and books the quantity
    and issue cost on the line."""
    ensure_feature_action(user, "erp", "service_requests", "spare_issue", "create")
    sr, mat = _material_target(db, sr_id, mat_id, user)
    issue = sr_spares.issue_spare(
        db, sr, mat, user, location_id=payload.location_id, quantity=payload.quantity,
        challan_number=payload.challan_number, vehicle_number=payload.vehicle_number,
        site_address=payload.site_address, issue_date=payload.issue_date, remarks=payload.remarks,
    )
    _recompute_billing(db, sr)
    _write_audit(db, sr.id, "material_issued", user,
                 summary=f"{user.name or user.email} issued {payload.quantity:g} {mat.unit} of '{mat.material_name}' from Store "
                         f"on {issue.issue_number} (challan {issue.challan_number}).")
    role_event(db, None, "sr_spare_issued", title=f"Spare issued for {sr.request_number}",
               message=f"{user.name or user.email} issued {payload.quantity:g} {mat.unit} of {mat.material_name} from Store to site "
                       f"for {sr.request_number} on {issue.issue_number} (challan {issue.challan_number}).",
               entity_type="service_request", entity_id=sr.id, actor=user, record=sr,
               skip_user_ids={sr.assigned_service_person_id} if sr.assigned_service_person_id else None)
    if sr.assigned_service_person_id and sr.assigned_service_person_id != user.id:
        notify_user(db, sr.assigned_service_person_id, f"Spare issued for {sr.request_number}",
                    f"{payload.quantity:g} {mat.unit} of {mat.material_name} was issued to site on challan {issue.challan_number}.",
                    notification_type="sr_spare_issued", entity_type="service_request", entity_id=sr.id)
    db.commit()
    db.refresh(mat)
    return sr_sensitive.material_out(user, mat)


@router.post("/{sr_id}/materials/{mat_id}/return", response_model=ServiceMaterialResponse)
async def return_material_to_store(
    sr_id: int,
    mat_id: int,
    payload: ServiceMaterialReturnPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Unused spare back from site into the store it was issued from."""
    ensure_feature_action(user, "erp", "service_requests", "spare_issue", "edit")
    sr, mat = _material_target(db, sr_id, mat_id, user)
    sr_spares.return_spare(db, sr, mat, user, quantity=payload.quantity, remarks=payload.remarks)
    _recompute_billing(db, sr)
    _write_audit(db, sr.id, "material_returned", user,
                 summary=f"{user.name or user.email} returned {payload.quantity:g} {mat.unit} of unused '{mat.material_name}' to Store.")
    db.commit()
    db.refresh(mat)
    return sr_sensitive.material_out(user, mat)


@router.get("/{sr_id}/store-issues")
async def list_sr_store_issues(
    sr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "spare_issue", "view")),
):
    """Store Material Issues (type Service) posted against this SR."""
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.models.material_issue import StoreMaterialIssue
    _get_live_sr(db, sr_id, user=_user)
    issues = db.query(StoreMaterialIssue).options(selectinload(StoreMaterialIssue.items)).filter(
        StoreMaterialIssue.service_request_id == sr_id).order_by(StoreMaterialIssue.id.desc()).all()
    locs = {l.id: l.name for l in db.query(StoreLocation).filter(StoreLocation.id.in_({i.location_id for i in issues})).all()} if issues else {}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({it.item_id for x in issues for it in x.items})).all()} if issues else {}
    return [{
        "id": i.id, "issue_number": i.issue_number, "issue_date": i.issue_date, "challan_number": i.challan_number,
        "vehicle_number": i.vehicle_number, "location_name": locs.get(i.location_id),
        "lines": [{"item_code": items[it.item_id].item_code if it.item_id in items else None,
                   "item_name": items[it.item_id].item_name if it.item_id in items else None,
                   "quantity": it.quantity, "batch_number": it.batch_number} for it in i.items],
    } for i in issues]


@router.get("/{sr_id}/store-locations")
async def list_issue_locations(
    sr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "spare_issue", "view")),
):
    """Stores the spare can be issued from (active, within the user's Store scope)."""
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.services.plant_access import visible_location_ids
    _get_live_sr(db, sr_id, user=_user)
    allowed = visible_location_ids(db, _user)
    rows = [l for l in db.query(StoreLocation).filter(StoreLocation.is_active == True).order_by(StoreLocation.name).all()  # noqa: E712
            if allowed is None or l.id in allowed]
    return [{"id": l.id, "label": l.name} for l in rows]


# ── Service billing (AR invoice through Finance) ───────────────────────────

def _ensure_can_bill(sr: ServiceRequest, user: User) -> None:
    if _can_edit(sr, user):
        return
    try:
        ensure_tab_action(user, "accounts", "sales_invoices", "create")
    except HTTPException:
        raise HTTPException(
            status_code=403,
            detail="Raising the invoice of an SR needs edit rights on the SR (its creator with Service Requests › Edit) or "
                   "Finance › Sales Invoices › Create. Ask the SR owner or Finance to raise it.",
        )


@router.get("/{sr_id}/invoice")
async def get_sr_invoice(
    sr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "service_requests", "invoice", "view")),
):
    """The SR's AR invoice (GST split, amounts, collection state) and, while
    it is not raised yet, the lines it would carry."""
    sr = _get_live_sr(db, sr_id, user=_user)
    sr_billing.sync_invoice(db, sr)
    db.commit()
    db.refresh(sr)
    preview, problem = None, None
    if not sr.ar_transaction_id and sr.is_chargeable:
        try:
            preview = sr_billing.build_invoice_lines(db, sr)
        except HTTPException as e:
            problem = e.detail
    return sr_sensitive.mask_dict(_user, {"billing_status": sr.billing_status, "is_chargeable": sr.is_chargeable, "warranty_status": sr.warranty_status,
            "invoice": sr_billing.invoice_summary(db, sr), "preview_lines": preview, "problem": problem})


@router.post("/{sr_id}/invoice", response_model=ServiceRequestResponse, status_code=201)
async def create_sr_invoice(
    sr_id: int,
    payload: ServiceInvoiceCreatePayload,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Drafts the GST sales invoice of a chargeable SR in Finance (CGST/SGST
    or IGST by place of supply, HSN/SAC per line). Finance approves it in
    Finance > Sales, which numbers (SI/<FY>/NNNN) and posts it."""
    sr_billing.ensure_billing_enabled()
    sr = _get_live_sr(db, sr_id, user=user)
    _ensure_unlocked(sr)
    ensure_feature_action(user, "erp", "service_requests", "invoice", "create")
    _ensure_can_bill(sr, user)
    txn = sr_billing.create_sr_invoice(db, sr, user, invoice_date=payload.invoice_date,
                                       customer_po_number=payload.customer_po_number, narration=payload.narration)
    _write_audit(db, sr.id, "invoice_drafted", user, request,
                 summary=f"{user.name or user.email} drafted sales invoice {txn.invoice_number} for {txn.total_amount:,.2f} "
                         f"(taxable {txn.invoice_amount:,.2f}, GST {txn.gst_amount:,.2f}) — Finance approves and posts it.")
    db.commit()
    db.refresh(sr)
    return sr_sensitive.sr_out(user, sr)


# ── Email utilities ──────────────────────────────────────────────────────────

@router.post("/{sr_id}/resend-client-email")
async def resend_client_email(
    sr_id: int,
    event_type: str = Query("created", pattern="^(created|closed)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = _get_live_sr(db, sr_id, user=user)
    if not _can_edit(sr, user):
        raise HTTPException(
            status_code=403,
            detail="Only the creator of this service request (with edit permission) or an admin can re-send the client email, "
                   "because it goes out in the sender's name.",
        )
    if not sr.reported_by_email:
        raise HTTPException(status_code=400, detail="No client email on this service request — add the Reported-by email on the Edit page first.")

    project = db.query(Project).filter(Project.id == sr.project_id).first()
    success = await send_client_sr_email(db, sr, project, user.id, user.name, event_type)
    db.commit()
    if not success:
        raise HTTPException(status_code=502, detail="Email could not be sent. Check the audit trail for the error detail.")
    return {"message": f"Email ({event_type}) resent to {sr.reported_by_email}."}


@router.post("/test-email")
async def test_email(user: User = Depends(require_app_access("erp"))):
    """Send a diagnostic test email via Graph, to verify Mail.Send configuration.
    Admin only; Azure/Graph error text is logged server-side, never returned."""
    import logging
    import httpx
    log = logging.getLogger(__name__)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can send a mail-configuration test email.")
    sender = settings.SENDER_EMAIL
    recipient = user.email
    if not sender:
        raise HTTPException(status_code=400, detail="SENDER_EMAIL is not set on the server — add it to the backend .env and restart.")
    try:
        token = await get_app_graph_token()
    except Exception:
        log.exception("test-email: could not get an app-only Graph token")
        raise HTTPException(
            status_code=503,
            detail="Could not sign in to Microsoft Graph with the app credentials — check the Azure client ID, secret "
                   "and tenant in the backend .env (full error is in the server log).",
        )
    async with httpx.AsyncClient(timeout=15) as hc:
        resp = await hc.post(
            f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "message": {
                    "subject": "ERP Email Test — Graph API",
                    "body": {"contentType": "Text", "content": f"Test email from Premnathrail ERP Portal.\nSender: {sender}\nRecipient: {recipient}"},
                    "toRecipients": [{"emailAddress": {"address": recipient}}],
                },
                "saveToSentItems": True,
            },
        )
    if resp.status_code in (200, 202):
        return {"status": "ok", "message": f"Test email sent from {sender} to {recipient}."}
    log.warning("test-email: Graph sendMail returned %s: %s", resp.status_code, resp.text[:2000])
    hint = {
        401: "the app token was rejected — check the Azure app credentials",
        403: "the Azure app lacks the Mail.Send application permission (or admin consent) for the sender mailbox",
        404: f"the sender mailbox '{sender}' was not found — check SENDER_EMAIL",
    }.get(resp.status_code, "see the server log for Microsoft's full response")
    raise HTTPException(
        status_code=502,
        detail=f"Microsoft Graph refused the test email (status {resp.status_code}): {hint}.",
    )


@router.post("/{sr_id}/raise-pr/{pr_id}/attachments", status_code=201)
async def upload_sr_pr_attachments(
    sr_id: int,
    pr_id: int,
    doc_type: str = Form("supporting"),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Documents for a PR raised from this SR's Materials tab. Lives on the SR
    side because the service user usually doesn't hold the p2p app, so the
    P2P attachments route would refuse them."""
    sr = _get_live_sr(db, sr_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "purchase_requisition", "create")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can add documents to this service request's purchase requisition.")
    _ensure_unlocked(sr)
    _ensure_open_for_purchase(sr)
    linked = db.query(ServiceMaterial.id).filter(ServiceMaterial.service_request_id == sr_id, ServiceMaterial.pr_id == pr_id).first()
    pr = db.query(P2PRequest).filter(P2PRequest.id == pr_id).first()
    if not pr or not linked:
        raise HTTPException(status_code=404, detail="That purchase requisition was not raised from this service request.")
    if doc_type not in P2P_ATTACHMENT_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid doc_type '{doc_type}' — must be one of {', '.join(P2P_ATTACHMENT_DOC_TYPES)}")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "p2p", pr.p2p_number)
    count = 0
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        db.add(P2PRequestAttachment(
            p2p_request_id=pr.id, doc_type=doc_type, filename=result["name"], content_type=f.content_type,
            size=result["size"], sharepoint_path=result["path"], sharepoint_url=result.get("webUrl"),
            created_by_id=user.id,
        ))
        count += 1
    db.commit()
    return {"uploaded": count}
