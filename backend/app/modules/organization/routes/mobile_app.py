"""Android app versions (Organization › Mobile App) - owner 2026-11-12.

- Any signed-in user / the app: latest active version + download.
- Portal admins only (deny by default): list, publish, change, delete.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.core.permission_registry import is_admin_user
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.schemas.mobile_app import (
    MobileAppLatestResponse, MobileAppReleaseResponse, MobileAppReleaseUpdate,
)
from app.modules.organization.services import mobile_app as svc


class _UploadSizeCapRoute(APIRoute):
    """Refuses an oversized publish request from its Content-Length header
    BEFORE FastAPI reads/spools the multipart body (body params are parsed
    before dependencies and the handler run)."""

    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        handler = super().get_route_handler()
        if "POST" not in self.methods or not self.path.endswith("/releases"):
            return handler

        async def capped(request: Request) -> Response:
            raw = request.headers.get("content-length") or ""
            if raw.isdigit() and int(raw) > svc.MAX_UPLOAD_REQUEST_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"The upload is {int(raw) / (1024 * 1024):.0f} MB; the limit for an app file "
                                       "is 250 MB. Build a smaller APK (release build, split per CPU type) and upload that."},
                )
            return await handler(request)

        return capped


router = APIRouter(prefix="/mobile-app", tags=["Organization - Mobile App"], route_class=_UploadSizeCapRoute)


def require_portal_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin_user(user):
        raise HTTPException(
            status_code=403,
            detail="Only a portal admin can publish or change mobile app versions. "
                   "Ask a portal admin to do it, or to give you the admin role.",
        )
    return user


@router.get("/latest", response_model=MobileAppLatestResponse)
def latest(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    release = svc.latest_release(db)
    if release is None:
        raise HTTPException(status_code=404, detail=svc.NO_RELEASE_MESSAGE)
    return svc.latest_out(release)


@router.get("/releases/{release_id}/download")
async def download(release_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    release = svc.get_release(db, release_id)
    if not release.is_active and not is_admin_user(user):
        # A withdrawn version is downloadable by portal admins only.
        raise HTTPException(
            status_code=404,
            detail=f"App version #{release_id} is not available any more. Download the latest version instead.",
        )
    svc.check_download_rate(user.id)
    return await svc.download_response(release)


@router.get("/releases", response_model=list[MobileAppReleaseResponse])
def list_releases(db: Session = Depends(get_db), _admin: User = Depends(require_portal_admin)):
    return svc.releases_out(db, svc.list_releases(db))


@router.post("/releases", response_model=MobileAppReleaseResponse, status_code=201)
async def publish(
    file: UploadFile = File(...),
    version_name: str = Form(...),
    version_code: int = Form(...),
    notes: str | None = Form(None),
    required: bool = Form(False),
    min_supported_version_code: int | None = Form(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_portal_admin),
):
    release = await svc.create_release(
        db, admin, file, version_name=version_name, version_code=version_code, notes=notes,
        required=required, min_supported_version_code=min_supported_version_code,
    )
    return svc.releases_out(db, [release])[0]


@router.patch("/releases/{release_id}", response_model=MobileAppReleaseResponse)
def update(
    release_id: int, payload: MobileAppReleaseUpdate,
    db: Session = Depends(get_db), admin: User = Depends(require_portal_admin),
):
    release = svc.update_release(db, admin, svc.get_release(db, release_id), payload)
    return svc.releases_out(db, [release])[0]


@router.delete("/releases/{release_id}")
async def delete(release_id: int, db: Session = Depends(get_db), admin: User = Depends(require_portal_admin)):
    await svc.delete_release(db, admin, svc.get_release(db, release_id))
    return {"ok": True}
