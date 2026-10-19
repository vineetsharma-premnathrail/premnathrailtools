"""Generate → edit in Word Online workflow for system-generated documents
(see models/managed_document.py for the lifecycle).

Entity-agnostic: each module registers a DocumentAdapter for its record
type (permission check, current revision number, SharePoint folder and a
.docx builder) — see register(). The generic routes in
routes/documents.py then serve every document type the same way, so adding
the workflow to a new document is just an adapter + a builder.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.main.models.managed_document import ManagedDocument, ManagedDocumentEvent
from app.modules.main.models.user import User
from app.utils.docx_diff import compare_docx
from app.utils.sharepoint import (
    sanitize_folder_name, upload_bytes_to_sharepoint, replace_item_content, grant_item_edit_access,
    list_item_versions, download_item, download_item_version,
)

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# (item_id, baseline_version, latest_version) → comparison. Versions are
# immutable once saved, so a result never goes stale; bounded so a long-
# running process doesn't grow without limit.
_changes_cache: dict[tuple[str, str, str], dict] = {}
_CHANGES_CACHE_MAX = 256


@dataclass
class DocumentTarget:
    """One record's document, as its module describes it."""
    entity_id: int
    revision: int          # bumps whenever the record's content changes
    title: str             # "Quotation QT-…-01-r1" — shown in messages and History
    folder: str            # SharePoint folder (build with sharepoint_folder())
    filename_stem: str     # safe file name without extension
    build_docx: Callable[[], bytes]


@dataclass
class DocumentAdapter:
    entity_type: str       # stored on ManagedDocument, used in the URL
    app: str               # module the user needs access to (AVAILABLE_APPS key)
    load: Callable[[Session, int, User, bool], DocumentTarget]  # (db, id, user, modify) — raise 404/403
    # Optional role-level gates (permission ids — tab `m:t:a` or feature
    # `m:t.f:a`): to open / download the Word document, and to create /
    # regenerate / edit / upload it. Checked before `load`; record-level rules
    # stay in `load`.
    view_grant: str | None = None
    edit_grant: str | None = None


_ADAPTERS: dict[str, DocumentAdapter] = {}


def register(adapter: DocumentAdapter) -> None:
    _ADAPTERS[adapter.entity_type] = adapter


def adapter_for(entity_type: str) -> DocumentAdapter:
    adapter = _ADAPTERS.get(entity_type)
    if not adapter:
        raise HTTPException(status_code=404, detail=f"'{entity_type}' is not a document type that supports Word editing.")
    return adapter


def sharepoint_folder(*parts: str) -> str:
    root = settings.SHAREPOINT_FOLDER or "ERP-media"
    return "/".join(sanitize_folder_name(p) for p in (root, *parts) if p)


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "document"


def active_for_revision(db: Session, entity_type: str, entity_id: int, revision: int) -> ManagedDocument | None:
    """The Word document that is the document of record for this revision, if any."""
    doc = get_active(db, entity_type, entity_id)
    return doc if doc and doc.source_revision == revision else None


async def pdf_of_record(db: Session, entity_type: str, entity_id: int, revision: int, render: Callable[[], bytes]) -> bytes:
    """For a module's own "Download PDF": the Word document (edits included)
    once one exists for the current revision, otherwise a fresh render."""
    doc = active_for_revision(db, entity_type, entity_id, revision)
    return await current_pdf(doc) if doc else render()


async def docx_of_record(db: Session, entity_type: str, entity_id: int, revision: int, render: Callable[[], bytes]) -> bytes:
    doc = active_for_revision(db, entity_type, entity_id, revision)
    return await current_docx(doc) if doc else render()


def _site() -> str:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint is not configured on this server (SHAREPOINT_SITE_ID is empty), so editable documents can't be stored. Ask an admin to set it.")
    return settings.SHAREPOINT_SITE_ID


def get_active(db: Session, entity_type: str, entity_id: int) -> ManagedDocument | None:
    return (
        db.query(ManagedDocument)
        .filter(ManagedDocument.entity_type == entity_type, ManagedDocument.entity_id == entity_id)
        .order_by(ManagedDocument.id.desc())
        .first()
    )


def _event(db: Session, doc: ManagedDocument, action: str, user: User, version: str | None = None, note: str | None = None) -> None:
    db.add(ManagedDocumentEvent(document_id=doc.id, action=action, sharepoint_version=version, user_id=user.id, note=note))


async def _latest_version(item_id: str) -> str | None:
    versions = await list_item_versions(_site(), item_id)
    return versions[0]["version"] if versions else None


async def generate(
    db: Session, *, entity_type: str, entity_id: int, source_revision: int, title: str,
    folder: str, filename: str, docx_bytes: bytes, user: User, regenerate: bool = False,
) -> ManagedDocument:
    """Create the Word draft for the entity's current revision. With
    regenerate=True an existing draft is overwritten from the system data —
    its previous content stays recoverable as an older SharePoint version."""
    site = _site()
    active = get_active(db, entity_type, entity_id)
    if active and active.source_revision == source_revision:
        if not regenerate:
            raise HTTPException(status_code=409, detail=f"A Word draft for '{title}' already exists. Open it to edit, or choose Regenerate to rebuild it from the system data (the current draft is kept as an older version).")
        await replace_item_content(site, active.docx_item_id, docx_bytes, DOCX_TYPE)
        _event(db, active, "regenerated", user, await _latest_version(active.docx_item_id), "Rebuilt from system data")
        db.commit()
        db.refresh(active)
        return active

    uploaded = await upload_bytes_to_sharepoint(site, folder, filename, DOCX_TYPE, docx_bytes)
    if not uploaded.get("item_id"):
        raise HTTPException(status_code=502, detail="SharePoint stored the file but returned no item id, so it can't be tracked. Try again.")
    doc = ManagedDocument(
        entity_type=entity_type, entity_id=entity_id, source_revision=source_revision, title=title,
        docx_item_id=uploaded["item_id"], docx_path=uploaded["path"],
        docx_web_url=uploaded.get("webUrl"), created_by_id=user.id,
    )
    db.add(doc)
    db.flush()
    _event(db, doc, "generated", user, await _latest_version(doc.docx_item_id), f"Generated for revision {source_revision}")
    db.commit()
    db.refresh(doc)
    return doc


async def open_for_edit(db: Session, doc: ManagedDocument, user: User) -> str:
    """Grant this user edit rights on the file (once) and return the Word
    Online URL. Edit rights are per person, so every save is attributed."""
    if not doc.docx_web_url:
        raise HTTPException(status_code=502, detail="SharePoint did not return a Word Online link for this document. Regenerate it.")
    already = any(e.action == "edit_access" and e.user_id == user.id for e in doc.events)
    if not already:
        if not user.email:
            raise HTTPException(status_code=400, detail="Your portal account has no email, so SharePoint can't give you edit access. Ask an admin to add your Microsoft 365 email.")
        await grant_item_edit_access(_site(), doc.docx_item_id, user.email)
        _event(db, doc, "edit_access", user, note=f"Edit access granted to {user.email}")
        db.commit()
    return doc.docx_web_url


async def upload_revision(db: Session, doc: ManagedDocument, data: bytes, user: User) -> ManagedDocument:
    """Offline fallback: someone edited a downloaded copy — it goes back in
    as the next version of the same file, never as a loose attachment."""
    if not data.startswith(b"PK\x03\x04"):
        raise HTTPException(status_code=400, detail="That file is not a Word .docx document. Save it as .docx in Word and upload again.")
    await replace_item_content(_site(), doc.docx_item_id, data, DOCX_TYPE)
    _event(db, doc, "uploaded", user, await _latest_version(doc.docx_item_id), "Revised copy uploaded")
    db.commit()
    db.refresh(doc)
    return doc


async def current_pdf(doc: ManagedDocument) -> bytes:
    """The latest Word version rendered to PDF by SharePoint."""
    return await download_item(_site(), doc.docx_item_id, as_pdf=True)


async def changes(doc: ManagedDocument) -> dict:
    """What people changed in Word since the system last built the file
    (generated/regenerated): added/removed lines, images, changed amounts."""
    site = _site()
    builds = [e for e in doc.events if e.action in ("generated", "regenerated") and e.sharepoint_version]
    versions = await list_item_versions(site, doc.docx_item_id)
    if not builds or not versions:
        return {"changed": False}
    baseline, latest = builds[-1].sharepoint_version, versions[0]["version"]
    summary = {"baseline_version": baseline, "latest_version": latest}
    if baseline == latest:
        return {**summary, "changed": False}
    key = (doc.docx_item_id, baseline, latest)
    if key not in _changes_cache:
        old = await download_item_version(site, doc.docx_item_id, baseline)
        new = await download_item(site, doc.docx_item_id)
        try:
            result = compare_docx(old, new)
        except Exception as exc:  # a corrupt/odd upload shouldn't break the card
            raise HTTPException(status_code=422, detail=f"Could not compare the Word versions ({exc.__class__.__name__}). The file may not be a valid .docx — download it and check it opens in Word.")
        if len(_changes_cache) >= _CHANGES_CACHE_MAX:
            _changes_cache.pop(next(iter(_changes_cache)))
        _changes_cache[key] = result
    return {**summary, **_changes_cache[key]}


async def current_docx(doc: ManagedDocument) -> bytes:
    return await download_item(_site(), doc.docx_item_id)


async def state(db: Session, doc: ManagedDocument | None, current_revision: int) -> dict | None:
    """Everything the UI needs: staleness and one merged history —
    SharePoint versions, with versions the portal wrote re-attributed to the
    person who actually triggered them."""
    if doc is None:
        return None
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(
        User.id.in_({e.user_id for e in doc.events if e.user_id})
    )}
    by_version = {e.sharepoint_version: e for e in doc.events if e.sharepoint_version}
    try:
        versions = await list_item_versions(_site(), doc.docx_item_id)
        versions_error = None
    except HTTPException as exc:
        versions, versions_error = [], str(exc.detail)
    labels = {"generated": "Generated by system", "regenerated": "Rebuilt from system data", "uploaded": "Revised copy uploaded"}
    history = []
    for v in versions:
        ev = by_version.get(v["version"])
        history.append({
            "version": v["version"],
            "modified_at": v["modified_at"],
            "modified_by": users.get(ev.user_id, v["modified_by"]) if ev else v["modified_by"],
            "action": labels.get(ev.action, "Edited in Word") if ev else "Edited in Word",
        })
    return {
        "id": doc.id,
        "title": doc.title,
        "source_revision": doc.source_revision,
        "is_stale": current_revision != doc.source_revision,
        "created_at": doc.created_at,
        "versions": history,
        "versions_error": versions_error,
    }
