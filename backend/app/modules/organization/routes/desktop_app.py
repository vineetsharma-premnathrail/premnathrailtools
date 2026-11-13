"""Windows app installer: details + download link (any signed-in user), upload
(portal admin only, browser -> SharePoint directly). See services/desktop_app.py."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permission_registry import is_admin_user
from app.db.session import get_db
from app.modules.main.routes.auth import get_current_user
from app.modules.main.models.user import User
from app.modules.organization.services import desktop_app as svc

router = APIRouter(prefix="/desktop-app", tags=["Windows app"])


def _admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Only the portal admin can upload the Windows app.")
    return user


class UploadStart(BaseModel):
    version: str
    file_name: str
    file_size: int


class UploadComplete(BaseModel):
    version: str
    item_id: str


@router.get("")
def info(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return svc.public_info(svc.current(db))


@router.get("/download-link")
async def download_link(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    """A short-lived link straight to the file in SharePoint (about 1 hour)."""
    return {"url": await svc.download_link(db), "file_name": (svc.current(db) or {}).get("file_name")}


@router.post("/upload-session")
async def upload_session(payload: UploadStart, _admin_user: User = Depends(_admin)):
    return await svc.start_upload(payload.version, payload.file_name, payload.file_size)


@router.post("/complete")
async def complete(payload: UploadComplete, db: Session = Depends(get_db), admin: User = Depends(_admin)):
    return svc.public_info(await svc.complete_upload(db, admin, payload.version, payload.item_id))
