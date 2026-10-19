"""App password lock screen (services/app_lock.py).

    GET  /auth/app-lock/status   lock state of this sign-in + the policy
    POST /auth/app-lock/set      first-time set / reset after a temporary password / change
    POST /auth/app-lock/unlock   app password (or the emailed temporary password)
    POST /auth/app-lock/lock     "Lock now" / the page's idle timer
    POST /auth/app-lock/heartbeat the person is using the page (no other API call needed)
    POST /auth/app-lock/forgot   email a one-time temporary password

Under /auth/ so a locked session can still reach them."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.user_session import UserSession
from app.modules.main.routes.auth import get_current_user
from app.modules.main.services import app_lock

router = APIRouter(prefix="/auth/app-lock", tags=["Authentication"])


class SetPasswordPayload(BaseModel):
    new_password: str
    current_password: str | None = None


class UnlockPayload(BaseModel):
    password: str


def _session(request: Request) -> UserSession:
    s = getattr(request.state, "app_session", None)
    if s is None:
        raise HTTPException(status_code=409, detail="The app password is for browser sign-ins only — this token has no sign-in session.")
    return s


@router.get("/status")
def lock_status(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return app_lock.status(db, user, getattr(request.state, "app_session", None))


@router.post("/set")
def set_app_password(payload: SetPasswordPayload, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    app_lock.set_password(db, user, _session(request), payload.new_password, payload.current_password, request)
    return app_lock.status(db, user, _session(request))


@router.post("/unlock")
def unlock(payload: UnlockPayload, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    app_lock.unlock(db, user, _session(request), payload.password, request)
    return app_lock.status(db, user, _session(request))


@router.post("/lock")
def lock_now(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    app_lock.lock(db, _session(request))
    return app_lock.status(db, user, _session(request))


@router.post("/heartbeat")
def heartbeat(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    app_lock.heartbeat(db, _session(request))
    return app_lock.status(db, user, _session(request))


@router.post("/forgot")
async def forgot(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _session(request)
    sent_to = await app_lock.send_temp_password(db, user, request)
    return {"sent_to": sent_to, "valid_minutes": app_lock.TEMP_VALID_MINUTES}
