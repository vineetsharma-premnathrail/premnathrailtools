"""HR & Administration — employee directory and profiles.

Owner: Agent A.

- HR-management endpoints (list, detail, create/update profile, employee
  documents) use `Depends(require_hr)`.
- Self-service (`/me`, `/me/documents`) and the PII-free `/directory` and
  `/org-chart` are open to any logged-in user (`get_current_user`).

Fixed paths (`/me`, `/directory`, `/org-chart`) are declared before
`/{user_id}` so they are not swallowed by the path parameter."""
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.config import settings
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.user_document import UserDocument
from app.modules.main.routes.auth import get_current_user
from app.modules.main.schemas.user import UserDocumentResponse
from app.modules.hr.models.employee_profile import HrEmployeeProfile, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES
from app.modules.hr.schemas.employee_profile import (
    HrEmployeeProfileUpdate, HrEmployeeSelfUpdate, HrEmployeeProfileResponse,
    HrEmployeeListResponse, HrDirectoryEntry, HrOrgChartResponse,
)
from app.modules.hr.services import employees as svc
from app.modules.hr.services.access import HR_ONLY_CONFIDENTIALITY, require_hr
from app.utils.sharepoint import (
    upload_file_to_sharepoint, delete_file_from_sharepoint, download_file_content, sanitize_folder_name,
)

router = APIRouter(prefix="/hr/employees", tags=["HR"])

# Documents with confidentiality HR_ONLY_CONFIDENTIALITY (services/access.py)
# are visible to HR only — never listed on the employee's own My HR page.
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"User #{user_id} does not exist. They may have been removed — go back to the Employees list and refresh.")
    return user


def _require_sharepoint() -> None:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(
            status_code=503,
            detail="Document storage (SharePoint) is not configured on the server, so files can't be uploaded or opened. Ask the portal admin to set SHAREPOINT_SITE_ID in the backend .env.",
        )


def _content_response(document: UserDocument, content: bytes, content_type: str | None) -> Response:
    safe_name = (document.filename or "document").replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=content,
        media_type=document.content_type or content_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )


# =================================================================== list

@router.get("", response_model=HrEmployeeListResponse)
async def list_employees(
    search: str | None = Query(None, description="Name, email or employee code"),
    department_id: int | None = Query(None),
    branch_id: int | None = Query(None),
    designation_id: int | None = Query(None),
    employment_status: str | None = Query(None),
    employment_type: str | None = Query(None),
    has_profile: bool | None = Query(None),
    manager_id: int | None = Query(None),
    user_status: str = Query("active", description="active | inactive | all (portal account status)"),
    sort: str = Query("name"),
    order: str = Query("asc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    """Every portal user (paged, no fixed cap) left-joined with their HR
    profile. Users without a profile appear with has_profile=false so HR can
    create one."""
    if employment_status and employment_status not in EMPLOYMENT_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown employment status '{employment_status}'. Use one of {', '.join(EMPLOYMENT_STATUSES)}.")
    if employment_type and employment_type not in EMPLOYMENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown employment type '{employment_type}'. Use one of {', '.join(EMPLOYMENT_TYPES)}.")
    if user_status not in ("active", "inactive", "all"):
        raise HTTPException(status_code=422, detail="user_status must be 'active', 'inactive' or 'all'.")
    if sort not in svc.SORT_FIELDS:
        raise HTTPException(status_code=422, detail=f"Can't sort by '{sort}'. Sort by one of {', '.join(svc.SORT_FIELDS)}.")
    items, total, total_users, with_profile = svc.list_employees(
        db, search=search, department_id=department_id, branch_id=branch_id, designation_id=designation_id,
        employment_status=employment_status, employment_type=employment_type, has_profile=has_profile,
        user_status=user_status, manager_id=manager_id, sort=sort, order="desc" if order == "desc" else "asc",
        page=page, page_size=page_size,
    )
    return HrEmployeeListResponse(
        items=items, total=total, page=page, page_size=page_size,
        total_users=total_users, with_profile=with_profile, without_profile=max(total_users - with_profile, 0),
    )


# =================================================================== self-service

@router.get("/me", response_model=HrEmployeeProfileResponse)
async def get_my_profile(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The signed-in employee's own full record, PII included."""
    return svc.build_profile_response(db, user, svc.get_profile(db, user.id), include_hr_fields=False)


@router.patch("/me", response_model=HrEmployeeProfileResponse)
async def update_my_profile(payload: HrEmployeeSelfUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Employees may change only their personal contact details, addresses,
    emergency contact, blood group and marital status. Org fields
    (department, designation, manager, codes, IDs) are HR-only."""
    data = payload.model_dump(exclude_unset=True)
    extra = set(data) - set(svc.SELF_EDITABLE_FIELDS)
    if extra:
        raise HTTPException(status_code=403, detail=f"You can't change {', '.join(sorted(extra))} yourself. Ask HR to update it.")
    profile = svc.get_profile(db, user.id)
    if profile is None:
        # Self-created profile: HR hasn't taken ownership of the org fields
        # yet, so leave Azure sync in charge of them (org_fields_locked=False).
        profile = HrEmployeeProfile(user_id=user.id, employment_status="active", org_fields_locked=False, created_by_id=user.id)
        svc.prefill_new_profile(db, user, profile)
        db.add(profile)
    for k, v in data.items():
        setattr(profile, k, v)
    profile.updated_by_id = user.id
    db.commit()
    db.refresh(profile)
    return svc.build_profile_response(db, user, profile, include_hr_fields=False)


@router.get("/me/documents", response_model=list[UserDocumentResponse])
async def list_my_documents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(UserDocument)
        .filter(UserDocument.user_id == user.id)
        .filter((UserDocument.confidentiality.is_(None)) | (UserDocument.confidentiality != HR_ONLY_CONFIDENTIALITY))
        .order_by(UserDocument.id.desc())
        .all()
    )


@router.get("/me/documents/{document_id}/content")
async def get_my_document_content(document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user.id).first()
    if not document or document.confidentiality == HR_ONLY_CONFIDENTIALITY:
        raise HTTPException(status_code=404, detail="That document isn't on your record (or is restricted to HR). Refresh the page; if you need a copy, ask HR.")
    _require_sharepoint()
    if not document.sharepoint_path:
        raise HTTPException(status_code=404, detail="This document record has no stored file. Ask HR to upload it again.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
    return _content_response(document, content, content_type)


# =================================================================== directory / org chart

@router.get("/directory", response_model=list[HrDirectoryEntry])
async def employee_directory(
    search: str | None = Query(None),
    department: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Company directory for everyone: name, designation, department, plant,
    manager and photo only. Exited and deactivated people are excluded."""
    return svc.directory_entries(db, search=search, department=department)


@router.get("/org-chart", response_model=HrOrgChartResponse)
async def employee_org_chart(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    """Flat node list with manager_id links; the client builds the tree.
    People whose manager has left are returned as roots."""
    nodes, roots = svc.org_chart(db)
    return HrOrgChartResponse(nodes=nodes, root_ids=roots)


# =================================================================== HR: one employee

@router.get("/{user_id}", response_model=HrEmployeeProfileResponse)
async def get_employee(user_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    target = _get_user_or_404(db, user_id)
    return svc.build_profile_response(db, target, svc.get_profile(db, user_id))


@router.patch("/{user_id}", response_model=HrEmployeeProfileResponse)
async def upsert_employee_profile(
    user_id: int,
    payload: HrEmployeeProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    """Create the HR profile if it doesn't exist yet, otherwise update the
    fields sent. Department / designation / plant are mirrored onto the User
    row; reporting manager and date of joining are written to User."""
    target = _get_user_or_404(db, user_id)
    if target.id == user.id:
        raise HTTPException(
            status_code=403,
            detail=(
                "You can't change your own HR record here (reporting manager, grade, status and the like). Ask another HR "
                "user to do it. Your personal contact details can be edited under My HR > Profile."
            ),
        )
    try:
        profile = svc.upsert_profile(db, target, payload, user)
    except HTTPException:
        db.rollback()  # drop a half-built new profile / User edits
        raise
    db.commit()
    db.refresh(profile)
    db.refresh(target)
    return svc.build_profile_response(db, target, profile)


# =================================================================== HR: documents

@router.get("/{user_id}/documents", response_model=list[UserDocumentResponse])
async def list_employee_documents(user_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    _get_user_or_404(db, user_id)
    return db.query(UserDocument).filter(UserDocument.user_id == user_id).order_by(UserDocument.id.desc()).all()


@router.post("/{user_id}/documents", response_model=UserDocumentResponse, status_code=201)
async def upload_employee_document(
    user_id: int,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    document_name: str = Form(...),
    document_number: str | None = Form(None),
    issue_date: date | None = Form(None),
    expiry_date: date | None = Form(None),
    issuing_authority: str | None = Form(None),
    confidentiality: str | None = Form(None),
    tags: str | None = Form(None),
    remarks: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    target = _get_user_or_404(db, user_id)
    if not document_type.strip():
        raise HTTPException(status_code=422, detail="Pick a document type (e.g. ID Proof, Offer Letter).")
    if not document_name.strip():
        raise HTTPException(status_code=422, detail="Enter a document name so people can tell the files apart (e.g. 'PAN card').")
    if issue_date and expiry_date and expiry_date < issue_date:
        raise HTTPException(
            status_code=422,
            detail=f"Expiry date ({expiry_date.strftime('%d-%m-%Y')}) is before the issue date ({issue_date.strftime('%d-%m-%Y')}). Check both dates.",
        )
    if file.size is not None and file.size > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail=f"'{file.filename}' is {file.size / 1024 / 1024:.1f} MB; the limit is 25 MB. Compress or split the file and upload again.")
    _require_sharepoint()

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    document = UserDocument(
        user_id=user_id,
        document_type=document_type.strip(),
        document_name=document_name.strip(),
        document_number=(document_number or "").strip() or None,
        issue_date=issue_date,
        expiry_date=expiry_date,
        issuing_authority=(issuing_authority or "").strip() or None,
        filename=file.filename or "document",
        content_type=file.content_type,
        confidentiality=confidentiality or None,
        tags=tag_list,
        remarks=(remarks or "").strip() or None,
        created_by_id=user.id,
    )
    db.add(document)
    db.flush()
    # One folder per document record: SharePoint PUT replaces a same-named
    # file, so a shared folder let a later 'scan.pdf' (e.g. HR Only) overwrite
    # the file behind an earlier, employee-visible record.
    folder_path = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/hr/employees/{user_id}/{document.id}"
    try:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)
    except Exception:
        db.rollback()
        raise
    document.filename = result["name"]
    document.size = result.get("size")
    document.sharepoint_path = result["path"]
    document.sharepoint_url = result.get("webUrl")
    record_audit(
        db, entity_type="user_document", entity_id=document.id, action="create", module_key="hr",
        summary=f"Uploaded {document.document_type} '{document.document_name}' for {target.name}",
        new_value={"user_id": user_id, "document_type": document.document_type, "document_name": document.document_name,
                   "expiry_date": expiry_date, "confidentiality": document.confidentiality},
        user_id=user.id,
    )
    db.commit()
    db.refresh(document)
    return document


@router.get("/{user_id}/documents/{document_id}/content")
async def get_employee_document_content(user_id: int, document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} isn't on this employee's record. It may have been deleted — refresh the Documents tab.")
    _require_sharepoint()
    if not document.sharepoint_path:
        raise HTTPException(status_code=404, detail="This document record has no stored file. Delete it and upload the file again.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
    return _content_response(document, content, content_type)


@router.delete("/{user_id}/documents/{document_id}")
async def delete_employee_document(user_id: int, document_id: int, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} isn't on this employee's record. It may already have been deleted — refresh the Documents tab.")
    # Older records shared one folder per employee, so two rows can point at
    # the same file — only remove it once nothing else references it.
    shared = bool(document.sharepoint_path) and db.query(UserDocument.id).filter(
        UserDocument.sharepoint_path == document.sharepoint_path, UserDocument.id != document.id,
    ).first() is not None
    if settings.SHAREPOINT_SITE_ID and document.sharepoint_path and not shared:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
        except HTTPException:
            pass  # file already gone in SharePoint — still remove the record
    record_audit(
        db, entity_type="user_document", entity_id=document.id, action="delete", module_key="hr",
        summary=f"Deleted {document.document_type} '{document.document_name}' (user #{user_id})",
        old_value={"user_id": user_id, "document_type": document.document_type, "document_name": document.document_name, "filename": document.filename},
        user_id=user.id,
    )
    db.delete(document)
    db.commit()
    return {"ok": True}
