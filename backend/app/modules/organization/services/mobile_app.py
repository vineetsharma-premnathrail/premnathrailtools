"""Android app releases: publish (portal admins), latest version, download.

Owner decisions 2026-11-12 (docs/agent-runs/2026-11-12-mobile-app-updates/
requirement.md): the APK is served only by this backend behind login and is
stored in SharePoint; integrity is a SHA-256 the server computes at upload.

The APK checks (extension, ZIP signature, 250 MB cap) live HERE on purpose:
the shared upload checks in app/utils/sharepoint.py stay as they are for every
other module.
"""
from __future__ import annotations

import hashlib
import logging
import re
import threading
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime, timezone
from typing import BinaryIO
from urllib.parse import quote

import httpx
from fastapi import HTTPException, UploadFile
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from sqlalchemy import func
from starlette.background import BackgroundTask
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.mobile_app_release import MobileAppRelease
from app.modules.organization.schemas.mobile_app import (
    MobileAppLatestResponse, MobileAppReleaseResponse, MobileAppReleaseUpdate,
)
from app.auth.microsoft import get_app_graph_token
from app.utils.sharepoint import (
    GRAPH_API, delete_file_from_sharepoint, get_download_url, sanitize_folder_name, upload_file_to_sharepoint,
)

_log = logging.getLogger(__name__)

APK_MEDIA_TYPE = "application/vnd.android.package-archive"
MAX_APK_BYTES = 250 * 1024 * 1024
# Whole multipart request (APK + form fields); refused before the body is read.
MAX_UPLOAD_REQUEST_BYTES = 260 * 1024 * 1024
DOWNLOAD_BUSY_MESSAGE = "The download service is busy - try again in a minute."
# Per-user download limit (in memory, per worker): enough for retries, stops loops.
DOWNLOAD_LIMIT = 6
DOWNLOAD_WINDOW_SECONDS = 10 * 60
_download_hits: dict[int, deque[float]] = {}
_download_lock = threading.Lock()
ZIP_MAGIC = b"PK\x03\x04"
_HASH_CHUNK = 1024 * 1024
# Letters, digits and . _ + - (e.g. "1.4.0", "1.4.0-beta+2"): it becomes part of the file name.
_VERSION_NAME_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+-]{0,49}$")
NO_RELEASE_MESSAGE = "No app version has been published yet."


class _ApkUpload:
    """The incoming upload under its stored name and the APK type, for
    upload_file_to_sharepoint (which reads .filename / .content_type / .file).
    The file stays on the spooled temp file, so a big APK is uploaded in chunks
    and never held in memory as a whole."""

    def __init__(self, filename: str, file: BinaryIO):
        self.filename = filename
        self.content_type = APK_MEDIA_TYPE
        self.file = file


def _root_folder() -> str:
    return f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/Mobile App/Android"


def download_name(release: MobileAppRelease) -> str:
    return f"PremnathERP-{release.version_name}.apk"


def download_path(release: MobileAppRelease) -> str:
    return f"/mobile-app/releases/{release.id}/download"


def _require_sharepoint() -> str:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(
            status_code=503,
            detail="The portal's SharePoint storage is not set up, so app files cannot be stored or downloaded. "
                   "Ask IT to set SHAREPOINT_SITE_ID for the portal, then try again.",
        )
    return settings.SHAREPOINT_SITE_ID


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def latest_release(db: Session) -> MobileAppRelease | None:
    return (
        db.query(MobileAppRelease)
        .filter(MobileAppRelease.is_active.is_(True))
        .order_by(MobileAppRelease.version_code.desc())
        .first()
    )


def latest_out(release: MobileAppRelease) -> MobileAppLatestResponse:
    return MobileAppLatestResponse(
        id=release.id,
        version_name=release.version_name,
        version_code=release.version_code,
        notes=release.notes,
        required=bool(release.required),
        min_supported_version_code=release.min_supported_version_code,
        file_size=release.file_size,
        sha256=release.sha256,
        released_at=release.released_at,
        download_path=download_path(release),
    )


def releases_out(db: Session, releases: list[MobileAppRelease]) -> list[MobileAppReleaseResponse]:
    """Admin rows; uploader names in one query (no per-row lookups)."""
    ids = {r.uploaded_by_id for r in releases if r.uploaded_by_id}
    names: dict[int, str] = {}
    if ids:
        names = {uid: name for uid, name in db.query(User.id, User.name).filter(User.id.in_(ids)).all()}
    return [
        MobileAppReleaseResponse(
            **latest_out(r).model_dump(),
            is_active=bool(r.is_active),
            file_name=r.file_name,
            uploaded_by_id=r.uploaded_by_id,
            uploaded_by_name=names.get(r.uploaded_by_id) if r.uploaded_by_id else None,
            created_at=r.created_at,
        )
        for r in releases
    ]


def list_releases(db: Session) -> list[MobileAppRelease]:
    return db.query(MobileAppRelease).order_by(MobileAppRelease.version_code.asc()).all()


def get_release(db: Session, release_id: int) -> MobileAppRelease:
    release = db.get(MobileAppRelease, release_id)
    if release is None:
        raise HTTPException(
            status_code=404,
            detail=f"App version #{release_id} does not exist (it may have been deleted). Refresh the list.",
        )
    return release


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _highest_code(db: Session) -> int | None:
    return db.query(func.max(MobileAppRelease.version_code)).scalar()


def _check_version_code(db: Session, version_code: int) -> None:
    if version_code < 1:
        raise HTTPException(
            status_code=422,
            detail=f"Version code must be a whole number of 1 or more (got {version_code}). "
                   "Use the versionCode from the app build.",
        )
    highest = _highest_code(db)
    if highest is not None and version_code <= highest:
        raise HTTPException(
            status_code=409,
            detail=f"Version code {version_code} is not higher than the latest published version ({highest}). "
                   f"Use {highest + 1} or higher.",
        )


def _check_min_supported(value: int | None, version_code: int) -> None:
    if value is None:
        return
    if value < 1 or value > version_code:
        raise HTTPException(
            status_code=422,
            detail=f"Oldest version still allowed ({value}) must be between 1 and this version's code "
                   f"({version_code}). Enter a version code in that range, or leave it empty.",
        )


def _check_version_name(version_name: str) -> str:
    name = (version_name or "").strip()
    if not _VERSION_NAME_RE.match(name):
        raise HTTPException(
            status_code=422,
            detail=f"Version name '{version_name}' is not valid. Use up to 50 letters, digits, dots, "
                   "dashes, underscores or + with no spaces, e.g. 1.4.0.",
        )
    return name


def check_apk(upload: UploadFile) -> tuple[int, str]:
    """Extension, ZIP signature and size of the uploaded APK; returns
    (size in bytes, SHA-256 hex) read in chunks from the spooled file."""
    filename = upload.filename or ""
    if not filename.lower().endswith(".apk"):
        raise HTTPException(
            status_code=422,
            detail=f"'{filename or 'the file'}' is not an Android app file. Choose the .apk file from the app build.",
        )
    f = upload.file
    try:
        f.seek(0, 2)
        size = f.tell()
        f.seek(0)
        header = f.read(4)
    except Exception:  # noqa: BLE001 - unreadable spool
        raise HTTPException(status_code=400, detail=f"Could not read '{filename}'. Choose the file again and retry.")
    if size == 0:
        raise HTTPException(status_code=422, detail=f"'{filename}' is empty. Choose the .apk file from the app build.")
    if size > MAX_APK_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"'{filename}' is {size / (1024 * 1024):.0f} MB; the limit for an app file is 250 MB. "
                   "Build a smaller APK (release build, split per CPU type) and upload that.",
        )
    if header != ZIP_MAGIC:
        raise HTTPException(
            status_code=422,
            detail=f"'{filename}' is not a real Android app file (it does not start like an APK). "
                   "Choose the .apk produced by the app build, not a renamed file.",
        )
    digest = hashlib.sha256()
    f.seek(0)
    while True:
        chunk = f.read(_HASH_CHUNK)
        if not chunk:
            break
        digest.update(chunk)
    f.seek(0)
    return size, digest.hexdigest()


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def _audit(db: Session, user: User, release: MobileAppRelease, action: str, summary: str) -> None:
    db.add(AuditLog(
        entity_type="mobile_app_release", entity_id=release.id, action=action,
        performed_by_id=user.id, summary=summary, module_key="organization",
    ))


async def create_release(
    db: Session, user: User, upload: UploadFile, *, version_name: str, version_code: int,
    notes: str | None, required: bool, min_supported_version_code: int | None,
) -> MobileAppRelease:
    name = _check_version_name(version_name)
    _check_version_code(db, version_code)
    _check_min_supported(min_supported_version_code, version_code)
    notes = (notes or "").strip() or None
    if notes and len(notes) > 5000:
        raise HTTPException(
            status_code=422,
            detail=f"What's new is {len(notes)} characters; the limit is 5000. Shorten the notes.",
        )
    size, sha = check_apk(upload)
    site_id = _require_sharepoint()

    file_name = f"PremnathERP-{name}.apk"
    folder = f"{_root_folder()}/{version_code}"
    try:
        stored = await upload_file_to_sharepoint(site_id, folder, _ApkUpload(file_name, upload.file))
    except (HTTPException, httpx.HTTPError) as exc:
        _log.warning("SharePoint upload of app %s failed: %s", name, getattr(exc, "detail", exc))
        raise HTTPException(
            status_code=502,
            detail="SharePoint did not accept the file. Try again in a few minutes; if it keeps failing, "
                   "ask IT to check the ERP SharePoint connection.",
        )

    release = MobileAppRelease(
        version_name=name, version_code=version_code, notes=notes, required=bool(required),
        min_supported_version_code=min_supported_version_code, is_active=True,
        file_name=stored.get("name") or file_name, file_size=size, sha256=sha,
        sharepoint_path=stored["path"], sharepoint_item_id=stored.get("item_id"),
        uploaded_by_id=user.id, released_at=datetime.now(timezone.utc),
    )
    db.add(release)
    try:
        db.flush()
    except IntegrityError:
        # Another admin published the same code a moment earlier.
        db.rollback()
        await _remove_file_quietly(site_id, stored["path"])
        highest = _highest_code(db) or version_code
        raise HTTPException(
            status_code=409,
            detail=f"Version code {version_code} is not higher than the latest published version ({highest}). "
                   f"Use {highest + 1} or higher.",
        )
    _audit(db, user, release, "create",
           f"{user.name} published app version {name} (code {version_code})"
           + (", update required" if release.required else ""))
    db.commit()
    db.refresh(release)
    return release


def update_release(db: Session, user: User, release: MobileAppRelease, payload: MobileAppReleaseUpdate) -> MobileAppRelease:
    sent = payload.model_fields_set
    changes: list[str] = []
    if "min_supported_version_code" in sent:
        _check_min_supported(payload.min_supported_version_code, release.version_code)
        if payload.min_supported_version_code != release.min_supported_version_code:
            release.min_supported_version_code = payload.min_supported_version_code
            changes.append(f"oldest allowed version {payload.min_supported_version_code or 'cleared'}")
    if "notes" in sent:
        notes = (payload.notes or "").strip() or None
        if notes != release.notes:
            release.notes = notes
            changes.append("what's new")
    if "required" in sent and payload.required is not None and payload.required != release.required:
        release.required = payload.required
        changes.append("update required" if payload.required else "update optional")
    if "is_active" in sent and payload.is_active is not None and payload.is_active != release.is_active:
        release.is_active = payload.is_active
        changes.append("active" if payload.is_active else "withdrawn")
    if changes:
        _audit(db, user, release, "update",
               f"{user.name} changed app version {release.version_name}: {', '.join(changes)}")
        db.commit()
        db.refresh(release)
    return release


async def _remove_file_quietly(site_id: str, path: str) -> None:
    try:
        await delete_file_from_sharepoint(site_id, path)
    except HTTPException as exc:
        _log.warning("Could not remove orphan app file %s: %s", path, exc.detail)


async def delete_release(db: Session, user: User, release: MobileAppRelease) -> None:
    if release.sharepoint_path:
        site_id = _require_sharepoint()
        try:
            await delete_file_from_sharepoint(site_id, release.sharepoint_path)
        except HTTPException as exc:
            # Already gone from SharePoint (removed by hand) is fine; anything else keeps the record.
            if "itemNotFound" not in str(exc.detail):
                _log.warning("SharePoint delete failed for %s: %s", release.sharepoint_path, exc.detail)
                raise HTTPException(
                    status_code=502,
                    detail=f"App version {release.version_name} was not deleted: SharePoint did not remove its file. "
                           "Try again in a minute; if it keeps failing, ask IT to check the portal's SharePoint connection.",
                )
    _audit(db, user, release, "delete",
           f"{user.name} deleted app version {release.version_name} (code {release.version_code})")
    db.delete(release)
    db.commit()


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def check_download_rate(user_id: int) -> None:
    """At most DOWNLOAD_LIMIT downloads per user per DOWNLOAD_WINDOW_SECONDS
    (in memory, per worker process)."""
    now = time.monotonic()
    with _download_lock:
        hits = _download_hits.setdefault(user_id, deque())
        while hits and now - hits[0] > DOWNLOAD_WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= DOWNLOAD_LIMIT:
            wait_min = max(1, int((DOWNLOAD_WINDOW_SECONDS - (now - hits[0])) // 60) + 1)
            raise HTTPException(
                status_code=429,
                detail=f"You have downloaded the app {DOWNLOAD_LIMIT} times in the last "
                       f"{DOWNLOAD_WINDOW_SECONDS // 60} minutes. Wait about {wait_min} minute(s) and try again.",
            )
        hits.append(now)


def reset_download_rate() -> None:
    with _download_lock:
        _download_hits.clear()


async def _open_sharepoint_stream(site_id: str, path: str) -> tuple[AsyncIterator[bytes], Callable[[], Awaitable[None]]]:
    """Open the file's Graph content as a stream (chunks, never the whole file
    in memory). Returns (chunk iterator, close). Raises 503 when SharePoint
    does not answer with the file."""
    encoded = "/".join(quote(p, safe="") for p in path.split("/") if p)
    url = f"{GRAPH_API}/sites/{site_id}/drive/root:/{encoded}:/content"
    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, read=300.0), follow_redirects=True)
    try:
        token = await get_app_graph_token()
        response = await client.send(client.build_request("GET", url, headers={"Authorization": f"Bearer {token}"}),
                                     stream=True)
    except Exception as exc:  # noqa: BLE001 - token or network failure
        await client.aclose()
        _log.warning("SharePoint stream failed for %s: %s", path, exc)
        raise HTTPException(status_code=503, detail=DOWNLOAD_BUSY_MESSAGE)
    if response.status_code != 200:
        _log.warning("SharePoint stream returned %s for %s", response.status_code, path)
        await response.aclose()
        await client.aclose()
        raise HTTPException(status_code=503, detail=DOWNLOAD_BUSY_MESSAGE)

    async def close() -> None:
        await response.aclose()
        await client.aclose()

    return response.aiter_bytes(1024 * 1024), close


async def download_response(release: MobileAppRelease) -> Response:
    """Redirect to SharePoint's short-lived pre-authenticated link (big file
    never passes through this server); if SharePoint will not give a link,
    stream the file through in chunks (never buffered whole)."""
    site_id = _require_sharepoint()
    try:
        url = await get_download_url(site_id, release.sharepoint_path)
        return RedirectResponse(url, status_code=307, headers={"Cache-Control": "no-store"})
    except HTTPException as exc:
        _log.warning("No SharePoint download link for app %s, streaming instead: %s", release.version_name, exc.detail)
    chunks, close = await _open_sharepoint_stream(site_id, release.sharepoint_path)
    return StreamingResponse(
        chunks,
        media_type=APK_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{download_name(release)}"',
            "Cache-Control": "no-store",
        },
        background=BackgroundTask(close),
    )
