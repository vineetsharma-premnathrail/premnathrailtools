"""CRM › Sales Library helpers: who may see which folder (Confidential), folder paths and loop checks,
file kind, link validation, search and the list / detail shapes. Routes: crm/routes/library.py."""
import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import String, cast, exists, func, or_
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, in_scope
from app.core.permission_registry import can_feature, is_admin_user
from app.modules.crm.models.library import (
    LibraryDocument, LibraryDocumentLink, LibraryDocumentVersion, LibraryFavorite, LibraryFolder,
)
from app.modules.crm.models.organization import Organization
from app.modules.main.models.user import User
from app.modules.products.models.product import FinishedProduct
from app.modules.projects.models.project import PmProject

MODULE = "crm"
TAB = "sales_library"
PATH_SEP = " › "
MAX_TAGS = 30
MAX_LINKS = 50
SP_ROOT = "Sales Library"
# Past this size the portal will not stream a file through itself (memory); the preview falls back to Download.
MAX_INLINE_BYTES = 25 * 1024 * 1024

GRANT_CONFIDENTIAL_HINT = ("Ask an admin to switch on 'Confidential folders' for your role under "
                           "Organization › Role & Permissions › CRM › Sales Library.")
# One message for "missing" and "hidden", so a Confidential folder / file can't be told apart from one that doesn't
# exist, and its name is never repeated to a user who may not see it.
NOT_FOUND_OR_HIDDEN = ("This file or folder was not found, or it is in a Confidential folder you can't open. "
                       "Ask an admin for CRM › Sales Library › Confidential folders if you need it.")
NAME_TAKEN_NEUTRAL = "That name can't be used here — pick another name."


def sees_confidential(user: User) -> bool:
    return is_admin_user(user) or can_feature(user, MODULE, TAB, "confidential", "view")


# ── Folders ──────────────────────────────────────────────────────────────
def live_folders(db: Session) -> dict[int, LibraryFolder]:
    rows = db.query(LibraryFolder).filter(LibraryFolder.is_deleted == False).all()  # noqa: E712
    return {f.id: f for f in rows}


def folder_chain(folders: dict[int, LibraryFolder], folder_id: int | None) -> list[LibraryFolder]:
    """The folder and its ancestors, nearest first (a loop in bad data stops the walk)."""
    out: list[LibraryFolder] = []
    seen: set[int] = set()
    cur = folders.get(folder_id) if folder_id is not None else None
    while cur is not None and cur.id not in seen:
        seen.add(cur.id)
        out.append(cur)
        cur = folders.get(cur.parent_id) if cur.parent_id is not None else None
    return out


def folder_path(folders: dict[int, LibraryFolder], folder_id: int | None) -> str:
    return PATH_SEP.join(f.name for f in reversed(folder_chain(folders, folder_id)))


def is_confidential_folder(folders: dict[int, LibraryFolder], folder_id: int | None) -> bool:
    """Confidential itself or under a confidential ancestor."""
    return any(f.is_confidential for f in folder_chain(folders, folder_id))


def is_pricing_folder(folders: dict[int, LibraryFolder], folder_id: int | None) -> bool:
    return any(f.is_pricing for f in folder_chain(folders, folder_id))


def inherited_product_id(folders: dict[int, LibraryFolder], folder_id: int | None) -> int | None:
    """Product of the nearest folder (itself or an ancestor) that is linked to one."""
    for f in folder_chain(folders, folder_id):
        if f.product_id:
            return f.product_id
    return None


def hidden_folder_ids(folders: dict[int, LibraryFolder], user: User) -> set[int]:
    """Folders `user` may not see (empty for admin / the Confidential feature)."""
    if sees_confidential(user):
        return set()
    return {fid for fid in folders if is_confidential_folder(folders, fid)}


def descendant_ids(folders: dict[int, LibraryFolder], folder_id: int) -> set[int]:
    """The folder and everything below it."""
    out = {folder_id}
    grew = True
    while grew:
        grew = False
        for f in folders.values():
            if f.parent_id is not None and f.parent_id in out and f.id not in out:
                out.add(f.id)
                grew = True
    return out


def ensure_folder_visible(folders: dict[int, LibraryFolder], user: User, folder_id: int | None) -> LibraryFolder:
    """The live folder; 404 with one neutral message when it is missing or inside a Confidential folder the user may not see."""
    folder = folders.get(folder_id) if folder_id is not None else None
    if folder is None or (is_confidential_folder(folders, folder.id) and not sees_confidential(user)):
        raise HTTPException(status_code=404, detail=NOT_FOUND_OR_HIDDEN)
    return folder


def ensure_document_visible(folders: dict[int, LibraryFolder], user: User, doc: LibraryDocument) -> None:
    if is_confidential_folder(folders, doc.folder_id) and not sees_confidential(user):
        raise HTTPException(status_code=404, detail=NOT_FOUND_OR_HIDDEN)


# ── File kind ────────────────────────────────────────────────────────────
_KIND_BY_EXT = {
    "pdf": "pdf",
    **dict.fromkeys(("mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "mpeg", "mpg", "3gp"), "video"),
    **dict.fromkeys(("jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif"), "image"),
    **dict.fromkeys(("xls", "xlsx", "xlsm", "xlsb", "csv", "ods"), "spreadsheet"),
    **dict.fromkeys(("doc", "docx", "docm", "txt", "rtf", "odt", "md"), "document"),
    **dict.fromkeys(("ppt", "pptx", "pptm", "pps", "ppsx", "odp"), "presentation"),
}


def derive_file_kind(file_name: str | None, mime_type: str | None) -> str:
    """pdf / video / image / spreadsheet / document / presentation / other, from the extension first, then the MIME type."""
    name = (file_name or "").lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    if ext in _KIND_BY_EXT:
        return _KIND_BY_EXT[ext]
    mime = (mime_type or "").lower()
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("image/"):
        return "image"
    if mime == "application/pdf":
        return "pdf"
    if "spreadsheet" in mime or "excel" in mime or mime == "text/csv":
        return "spreadsheet"
    if "presentation" in mime or "powerpoint" in mime:
        return "presentation"
    if "word" in mime or "opendocument.text" in mime or mime in ("text/plain", "application/rtf"):
        return "document"
    return "other"


# The browser's MIME type is never stored or served (a lie like text/html would run script in the portal's origin):
# the type comes from the allow-listed file extension.
_MIME_BY_EXT = {
    "pdf": "application/pdf",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
    "bmp": "image/bmp", "tif": "image/tiff", "tiff": "image/tiff", "heic": "image/heic", "heif": "image/heif",
    "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "m4v": "video/x-m4v", "avi": "video/x-msvideo",
    "mkv": "video/x-matroska", "wmv": "video/x-ms-wmv", "mpeg": "video/mpeg", "mpg": "video/mpeg", "3gp": "video/3gpp",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "csv": "text/csv", "txt": "text/plain", "rtf": "application/rtf",
    "odt": "application/vnd.oasis.opendocument.text", "ods": "application/vnd.oasis.opendocument.spreadsheet",
    "odp": "application/vnd.oasis.opendocument.presentation",
    "zip": "application/zip",
}
# Types that carry script (or markup that can) — refused outright when a client announces them.
_BLOCKED_CLIENT_MIME = {"text/html", "application/xhtml+xml", "text/xml", "application/xml", "text/javascript",
                        "application/javascript", "application/x-javascript", "image/svg+xml"}


def server_mime(file_name: str | None) -> str:
    """MIME type from the file extension; anything unlisted (svg, html, xml, js …) is application/octet-stream."""
    name = (file_name or "").lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    return _MIME_BY_EXT.get(ext, "application/octet-stream")


def normalise_client_mime(mime_type: str | None) -> str | None:
    """The announced type without parameters ("text/html; charset=utf-8" -> "text/html"); script-capable types are refused."""
    mime = (mime_type or "").split(";")[0].strip().lower() or None
    if mime and (mime in _BLOCKED_CLIENT_MIME or mime.endswith("+xml") or "svg" in mime
                 or "javascript" in mime or "ecmascript" in mime):
        raise HTTPException(status_code=400, detail=(
            f"Files announced as '{mime}' can't be uploaded — web pages, scripts and SVG images can run code in the portal. "
            "Save the content as a PDF, Word or image file and upload that instead."))
    return mime


def inline_allowed(mime: str) -> bool:
    """Shown in the browser only for PDFs, raster images and videos; everything else downloads."""
    return mime == "application/pdf" or (mime.startswith(("image/", "video/")) and "svg" not in mime)


def sharepoint_name_matches(claimed: str, actual: str) -> bool:
    """The stored item is the file the session was opened for: same name, or Graph's rename suffix (" 1", " 2")."""
    stem, dot, ext = claimed.rpartition(".")
    if not dot:
        stem, ext = claimed, ""
    pattern = re.escape(stem) + r"(?: \d+)?" + (r"\." + re.escape(ext) if ext else "")
    return re.fullmatch(pattern, actual or "", flags=re.IGNORECASE) is not None


def clean_tags(tags: Iterable[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for t in tags or []:
        s = " ".join(str(t).split())[:50]
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    if len(out) > MAX_TAGS:
        raise HTTPException(status_code=422, detail=f"A document can have at most {MAX_TAGS} tags — remove {len(out) - MAX_TAGS} and save again.")
    return out


# ── Links ────────────────────────────────────────────────────────────────
_LINK_LABEL = {"product": "Product", "project": "Project", "organization": "Customer"}


def _link_exists(db: Session, link_type: str, link_id: int) -> bool:
    if link_type == "product":
        return db.get(FinishedProduct, link_id) is not None
    if link_type == "project":
        return db.get(PmProject, link_id) is not None
    org = db.get(Organization, link_id)
    return org is not None and not org.is_deleted


def validate_links(db: Session, links, user: User | None = None,
                   keep: set[tuple[str, int]] | None = None) -> list[tuple[str, int]]:
    """Unique (type, id) pairs, each checked to exist (links are references, never copies). A customer must also be
    inside the user's CRM Organizations data scope, unless the document already carries that link (`keep`)."""
    out: list[tuple[str, int]] = []
    for link in links or []:
        key = (link.link_type, link.link_id)
        if key in out:
            continue
        ok = _link_exists(db, link.link_type, link.link_id)
        if ok and link.link_type == "organization" and user is not None and key not in (keep or set()):
            ok = in_scope(db, user, db.get(Organization, link.link_id))
        if not ok:
            raise HTTPException(status_code=422, detail=(
                f"{_LINK_LABEL[link.link_type]} #{link.link_id} was not found, or it is outside your access — it may have "
                "been deleted. Remove it from the links or pick it again from the list."))
        out.append(key)
    if len(out) > MAX_LINKS:
        raise HTTPException(status_code=422, detail=f"A document can be linked to at most {MAX_LINKS} records — remove some links and save again.")
    return out


def replace_links(db: Session, doc: LibraryDocument, pairs: list[tuple[str, int]]) -> None:
    db.query(LibraryDocumentLink).filter(LibraryDocumentLink.document_id == doc.id).delete(synchronize_session=False)
    for link_type, link_id in pairs:
        db.add(LibraryDocumentLink(document_id=doc.id, link_type=link_type, link_id=link_id))


def add_links(db: Session, doc: LibraryDocument, pairs: list[tuple[str, int]]) -> None:
    have = {(r.link_type, r.link_id) for r in db.query(LibraryDocumentLink).filter(LibraryDocumentLink.document_id == doc.id).all()}
    for link_type, link_id in pairs:
        if (link_type, link_id) not in have:
            db.add(LibraryDocumentLink(document_id=doc.id, link_type=link_type, link_id=link_id))


def _link_names(db: Session, rows: list[LibraryDocumentLink]) -> dict[tuple[str, int], str]:
    names: dict[tuple[str, int], str] = {}
    by_type: dict[str, set[int]] = {}
    for r in rows:
        by_type.setdefault(r.link_type, set()).add(r.link_id)
    if by_type.get("product"):
        for p in db.query(FinishedProduct).filter(FinishedProduct.id.in_(by_type["product"])).all():
            names[("product", p.id)] = p.name
    if by_type.get("project"):
        for p in db.query(PmProject).filter(PmProject.id.in_(by_type["project"])).all():
            names[("project", p.id)] = p.project_code
    if by_type.get("organization"):
        for o in db.query(Organization).filter(Organization.id.in_(by_type["organization"])).all():
            names[("organization", o.id)] = o.name
    return names


# ── Search ───────────────────────────────────────────────────────────────
def _like(word: str) -> str:
    return "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _tag_hits(word: str) -> list:
    """Tags are JSON text, where non-ASCII letters are written as \\uXXXX — match the word as typed and in that escaped
    form, so Hindi tags are found."""
    tags_text = cast(LibraryDocument.tags, String)
    forms = {_like(word)}
    escaped = json.dumps(word, ensure_ascii=True)[1:-1]
    if escaped != word:
        forms.add(_like(escaped))
        forms.add(_like(escaped.lower()))
    return [tags_text.ilike(f, escape="\\") for f in forms]


def apply_search(query, text: str | None):
    """Word by word, any order: every typed word must match the title, description, tags, a file name or a linked product."""
    for word in (text or "").split():
        pat = _like(word)
        file_hit = exists().where(
            LibraryDocumentVersion.document_id == LibraryDocument.id,
            LibraryDocumentVersion.version_no == LibraryDocument.current_version_no,
            LibraryDocumentVersion.file_name.ilike(pat, escape="\\"),
        )
        product_hit = exists().where(
            LibraryDocumentLink.document_id == LibraryDocument.id,
            LibraryDocumentLink.link_type == "product",
            FinishedProduct.id == LibraryDocumentLink.link_id,
            or_(FinishedProduct.name.ilike(pat, escape="\\"), FinishedProduct.code.ilike(pat, escape="\\")),
        )
        query = query.filter(or_(
            LibraryDocument.title.ilike(pat, escape="\\"),
            LibraryDocument.description.ilike(pat, escape="\\"),
            *_tag_hits(word),
            file_hit, product_hit,
        ))
    return query


def link_filter(link_type: str, link_id: int):
    return exists().where(
        LibraryDocumentLink.document_id == LibraryDocument.id,
        LibraryDocumentLink.link_type == link_type,
        LibraryDocumentLink.link_id == link_id,
    )


# ── Response shapes ──────────────────────────────────────────────────────
def serialize_documents(db: Session, user: User, docs: list[LibraryDocument], folders: dict[int, LibraryFolder],
                        with_versions: bool = False) -> list[dict]:
    if not docs:
        return []
    ids = [d.id for d in docs]
    today = date.today()

    versions = db.query(LibraryDocumentVersion).filter(LibraryDocumentVersion.document_id.in_(ids)).order_by(
        LibraryDocumentVersion.document_id, LibraryDocumentVersion.version_no.desc()).all()
    versions_by_doc: dict[int, list[LibraryDocumentVersion]] = {}
    for v in versions:
        versions_by_doc.setdefault(v.document_id, []).append(v)

    link_rows = db.query(LibraryDocumentLink).filter(LibraryDocumentLink.document_id.in_(ids)).order_by(
        LibraryDocumentLink.link_type, LibraryDocumentLink.id).all()
    names = _link_names(db, link_rows)
    links_by_doc: dict[int, list[dict]] = {}
    for r in link_rows:
        links_by_doc.setdefault(r.document_id, []).append(
            {"link_type": r.link_type, "link_id": r.link_id, "name": names.get((r.link_type, r.link_id))})

    favs = {r.document_id for r in db.query(LibraryFavorite).filter(
        LibraryFavorite.user_id == user.id, LibraryFavorite.document_id.in_(ids)).all()}

    user_ids = {d.created_by_id for d in docs if d.created_by_id}
    if with_versions:
        user_ids |= {v.uploaded_by_id for v in versions if v.uploaded_by_id}
    user_names = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    out: list[dict] = []
    for d in docs:
        vers = versions_by_doc.get(d.id, [])
        cur = next((v for v in vers if v.version_no == d.current_version_no), vers[0] if vers else None)
        item = {
            "id": d.id, "folder_id": d.folder_id, "folder_path": folder_path(folders, d.folder_id),
            "title": d.title, "description": d.description, "file_kind": d.file_kind, "tags": list(d.tags or []),
            "expiry_date": d.expiry_date, "current_version_no": d.current_version_no,
            "file_name": cur.file_name if cur else None, "file_size": cur.file_size if cur else None,
            "mime_type": cur.mime_type if cur else None,
            "current_version": ({"version_no": cur.version_no, "file_name": cur.file_name, "file_size": cur.file_size,
                                 "mime_type": cur.mime_type} if cur else None),
            "links": links_by_doc.get(d.id, []),
            "is_favorite": d.id in favs,
            "is_expired": bool(d.expiry_date and d.expiry_date < today),
            "created_by_id": d.created_by_id, "created_by_name": user_names.get(d.created_by_id),
            "created_at": d.created_at, "updated_at": d.updated_at,
        }
        if with_versions:
            item["versions"] = [
                {"id": v.id, "version_no": v.version_no, "file_name": v.file_name, "file_size": v.file_size,
                 "mime_type": v.mime_type, "change_note": v.change_note, "uploaded_by_id": v.uploaded_by_id,
                 "uploaded_by_name": user_names.get(v.uploaded_by_id), "created_at": v.created_at}
                for v in vers
            ]
        out.append(item)
    return out


def visible_documents_query(db: Session, user: User, folders: dict[int, LibraryFolder]):
    """Live documents in folders the user may see."""
    q = db.query(LibraryDocument).filter(LibraryDocument.is_deleted == False)  # noqa: E712
    hidden = hidden_folder_ids(folders, user)
    if hidden:
        q = q.filter(LibraryDocument.folder_id.not_in(hidden))
    return q


def expiring_window(today: date | None = None) -> tuple[date, date]:
    t = today or date.today()
    return t, t + timedelta(days=30)


def docs_without_expiry(db: Session, folder_ids: set[int]) -> int:
    """Live documents in these folders that carry no expiry date (pricing folders need one on each)."""
    if not folder_ids:
        return 0
    return db.query(func.count(LibraryDocument.id)).filter(
        LibraryDocument.is_deleted == False, LibraryDocument.folder_id.in_(folder_ids),  # noqa: E712
        LibraryDocument.expiry_date.is_(None)).scalar() or 0


PRICING_EXPIRY_MESSAGE = ("Pricing documents need an expiry date so outdated prices are flagged — "
                          "pick the date the price list stops being valid.")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def scoped_organizations(db: Session, user: User):
    """Live customers inside the user's CRM Organizations data scope (query)."""
    return apply_scope(db.query(Organization).filter(Organization.is_deleted == False), user, Organization)  # noqa: E712
