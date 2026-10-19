"""Single-file SharePoint storage for Design records other than drawing
revisions: customer letters, standards, templates. Same rules as
revisions.py — files stream through the app token, never a raw SharePoint
URL, and the response type is derived from the file name."""
import mimetypes
from urllib.parse import quote

from fastapi import HTTPException, Response, UploadFile

from app.core.config import settings
from app.utils.sharepoint import delete_file_from_sharepoint, download_file_content, upload_file_to_sharepoint

STORAGE_NOT_CONFIGURED = (
    "File storage isn't set up on this server (SharePoint site ID missing), so Design files can't be "
    "uploaded or opened. Ask IT to set SHAREPOINT_SITE_ID in the backend configuration."
)
_INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/bmp", "image/webp"}


async def store_file(folder: str, upload: UploadFile) -> dict:
    """Uploads one file; returns {name, path, size}. Raises a readable 4xx/5xx."""
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=STORAGE_NOT_CONFIGURED)
    try:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, upload)
    except HTTPException:
        raise
    except Exception as exc:  # network / Graph outage
        raise HTTPException(
            status_code=502,
            detail=f"'{upload.filename}' couldn't be uploaded: SharePoint didn't respond ({exc.__class__.__name__}). Try again in a minute.",
        )
    return {"name": result["name"], "path": result["path"], "size": result.get("size")}


async def remove_file(path: str | None) -> None:
    if settings.SHAREPOINT_SITE_ID and path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, path)
        except Exception:
            pass  # the record is updated either way; an orphaned file is harmless


async def stream_file(path: str | None, file_name: str, download: bool = False) -> Response:
    if not path:
        raise HTTPException(status_code=404, detail="No file is attached here.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=STORAGE_NOT_CONFIGURED)
    content, _claimed = await download_file_content(settings.SHAREPOINT_SITE_ID, path)
    mime = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
    kind = "inline" if mime in _INLINE_TYPES and not download else "attachment"
    ascii_name = (file_name.encode("ascii", "ignore").decode() or "download").replace('"', "")
    return Response(
        content=content, media_type=mime,
        headers={
            "Content-Disposition": f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )
