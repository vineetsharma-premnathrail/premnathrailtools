from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, UploadFile, File
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from pydantic import BaseModel

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import SessionLocal, get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.schemas.service_request import (
    ServiceRequestCreate,
    ServiceRequestUpdate,
    ServiceRequestResponse,
    ServiceRequestAttachmentResponse,
    ServiceMaterialCreate,
    ServiceMaterialUpdate,
    ServiceMaterialResponse,
)
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint
from app.utils.email import send_client_sr_email, send_team_sr_notification
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


def _can_modify(sr: ServiceRequest, user: User) -> bool:
    return user.role in ("admin", "super_admin") or sr.created_by_id == user.id


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
    if not _can_modify(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator can edit this service request.")
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
    if not _can_modify(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator can delete this service request.")

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
    if not _can_modify(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator can add attachments to this service request.")
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
    if sr and not _can_modify(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator can delete attachments from this service request.")

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
    if not _can_modify(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can add materials to this service request.")

    mat = ServiceMaterial(
        service_request_id=sr_id,
        material_name=payload.material_name,
        part_number=payload.part_number,
        quantity=payload.quantity,
        unit=payload.unit,
        unit_price=payload.unit_price,
        total_price=round(payload.quantity * payload.unit_price, 2),
        supplier=payload.supplier,
        status=payload.status or "pending",
        availability=payload.availability or "in_stock",
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
    if sr and not _can_modify(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can update materials on this service request.")

    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(mat, field, val)
    mat.total_price = round(mat.quantity * mat.unit_price, 2)
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
    if sr and not _can_modify(sr, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete materials from this service request.")

    mat_name = mat.material_name
    mat.is_deleted = True
    _write_audit(db, sr_id, "material_deleted", user, summary=f"Material deleted: {mat_name}.")
    db.commit()
    return {"message": "Material deleted"}


# ── Email utilities ──────────────────────────────────────────────────────────

@router.get("/{sr_id}/purchase-users")
async def get_purchase_dept_users(
    sr_id: int,
    _user: User = Depends(require_app_access("erp")),
):
    """Azure AD users in the Purchase department, for the purchase-email recipient picker."""
    import httpx
    try:
        token = await get_app_graph_token()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Azure token error: {e}")

    params = {
        "$select": "id,displayName,mail,userPrincipalName,jobTitle,department",
        "$filter": "department eq 'Purchase' and accountEnabled eq true",
        "$top": 100,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get("https://graph.microsoft.com/v1.0/users", headers={"Authorization": f"Bearer {token}"}, params=params)
    if resp.status_code != 200:
        err = resp.json().get("error", {})
        raise HTTPException(status_code=resp.status_code, detail=err.get("message", "Graph API error"))

    return [
        {"id": u.get("id"), "name": u.get("displayName", ""), "email": u.get("mail") or u.get("userPrincipalName", ""), "job_title": u.get("jobTitle", "")}
        for u in resp.json().get("value", [])
        if (u.get("mail") or u.get("userPrincipalName"))
    ]


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


class PurchaseEmailPayload(BaseModel):
    recipient_emails: list[str]


@router.post("/{sr_id}/send-purchase-email")
async def send_purchase_email(
    sr_id: int,
    payload: PurchaseEmailPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Send a formatted purchase-requisition email listing the SR's materials."""
    import httpx

    if not payload.recipient_emails:
        raise HTTPException(status_code=400, detail="No recipients specified.")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == sr_id, ServiceRequest.is_deleted == False).first()  # noqa: E712
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")

    project = db.query(Project).filter(Project.id == sr.project_id).first()
    mats = db.query(ServiceMaterial).filter(ServiceMaterial.service_request_id == sr_id, ServiceMaterial.is_deleted == False).all()  # noqa: E712

    proj_name = f"{project.serial_number} — {project.model_name}" if project else f"Project #{sr.project_id}"
    client_name = project.client_company if project else "—"
    site_name = project.site_name if project else "—"

    parts_rows = "".join(
        f"<tr style='border-bottom:1px solid #e2e8f0'>"
        f"<td style='padding:8px 12px;font-weight:600'>{m.material_name}</td>"
        f"<td style='padding:8px 12px;text-align:center'>{m.quantity}</td>"
        f"<td style='padding:8px 12px;text-align:right'>&#8377; {m.total_price:,.2f}</td>"
        f"</tr>"
        for m in mats
    ) if mats else "<tr><td colspan='3' style='padding:16px;text-align:center;color:#94a3b8'>No parts listed.</td></tr>"
    total_cost = sum(m.total_price for m in mats)

    body_html = f"""
<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1e293b">
  <div style="background:#f97316;padding:20px 28px;border-radius:12px 12px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">Purchase Requisition — {sr.request_number}</h2>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;padding:24px 28px">
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <tr><td style="padding:5px 0;color:#64748b;width:160px">Machine / Asset</td><td style="font-weight:600">{proj_name}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Client</td><td>{client_name}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Site</td><td>{site_name}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b">Part</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;color:#64748b">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;color:#64748b">Cost Est.</th>
      </tr></thead>
      <tbody>{parts_rows}</tbody>
      <tfoot><tr style="background:#f8fafc;border-top:2px solid #e2e8f0">
        <td colspan="2" style="padding:8px 12px;font-weight:700">Total Estimated Cost</td>
        <td style="padding:8px 12px;text-align:right;font-weight:700">&#8377; {total_cost:,.2f}</td>
      </tr></tfoot>
    </table>
  </div>
</div>"""

    sender_email = settings.SENDER_EMAIL or user.email
    if not sender_email:
        raise HTTPException(status_code=400, detail="No sender email configured (set SENDER_EMAIL in .env).")

    try:
        token = await get_app_graph_token()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Azure token error: {e}")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://graph.microsoft.com/v1.0/users/{sender_email}/sendMail",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "message": {
                    "subject": f"Purchase Requisition: {sr.request_number}",
                    "body": {"contentType": "HTML", "content": body_html},
                    "toRecipients": [{"emailAddress": {"address": e}} for e in payload.recipient_emails],
                },
                "saveToSentItems": True,
            },
        )
    if resp.status_code not in (200, 202):
        raise HTTPException(status_code=502, detail=f"Graph sendMail failed: {resp.text[:300]}")

    return {"message": f"Email sent to {len(payload.recipient_emails)} recipient(s)."}


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
