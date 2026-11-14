"""CRM › Knowledge Hub: nested folders, documents with versions (files live in SharePoint), links to
products / projects / customers, favourites, share and product resources.

Permission tab `crm:sales_library` (view / create / edit / delete); folders flagged Confidential (and
everything under one) are hidden unless the user is an admin or holds `crm:sales_library.confidential:view`.
The library is company-wide: no per-record data scope, deny-by-default comes from the tab permission."""
import uuid
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.jwt_handler import create_upload_token, verify_upload_token
from app.core.config import settings
from app.core.permission_registry import can_view_tab, is_admin_user
from app.core.permissions import ensure_can_delete, ensure_tab_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.crm.models.library import (
    LibraryDocument, LibraryDocumentLink, LibraryDocumentVersion, LibraryFavorite, LibraryFolder,
)
from app.modules.crm.models.organization import Organization
from app.modules.crm.schemas.library import (
    LibraryCompleteUploadPayload, LibraryDocumentPatch, LibraryDocumentResponse, LibraryFolderCreate,
    LibraryFolderResponse, LibraryFolderUpdate, LibraryPickerItem, LibraryProductResourceGroup,
    LibrarySharePayload, LibrarySummaryResponse, LibraryUploadSessionPayload, LibraryUploadSessionResponse,
)
from app.modules.crm.services import library as lib
from app.modules.main.models.user import User
from app.modules.products.models.product import FinishedProduct
from app.modules.projects.models.project import PmProject
from app.utils.notifications import notify_user
from app.utils.sharepoint import (
    DIRECT_UPLOAD_CHUNK_BYTES, create_upload_session, download_file_content, get_download_url,
    delete_drive_item, validate_upload_metadata, verify_direct_upload,
)

router = APIRouter(prefix="/crm/library", tags=["CRM - Knowledge Hub"])

MODULE, TAB = lib.MODULE, lib.TAB
_VIEW = require_tab_access(MODULE, TAB)
_CREATE = require_tab_action(MODULE, TAB, "create")
_EDIT = require_tab_action(MODULE, TAB, "edit")

UPLOAD_KIND = "sales_library"
SHARE_NOTIFICATION = "crm_library_share"
SHARE_ENTITY = "crm_library_document"


def _need_site() -> None:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=(
            "SharePoint is not configured on this server, so Knowledge Hub files can't be stored or opened. "
            "Ask IT to set the SharePoint site for the portal."))


def _get_doc(db: Session, user: User, document_id: int, folders: dict[int, LibraryFolder] | None = None) -> LibraryDocument:
    """A live document the user may open (one neutral 404 when missing or inside a Confidential folder they can't open)."""
    doc = db.query(LibraryDocument).filter(LibraryDocument.id == document_id, LibraryDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail=lib.NOT_FOUND_OR_HIDDEN)
    lib.ensure_document_visible(folders if folders is not None else lib.live_folders(db), user, doc)
    return doc


def _existing_links(db: Session, document_id: int | None) -> set[tuple[str, int]]:
    if document_id is None:
        return set()
    return {(r.link_type, r.link_id) for r in db.query(LibraryDocumentLink).filter(LibraryDocumentLink.document_id == document_id).all()}


def _commit_or_conflict(db: Session, name: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=lib.NAME_TAKEN_NEUTRAL)


def _ensure_name_free(folders: dict[int, LibraryFolder], user: User, parent_id: int | None, name: str,
                      ignore_id: int | None = None) -> None:
    """409 when a live sibling already has this name. A clash with a folder the user can't see gets a neutral message
    (it must not reveal that a hidden folder exists or what it is called)."""
    key = name.strip().lower()
    clash = next((f for f in folders.values()
                  if f.parent_id == parent_id and f.name.strip().lower() == key and f.id != ignore_id), None)
    if clash is None:
        return
    if lib.is_confidential_folder(folders, clash.id) and not lib.sees_confidential(user):
        raise HTTPException(status_code=409, detail=lib.NAME_TAKEN_NEUTRAL)
    raise HTTPException(status_code=409, detail=(
        f"A folder named '{clash.name}' already exists in that place. Pick another name or open the existing folder."))


def _ensure_not_builtin(folder: LibraryFolder, user: User, what: str) -> None:
    """Folders with no creator (the seeded top folders) can only be renamed, moved or deleted by an admin."""
    if folder.created_by_id is None and not is_admin_user(user):
        raise HTTPException(status_code=403, detail=(
            f"'{folder.name}' is a built-in Knowledge Hub folder — only an admin can {what} it. "
            "Ask an admin, or create your own folder instead."))


def _folder_name(raw: str | None) -> str:
    name = " ".join((raw or "").split())
    if not name:
        raise HTTPException(status_code=422, detail="Folder name is required — type a name such as 'Catalogues'.")
    if len(name) > 150:
        raise HTTPException(status_code=422, detail=f"Folder name is {len(name)} characters; the limit is 150 — shorten it.")
    return name


def _check_product(db: Session, product_id: int | None) -> None:
    if product_id is not None and db.get(FinishedProduct, product_id) is None:
        raise HTTPException(status_code=422, detail=(
            f"Product #{product_id} was not found — it may have been deleted. Pick the product again or leave it empty."))


def _folder_out(f: LibraryFolder, count: int, product_names: dict[int, str]) -> dict:
    return {
        "id": f.id, "parent_id": f.parent_id, "name": f.name, "description": f.description, "product_id": f.product_id,
        "product_name": product_names.get(f.product_id) if f.product_id else None,
        "is_confidential": bool(f.is_confidential), "is_pricing": bool(f.is_pricing), "sort_order": f.sort_order or 0,
        "document_count": count, "created_by_id": f.created_by_id,
    }


def _folder_response(db: Session, f: LibraryFolder) -> dict:
    names = {}
    if f.product_id:
        p = db.get(FinishedProduct, f.product_id)
        names[f.product_id] = p.name if p else None
    count = db.query(func.count(LibraryDocument.id)).filter(
        LibraryDocument.folder_id == f.id, LibraryDocument.is_deleted == False).scalar() or 0  # noqa: E712
    return _folder_out(f, count, names)


def _document_response(db: Session, user: User, doc: LibraryDocument, folders: dict[int, LibraryFolder] | None = None) -> dict:
    return lib.serialize_documents(db, user, [doc], folders if folders is not None else lib.live_folders(db), with_versions=True)[0]


# ── Summary ──────────────────────────────────────────────────────────────
@router.get("/summary", response_model=LibrarySummaryResponse)
async def library_summary(db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    folders = lib.live_folders(db)
    hidden = lib.hidden_folder_ids(folders, user)
    base = lib.visible_documents_query(db, user, folders)
    today, soon = lib.expiring_window()
    recent = base.order_by(LibraryDocument.created_at.desc(), LibraryDocument.id.desc()).limit(8).all()
    return {
        "folders": len(folders) - len(hidden),
        "documents": base.count(),
        "videos": base.filter(LibraryDocument.file_kind == "video").count(),
        "expired": base.filter(LibraryDocument.expiry_date < today).count(),
        "expiring_30d": base.filter(LibraryDocument.expiry_date >= today, LibraryDocument.expiry_date <= soon).count(),
        "recent": lib.serialize_documents(db, user, recent, folders),
    }


# ── Folders ──────────────────────────────────────────────────────────────
@router.get("/folders", response_model=list[LibraryFolderResponse])
async def list_folders(db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    folders = lib.live_folders(db)
    hidden = lib.hidden_folder_ids(folders, user)
    counts = dict(db.query(LibraryDocument.folder_id, func.count(LibraryDocument.id)).filter(
        LibraryDocument.is_deleted == False).group_by(LibraryDocument.folder_id).all())  # noqa: E712
    product_ids = {f.product_id for f in folders.values() if f.product_id}
    names = {p.id: p.name for p in db.query(FinishedProduct).filter(FinishedProduct.id.in_(product_ids)).all()} if product_ids else {}
    rows = sorted((f for f in folders.values() if f.id not in hidden), key=lambda f: (f.sort_order or 0, f.name.lower(), f.id))
    return [_folder_out(f, counts.get(f.id, 0), names) for f in rows]


@router.post("/folders", response_model=LibraryFolderResponse)
async def create_folder(payload: LibraryFolderCreate, db: Session = Depends(get_db), user: User = Depends(_CREATE)):
    name = _folder_name(payload.name)
    folders = lib.live_folders(db)
    parent = lib.ensure_folder_visible(folders, user, payload.parent_id) if payload.parent_id is not None else None
    _check_product(db, payload.product_id)
    # A folder inside a Confidential folder is itself Confidential.
    inherits = parent is not None and lib.is_confidential_folder(folders, parent.id)
    if payload.is_confidential and not lib.sees_confidential(user):
        raise HTTPException(status_code=403, detail=(
            "Only people with the 'Confidential folders' permission can mark a folder Confidential (they are the only ones who could open it again). "
            + lib.GRANT_CONFIDENTIAL_HINT))
    _ensure_name_free(folders, user, payload.parent_id, name)
    folder = LibraryFolder(
        parent_id=payload.parent_id, name=name, description=(payload.description or "").strip() or None,
        product_id=payload.product_id, is_confidential=bool(payload.is_confidential or inherits),
        is_pricing=payload.is_pricing, sort_order=payload.sort_order if payload.sort_order is not None else 100,
        created_by_id=user.id,
    )
    db.add(folder)
    _commit_or_conflict(db, name)
    db.refresh(folder)
    return _folder_response(db, folder)


@router.patch("/folders/{folder_id}", response_model=LibraryFolderResponse)
async def update_folder(folder_id: int, payload: LibraryFolderUpdate, db: Session = Depends(get_db), user: User = Depends(_EDIT)):
    folders = lib.live_folders(db)
    folder = lib.ensure_folder_visible(folders, user, folder_id)
    data = payload.model_dump(exclude_unset=True)

    name = _folder_name(data["name"]) if "name" in data else folder.name
    new_parent_id = data["parent_id"] if "parent_id" in data else folder.parent_id
    moved = "parent_id" in data and new_parent_id != folder.parent_id
    if name != folder.name:
        _ensure_not_builtin(folder, user, "rename")
    if moved:
        _ensure_not_builtin(folder, user, "move")

    if "parent_id" in data and new_parent_id is not None:
        target = lib.ensure_folder_visible(folders, user, new_parent_id)
        if new_parent_id in lib.descendant_ids(folders, folder.id):
            raise HTTPException(status_code=422, detail=(
                f"Moving '{folder.name}' into '{target.name}' would create a loop — a folder can't sit inside itself or one of "
                "its own sub-folders. Pick a different parent folder."))
    _ensure_name_free(folders, user, new_parent_id, name, ignore_id=folder.id)
    if "product_id" in data:
        _check_product(db, data["product_id"])
    if "is_confidential" in data and bool(data["is_confidential"]) != bool(folder.is_confidential) and not lib.sees_confidential(user):
        raise HTTPException(status_code=403, detail=(
            "Only people with the 'Confidential folders' permission can change whether a folder is Confidential. "
            + lib.GRANT_CONFIDENTIAL_HINT))

    # A folder that becomes pricing (itself or through its new parent) needs an expiry date on every file inside it.
    was_pricing = lib.is_pricing_folder(folders, folder.id)
    will_be_pricing = bool(data.get("is_pricing", folder.is_pricing)) or (
        new_parent_id is not None and lib.is_pricing_folder(folders, new_parent_id))
    if will_be_pricing and (not was_pricing or moved):
        missing = lib.docs_without_expiry(db, lib.descendant_ids(folders, folder.id))
        if missing:
            raise HTTPException(status_code=422, detail=(
                f"{missing} document(s) in '{folder.name}' have no expiry date, and pricing folders need one on every file. "
                "Open each document, set the date its price stops being valid, then make the folder a pricing folder."))

    if "description" in data:
        folder.description = (data["description"] or "").strip() or None
    if "product_id" in data:
        folder.product_id = data["product_id"]
    if "sort_order" in data and data["sort_order"] is not None:
        folder.sort_order = data["sort_order"]
    if "is_pricing" in data and data["is_pricing"] is not None:
        folder.is_pricing = data["is_pricing"]
    if "is_confidential" in data and data["is_confidential"] is not None:
        folder.is_confidential = data["is_confidential"]
    folder.name = name
    folder.parent_id = new_parent_id
    if moved and new_parent_id is not None and lib.is_confidential_folder(folders, new_parent_id):
        folder.is_confidential = True
    _commit_or_conflict(db, name)
    db.refresh(folder)
    return _folder_response(db, folder)


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    folders = lib.live_folders(db)
    folder = lib.ensure_folder_visible(folders, user, folder_id)
    ensure_can_delete(user, folder, MODULE, TAB, what="folder")
    _ensure_not_builtin(folder, user, "delete")
    subfolders = sum(1 for f in folders.values() if f.parent_id == folder.id)
    documents = db.query(func.count(LibraryDocument.id)).filter(
        LibraryDocument.folder_id == folder.id, LibraryDocument.is_deleted == False).scalar() or 0  # noqa: E712
    if subfolders or documents:
        parts = []
        if subfolders:
            parts.append(f"{subfolders} sub-folder(s)")
        if documents:
            parts.append(f"{documents} document(s)")
        raise HTTPException(status_code=409, detail=(
            f"'{folder.name}' can't be deleted because it still contains {' and '.join(parts)}. "
            "Move or delete them first, then delete the folder."))
    folder.is_deleted = True
    folder.deleted_at = lib.now_utc()
    db.commit()
    return {"message": f"Folder '{folder.name}' deleted"}


# ── Documents: list, detail ──────────────────────────────────────────────
@router.get("/documents", response_model=list[LibraryDocumentResponse])
async def list_documents(
    folder_id: int | None = None,
    q: str | None = None,
    file_kind: str | None = None,
    product_id: int | None = None,
    project_id: int | None = None,
    organization_id: int | None = None,
    favorites: bool = False,
    expiry: str | None = None,
    include_subfolders: bool = False,
    limit: int = Query(1000, ge=1, le=3000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(_VIEW),
):
    if expiry not in (None, "", "expired", "expiring"):
        raise HTTPException(status_code=422, detail="expiry must be 'expired' (past the date) or 'expiring' (within 30 days).")
    folders = lib.live_folders(db)
    query = lib.visible_documents_query(db, user, folders)
    if folder_id is not None:
        lib.ensure_folder_visible(folders, user, folder_id)
        ids = lib.descendant_ids(folders, folder_id) if include_subfolders else {folder_id}
        query = query.filter(LibraryDocument.folder_id.in_(ids))
    query = lib.apply_search(query, q)
    if file_kind:
        query = query.filter(LibraryDocument.file_kind == file_kind)
    if product_id is not None:
        query = query.filter(lib.link_filter("product", product_id))
    if project_id is not None:
        query = query.filter(lib.link_filter("project", project_id))
    if organization_id is not None:
        query = query.filter(lib.link_filter("organization", organization_id))
    if favorites:
        query = query.filter(LibraryDocument.id.in_(
            db.query(LibraryFavorite.document_id).filter(LibraryFavorite.user_id == user.id)))
    today, soon = lib.expiring_window()
    if expiry == "expired":
        query = query.filter(LibraryDocument.expiry_date < today)
    elif expiry == "expiring":
        query = query.filter(LibraryDocument.expiry_date >= today, LibraryDocument.expiry_date <= soon)
    docs = query.order_by(func.lower(LibraryDocument.title), LibraryDocument.id).offset(offset).limit(limit).all()
    return lib.serialize_documents(db, user, docs, folders)


@router.get("/documents/{document_id}", response_model=LibraryDocumentResponse)
async def get_document(document_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    folders = lib.live_folders(db)
    doc = _get_doc(db, user, document_id, folders)
    return _document_response(db, user, doc, folders)


# ── Documents: direct upload (new document or new version) ───────────────
@router.post("/documents/upload-session", response_model=LibraryUploadSessionResponse)
async def start_upload(payload: LibraryUploadSessionPayload, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    """Large files go straight from the browser to SharePoint in chunks. This opens the session and signs what it was
    opened for. SharePoint path: a new version of a document is `Sales Library/<document id>/v<n>-<file>`; a brand-new
    document has no id yet, so its first file is `Sales Library/new-<key>/v1-<file>` — the path is stored on the version
    row, so renaming or moving folders never moves a file."""
    folders = lib.live_folders(db)
    if payload.document_id is not None:
        ensure_tab_action(user, MODULE, TAB, "edit")
        doc = _get_doc(db, user, payload.document_id, folders)
        folder_id, version_no, sp_folder = doc.folder_id, doc.current_version_no + 1, f"{lib.SP_ROOT}/{doc.id}"
    else:
        ensure_tab_action(user, MODULE, TAB, "create")
        if payload.folder_id is None:
            raise HTTPException(status_code=422, detail="Pick the folder the file goes into before uploading.")
        lib.ensure_folder_visible(folders, user, payload.folder_id)
        doc, folder_id, version_no, sp_folder = None, payload.folder_id, 1, f"{lib.SP_ROOT}/new-{uuid.uuid4().hex[:12]}"
    _need_site()
    client_mime = lib.normalise_client_mime(payload.mime_type)  # script-capable types are refused here
    clean_name = validate_upload_metadata(payload.file_name, payload.file_size, client_mime)
    sp_name = f"v{version_no}-{clean_name}"
    session = await create_upload_session(settings.SHAREPOINT_SITE_ID, sp_folder, sp_name)
    token = create_upload_token({
        "kind": UPLOAD_KIND, "user_id": user.id, "folder": sp_folder, "file_name": sp_name, "original_name": clean_name,
        "file_size": payload.file_size, "content_type": client_mime, "library_folder_id": folder_id,
        "document_id": doc.id if doc else None, "version_no": version_no,
    })
    return LibraryUploadSessionResponse(
        upload_url=session["upload_url"], upload_token=token, chunk_size=DIRECT_UPLOAD_CHUNK_BYTES,
        file_name=clean_name, expires_at=session.get("expires_at"),
    )


@router.post("/documents/complete-upload", response_model=LibraryDocumentResponse)
async def complete_upload(payload: LibraryCompleteUploadPayload, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    """Records a file the browser finished uploading: a new document (version 1) or a new version of one."""
    claims = verify_upload_token(payload.upload_token)
    if not claims or claims.get("kind") != UPLOAD_KIND:
        raise HTTPException(status_code=400, detail="This upload link has expired or is not a Knowledge Hub upload. Start the upload again.")
    if claims.get("user_id") != user.id:
        raise HTTPException(status_code=403, detail="This upload was started by a different user. Start the upload again from your own screen.")

    folders = lib.live_folders(db)
    document_id = claims.get("document_id")
    if document_id is not None:
        ensure_tab_action(user, MODULE, TAB, "edit")
        doc = _get_doc(db, user, document_id, folders)
        folder_id = doc.folder_id
    else:
        ensure_tab_action(user, MODULE, TAB, "create")
        doc = None
        folder_id = claims.get("library_folder_id")
    folder = lib.ensure_folder_visible(folders, user, folder_id)

    # Cheap checks first, so a refusal does not cost the user the uploaded file (the token stays valid for 24 h).
    pairs = lib.validate_links(db, payload.links, user, _existing_links(db, document_id)) if payload.links is not None else None
    tags = lib.clean_tags(payload.tags) if payload.tags is not None else None
    pricing = lib.is_pricing_folder(folders, folder.id)
    if pricing:
        if doc is None and payload.expiry_date is None:
            raise HTTPException(status_code=422, detail=lib.PRICING_EXPIRY_MESSAGE)
        if doc is not None and payload.expiry_date is None and (doc.expiry_date is None or doc.expiry_date < date.today()):
            raise HTTPException(status_code=422, detail=lib.PRICING_EXPIRY_MESSAGE)
    title = " ".join((payload.title or "").split()) if payload.title is not None else None
    if title is not None and not title:
        raise HTTPException(status_code=422, detail="Title can't be empty — type a title or leave it out to use the file name.")
    if title and len(title) > 200:
        raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters; the limit is 200 — shorten it.")
    _need_site()

    result = await verify_direct_upload(
        settings.SHAREPOINT_SITE_ID, payload.drive_item_id, claims["folder"], claims["file_size"], claims.get("content_type"))
    if not lib.sharepoint_name_matches(claims["file_name"], result.get("name")):
        try:
            await delete_drive_item(settings.SHAREPOINT_SITE_ID, payload.drive_item_id)
        except Exception:
            pass  # best effort: the file is not recorded either way
        raise HTTPException(status_code=400, detail=(
            f"The file in SharePoint ('{result.get('name')}') is not the one this upload was opened for "
            f"('{claims['file_name']}'), so it was not recorded. Start the upload again."))
    if db.query(LibraryDocumentVersion.id).filter(LibraryDocumentVersion.sharepoint_path == result["path"]).first():
        raise HTTPException(status_code=409, detail="This upload was already recorded in the Knowledge Hub. Reload the list to see it.")

    original_name = claims.get("original_name") or result["name"]
    mime = lib.server_mime(original_name)  # from the extension, never the browser's claim
    kind = lib.derive_file_kind(original_name, mime)
    if doc is None:
        doc = LibraryDocument(
            folder_id=folder.id, title=(title or original_name)[:200], description=(payload.description or "").strip() or None,
            file_kind=kind, tags=tags or [], expiry_date=payload.expiry_date, current_version_no=1, created_by_id=user.id,
        )
        db.add(doc)
        db.flush()
        wanted = list(pairs or [])
        product_id = lib.inherited_product_id(folders, folder.id)
        if product_id and ("product", product_id) not in wanted and db.get(FinishedProduct, product_id):
            wanted.append(("product", product_id))
        lib.add_links(db, doc, wanted)
        version_no = 1
    else:
        version_no = (db.query(func.max(LibraryDocumentVersion.version_no)).filter(
            LibraryDocumentVersion.document_id == doc.id).scalar() or 0) + 1
        doc.current_version_no = version_no
        doc.file_kind = kind
        doc.updated_at = lib.now_utc()
        if title:
            doc.title = title
        if payload.description is not None:
            doc.description = payload.description.strip() or None
        if tags is not None:
            doc.tags = tags
        if payload.expiry_date is not None:
            doc.expiry_date = payload.expiry_date
        if pairs:
            lib.add_links(db, doc, pairs)
    db.add(LibraryDocumentVersion(
        document_id=doc.id, version_no=version_no, file_name=original_name[:255], sharepoint_path=result["path"][:1000],
        sharepoint_url=(result.get("webUrl") or None) and result["webUrl"][:1000], file_size=result.get("size"), mime_type=mime,
        change_note=(payload.change_note or "").strip() or None, uploaded_by_id=user.id,
    ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if document_id is None:
            raise
        raise HTTPException(status_code=409, detail=(
            "Someone uploaded another version of this file at the same moment — open it again and retry."))
    db.refresh(doc)
    return _document_response(db, user, doc, folders)


# ── Documents: edit, delete ──────────────────────────────────────────────
@router.patch("/documents/{document_id}", response_model=LibraryDocumentResponse)
async def update_document(document_id: int, payload: LibraryDocumentPatch, db: Session = Depends(get_db), user: User = Depends(_EDIT)):
    folders = lib.live_folders(db)
    doc = _get_doc(db, user, document_id, folders)
    data = payload.model_dump(exclude_unset=True)

    if "title" in data:
        title = " ".join((data["title"] or "").split())
        if not title:
            raise HTTPException(status_code=422, detail="Title can't be empty — type the name people will search for.")
        if len(title) > 200:
            raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters; the limit is 200 — shorten it.")
        doc.title = title
    if "description" in data:
        doc.description = (data["description"] or "").strip() or None
    if "tags" in data:
        doc.tags = lib.clean_tags(data["tags"])
    if "expiry_date" in data:
        doc.expiry_date = data["expiry_date"]
    target_folder_id = doc.folder_id
    if data.get("folder_id") is not None and data["folder_id"] != doc.folder_id:
        lib.ensure_folder_visible(folders, user, data["folder_id"])
        target_folder_id = data["folder_id"]
    if lib.is_pricing_folder(folders, target_folder_id) and doc.expiry_date is None:
        raise HTTPException(status_code=422, detail=lib.PRICING_EXPIRY_MESSAGE)
    doc.folder_id = target_folder_id
    if "links" in data and data["links"] is not None:
        lib.replace_links(db, doc, lib.validate_links(db, payload.links, user, _existing_links(db, doc.id)))
    doc.updated_at = lib.now_utc()
    db.commit()
    db.refresh(doc)
    return _document_response(db, user, doc, folders)


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    """Soft delete: the row leaves every list, the SharePoint files stay (an admin can restore from the database)."""
    doc = _get_doc(db, user, document_id)
    ensure_can_delete(user, doc, MODULE, TAB, what="document")
    doc.is_deleted = True
    doc.deleted_at = lib.now_utc()
    db.commit()
    return {"message": f"Document '{doc.title}' deleted"}


# ── Documents: download, preview ─────────────────────────────────────────
def _version(db: Session, doc: LibraryDocument, version_no: int | None) -> LibraryDocumentVersion:
    wanted = version_no if version_no is not None else doc.current_version_no
    v = db.query(LibraryDocumentVersion).filter(
        LibraryDocumentVersion.document_id == doc.id, LibraryDocumentVersion.version_no == wanted).first()
    if not v:
        raise HTTPException(status_code=404, detail=(
            f"'{doc.title}' has no version {wanted}. Open the document and pick one from its version list."))
    return v


@router.get("/documents/{document_id}/download-url")
async def document_download_url(document_id: int, version_no: int | None = None, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    """Short-lived direct SharePoint link (about an hour) — works for files of any size; authorised here first."""
    doc = _get_doc(db, user, document_id)
    version = _version(db, doc, version_no)
    _need_site()
    url = await get_download_url(settings.SHAREPOINT_SITE_ID, version.sharepoint_path)
    return {"url": url, "file_name": version.file_name, "version_no": version.version_no}


@router.get("/documents/{document_id}/content")
async def document_content(document_id: int, version_no: int | None = None, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    """File bytes through the portal for the in-app preview (pdf / image). Larger files use download-url instead."""
    doc = _get_doc(db, user, document_id)
    version = _version(db, doc, version_no)
    if (version.file_size or 0) > lib.MAX_INLINE_BYTES:
        raise HTTPException(status_code=413, detail=(
            f"{version.file_name} is {(version.file_size or 0) / 1024 ** 2:.0f} MB — too large to preview through the portal. "
            "Use Download (it streams straight from SharePoint)."))
    _need_site()
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, version.sharepoint_path)
    mime = lib.server_mime(version.file_name)  # the extension decides, never a stored / announced type
    return Response(
        content=content, media_type=mime,
        headers={
            "Content-Disposition": f"{'inline' if lib.inline_allowed(mime) else 'attachment'}; filename*=UTF-8''{quote(version.file_name)}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )


# ── Favourites ───────────────────────────────────────────────────────────
@router.post("/documents/{document_id}/favorite")
async def add_favorite(document_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    doc = _get_doc(db, user, document_id)
    if not db.get(LibraryFavorite, (user.id, doc.id)):
        db.add(LibraryFavorite(user_id=user.id, document_id=doc.id))
        db.commit()
    return {"is_favorite": True}


@router.delete("/documents/{document_id}/favorite")
async def remove_favorite(document_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    doc = _get_doc(db, user, document_id)
    fav = db.get(LibraryFavorite, (user.id, doc.id))
    if fav:
        db.delete(fav)
        db.commit()
    return {"is_favorite": False}


# ── Share (in-app bell) ──────────────────────────────────────────────────
@router.post("/documents/{document_id}/share")
async def share_document(document_id: int, payload: LibrarySharePayload, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    """Tells colleagues about a file (bell). Only people who can open it are notified; the rest come back in `skipped`."""
    folders = lib.live_folders(db)
    doc = _get_doc(db, user, document_id, folders)
    ids = list(dict.fromkeys(payload.user_ids))
    if not ids:
        raise HTTPException(status_code=422, detail="Pick at least one colleague to share the file with.")
    if len(ids) > 50:
        raise HTTPException(status_code=422, detail=f"You picked {len(ids)} people; share with at most 50 at a time.")
    users = {u.id: u for u in db.query(User).filter(User.id.in_(ids), User.is_active == True).all()}  # noqa: E712
    confidential = lib.is_confidential_folder(folders, doc.folder_id)
    note = (payload.message or "").strip()[:500]
    sender = user.name or user.email
    sent, skipped = [], 0
    for uid in ids:
        target = users.get(uid)
        if (target is None or target.id == user.id or not can_view_tab(target, MODULE, TAB)
                or (confidential and not lib.sees_confidential(target))):
            skipped += 1
            continue
        message = f"{sender} shared '{doc.title}' with you."
        if note:
            message += f" Note: {note}"
        notify_user(db, target.id, "Knowledge Hub file shared with you", message, SHARE_NOTIFICATION,
                    entity_type=SHARE_ENTITY, entity_id=doc.id)
        sent.append(uid)
    if not sent:
        raise HTTPException(status_code=422, detail=(
            "Nobody was notified — the people you picked can't receive this file (they need an active account with "
            "CRM › Knowledge Hub access, and the 'Confidential folders' permission for a Confidential file). "
            "Pick other colleagues or ask an admin to grant the access."))
    db.commit()
    return {"sent": len(sent), "user_ids": sent,
            "skipped": [{"reason": "can't receive this file"}] * skipped}


# ── Product resources (product detail page › Sales Resources) ────────────
@router.get("/products/{product_id}/resources", response_model=list[LibraryProductResourceGroup])
async def product_resources(product_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    if db.get(FinishedProduct, product_id) is None:
        raise HTTPException(status_code=404, detail=f"Product #{product_id} was not found — it may have been deleted. Reload the page.")
    folders = lib.live_folders(db)
    docs = lib.visible_documents_query(db, user, folders).filter(lib.link_filter("product", product_id)).order_by(
        func.lower(LibraryDocument.title), LibraryDocument.id).all()
    items = lib.serialize_documents(db, user, docs, folders)
    groups: dict[int, dict] = {}
    for item in items:
        g = groups.setdefault(item["folder_id"], {"folder_id": item["folder_id"], "folder_path": item["folder_path"], "documents": []})
        g["documents"].append(item)
    return sorted(groups.values(), key=lambda g: (g["folder_path"] or "").lower())


# ── Pickers for the link fields (library users need not hold Products / Projects / Organizations access) ──
def _words(query, text: str | None, *cols):
    """Every typed word must appear in one of `cols` (any order)."""
    for word in (text or "").split():
        pat = lib._like(word)
        query = query.filter(or_(*[c.ilike(pat, escape="\\") for c in cols]))
    return query


@router.get("/pickers/products", response_model=list[LibraryPickerItem])
async def picker_products(q: str | None = None, limit: int = Query(30, ge=1, le=50),
                          db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    query = _words(db.query(FinishedProduct), q, FinishedProduct.code, FinishedProduct.name)
    return [{"id": r.id, "code": r.code, "name": r.name} for r in query.order_by(FinishedProduct.code).limit(limit).all()]


@router.get("/pickers/projects", response_model=list[LibraryPickerItem])
async def picker_projects(q: str | None = None, limit: int = Query(30, ge=1, le=50),
                          db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    query = _words(db.query(PmProject).filter(PmProject.status != "cancelled"), q, PmProject.project_code, PmProject.name)
    return [{"id": r.id, "code": r.project_code, "name": r.name} for r in query.order_by(PmProject.project_code).limit(limit).all()]


@router.get("/pickers/organizations", response_model=list[LibraryPickerItem])
async def picker_organizations(q: str | None = None, limit: int = Query(30, ge=1, le=50),
                               db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    query = lib.scoped_organizations(db, user)
    query = _words(query, q, Organization.name, Organization.org_code)
    return [{"id": r.id, "code": r.org_code, "name": r.name} for r in query.order_by(Organization.name).limit(limit).all()]
