import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.db.session import get_db
from app.core.permissions import require_app_access, has_erp_permission
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.erp.models.project import Project
from app.modules.erp.models.project_attachment import ProjectAttachment, ProjectAttachmentShare
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.schemas.project import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectAttachmentResponse, ProjectAttachmentPermissionUpdate,
)
from fastapi.responses import Response
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    get_preview_url, download_file_content,
)
from app.utils.notifications import broadcast_notification, notify_user

router = APIRouter(prefix="/erp/projects", tags=["ERP - Projects"])

_NATURAL_SORT_SPLIT = re.compile(r"(\d+)")


def _natural_sort_key(value: str | None) -> list:
    """Split a serial number like 'PEW-53-A-9' into ['pew-', 9, '-a-', ''] so that
    digit groups sort numerically (9 before 10) instead of lexicographically."""
    parts = _NATURAL_SORT_SPLIT.split(value or "")
    return [int(part) if part.isdigit() else part.lower() for part in parts]


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="project", entity_id=project_id, action=action, performed_by_id=user.id, summary=summary))


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    search: str | None = None,
    status: str | None = None,
    application_type: str | None = None,
    client_company: str | None = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    """List active (non-deleted) machines/vehicles, optionally filtered by a text search
    across serial number, model, and client company, plus exact-match filters."""
    query = db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
    if status:
        query = query.filter(Project.status == status)
    if application_type:
        query = query.filter(Project.application_type == application_type)
    if client_company:
        query = query.filter(Project.client_company == client_company)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Project.serial_number.ilike(like))
            | (Project.model_name.ilike(like))
            | (Project.client_company.ilike(like))
        )
    projects = query.all()
    projects.sort(key=lambda p: _natural_sort_key(p.serial_number))
    return projects[skip:skip + limit]


@router.get("/filter-options")
async def get_project_filter_options(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    """Distinct values for the registry's filter dropdowns, so the UI only ever
    offers values that actually exist in the data."""
    base = db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
    statuses = [r[0] for r in base.with_entities(Project.status).distinct() if r[0]]
    application_types = [r[0] for r in base.with_entities(Project.application_type).distinct() if r[0]]
    client_companies = [r[0] for r in base.with_entities(Project.client_company).distinct() if r[0]]
    return {
        "statuses": sorted(statuses),
        "application_types": sorted(application_types),
        "client_companies": sorted(client_companies),
    }


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_create"):
        raise HTTPException(status_code=403, detail="You do not have permission to create projects.")
    existing = db.query(Project).filter(Project.serial_number == payload.serial_number).first()
    if existing:
        raise HTTPException(status_code=409, detail="A machine with this serial number already exists")

    project = Project(**payload.model_dump())
    db.add(project)
    db.flush()
    _write_audit(db, project.id, "created", user, summary=f"Machine {project.serial_number} registered by {user.name or user.email}.")
    broadcast_notification(
        db,
        title="New Machine Registered",
        message=f"Machine '{project.serial_number}' was registered by {user.name or user.email}.",
        notification_type="project_created",
        entity_type="project",
        entity_id=project.id,
        exclude_user_id=user.id,
    )
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="Machine not found")
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_edit"):
        raise HTTPException(status_code=403, detail="You do not have permission to edit projects.")
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="Machine not found")

    updates = payload.model_dump(exclude_unset=True)
    if "serial_number" in updates and updates["serial_number"] != project.serial_number:
        clash = db.query(Project).filter(Project.serial_number == updates["serial_number"]).first()
        if clash:
            raise HTTPException(status_code=409, detail="A machine with this serial number already exists")

    changed_fields = [field for field, value in updates.items() if str(getattr(project, field, None)) != str(value)]
    for field, value in updates.items():
        setattr(project, field, value)

    if changed_fields:
        _write_audit(db, project.id, "updated", user, summary=f"{user.name or user.email} updated: {', '.join(changed_fields[:5])}.")

    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Soft delete a machine, and cascade the soft-delete to all of its Service Requests
    (setting `is_deleted` doesn't trigger the ORM's `delete-orphan` cascade — that only
    fires on real deletes — so the SRs have to be soft-deleted explicitly here)."""
    if not has_erp_permission(user, "project_delete"):
        raise HTTPException(status_code=403, detail="You do not have permission to delete projects.")
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="Machine not found")
    now = datetime.now(timezone.utc)
    project.is_deleted = True
    project.deleted_at = now
    for sr in db.query(ServiceRequest).filter(ServiceRequest.project_id == project.id, ServiceRequest.is_deleted == False).all():  # noqa: E712
        sr.is_deleted = True
        sr.deleted_at = now
    _write_audit(db, project.id, "deleted", user, summary=f"Machine {project.serial_number} moved to recycle bin by {user.name or user.email}.")
    broadcast_notification(
        db,
        title="Machine Deleted",
        message=f"Machine '{project.serial_number}' was deleted by {user.name or user.email}.",
        notification_type="project_deleted",
        entity_type="project",
        entity_id=project.id,
        exclude_user_id=user.id,
    )
    notify_user(
        db,
        user_id=user.id,
        title="Machine Deleted",
        message=f"You deleted machine '{project.serial_number}'. It can be restored from the recycle bin for 10 days.",
        notification_type="project_deleted",
        entity_type="project",
        entity_id=project.id,
    )
    db.commit()


@router.post("/{project_id}/restore", response_model=ProjectResponse)
async def restore_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == True).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="Deleted machine not found")
    project.is_deleted = False
    project.deleted_at = None
    for sr in db.query(ServiceRequest).filter(ServiceRequest.project_id == project.id, ServiceRequest.is_deleted == True).all():  # noqa: E712
        sr.is_deleted = False
        sr.deleted_at = None
    _write_audit(db, project.id, "restored", user, summary=f"Machine {project.serial_number} restored from recycle bin.")
    db.commit()
    db.refresh(project)
    return project


@router.get("/recycle-bin/list")
async def list_deleted_projects(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    projects = db.query(Project).filter(Project.is_deleted == True).all()  # noqa: E712
    return [
        {
            "id": p.id,
            "serial_number": p.serial_number,
            "model_name": p.model_name,
            "client_company": p.client_company,
            "deleted_at": p.deleted_at.isoformat() if p.deleted_at else None,
        }
        for p in projects
    ]


@router.get("/{project_id}/audit")
async def get_project_audit(
    project_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "project", AuditLog.entity_id == project_id
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
            "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]


# ── Documents / Attachments (SharePoint) ────────────────────────────────────

def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v.strip()]


def _split_csv_ints(value: str | None) -> list[int]:
    return [int(v) for v in _split_csv(value) if v.isdigit()]


def _build_share_rows(user_ids: list[int], departments: list[str], designations: list[str]) -> list[ProjectAttachmentShare]:
    return (
        [ProjectAttachmentShare(user_id=uid) for uid in dict.fromkeys(user_ids)]
        + [ProjectAttachmentShare(department=d) for d in dict.fromkeys(departments)]
        + [ProjectAttachmentShare(designation=d) for d in dict.fromkeys(designations)]
    )


def _can_view_attachment(user: User, attachment: ProjectAttachment) -> bool:
    if user.role == "admin" or not attachment.is_private or attachment.created_by_id == user.id:
        return True
    if user.id in attachment.shared_with_user_ids:
        return True
    if user.department and user.department in attachment.shared_departments:
        return True
    if user.designation and user.designation in attachment.shared_designations:
        return True
    return False


@router.get("/{project_id}/attachments", response_model=list[ProjectAttachmentResponse])
async def list_project_attachments(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    attachments = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.project_id == project_id
    ).all()
    return [a for a in attachments if _can_view_attachment(user, a)]


@router.get("/{project_id}/attachments/{attachment_id}/preview")
async def preview_project_attachment(
    project_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    attachment = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.id == attachment_id, ProjectAttachment.project_id == project_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not _can_view_attachment(user, attachment):
        raise HTTPException(status_code=403, detail="You do not have permission to view this document.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    get_url = await get_preview_url(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return {"getUrl": get_url}


@router.get("/{project_id}/attachments/{attachment_id}/content")
async def get_project_attachment_content(
    project_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Raw file bytes for in-app preview (img/pdf/video tags on our own
    origin) — for formats the browser can render natively. Office documents
    (docx/xlsx/pptx) still need the /preview Microsoft-viewer link since a
    browser can't render those on its own."""
    attachment = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.id == attachment_id, ProjectAttachment.project_id == project_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not _can_view_attachment(user, attachment):
        raise HTTPException(status_code=403, detail="You do not have permission to view this document.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return Response(
        content=content,
        media_type=attachment.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.filename}"'},
    )


@router.post("/{project_id}/attachments", response_model=list[ProjectAttachmentResponse])
async def upload_project_attachments(
    project_id: int,
    files: list[UploadFile] = File(...),
    is_private: bool = Form(False),
    shared_with_user_ids: str | None = Form(None),
    shared_departments: str | None = Form(None),
    shared_designations: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_edit"):
        raise HTTPException(status_code=403, detail="You do not have permission to edit projects.")
    project = db.query(Project).options(selectinload(Project.attachments)).filter(
        Project.id == project_id, Project.is_deleted == False  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Machine not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    share_rows: list[ProjectAttachmentShare] = []
    if is_private:
        share_rows = _build_share_rows(
            _split_csv_ints(shared_with_user_ids), _split_csv(shared_departments), _split_csv(shared_designations)
        )

    project_name = project.serial_number or project.model_name or str(project.id)
    folder_path = build_sharepoint_folder_path(user.name or user.email or "", project_name, "documents")

    attachments = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        attachment = ProjectAttachment(
            project_id=project.id,
            filename=result["name"],
            content_type=f.content_type,
            size=result["size"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            created_by_id=user.id,
            is_private=is_private,
        )
        if is_private:
            # Each attachment gets its own fresh Share rows — sharing one
            # ProjectAttachmentShare instance across attachments would try to
            # insert the same primary key twice.
            attachment.shares = [
                ProjectAttachmentShare(user_id=s.user_id, department=s.department, designation=s.designation)
                for s in share_rows
            ]
        db.add(attachment)
        attachments.append(attachment)

    if attachments:
        db.flush()
        for a in attachments:
            db.refresh(a)
        filenames = ", ".join(a.filename for a in attachments)
        _write_audit(db, project.id, "attachment_uploaded", user, summary=f"{user.name or user.email} uploaded {len(attachments)} file(s): {filenames}")

    db.commit()
    return attachments


@router.patch("/{project_id}/attachments/{attachment_id}/permissions", response_model=ProjectAttachmentResponse)
async def update_project_attachment_permissions(
    project_id: int,
    attachment_id: int,
    payload: ProjectAttachmentPermissionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    attachment = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.id == attachment_id, ProjectAttachment.project_id == project_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if user.role != "admin" and attachment.created_by_id != user.id:
        raise HTTPException(status_code=403, detail="Only the uploader or an admin can change this document's access.")

    attachment.is_private = payload.is_private
    attachment.shares = (
        _build_share_rows(payload.shared_with_user_ids, payload.shared_departments, payload.shared_designations)
        if payload.is_private else []
    )
    _write_audit(
        db, project_id, "attachment_permissions_updated", user,
        summary=f"{user.name or user.email} updated access for '{attachment.filename}'",
    )
    db.commit()
    db.refresh(attachment)
    return attachment


@router.delete("/{project_id}/attachments/{attachment_id}")
async def delete_project_attachment(
    project_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_delete"):
        raise HTTPException(status_code=403, detail="You do not have permission to delete project attachments.")
    attachment = db.query(ProjectAttachment).filter(
        ProjectAttachment.id == attachment_id, ProjectAttachment.project_id == project_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    if settings.SHAREPOINT_SITE_ID and attachment.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    db.delete(attachment)
    db.commit()
    return {"message": "Attachment deleted"}
