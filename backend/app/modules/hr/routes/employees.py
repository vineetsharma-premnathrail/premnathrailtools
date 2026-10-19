"""HR & Administration — employee directory and profiles.

Owner: Agent A.

- HR-management endpoints (list, detail, create/update profile, employee
  documents) use `Depends(require_hr)`.
- Self-service (`/me`, `/me/documents`) and the PII-free `/directory` and
  `/org-chart` are open to any logged-in user (`get_current_user`).

Fixed paths (`/me`, `/directory`, `/org-chart`) are declared before
`/{user_id}` so they are not swallowed by the path parameter."""
from datetime import date, datetime, timezone

from pydantic import BaseModel

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
from app.modules.hr.models.employee_profile import HrEmployeeProfile, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, WORKER_TYPES
from app.modules.hr.schemas.employee_profile import (
    HrEmployeeProfileUpdate, HrEmployeeSelfUpdate, HrEmployeeProfileResponse,
    HrEmployeeListResponse, HrDirectoryEntry, HrOrgChartResponse, HrWorkerCreate, HrWorkerUpdate,
)
from app.modules.hr.services import employees as svc
from app.modules.hr.services.approvals import (
    employee_scope_filter, ensure_employee_in_scope, ensure_worker_in_scope, worker_scope_filter,
)
from types import SimpleNamespace

from app.core.permission_registry import can_feature
from app.core.permissions import ensure_can_delete, ensure_feature_action, ensure_tab_action
from app.modules.hr.models.employee_profile import PII_FIELDS
from app.modules.hr.services.access import (
    HR_ONLY_CONFIDENTIALITY, require_hr_tab, require_me_edit, require_me_view,
)
from app.utils.sharepoint import (
    upload_file_to_sharepoint, delete_file_from_sharepoint, download_file_content, sanitize_folder_name,
)

router = APIRouter(prefix="/hr/employees", tags=["HR"])

# HR-team gate for this file: hr app + Permission Matrix › HR › employees.
require_hr = require_hr_tab("employees")
require_hr_edit = require_hr_tab("employees", "edit")  # employee documents are part of the record
# Org chart: its own tab, also shown to employees on My HR.
require_org_chart = require_hr_tab(("org_chart", "me"))

# Feature gates inside the employee record (core/features/hr.py): the
# statutory IDs are the sensitive switch, the rest of the PII is the
# "personal" section, HR remarks their own section.
STATUTORY_FIELDS = ("pan_number", "aadhaar_last4", "uan_number", "esic_number")
PERSONAL_FIELDS = tuple(f for f in PII_FIELDS if f not in STATUTORY_FIELDS)
_FEATURE_FIELDS = (("personal", PERSONAL_FIELDS), ("statutory_ids", STATUTORY_FIELDS), ("hr_notes", ("notes",)))


def _mask(viewer: User, resp: HrEmployeeProfileResponse) -> HrEmployeeProfileResponse:
    """Blank the record sections `viewer`'s roles don't grant (response only —
    the stored data is untouched)."""
    blank = {f: None for fk, fields in _FEATURE_FIELDS
             if not can_feature(viewer, "hr", "employees", fk, "view") for f in fields}
    return resp.model_copy(update=blank) if blank else resp


def _drop_ungranted(viewer: User, payload, creating: bool) -> None:
    """A save from a role without create / edit on a section leaves that
    section's stored values as they are (the form hides them, and a masked
    blank must never overwrite real data)."""
    action = "create" if creating else "edit"
    for fk, fields in _FEATURE_FIELDS:
        allowed = can_feature(viewer, "hr", "employees", fk, "view" if fk == "hr_notes" else action)
        if not allowed:
            for f in fields:
                payload.model_fields_set.discard(f)


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


def _with_verifier(db: Session, docs: list[UserDocument]) -> list[UserDocument]:
    """Fill verified_by_name for the response (not a column)."""
    ids = {d.verified_by_id for d in docs if d.verified_by_id}
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    for d in docs:
        d.verified_by_name = names.get(d.verified_by_id)
    return docs


class DocumentVerifyPayload(BaseModel):
    status: str  # pending | verified | rejected
    remarks: str | None = None


def _verify(db: Session, document: UserDocument, payload: DocumentVerifyPayload, user: User, owner_name: str) -> UserDocument:
    from app.modules.hr.models.employee_profile import VERIFICATION_STATUSES

    if payload.status not in VERIFICATION_STATUSES:
        raise HTTPException(status_code=422, detail=f"'{payload.status}' is not a verification status. Use one of: {', '.join(VERIFICATION_STATUSES.values())}.")
    remarks = (payload.remarks or "").strip() or None
    if payload.status == "rejected" and not remarks:
        raise HTTPException(status_code=422, detail="Say why the document is rejected (e.g. 'blurred scan', 'expired', 'name doesn't match'), so it can be fixed and uploaded again.")
    old = document.verification_status
    document.verification_status = payload.status
    document.verified_by_id = user.id if payload.status != "pending" else None
    document.verified_at = datetime.now(timezone.utc) if payload.status != "pending" else None
    if remarks:
        document.remarks = remarks
    record_audit(
        db, entity_type="user_document", entity_id=document.id, action="update", module_key="hr",
        summary=f"{document.document_name} of {owner_name} marked {payload.status} by {user.name}" + (f": {remarks}" if remarks else ""),
        old_value={"verification_status": old}, new_value={"verification_status": payload.status, "remarks": remarks},
        user_id=user.id,
    )
    db.commit()
    db.refresh(document)
    return _with_verifier(db, [document])[0]


async def _store_document(
    db: Session, user: User, file: UploadFile, *, owner_name: str, user_id: int | None, profile_id: int | None,
    folder_owner: str, document_type: str | None, document_name: str | None, document_number: str | None,
    issue_date: date | None, expiry_date: date | None, issuing_authority: str | None, confidentiality: str | None,
    tags: str | None, remarks: str | None, checklist_key: str | None,
) -> UserDocument:
    """Validate, upload to SharePoint and record one employee document — for a
    portal account (user_id) or an HR record without one (profile_id). With a
    checklist_key the file counts as that joining document received."""
    from app.modules.hr.services.workforce_rules import CHECKLIST_DOCUMENT_TYPES, DOCUMENTS, SENSITIVE_DOCUMENTS

    checklist_key = (checklist_key or "").strip() or None
    if checklist_key:
        if checklist_key not in DOCUMENTS:
            raise HTTPException(status_code=422, detail=f"'{checklist_key}' is not one of the employee document types. Pick the type from the list on the employee form.")
        document_type = document_type or CHECKLIST_DOCUMENT_TYPES[checklist_key]
        document_name = document_name or DOCUMENTS[checklist_key]
        if checklist_key in SENSITIVE_DOCUMENTS:
            confidentiality = HR_ONLY_CONFIDENTIALITY  # statutory / identity papers: HR only
    if not (document_type or "").strip():
        raise HTTPException(status_code=422, detail="Pick a document type (e.g. ID Proof, Offer Letter).")
    if not (document_name or "").strip():
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
        hr_profile_id=profile_id,
        checklist_key=checklist_key,
        verification_status="pending" if checklist_key else None,
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
    folder_path = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/hr/employees/{folder_owner}/{document.id}"
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
        summary=f"Uploaded {document.document_type} '{document.document_name}' for {owner_name}",
        new_value={"user_id": user_id, "hr_profile_id": profile_id, "document_type": document.document_type,
                   "document_name": document.document_name, "checklist_key": checklist_key,
                   "expiry_date": expiry_date, "confidentiality": document.confidentiality},
        user_id=user.id,
    )
    db.commit()
    db.refresh(document)
    return document


# =================================================================== list

@router.get("", response_model=HrEmployeeListResponse)
async def list_employees(
    search: str | None = Query(None, description="Name, email or employee code"),
    department_id: int | None = Query(None),
    branch_id: int | None = Query(None),
    designation_id: int | None = Query(None),
    employment_status: str | None = Query(None),
    employment_type: str | None = Query(None),
    worker_type: str | None = Query(None, description="office | factory | contract"),
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
    profile, plus employees without a portal account (has_login=false, opened
    by profile_id). Users without a profile appear with has_profile=false so
    HR can create one."""
    if employment_status and employment_status not in EMPLOYMENT_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown employment status '{employment_status}'. Use one of {', '.join(EMPLOYMENT_STATUSES)}.")
    if employment_type and employment_type not in EMPLOYMENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown employment type '{employment_type}'. Use one of {', '.join(EMPLOYMENT_TYPES)}.")
    if worker_type and worker_type not in WORKER_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown worker type '{worker_type}'. Use one of {', '.join(WORKER_TYPES)}.")
    if user_status not in ("active", "inactive", "all"):
        raise HTTPException(status_code=422, detail="user_status must be 'active', 'inactive' or 'all'.")
    if sort not in svc.SORT_FIELDS:
        raise HTTPException(status_code=422, detail=f"Can't sort by '{sort}'. Sort by one of {', '.join(svc.SORT_FIELDS)}.")
    items, total, total_users, with_profile, without_login = svc.list_employees(
        db, search=search, department_id=department_id, branch_id=branch_id, designation_id=designation_id,
        employment_status=employment_status, employment_type=employment_type, has_profile=has_profile,
        user_status=user_status, manager_id=manager_id, sort=sort, order="desc" if order == "desc" else "asc",
        page=page, page_size=page_size, scope=employee_scope_filter(db, _user),
        worker_scope=worker_scope_filter(db, _user), worker_type=worker_type,
    )
    return HrEmployeeListResponse(
        items=items, total=total, page=page, page_size=page_size,
        total_users=total_users, with_profile=with_profile, without_profile=max(total_users - with_profile, 0),
        without_login=without_login,
    )


# =================================================================== self-service

@router.get("/me", response_model=HrEmployeeProfileResponse)
async def get_my_profile(db: Session = Depends(get_db), user: User = Depends(require_me_view)):
    """The signed-in employee's own full record, PII included."""
    return svc.build_profile_response(db, user, svc.get_profile(db, user.id), include_hr_fields=False)


@router.patch("/me", response_model=HrEmployeeProfileResponse)
async def update_my_profile(payload: HrEmployeeSelfUpdate, db: Session = Depends(get_db), user: User = Depends(require_me_edit)):
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
async def list_my_documents(db: Session = Depends(get_db), user: User = Depends(require_me_view)):
    return (
        db.query(UserDocument)
        .filter(UserDocument.user_id == user.id)
        .filter((UserDocument.confidentiality.is_(None)) | (UserDocument.confidentiality != HR_ONLY_CONFIDENTIALITY))
        .order_by(UserDocument.id.desc())
        .all()
    )


@router.get("/me/documents/{document_id}/content")
async def get_my_document_content(document_id: int, db: Session = Depends(get_db), user: User = Depends(require_me_view)):
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
    # PII-free people picker used across HR forms (any HR tab, My HR included):
    # the hr app (router-level require_hr_module) is enough.
    _user: User = Depends(get_current_user),
):
    """Company directory for everyone: name, designation, department, plant,
    manager and photo only. Exited and deactivated people are excluded."""
    return svc.directory_entries(db, search=search, department=department)


@router.get("/org-chart", response_model=HrOrgChartResponse)
async def employee_org_chart(db: Session = Depends(get_db), _user: User = Depends(require_org_chart)):
    """Flat node list with manager_id links; the client builds the tree.
    People whose manager has left are returned as roots."""
    nodes, roots = svc.org_chart(db)
    return HrOrgChartResponse(nodes=nodes, root_ids=roots)


# =================================================================== dynamic form rules

@router.get("/form-rules")
async def workforce_form_rules(db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    """Field rules of the dynamic workforce form: sections, per-field
    visibility / required conditions, why each field exists and which process
    uses it, document checklists and per-type defaults
    (services/workforce_rules.py). The backend enforces the same rules on save."""
    from app.modules.hr.services.workforce_rules import rules_payload
    from app.modules.main.models.role import Role

    roles = (db.query(Role).filter(Role.is_active.is_(True), Role.is_default.is_(False)).order_by(Role.name).all())
    return rules_payload([{"id": r.id, "name": r.name, "description": r.description} for r in roles])


def _record_response(db: Session, profile: HrEmployeeProfile, viewer: User) -> HrEmployeeProfileResponse:
    """A worker record, or — once Portal Access linked it to an account — the account holder's record."""
    if profile.user_id:
        target = db.get(User, profile.user_id)
        return _mask(viewer, svc.build_profile_response(db, target, profile))
    return _mask(viewer, svc.build_worker_response(db, profile))


# =================================================================== HR: employees without a portal account

@router.post("/workers", response_model=HrEmployeeProfileResponse, status_code=201)
async def create_worker(payload: HrWorkerCreate, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    """Add someone who works for us but has no work email / portal login —
    workshop staff, contract labour. They exist only as an HR record."""
    ensure_tab_action(user, "hr", "employees", "create")
    _drop_ungranted(user, payload, creating=True)
    try:
        profile = svc.upsert_worker(db, None, payload, user)
        ensure_worker_in_scope(db, user, profile)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(profile)
    return _record_response(db, profile, user)


@router.get("/workers/{profile_id}", response_model=HrEmployeeProfileResponse)
async def get_worker(profile_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    profile = svc.get_worker(db, profile_id)
    ensure_worker_in_scope(db, _user, profile)
    return _mask(_user, svc.build_worker_response(db, profile))


@router.patch("/workers/{profile_id}", response_model=HrEmployeeProfileResponse)
async def update_worker(profile_id: int, payload: HrWorkerUpdate, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    ensure_tab_action(user, "hr", "employees", "edit")
    profile = svc.get_worker(db, profile_id)
    ensure_worker_in_scope(db, user, profile)
    _drop_ungranted(user, payload, creating=False)
    try:
        svc.upsert_worker(db, profile, payload, user)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(profile)
    return _record_response(db, profile, user)


# =================================================================== HR: documents of employees without a portal account

def _worker_document_or_404(db: Session, profile: HrEmployeeProfile, document_id: int) -> UserDocument:
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.hr_profile_id == profile.id,
                                             UserDocument.user_id.is_(None)).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} isn't on {profile.full_name or 'this employee'}'s record. It may have been deleted — refresh the page.")
    return document


@router.get("/workers/{profile_id}/documents", response_model=list[UserDocumentResponse])
async def list_worker_documents(profile_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    ensure_feature_action(_user, "hr", "employees", "documents", "view")
    profile = svc.get_worker(db, profile_id)
    ensure_worker_in_scope(db, _user, profile)
    return _with_verifier(db, db.query(UserDocument).filter(UserDocument.hr_profile_id == profile_id, UserDocument.user_id.is_(None))
                          .order_by(UserDocument.id.desc()).all())


@router.post("/workers/{profile_id}/documents/{document_id}/verify", response_model=UserDocumentResponse)
async def verify_worker_document(profile_id: int, document_id: int, payload: DocumentVerifyPayload, db: Session = Depends(get_db),
                                 user: User = Depends(require_hr)):
    """HR marks a document Verified or Rejected (rejection needs remarks)."""
    ensure_feature_action(user, "hr", "employees", "documents", "approve")
    profile = svc.get_worker(db, profile_id)
    ensure_worker_in_scope(db, user, profile)
    return _verify(db, _worker_document_or_404(db, profile, document_id), payload, user, profile.full_name or f"record #{profile_id}")


@router.post("/workers/{profile_id}/documents", response_model=UserDocumentResponse, status_code=201)
async def upload_worker_document(
    profile_id: int,
    file: UploadFile = File(...),
    document_type: str | None = Form(None),
    document_name: str | None = Form(None),
    document_number: str | None = Form(None),
    issue_date: date | None = Form(None),
    expiry_date: date | None = Form(None),
    issuing_authority: str | None = Form(None),
    confidentiality: str | None = Form(None),
    tags: str | None = Form(None),
    remarks: str | None = Form(None),
    checklist_key: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    ensure_feature_action(user, "hr", "employees", "documents", "create")
    profile = svc.get_worker(db, profile_id)
    ensure_worker_in_scope(db, user, profile)
    return await _store_document(
        db, user, file, owner_name=profile.full_name or f"record #{profile_id}", user_id=None, profile_id=profile_id,
        folder_owner=f"record-{profile_id}", document_type=document_type, document_name=document_name,
        document_number=document_number, issue_date=issue_date, expiry_date=expiry_date, issuing_authority=issuing_authority,
        confidentiality=confidentiality, tags=tags, remarks=remarks, checklist_key=checklist_key,
    )


@router.get("/workers/{profile_id}/documents/{document_id}/content")
async def get_worker_document_content(profile_id: int, document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    ensure_feature_action(_user, "hr", "employees", "documents", "export")
    profile = svc.get_worker(db, profile_id)
    ensure_worker_in_scope(db, _user, profile)
    document = _worker_document_or_404(db, profile, document_id)
    _require_sharepoint()
    if not document.sharepoint_path:
        raise HTTPException(status_code=404, detail="This document record has no stored file. Delete it and upload the file again.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
    return _content_response(document, content, content_type)


@router.delete("/workers/{profile_id}/documents/{document_id}")
async def delete_worker_document(profile_id: int, document_id: int, db: Session = Depends(get_db), user: User = Depends(require_hr_edit)):
    ensure_feature_action(user, "hr", "employees", "documents", "delete")
    profile = svc.get_worker(db, profile_id)
    ensure_worker_in_scope(db, user, profile)
    document = _worker_document_or_404(db, profile, document_id)
    # Company delete rule: 'delete' on Employees AND you uploaded it.
    ensure_can_delete(user, SimpleNamespace(created_by_id=document.created_by_id), "hr", "employees", what="employee document")
    if settings.SHAREPOINT_SITE_ID and document.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
        except HTTPException:
            pass  # file already gone in SharePoint — still remove the record
    record_audit(
        db, entity_type="user_document", entity_id=document.id, action="delete", module_key="hr",
        summary=f"Deleted {document.document_type} '{document.document_name}' ({profile.full_name or f'record #{profile_id}'})",
        old_value={"hr_profile_id": profile_id, "document_type": document.document_type, "document_name": document.document_name,
                   "checklist_key": document.checklist_key, "filename": document.filename},
        user_id=user.id,
    )
    db.delete(document)
    db.commit()
    return {"ok": True}


# =================================================================== HR: one employee

@router.get("/{user_id}", response_model=HrEmployeeProfileResponse)
async def get_employee(user_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    target = _get_user_or_404(db, user_id)
    ensure_employee_in_scope(db, _user, target)
    return _mask(_user, svc.build_profile_response(db, target, svc.get_profile(db, user_id)))


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
    ensure_employee_in_scope(db, user, target)
    # Creating the HR profile is 'create' on Employees; changing an existing one is 'edit'.
    ensure_tab_action(user, "hr", "employees", "create" if svc.get_profile(db, user_id) is None else "edit")
    if target.id == user.id:
        raise HTTPException(
            status_code=403,
            detail=(
                "You can't change your own HR record here (reporting manager, grade, status and the like). Ask another HR "
                "user to do it. Your personal contact details can be edited under My HR > Profile."
            ),
        )
    from app.modules.hr.services import assignments as asg

    existing = svc.get_profile(db, user_id)
    _drop_ungranted(user, payload, creating=existing is None)
    before = asg.current_values(target, existing) if existing is not None else None
    try:
        profile = svc.upsert_profile(db, target, payload, user)
        # PA30: an org-field change opens a new assignment slice from today.
        asg.sync_from_profile(db, target, before, asg.current_values(target, profile), actor_id=user.id,
                              source="profile_edit")
    except HTTPException:
        db.rollback()  # drop a half-built new profile / User edits
        raise
    db.commit()
    db.refresh(profile)
    db.refresh(target)
    return _mask(user, svc.build_profile_response(db, target, profile))


# =================================================================== HR: documents

@router.get("/{user_id}/documents", response_model=list[UserDocumentResponse])
async def list_employee_documents(user_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    ensure_feature_action(_user, "hr", "employees", "documents", "view")
    ensure_employee_in_scope(db, _user, _get_user_or_404(db, user_id))
    return _with_verifier(db, db.query(UserDocument).filter(UserDocument.user_id == user_id).order_by(UserDocument.id.desc()).all())


@router.post("/{user_id}/documents/{document_id}/verify", response_model=UserDocumentResponse)
async def verify_employee_document(user_id: int, document_id: int, payload: DocumentVerifyPayload, db: Session = Depends(get_db),
                                   user: User = Depends(require_hr)):
    """HR marks a document Verified or Rejected (rejection needs remarks)."""
    ensure_feature_action(user, "hr", "employees", "documents", "approve")
    target = _get_user_or_404(db, user_id)
    ensure_employee_in_scope(db, user, target)
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} isn't on this employee's record. Refresh the page.")
    return _verify(db, document, payload, user, target.name)


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
    checklist_key: str | None = Form(None, description="Joining-document checklist item this file satisfies"),
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    ensure_feature_action(user, "hr", "employees", "documents", "create")
    target = _get_user_or_404(db, user_id)
    ensure_employee_in_scope(db, user, target)
    return await _store_document(
        db, user, file, owner_name=target.name, user_id=user_id, profile_id=None, folder_owner=str(user_id),
        document_type=document_type, document_name=document_name, document_number=document_number, issue_date=issue_date,
        expiry_date=expiry_date, issuing_authority=issuing_authority, confidentiality=confidentiality, tags=tags,
        remarks=remarks, checklist_key=checklist_key,
    )


@router.get("/{user_id}/documents/{document_id}/content")
async def get_employee_document_content(user_id: int, document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    ensure_feature_action(_user, "hr", "employees", "documents", "export")
    ensure_employee_in_scope(db, _user, _get_user_or_404(db, user_id))
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
    ensure_feature_action(user, "hr", "employees", "documents", "delete")
    ensure_employee_in_scope(db, user, _get_user_or_404(db, user_id))
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} isn't on this employee's record. It may already have been deleted — refresh the Documents tab.")
    # Company delete rule: 'delete' on Employees AND you uploaded it. The proxy
    # stops record_owner_id falling back to user_id (the employee, not the uploader).
    ensure_can_delete(user, SimpleNamespace(created_by_id=document.created_by_id), "hr", "employees", what="employee document")
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
