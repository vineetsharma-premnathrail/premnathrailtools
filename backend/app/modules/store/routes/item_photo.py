"""One photo per Store item, stored in SharePoint (same as other attachments)
and served back through the app so the browser never talks to SharePoint."""
import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.utils.sharepoint import (
    delete_file_from_sharepoint, download_file_content, sanitize_folder_name, upload_file_to_sharepoint,
)

router = APIRouter(prefix="/store/items", tags=["Store"])

MAX_PHOTO_BYTES = 5 * 1024 * 1024


def _get_item(db: Session, item_id: int) -> StoreItem:
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found — it may have been deleted. Reload the page.")
    return item


def _require_sharepoint() -> None:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="Photo storage (SharePoint) isn't configured on the server — ask the admin to set SHAREPOINT_SITE_ID.")


@router.post("/{item_id}/photo")
async def upload_item_photo(
    item_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = _get_item(db, item_id)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"'{file.filename}' isn't an image — upload a JPG, PNG or WEBP photo.")
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail=f"The photo is {size / 1024 / 1024:.1f} MB — keep it under 5 MB (resize or compress it and try again).")
    _require_sharepoint()

    # Named after the item code so a replacement overwrites the same file.
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    file.filename = f"{item.item_code}{ext}"
    root = sanitize_folder_name(settings.SHAREPOINT_FOLDER or "ERP-media")
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, f"{root}/Store-Items", file)

    old_path = item.photo_path
    item.photo_path = result["path"]
    item.photo_content_type = file.content_type
    db.commit()
    if old_path and old_path != item.photo_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, old_path)
        except HTTPException:
            pass  # old file left behind; the item already points at the new one
    return {"has_photo": True}


@router.get("/{item_id}/photo")
async def get_item_photo(
    item_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = _get_item(db, item_id)
    if not item.photo_path:
        raise HTTPException(status_code=404, detail="This item has no photo yet.")
    _require_sharepoint()
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, item.photo_path)
    return Response(content=content, media_type=item.photo_content_type or content_type,
                    headers={"Cache-Control": "private, max-age=300"})


@router.delete("/{item_id}/photo")
async def delete_item_photo(
    item_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    item = _get_item(db, item_id)
    if item.photo_path and settings.SHAREPOINT_SITE_ID:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, item.photo_path)
        except HTTPException:
            pass
    item.photo_path = None
    item.photo_content_type = None
    db.commit()
    return {"has_photo": False}
