"""Revision workflow: draft edits and files, submit → check → approve/release,
returns, recall, discard. Every state change row-locks the revision (so a
double-click can't release twice) and returns the refreshed document
detail, so the UI just swaps its state."""
import mimetypes
from datetime import datetime, timezone
from urllib.parse import quote
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.design.models.change_notice import DesignChangeNotice
from app.modules.design.models.document import (
    DesignDocument, DesignDocumentRevision, DesignRevisionFile, DESIGN_FILE_ROLES,
)
from app.modules.design.routes.documents import document_detail, get_document, validate_ecn_link
from app.modules.design.schemas.document import DesignDocumentDetail
from app.modules.design.schemas.revision import (
    DesignRevisionDecisionPayload, DesignRevisionRecallPayload, DesignRevisionSubmitPayload, DesignRevisionUpdate,
)
from app.modules.design.service import (
    add_event, check_approve, check_discard_revision, check_manage_draft, check_recall, check_review, ensure,
    notify, ref, released_revision, user_name, utcnow, validate_signatories,
)
from app.modules.main.models.user import User
from app.utils.sharepoint import (
    delete_file_from_sharepoint, download_file_content, sanitize_folder_name, upload_file_to_sharepoint,
)

router = APIRouter(
    prefix="/design/revisions", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't set up on this server (SharePoint site ID missing), so design files can't be "
    "uploaded or opened. Ask IT to set SHAREPOINT_SITE_ID in the backend configuration."
)
# Browsers may render these inline; everything else (CAD, Office, zip) is
# served as a download, with a server-derived type rather than the one the
# uploader's browser claimed.
_INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/bmp", "image/webp"}
_NOTIFY_ENTITY = "design_document"


def _load(db: Session, revision_id: int, lock: bool = False) -> tuple[DesignDocument, DesignDocumentRevision]:
    if lock:
        db.query(DesignDocumentRevision.id).filter(DesignDocumentRevision.id == revision_id).with_for_update().first()
    rev = db.query(DesignDocumentRevision).populate_existing().filter(
        DesignDocumentRevision.id == revision_id, DesignDocumentRevision.is_deleted == False  # noqa: E712
    ).first()
    if not rev:
        raise HTTPException(status_code=404, detail=f"Revision #{revision_id} not found — it may have been discarded.")
    doc = get_document(db, rev.document_id, lock=lock)
    rev = next(r for r in doc.revisions if r.id == rev.id)
    return doc, rev


def _person(db: Session, user_id: int | None) -> User | None:
    return db.query(User).filter(User.id == user_id).first() if user_id else None


def _content_disposition(kind: str, filename: str) -> str:
    """ASCII fallback + RFC 5987 UTF-8 name, so a Devanagari or accented
    filename doesn't blow up the (latin-1) response header."""
    ascii_name = filename.encode("ascii", "ignore").decode() or "download"
    ascii_name = ascii_name.replace('"', "")
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


# ---------------------------------------------------------------------------
# Draft editing
# ---------------------------------------------------------------------------

@router.patch("/{revision_id}", response_model=DesignDocumentDetail)
async def update_revision(
    revision_id: int,
    payload: DesignRevisionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc, rev = _load(db, revision_id, lock=True)
    ensure(check_manage_draft(user, doc, rev))
    changes = payload.model_dump(exclude_unset=True)
    reviewer_id = changes.get("reviewer_id", rev.reviewer_id)
    approver_id = changes.get("approver_id", rev.approver_id)
    validate_signatories(db, rev.created_by_id, reviewer_id, approver_id)
    if "ecn_id" in changes:
        validate_ecn_link(db, doc, changes["ecn_id"])
    if "change_summary" in changes:
        changes["change_summary"] = (changes["change_summary"] or "").strip() or None
        if rev.revision_index > 0 and not changes["change_summary"]:
            raise HTTPException(status_code=400, detail=f"{ref(doc, rev)} needs a change summary — say what changed from the previous revision and why.")
    changed = [k for k, v in changes.items() if getattr(rev, k) != v]
    for key in changed:
        setattr(rev, key, changes[key])
    if changed:
        add_event(db, "revision_updated", user, document_id=doc.id, revision_id=rev.id,
                  comment="Changed " + ", ".join(k.replace("_id", "").replace("_", " ") for k in changed))
    db.commit()
    return document_detail(db, doc, user)


@router.delete("/{revision_id}", response_model=DesignDocumentDetail)
async def discard_revision(
    revision_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc, rev = _load(db, revision_id, lock=True)
    ensure(check_discard_revision(user, doc, rev))
    now = datetime.now(timezone.utc)
    paths = []
    for f in rev.files:
        if not f.is_deleted:
            f.is_deleted, f.deleted_at = True, now
            if f.sharepoint_path:
                paths.append(f.sharepoint_path)
    rev.is_deleted, rev.deleted_at = True, now
    add_event(db, "revision_discarded", user, document_id=doc.id, revision_id=rev.id)
    db.commit()
    if settings.SHAREPOINT_SITE_ID:
        for path in paths:
            try:
                await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, path)
            except Exception:
                pass  # the draft is discarded either way; an orphaned file is harmless
    return document_detail(db, doc, user)


@router.post("/{revision_id}/files", response_model=DesignDocumentDetail)
async def upload_files(
    revision_id: int,
    files: list[UploadFile] = File(...),
    file_role: str = Form("primary"),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc, rev = _load(db, revision_id)
    ensure(check_manage_draft(user, doc, rev))
    if file_role not in DESIGN_FILE_ROLES:
        raise HTTPException(status_code=400, detail=f"'{file_role}' isn't a valid file role. Choose one of: {', '.join(DESIGN_FILE_ROLES)}.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    if not files:
        raise HTTPException(status_code=400, detail="No files were attached — pick at least one file to upload.")

    # SharePoint uploads use conflictBehavior=replace, so a second file with
    # the same name in the same revision folder would silently overwrite the
    # first. Refuse it instead.
    existing = {f.file_name.lower() for f in rev.files if not f.is_deleted}
    incoming: set[str] = set()
    for f in files:
        name = sanitize_folder_name(f.filename or "attachment").lower()
        if name in existing:
            raise HTTPException(status_code=409, detail=f"{ref(doc, rev)} already has a file named '{f.filename}'. Remove the old one first, or rename the new file.")
        if name in incoming:
            raise HTTPException(status_code=400, detail=f"'{f.filename}' was selected twice — pick each file once.")
        incoming.add(name)

    folder = f"Design-media/{sanitize_folder_name(doc.doc_number)}/{rev.revision_label}"
    uploaded: list[str] = []
    failure: str | None = None
    for f in files:
        try:
            result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        except HTTPException as exc:
            failure = f"'{f.filename}' failed: {exc.detail}"
            break
        except Exception as exc:  # network / Graph outage
            failure = f"'{f.filename}' failed: SharePoint didn't respond ({exc.__class__.__name__}). Try again in a minute."
            break
        mime = mimetypes.guess_type(result["name"])[0] or "application/octet-stream"
        db.add(DesignRevisionFile(
            revision_id=rev.id, file_role=file_role, file_name=result["name"], sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"), file_size=result["size"], mime_type=mime, uploaded_by_id=user.id,
        ))
        uploaded.append(result["name"])

    if uploaded:
        add_event(db, "file_added", user, document_id=doc.id, revision_id=rev.id, comment=", ".join(uploaded))
        db.commit()
    if failure:
        done = f"Uploaded {', '.join(uploaded)}, but " if uploaded else ""
        raise HTTPException(status_code=400, detail=f"{done}{failure} Nothing after it was uploaded — try those files again.")
    return document_detail(db, doc, user)


@router.delete("/{revision_id}/files/{file_id}", response_model=DesignDocumentDetail)
async def remove_file(
    revision_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc, rev = _load(db, revision_id)
    ensure(check_manage_draft(user, doc, rev))
    target = next((f for f in rev.files if f.id == file_id and not f.is_deleted), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"File #{file_id} isn't on {ref(doc, rev)} — it may already have been removed.")
    target.is_deleted, target.deleted_at = True, datetime.now(timezone.utc)
    add_event(db, "file_removed", user, document_id=doc.id, revision_id=rev.id, comment=target.file_name)
    db.commit()
    if settings.SHAREPOINT_SITE_ID and target.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, target.sharepoint_path)
        except Exception:
            pass  # draft file; the DB removal stands
    return document_detail(db, doc, user)


@router.get("/files/{file_id}/content")
async def get_file_content(
    file_id: int,
    download: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Streams a revision file through the app-only Graph token — never the
    raw SharePoint URL (same pattern as rnd/quality documents). Superseded
    revisions stay retrievable; the UI labels them as not for use."""
    f = db.query(DesignRevisionFile).filter(DesignRevisionFile.id == file_id, DesignRevisionFile.is_deleted == False).first()  # noqa: E712
    rev = db.query(DesignDocumentRevision).filter(DesignDocumentRevision.id == f.revision_id, DesignDocumentRevision.is_deleted == False).first() if f else None  # noqa: E712
    doc = db.query(DesignDocument).filter(DesignDocument.id == rev.document_id, DesignDocument.is_deleted == False).first() if rev else None  # noqa: E712
    if not (f and rev and doc):
        raise HTTPException(status_code=404, detail=f"File #{file_id} not found — it may have been removed from its revision.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    content, _claimed = await download_file_content(settings.SHAREPOINT_SITE_ID, f.sharepoint_path or "")
    mime = mimetypes.guess_type(f.file_name)[0] or "application/octet-stream"
    kind = "inline" if mime in _INLINE_TYPES and not download else "attachment"
    return Response(
        content=content,
        media_type=mime,
        headers={"Content-Disposition": _content_disposition(kind, f.file_name), "X-Content-Type-Options": "nosniff"},
    )


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------

@router.post("/{revision_id}/submit", response_model=DesignDocumentDetail)
async def submit_revision(
    revision_id: int,
    payload: DesignRevisionSubmitPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc, rev = _load(db, revision_id, lock=True)
    ensure(check_manage_draft(user, doc, rev))
    if payload.reviewer_id:
        rev.reviewer_id = payload.reviewer_id
    if payload.approver_id:
        rev.approver_id = payload.approver_id
    if not rev.reviewer_id or not rev.approver_id:
        missing = " and ".join(x for x, v in (("a checker", rev.reviewer_id), ("an approver", rev.approver_id)) if not v)
        raise HTTPException(status_code=400, detail=f"Name {missing} before submitting {ref(doc, rev)} — they're the two people who sign it off.")
    validate_signatories(db, rev.created_by_id, rev.reviewer_id, rev.approver_id)
    if not any(not f.is_deleted for f in rev.files):
        raise HTTPException(status_code=400, detail=f"{ref(doc, rev)} has no files yet. Upload the drawing/document itself before submitting it for review.")
    if rev.revision_index > 0 and not (rev.change_summary or "").strip():
        raise HTTPException(status_code=400, detail=f"{ref(doc, rev)} needs a change summary — say what changed from the previous revision and why.")
    if rev.ecn_id:
        ecn = db.query(DesignChangeNotice).filter(DesignChangeNotice.id == rev.ecn_id).first()
        if not ecn or ecn.is_deleted or ecn.status != "approved":
            number = ecn.ecn_number if ecn else f"ECN #{rev.ecn_id}"
            raise HTTPException(status_code=409, detail=f"{ref(doc, rev)} is linked to {number}, which is no longer approved and open. Unlink it (or link the right ECN) before submitting.")

    rev.status = "in_review"
    rev.submitted_at = utcnow()
    # Fresh signatures for this cycle — a previous return's decisions live on
    # in the event timeline.
    rev.reviewed_by_id = rev.reviewed_at = rev.review_comment = None
    rev.approved_by_id = rev.approved_at = rev.approval_comment = None
    add_event(db, "submitted", user, document_id=doc.id, revision_id=rev.id, comment=payload.comment)
    notify(
        db, rev.reviewer_id, user, f"Design check needed: {ref(doc, rev)}",
        f"{user_name(user)} submitted {ref(doc, rev)} ({doc.title}) for your check.",
        "design_review_requested", _NOTIFY_ENTITY, doc.id,
    )
    db.commit()
    return document_detail(db, doc, user)


@router.post("/{revision_id}/recall", response_model=DesignDocumentDetail)
async def recall_revision(
    revision_id: int,
    payload: DesignRevisionRecallPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc, rev = _load(db, revision_id, lock=True)
    ensure(check_recall(user, doc, rev))
    waiting_on = rev.reviewer_id if rev.status == "in_review" else rev.approver_id
    rev.status = "draft"
    add_event(db, "recalled", user, document_id=doc.id, revision_id=rev.id, comment=payload.comment)
    notify(
        db, waiting_on, user, f"Recalled: {ref(doc, rev)}",
        f"{user_name(user)} recalled {ref(doc, rev)} to draft — no action is needed from you for now.",
        "design_revision_recalled", _NOTIFY_ENTITY, doc.id,
    )
    db.commit()
    return document_detail(db, doc, user)


@router.post("/{revision_id}/review", response_model=DesignDocumentDetail)
async def review_revision(
    revision_id: int,
    payload: DesignRevisionDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc, rev = _load(db, revision_id, lock=True)
    ensure(check_review(user, doc, rev, _person(db, rev.reviewer_id)))
    comment = (payload.comment or "").strip() or None
    rev.reviewed_by_id = user.id
    rev.reviewed_at = utcnow()
    rev.review_comment = comment
    if payload.decision == "return":
        if not comment:
            raise HTTPException(status_code=400, detail=f"Say what needs fixing when returning {ref(doc, rev)} — the author sees your comment.")
        rev.status = "draft"
        rev.returned_count += 1
        add_event(db, "review_returned", user, document_id=doc.id, revision_id=rev.id, comment=comment)
        notify(
            db, rev.created_by_id, user, f"Returned by checker: {ref(doc, rev)}",
            f"{user_name(user)} returned {ref(doc, rev)} to you: {comment}",
            "design_revision_returned", _NOTIFY_ENTITY, doc.id,
        )
    else:
        rev.status = "in_approval"
        add_event(db, "review_passed", user, document_id=doc.id, revision_id=rev.id, comment=comment)
        notify(
            db, rev.approver_id, user, f"Design approval needed: {ref(doc, rev)}",
            f"{user_name(user)} checked {ref(doc, rev)} ({doc.title}) — it's now waiting for your approval.",
            "design_approval_requested", _NOTIFY_ENTITY, doc.id,
        )
    db.commit()
    return document_detail(db, doc, user)


@router.post("/{revision_id}/approve", response_model=DesignDocumentDetail)
async def approve_revision(
    revision_id: int,
    payload: DesignRevisionDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc, rev = _load(db, revision_id, lock=True)
    ensure(check_approve(user, doc, rev, _person(db, rev.approver_id)))
    comment = (payload.comment or "").strip() or None
    now = utcnow()
    if payload.decision == "return":
        if not comment:
            raise HTTPException(status_code=400, detail=f"Say what needs fixing when returning {ref(doc, rev)} — the author sees your comment.")
        rev.status = "draft"
        rev.returned_count += 1
        rev.approval_comment = comment
        add_event(db, "approval_returned", user, document_id=doc.id, revision_id=rev.id, comment=comment)
        for recipient in {rev.created_by_id, rev.reviewed_by_id}:
            notify(
                db, recipient, user, f"Returned by approver: {ref(doc, rev)}",
                f"{user_name(user)} returned {ref(doc, rev)} to draft: {comment}",
                "design_revision_returned", _NOTIFY_ENTITY, doc.id,
            )
        db.commit()
        return document_detail(db, doc, user)

    previous = released_revision(doc)
    if previous:
        previous.status = "superseded"
        previous.superseded_at = now
        add_event(db, "superseded", user, document_id=doc.id, revision_id=previous.id, comment=f"Superseded by {rev.revision_label}")
    rev.status = "released"
    rev.approved_by_id = user.id
    rev.approved_at = now
    rev.approval_comment = comment
    rev.released_at = now
    add_event(db, "approved_released", user, document_id=doc.id, revision_id=rev.id, comment=comment)
    if rev.ecn_id:
        add_event(db, "document_released", user, ecn_id=rev.ecn_id, document_id=doc.id, revision_id=rev.id, comment=ref(doc, rev))
    for recipient in {rev.created_by_id, rev.reviewed_by_id, doc.owner_id}:
        notify(
            db, recipient, user, f"Released: {ref(doc, rev)}",
            f"{user_name(user)} approved {ref(doc, rev)} ({doc.title}). It is now the controlled revision"
            + (f"; {previous.revision_label} is superseded." if previous else "."),
            "design_revision_released", _NOTIFY_ENTITY, doc.id,
        )
    db.commit()
    return document_detail(db, doc, user)
