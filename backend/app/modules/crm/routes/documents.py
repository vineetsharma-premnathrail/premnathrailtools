from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.core.permissions import ensure_can_delete, require_app_access
from app.modules.crm.access import (
    INQ, PARENT_MODELS, can_child_view, ensure_child_action, ensure_own, ensure_parent_in_scope, parent_record, tab_for,
)
from app.modules.main.routes.auth import get_current_user
from app.modules.main.models.user import User
from app.auth.jwt_handler import verify_document_share_token, create_upload_token, verify_upload_token
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.organization import Organization
from app.modules.crm.schemas.document import (
    CrmDocumentResponse, CrmDocumentUploadSessionPayload, CrmDocumentUploadSessionResponse, CrmDocumentCompleteUploadPayload,
)
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    download_file_content, validate_upload_metadata, create_upload_session, verify_direct_upload, get_download_url,
    DIRECT_UPLOAD_CHUNK_BYTES,
)

router = APIRouter(prefix="/crm/documents", tags=["CRM - Documents"])


def _ensure_can_open(db: Session, user: User, doc: CrmDocument) -> None:
    """View on the document's CRM tab and its Organization / Inquiry / Tender
    in the user's data scope — or any logged-in user for a document shared
    through a Technical Offer Request (see get_document_content)."""
    if user.role == "admin":
        return
    if doc.shared_via_tor:
        # The TOR exception is for R&D, who may not have CRM — not for every signed-in user
        # (ids are sequential, so anyone could otherwise walk every TOR document).
        apps = set(user.get_apps())
        if not apps & {"crm", "rnd"}:
            raise HTTPException(status_code=403, detail=(
                "This document was shared with R&D through a Technical Offer Request — opening it needs the CRM or R&D app. "
                "Ask an admin to grant one of them, or ask the sender to share it with you."))
        # Having the app isn't enough: a CRM user still needs the record in
        # their data scope, and an R&D user needs access to that requirement
        # (same rule as R&D's own document opener) — otherwise anyone could
        # walk the sequential ids and read every customer's TOR files.
        crm_error: HTTPException | None = None
        if "crm" in apps:
            try:
                if not can_child_view(user, doc.related_module, "documents"):
                    ensure_child_action(user, doc.related_module, "documents", "view", "view")
                ensure_parent_in_scope(db, user, doc.related_module, doc.related_id)
                return
            except HTTPException as exc:
                crm_error = exc
        if "rnd" in apps:
            from app.modules.rnd.routes.requirement_work import _ensure_can_open as ensure_rnd_can_open
            ensure_rnd_can_open(db, user, doc)
            return
        raise crm_error  # type: ignore[misc]  # set: "crm" is in apps when "rnd" isn't
    # Inquiry / tender documents: Inquiries & Tenders › Documents › View;
    # organization documents: Organizations › View.
    if not can_child_view(user, doc.related_module, "documents"):
        ensure_child_action(user, doc.related_module, "documents", "view", "view")
    ensure_parent_in_scope(db, user, doc.related_module, doc.related_id)


# related_sub_module values owned by R&D / the requirement discussion. Their
# lists match only on (sub_module, sub_id), so a file uploaded here with one of
# them would show up on another requirement's R&D task or discussion message.
_RESERVED_SUB_MODULES = {"rnd_task", "rnd_requirement", "discussion", "rnd_request", "rnd_dept_share"}


def _ensure_upload_target(db: Session, related_module: str | None, related_id: int | None,
                          related_sub_module: str | None) -> None:
    """A CRM upload must hang off a real Organization / Inquiry / Tender (an
    unknown module or a missing record would skip the data-scope check), and
    may not pose as an R&D task / discussion attachment."""
    if related_module not in PARENT_MODELS:
        raise HTTPException(status_code=422, detail=f"Files can only be attached to an organization, inquiry or tender — "
                                                    f"'{related_module}' isn't one of them. Reload the page and upload again.")
    if parent_record(db, related_module, related_id) is None:
        raise HTTPException(status_code=404, detail=f"The {related_module} #{related_id} these files are for wasn't found — "
                                                    "it may have been deleted. Reload the page.")
    if related_sub_module in _RESERVED_SUB_MODULES:
        raise HTTPException(status_code=422, detail="R&D task, requirement and discussion files are attached from those screens "
                                                    "(R&D › Requirements or the Discussion tab), not from CRM Documents.")


@router.get("", response_model=list[CrmDocumentResponse])
async def list_documents(
    related_module: str,
    related_id: int,
    related_sub_module: str | None = None,
    related_sub_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    ensure_child_action(_user, related_module, "documents", "view", "view")
    ensure_parent_in_scope(db, _user, related_module, related_id)
    query = db.query(CrmDocument).filter(
        CrmDocument.related_module == related_module,
        CrmDocument.related_id == related_id,
        CrmDocument.is_deleted == False,  # noqa: E712
    )
    if related_sub_module:
        query = query.filter(CrmDocument.related_sub_module == related_sub_module)
    if related_sub_id:
        query = query.filter(CrmDocument.related_sub_id == related_sub_id)
    return query.order_by(CrmDocument.id.desc()).all()


@router.post("", response_model=list[CrmDocumentResponse])
async def upload_documents(
    related_module: str = Form(...),
    related_id: int = Form(...),
    folder_type: str = Form(...),
    doc_category: str | None = Form(None),
    related_sub_module: str | None = Form(None),
    related_sub_id: int | None = Form(None),
    universal_id: str | None = Form(None),
    org_id: int | None = Form(None),
    description: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    # Attaching files is editing the Organization / Inquiry / Tender they belong to.
    _ensure_upload_target(db, related_module, related_id, related_sub_module)
    ensure_child_action(user, related_module, "documents", "create", "edit")
    ensure_parent_in_scope(db, user, related_module, related_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    org_name = "General"
    if org_id:
        org = db.query(Organization).filter(Organization.id == org_id).first()
        if org:
            org_name = org.name

    folder_path = build_sharepoint_folder_path(
        user.name or user.email or "", org_name, f"crm/{related_module}/{universal_id or related_id}",
        root_folder="CRM-media",
    )

    documents = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        doc = CrmDocument(
            related_module=related_module,
            related_id=related_id,
            related_sub_module=related_sub_module,
            related_sub_id=related_sub_id,
            universal_id=universal_id,
            folder_type=folder_type,
            doc_category=doc_category,
            file_name=result["name"],
            file_path=result["path"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            file_size=result["size"],
            mime_type=f.content_type,
            description=description,
            uploaded_by_name=user.name or user.email,
            org_id=org_id,
            created_by_id=user.id,
        )
        db.add(doc)
        documents.append(doc)

    if documents:
        db.flush()
        for d in documents:
            db.refresh(d)
    db.commit()
    return documents


def _crm_folder(db: Session, user: User, related_module: str, related_id: int, universal_id: str | None, org_id: int | None) -> str:
    """Same folder the regular upload uses, so both paths file side by side."""
    org_name = "General"
    if org_id:
        org = db.query(Organization).filter(Organization.id == org_id).first()
        if org:
            org_name = org.name
    return build_sharepoint_folder_path(
        user.name or user.email or "", org_name, f"crm/{related_module}/{universal_id or related_id}",
        root_folder="CRM-media",
    )


@router.post("/upload-session", response_model=CrmDocumentUploadSessionResponse)
async def start_direct_upload(
    payload: CrmDocumentUploadSessionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    """Large files (up to 100 GB) go straight from the browser to SharePoint
    in chunks, never through the portal. This opens the upload session in the
    document's folder and signs what it was opened for."""
    ensure_child_action(user, payload.related_module, "documents", "create", "edit")
    ensure_parent_in_scope(db, user, payload.related_module, payload.related_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    file_name = validate_upload_metadata(payload.file_name, payload.file_size, payload.content_type)
    folder = _crm_folder(db, user, payload.related_module, payload.related_id, payload.universal_id, payload.org_id)
    session = await create_upload_session(settings.SHAREPOINT_SITE_ID, folder, file_name)
    token = create_upload_token({
        "user_id": user.id, "folder": folder, "file_name": file_name, "file_size": payload.file_size,
        "content_type": payload.content_type, "related_module": payload.related_module, "related_id": payload.related_id,
        "universal_id": payload.universal_id, "org_id": payload.org_id,
    })
    return CrmDocumentUploadSessionResponse(
        upload_url=session["upload_url"], upload_token=token, chunk_size=DIRECT_UPLOAD_CHUNK_BYTES,
        file_name=file_name, expires_at=session.get("expires_at"),
    )


@router.post("/complete-upload", response_model=CrmDocumentResponse)
async def complete_direct_upload(
    payload: CrmDocumentCompleteUploadPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    """Records a file the browser finished uploading to SharePoint, after
    checking it is exactly what the session was opened for."""
    claims = verify_upload_token(payload.upload_token)
    if not claims:
        raise HTTPException(status_code=400, detail="This upload link has expired or is invalid. Start the upload again.")
    if claims.get("user_id") != user.id:
        raise HTTPException(status_code=403, detail="This upload was started by a different user.")
    _ensure_upload_target(db, claims.get("related_module"), claims.get("related_id"), payload.related_sub_module)
    ensure_child_action(user, claims.get("related_module"), "documents", "create", "edit")
    ensure_parent_in_scope(db, user, claims.get("related_module"), claims.get("related_id"))
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    result = await verify_direct_upload(
        settings.SHAREPOINT_SITE_ID, payload.drive_item_id, claims["folder"], claims["file_size"], claims.get("content_type"),
    )
    doc = CrmDocument(
        related_module=claims["related_module"],
        related_id=claims["related_id"],
        related_sub_module=payload.related_sub_module,
        related_sub_id=payload.related_sub_id,
        universal_id=claims.get("universal_id"),
        folder_type=payload.folder_type,
        doc_category=payload.doc_category,
        file_name=result["name"],
        file_path=result["path"],
        sharepoint_path=result["path"],
        sharepoint_url=result.get("webUrl"),
        file_size=result["size"],
        mime_type=claims.get("content_type"),
        description=payload.description,
        uploaded_by_name=user.name or user.email,
        org_id=claims.get("org_id"),
        created_by_id=user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/{document_id}/download-url")
async def get_document_download_url(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Short-lived direct SharePoint link, for files too large to stream
    through the portal. Same access rule as /content (crm module, or a
    document shared via a Technical Offer Request)."""
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    _ensure_can_open(db, user, doc)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    return {"url": await get_download_url(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or ""), "file_name": doc.file_name}


@router.get("/{document_id}/shared-content")
async def get_shared_document_content(
    document_id: int,
    token: str,
    db: Session = Depends(get_db),
):
    """Unauthenticated document fetch for recipients with no portal account at
    all (e.g. external vendors on a Technical Offer Request email) — the
    signed `token` (see create_document_share_token) is the only credential,
    scoped to this exact document id and time-limited. Still never exposes
    the raw SharePoint webUrl; bytes are fetched server-side with the
    app-only Graph token same as get_document_content below."""
    if not verify_document_share_token(token, "crm_document", document_id):
        raise HTTPException(status_code=403, detail="This link is invalid or has expired.")
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(
        content=content,
        media_type=doc.mime_type or content_type,
        headers={
            "Content-Disposition": f'inline; filename="{doc.file_name}"',
            # The token sits in this URL: never forward it in a Referer, never index it.
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex, nofollow",
        },
    )


@router.get("/{document_id}/content")
async def get_document_content(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Raw bytes for in-app viewing (img/pdf tags, or a same-origin download),
    fetched via the app-only Graph token — never the raw SharePoint webUrl,
    which bypasses our own auth and exposes the SharePoint folder structure
    to anyone who has or guesses the link.

    Access check: normal CRM documents still require the 'crm' module grant.
    One exception, because these get emailed cross-department to R&D (who
    may not have 'crm' access at all) — any logged-in portal user can fetch
    a document *by its specific id* when it was actually shared as part of a
    Technical Offer Request (the generated TOR PDF itself, or one of the
    reference documents the sender explicitly picked via body.document_ids —
    see inquiries.py/tenders.py technical-offer-request, which set
    shared_via_tor on exactly those rows). This is narrower than opening
    module access wide: you still need the id from a real email, only the
    docs actually attached to that email qualify, and the doc list/other CRM
    data stays behind the normal 'crm' gate."""
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    _ensure_can_open(db, user, doc)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(
        content=content,
        media_type=doc.mime_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.file_name}"'},
    )


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    ensure_parent_in_scope(db, user, doc.related_module, doc.related_id)
    if tab_for(doc.related_module) == INQ:
        ensure_child_action(user, doc.related_module, "documents", "delete", "delete")
        ensure_own(user, doc, "document")
    else:
        ensure_can_delete(user, doc, "crm", tab_for(doc.related_module), what="document")

    # A document shared into a requirement discussion is a second row pointing
    # at the same file — keep the file while any other row still uses it.
    still_used = doc.sharepoint_path and db.query(CrmDocument.id).filter(
        CrmDocument.sharepoint_path == doc.sharepoint_path, CrmDocument.id != doc.id,
        CrmDocument.is_deleted == False,  # noqa: E712
    ).first()
    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path and not still_used:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Document deleted"}
