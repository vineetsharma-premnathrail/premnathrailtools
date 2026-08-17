from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, UploadFile, File
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import require_app_access, has_erp_permission
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
)
from app.modules.purchase.models.purchase_requisition import PurchaseRequisition, PR_PRIORITIES, PR_CATEGORIES, PR_REQUIREMENT_TYPES
from app.modules.purchase.schemas.purchase_requisition import PurchaseRequisitionResponse, PurchaseRequisitionRaisePayload
from app.modules.purchase.service import raise_requisition, mark_material_received
from fastapi.responses import Response
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    get_preview_url, download_file_content,
)
from app.utils.email import send_client_sr_email, send_team_sr_notification, send_purchase_requisition_email
from app.utils.notifications import broadcast_notification, notify_user
from app.auth.microsoft import get_app_graph_token

router = APIRouter(prefix="/erp/service-requests", tags=["ERP - Service Requests"])

# Fields tracked in the audit log on PATCH, with a human-readable label
_TRACKED_FIELDS = {
    "status": "Status",
    "priority": "Priority",
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


def _current_financial_year() -> str:
    today = date.today()
    fy_start = today.year if today.month >= 4 else today.year - 1
    return f"{fy_start}-{str(fy_start + 1)[-2:]}"


def _generate_sr_number(db: Session) -> str:
    prefix = f"SR-{_current_financial_year()}-"
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
        pr = db.query(PurchaseRequisition).filter(PurchaseRequisition.id == pr_id).first()
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


def _can_edit(sr: ServiceRequest, user: User) -> bool:
    """Admins always pass. Everyone else must both own the SR (be its creator)
    and hold the granular "sr_edit" permission — mirrors the Edit checkbox in
    the Users & Roles module-access editor."""
    if user.role == "admin":
        return True
    return sr.created_by_id == user.id and has_erp_permission(user, "sr_edit")


def _can_delete(sr: ServiceRequest, user: User) -> bool:
    """Same as `_can_edit` but gated on "sr_delete" instead."""
    if user.role == "admin":
        return True
    return sr.created_by_id == user.id and has_erp_permission(user, "sr_delete")


@router.get("", response_model=list[ServiceRequestResponse])
async def list_service_requests(
    search: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    project_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    query = db.query(ServiceRequest).options(
        selectinload(ServiceRequest.attachments), selectinload(ServiceRequest.materials)
    ).filter(ServiceRequest.is_deleted == False)  # noqa: E712

    if search:
        like = f"%{search}%"
        query = query.filter(
            ServiceRequest.request_number.ilike(like)
            | ServiceRequest.issue_title.ilike(like)
            | ServiceRequest.issue_description.ilike(like)
            | ServiceRequest.issue_category.ilike(like)
        )
    if status:
        query = query.filter(ServiceRequest.status == status)
    if priority:
        query = query.filter(ServiceRequest.priority == priority)
    if project_id:
        query = query.filter(ServiceRequest.project_id == project_id)

    return query.order_by(ServiceRequest.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=ServiceRequestResponse, status_code=201)
async def create_service_request(
    request: Request,
    background_tasks: BackgroundTasks,
    data: ServiceRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "sr_create"):
        raise HTTPException(status_code=403, detail="You do not have permission to create service requests.")
    project = db.query(Project).filter(Project.id == data.project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="Machine/Project not found")

    sr = None
    for attempt in range(5):
        try:
            sr_number = _generate_sr_number(db)
            sr = ServiceRequest(
                request_number=sr_number,
                created_by_id=user.id,
                opened_at=datetime.now(timezone.utc),
                **data.model_dump(),
            )
            db.add(sr)
            db.flush()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 4:
                raise HTTPException(status_code=500, detail="Could not allocate a service request number, please retry")

    _write_audit(db, sr.id, "created", user, request, summary=f"Service request {sr.request_number} created by {user.name or user.email}.")
    broadcast_notification(
        db,
        title="New Service Request Raised",
        message=f"Service request '{sr.request_number}' for issue '{sr.issue_title}' was created by {user.name or user.email}.",
        notification_type="sr_created",
        entity_type="service_request",
        entity_id=sr.id,
        exclude_user_id=user.id,
    )
    notify_user(
        db,
        user_id=user.id,
        title="Service Request Created",
        message=f"Your service request '{sr.request_number}' for issue '{sr.issue_title}' has been raised.",
        notification_type="sr_created",
        entity_type="service_request",
        entity_id=sr.id,
    )
    db.commit()
    db.refresh(sr)

    background_tasks.add_task(_run_sr_emails_background, sr.id, "created", user.id, user.name)
    return sr


@router.get("/recycle-bin")
async def list_deleted_service_requests(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    RECYCLE_DAYS = 10
    srs = db.query(ServiceRequest).filter(ServiceRequest.is_deleted == True).all()  # noqa: E712
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
        })
    return items


@router.get("/{sr_id}", response_model=ServiceRequestResponse)
async def get_service_request(
    sr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    sr = db.query(ServiceRequest).options(
        selectinload(ServiceRequest.attachments), selectinload(ServiceRequest.materials)
    ).filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False).first()  # noqa: E712
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    return sr


@router.patch("/{sr_id}", response_model=ServiceRequestResponse)
async def update_service_request(
    sr_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    data: ServiceRequestUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False).first()  # noqa: E712
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) can edit this service request.")
    if sr.is_locked:
        raise HTTPException(status_code=423, detail="Service request is locked")

    changes = data.model_dump(exclude_unset=True)
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
                summary=f"{user.name or user.email} changed {label} from '{old_val}' to '{new_val}'.",
            )
            if field == "status" and str(new_val).lower() == "closed":
                status_changed_to_closed = True
                sr.closed_at = datetime.now(timezone.utc)
            elif field == "status" and str(old_val).lower() == "closed" and str(new_val).lower() != "closed":
                # Reopening a previously-closed SR — the old Closed Date is no longer valid.
                sr.closed_at = None
            changed_labels.append(label)
        setattr(sr, field, new_val)

    if status_changed_to_closed:
        broadcast_notification(
            db,
            title="Service Request Closed",
            message=f"Service request '{sr.request_number}' has been closed by {user.name or user.email}.",
            notification_type="sr_closed",
            entity_type="service_request",
            entity_id=sr.id,
            exclude_user_id=user.id,
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

    return sr


@router.delete("/{sr_id}", status_code=200)
async def delete_service_request(
    sr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    if not _can_delete(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with delete permission) can delete this service request.")

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
        raise HTTPException(status_code=404, detail="Deleted service request not found")
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
):
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
    sr = db.query(ServiceRequest).options(selectinload(ServiceRequest.project)).filter(
        ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False  # noqa: E712
    ).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) can add attachments to this service request.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

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
):
    """Raw bytes for in-app preview (img/pdf/video tags on our own origin),
    fetched via the app-only Graph token — never the raw SharePoint webUrl."""
    attachment = db.query(ServiceRequestAttachment).filter(
        ServiceRequestAttachment.id == attachment_id, ServiceRequestAttachment.service_request_id == sr_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

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
):
    """Fallback for formats the browser can't render natively (Office docs) —
    a short-lived Microsoft-viewer link, minted via the app-only token."""
    attachment = db.query(ServiceRequestAttachment).filter(
        ServiceRequestAttachment.id == attachment_id, ServiceRequestAttachment.service_request_id == sr_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    get_url = await get_preview_url(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return {"getUrl": get_url}


@router.delete("/{sr_id}/attachments/{attachment_id}")
async def delete_service_request_attachment(
    sr_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    attachment = db.query(ServiceRequestAttachment).filter(
        ServiceRequestAttachment.id == attachment_id, ServiceRequestAttachment.service_request_id == sr_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id).first()
    if sr and not _can_delete(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with delete permission) can delete attachments from this service request.")

    if settings.SHAREPOINT_SITE_ID and attachment.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    db.delete(attachment)
    db.commit()
    return {"message": "Attachment deleted"}


# ── Materials / spare parts ─────────────────────────────────────────────────

@router.get("/{sr_id}/materials", response_model=list[ServiceMaterialResponse])
async def list_materials(
    sr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    return db.query(ServiceMaterial).filter(
        ServiceMaterial.service_request_id == sr_id, ServiceMaterial.is_deleted == False  # noqa: E712
    ).order_by(ServiceMaterial.id).all()


@router.post("/{sr_id}/materials", response_model=ServiceMaterialResponse, status_code=201)
async def add_material(
    sr_id: int,
    payload: ServiceMaterialCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can add materials to this service request.")

    mat = ServiceMaterial(
        service_request_id=sr_id,
        material_name=payload.material_name,
        part_number=payload.part_number,
        model_number=payload.model_number,
        description=payload.description,
        estimated_budget=payload.estimated_budget,
        reason=payload.reason,
        quantity=payload.quantity,
        unit=payload.unit,
        status=payload.status or "pending",
    )
    db.add(mat)
    _write_audit(db, sr_id, "material_added", user, summary=f"Material added: {mat.material_name} (qty: {mat.quantity} {mat.unit}).")
    db.commit()
    db.refresh(mat)
    return mat


@router.patch("/{sr_id}/materials/{mat_id}", response_model=ServiceMaterialResponse)
async def update_material(
    sr_id: int,
    mat_id: int,
    payload: ServiceMaterialUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    mat = db.query(ServiceMaterial).filter(ServiceMaterial.id == mat_id, ServiceMaterial.service_request_id == sr_id).first()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found")
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id).first()
    if sr and not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can update materials on this service request.")

    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(mat, field, val)
    _write_audit(db, sr_id, "material_updated", user, summary=f"Material updated: {mat.material_name}.")
    db.commit()
    db.refresh(mat)
    return mat


@router.delete("/{sr_id}/materials/{mat_id}")
async def delete_material(
    sr_id: int,
    mat_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    mat = db.query(ServiceMaterial).filter(ServiceMaterial.id == mat_id, ServiceMaterial.service_request_id == sr_id).first()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found")
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id).first()
    if sr and not _can_delete(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with delete permission) or an admin can delete materials from this service request.")

    mat_name = mat.material_name
    mat.is_deleted = True
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
    mat = db.query(ServiceMaterial).filter(
        ServiceMaterial.id == mat_id, ServiceMaterial.service_request_id == sr_id, ServiceMaterial.is_deleted == False  # noqa: E712
    ).first()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found")
    sr = db.query(ServiceRequest).options(selectinload(ServiceRequest.project)).filter(
        ServiceRequest.id == sr_id
    ).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can add photos to this material.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

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
):
    attachment = db.query(ServiceMaterialAttachment).filter(
        ServiceMaterialAttachment.id == attachment_id, ServiceMaterialAttachment.service_material_id == mat_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

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
):
    attachment = db.query(ServiceMaterialAttachment).filter(
        ServiceMaterialAttachment.id == attachment_id, ServiceMaterialAttachment.service_material_id == mat_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

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
    attachment = db.query(ServiceMaterialAttachment).filter(
        ServiceMaterialAttachment.id == attachment_id, ServiceMaterialAttachment.service_material_id == mat_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Photo not found")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id).first()
    if sr and not _can_delete(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with delete permission) or an admin can delete photos from this material.")

    if settings.SHAREPOINT_SITE_ID and attachment.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    db.delete(attachment)
    db.commit()
    return {"message": "Photo deleted"}


@router.post("/{sr_id}/raise-pr", response_model=PurchaseRequisitionResponse, status_code=201)
async def raise_purchase_requisition(
    sr_id: int,
    payload: PurchaseRequisitionRaisePayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Raise a Purchase Requisition from this SR's materials that aren't
    already linked to one, notifying the Purchase department (in-app +
    email) that a PR is waiting on them for this project/SR.

    Requester and department are always taken from the logged-in user;
    priority/required-by/reason are supplied by the caller and, once set,
    are not editable afterwards."""
    if payload.priority not in PR_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{payload.priority}' — must be one of {', '.join(PR_PRIORITIES)}")
    if payload.category_code and payload.category_code not in PR_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category_code '{payload.category_code}'")
    if payload.requirement_type and payload.requirement_type not in PR_REQUIREMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid requirement_type '{payload.requirement_type}'")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False).first()  # noqa: E712
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    if not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can raise a purchase requisition for this service request.")

    materials = db.query(ServiceMaterial).filter(
        ServiceMaterial.service_request_id == sr_id,
        ServiceMaterial.is_deleted == False,  # noqa: E712
        ServiceMaterial.pr_id.is_(None),
    ).all()
    if not materials:
        raise HTTPException(
            status_code=400,
            detail="No materials available to raise a purchase requisition — add materials first, or every existing material already belongs to a PR.",
        )

    project = db.query(Project).filter(Project.id == sr.project_id).first()
    pr = raise_requisition(
        db, project_id=sr.project_id, service_request_id=sr.id, materials=materials, raised_by_id=user.id,
        priority=payload.priority, required_by_date=payload.required_by_date, reason=payload.reason,
        category_code=payload.category_code, requirement_type=payload.requirement_type,
        approver_id=payload.approver_id, approver_name=payload.approver_name,
    )
    detail_notes = [f"Priority: {payload.priority.title()}."]
    if payload.required_by_date:
        detail_notes.append(f"Required by: {payload.required_by_date.isoformat()}.")
    if payload.reason:
        detail_notes.append(f"Reason: {payload.reason}")
    _write_audit(
        db, sr.id, "pr_raised", user,
        summary=f"{user.name or user.email} raised purchase requisition {pr.pr_number} with {len(materials)} material(s). " + " ".join(detail_notes),
    )

    proj_name = f"{project.serial_number} — {project.model_name}" if project and project.model_name else (project.serial_number if project else f"Project #{sr.project_id}")
    broadcast_notification(
        db,
        title="New Purchase Requisition",
        message=f"PR '{pr.pr_number}' raised for SR '{sr.request_number}' ({proj_name}).",
        notification_type="pr_raised",
        entity_type="purchase_requisition",
        entity_id=pr.id,
        app_name="purchase",
    )

    db.commit()
    db.refresh(pr)
    background_tasks.add_task(_send_purchase_requisition_email_background, pr.id, sr.id)

    resp = PurchaseRequisitionResponse.model_validate(pr)
    if pr.category_code:
        resp.category_label = PR_CATEGORIES.get(pr.category_code, pr.category_code)
    resp.project_label = proj_name
    if project:
        resp.client_company = project.client_company
        resp.site_name = project.site_name
    resp.sr_request_number = sr.request_number
    resp.raised_by_name = user.name or user.email
    resp.department = user.department
    return resp


@router.post("/{sr_id}/materials/{mat_id}/receive", response_model=ServiceMaterialResponse)
async def receive_material(
    sr_id: int,
    mat_id: int,
    payload: MaterialReceivePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Mark a (possibly partial) physical receipt of a material at the service
    site. If the material is linked to a PR, this also syncs the PR item's
    received quantity and — once every item on the PR is fully received —
    advances the PR to "received" so Purchase knows it's ready to close."""
    mat = db.query(ServiceMaterial).filter(
        ServiceMaterial.id == mat_id, ServiceMaterial.service_request_id == sr_id, ServiceMaterial.is_deleted == False  # noqa: E712
    ).first()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found")
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id).first()
    if sr and not _can_edit(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator (with edit permission) or an admin can mark materials received on this service request.")
    if payload.received_quantity < 0:
        raise HTTPException(status_code=400, detail="received_quantity cannot be negative")

    pr = mark_material_received(db, mat, payload.received_quantity)
    _write_audit(
        db, sr_id, "material_received", user,
        summary=f"{user.name or user.email} marked {mat.received_quantity}/{mat.quantity} {mat.unit} of '{mat.material_name}' as received.",
    )

    if pr and pr.status == "received" and sr:
        broadcast_notification(
            db,
            title="Purchase Requisition Fully Received",
            message=f"All items for PR '{pr.pr_number}' (SR '{sr.request_number}') have been received and it's ready to close.",
            notification_type="pr_received",
            entity_type="purchase_requisition",
            entity_id=pr.id,
            app_name="purchase",
        )

    db.commit()
    db.refresh(mat)
    return mat


# ── Email utilities ──────────────────────────────────────────────────────────

@router.post("/{sr_id}/resend-client-email")
async def resend_client_email(
    sr_id: int,
    event_type: str = Query("created", pattern="^(created|closed)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False).first()  # noqa: E712
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    if not sr.reported_by_email:
        raise HTTPException(status_code=400, detail="No client email on this service request.")

    project = db.query(Project).filter(Project.id == sr.project_id).first()
    success = await send_client_sr_email(db, sr, project, user.id, user.name, event_type)
    db.commit()
    if not success:
        raise HTTPException(status_code=502, detail="Email could not be sent. Check the audit trail for the error detail.")
    return {"message": f"Email ({event_type}) resent to {sr.reported_by_email}."}


@router.post("/test-email")
async def test_email(user: User = Depends(require_app_access("erp"))):
    """Send a diagnostic test email via Graph, to verify Mail.Send configuration."""
    import httpx
    sender = settings.SENDER_EMAIL
    recipient = user.email
    if not sender:
        raise HTTPException(status_code=400, detail="SENDER_EMAIL not set in .env")
    try:
        token = await get_app_graph_token()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Azure token error: {e}")
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
    return {"status": "error", "graph_status": resp.status_code, "detail": resp.text[:500]}
