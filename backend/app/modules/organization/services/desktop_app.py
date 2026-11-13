"""Windows app installer: the portal admin uploads it once, every signed-in user
downloads it from their profile menu (owner, 2026-11-13).

The Windows app (desktop/, Electron) only opens the live portal, so a new
installer is needed rarely: only when desktop/ itself changes. One file is
kept: uploading a new one replaces the old.

- The .exe lives in SharePoint (<SHAREPOINT_FOLDER>/Desktop App/Windows/).
- It is ~100 MB, so like every big file it goes browser -> SharePoint directly
  (frontend/src/lib/largeUpload.ts): the API opens the upload session, then
  checks the stored file on "complete" (right folder, .exe, Windows program
  header "MZ") and deletes it if it isn't one. The shared check in
  sharepoint.validate_upload_metadata doesn't allow .exe on purpose.
- Its details (version, size, who / when) are one key in organization_settings,
  so no table of its own is needed.
- The download is a short-lived pre-authenticated SharePoint link handed out
  only to a signed-in user, so the file never passes through the API.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.approval import OrganizationSetting
from app.utils.sharepoint import (
    create_upload_session, delete_drive_item, get_download_url, get_drive_item, read_item_head, sanitize_folder_name,
)

_log = logging.getLogger(__name__)

SETTING_KEY = "desktop_app_installer"
MAX_BYTES = 500 * 1024 * 1024
CHUNK_SIZE = 10 * 1024 * 1024  # Graph wants a multiple of 320 KiB; 10 MiB is one
_VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+-]{0,29}$")


def _folder() -> str:
    return f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/Desktop App/Windows"


def _site() -> str:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(
            status_code=503,
            detail="The portal's SharePoint storage is not set up, so the Windows app file can't be stored or "
                   "downloaded. Ask IT to set SHAREPOINT_SITE_ID for the portal, then try again.")
    return settings.SHAREPOINT_SITE_ID


def current(db: Session) -> dict | None:
    row = db.query(OrganizationSetting).filter(OrganizationSetting.key == SETTING_KEY).first()
    return row.value if row and isinstance(row.value, dict) and row.value.get("path") else None


def public_info(info: dict | None) -> dict:
    if not info:
        return {"available": False}
    return {"available": True, "version": info.get("version"), "file_name": info.get("file_name"),
            "file_size": info.get("file_size"), "released_at": info.get("released_at"),
            "uploaded_by_name": info.get("uploaded_by_name")}


def _version(value: str) -> str:
    value = (value or "").strip()
    if not _VERSION_RE.match(value):
        raise HTTPException(status_code=422, detail="Version must be like 1.0.2 (letters, digits, dot, dash; up to 30).")
    return value


async def start_upload(version: str, file_name: str, file_size: int) -> dict:
    """Step 1: check what the browser is about to send and open the SharePoint upload session."""
    version = _version(version)
    if not (file_name or "").lower().endswith(".exe"):
        raise HTTPException(status_code=422, detail=f"'{file_name or 'The file'}' is not a Windows installer. Choose the "
                                                    "Setup .exe made by the desktop app build (desktop/dist).")
    if not file_size or file_size <= 0:
        raise HTTPException(status_code=422, detail=f"'{file_name}' is empty. Choose the Setup .exe from the desktop app build.")
    if file_size > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"'{file_name}' is {file_size // (1024 * 1024)} MB; the limit is "
                                                    f"{MAX_BYTES // (1024 * 1024)} MB. Upload the Setup .exe, not a zip of the build folder.")
    stored_name = f"PremnathrailPortal-Setup-{version}.exe"
    session = await create_upload_session(_site(), _folder(), stored_name)
    return {"upload_url": session["upload_url"], "chunk_size": CHUNK_SIZE, "file_name": stored_name}


async def complete_upload(db: Session, user: User, version: str, item_id: str) -> dict:
    """Step 2: check the stored file, then make it the one everyone downloads."""
    version = _version(version)
    site = _site()
    item = await get_drive_item(site, item_id)
    name = item.get("name") or ""
    size = int(item.get("size") or 0)
    parent = ((item.get("parentReference") or {}).get("path") or "").split("root:", 1)[-1].strip("/")
    problem = None
    if parent.lower() != _folder().lower():
        problem = "it is not in the Windows app folder"
    elif not name.lower().endswith(".exe") or size <= 0:
        problem = "it is not a Windows installer (.exe)"
    elif (await read_item_head(site, item_id, 2)) != b"MZ":
        problem = "it is not a real Windows program (it may be a renamed file)"
    if problem:
        await delete_drive_item(site, item_id)
        raise HTTPException(status_code=422, detail=f"The uploaded file was removed: {problem}. Choose the Setup .exe "
                                                    "made by the desktop app build and upload it again.")

    old = current(db)
    info = {
        "version": version, "file_name": name, "file_size": size, "path": f"{_folder()}/{name}", "item_id": item_id,
        "released_at": datetime.now(timezone.utc).isoformat(), "uploaded_by_id": user.id, "uploaded_by_name": user.name,
    }
    row = db.query(OrganizationSetting).filter(OrganizationSetting.key == SETTING_KEY).first()
    if row is None:
        row = OrganizationSetting(key=SETTING_KEY)
        db.add(row)
    row.value = info
    row.updated_by_id = user.id
    db.add(AuditLog(entity_type="desktop_app", entity_id=0, action="updated", module_key="organization",
                    performed_by_id=user.id,
                    summary=f"{user.name} published Windows app {version} ({size // (1024 * 1024)} MB)"
                            + (f", replacing {old.get('version')}" if old else "")))
    db.commit()

    if old and old.get("item_id") and old["item_id"] != item_id:
        try:
            await delete_drive_item(site, old["item_id"])
        except Exception as exc:  # noqa: BLE001 — the new file is live; an old leftover is only clutter
            _log.warning("Old Windows installer not removed (%s): %s", old.get("path"), exc)
    return info


async def download_link(db: Session) -> str:
    info = current(db)
    if not info:
        raise HTTPException(status_code=404, detail="The Windows app hasn't been uploaded yet. Ask the portal admin to upload it.")
    return await get_download_url(_site(), info["path"])
