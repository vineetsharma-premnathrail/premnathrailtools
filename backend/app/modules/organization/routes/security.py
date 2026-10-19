"""Organization › Security & Sessions: session policy, live sessions with
revoke, and the sign-in audit trail."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_action
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.models.user_session import UserSession
from app.modules.organization.services import security as sec

router = APIRouter(prefix="/organization/security", tags=["Organization - Security"])

_can_view = require_tab_action("organization", "security", "view")
_can_edit = require_tab_action("organization", "security", "edit")


class SecuritySettingsPayload(BaseModel):
    access_token_minutes: int | None = None
    refresh_token_days: int | None = None
    idle_timeout_minutes: int | None = None
    max_sessions_per_user: int | None = None
    app_lock_enabled: bool | None = None
    app_lock_idle_minutes: int | None = None
    app_password_min_length: int | None = None


@router.get("/settings")
async def get_settings(db: Session = Depends(get_db), _user: User = Depends(_can_view)):
    return {"values": sec.get_security_settings(db), "defaults": sec.defaults()}


@router.put("/settings")
async def save_settings(payload: SecuritySettingsPayload, db: Session = Depends(get_db), actor: User = Depends(_can_edit)):
    values = sec.save_security_settings(db, payload.model_dump(exclude_none=True), actor)
    db.commit()
    return {"values": values, "defaults": sec.defaults()}


def _session_out(s: UserSession, names: dict[int, tuple[str, str]]) -> dict:
    name, email = names.get(s.user_id, (None, None))
    return {
        "id": s.id, "user_id": s.user_id, "user_name": name, "user_email": email, "created_at": s.created_at,
        "last_used_at": s.last_used_at, "expires_at": s.expires_at, "revoked_at": s.revoked_at,
        "revoked_reason": s.revoked_reason, "ip_address": s.ip_address, "user_agent": s.user_agent,
        "app_lock_state": s.app_lock_state,
    }


@router.get("/sessions")
async def live_sessions(user_id: int | None = None, db: Session = Depends(get_db), _user: User = Depends(_can_view)):
    """Signed-in sessions that are still valid (one row per device/browser)."""
    now = datetime.now(timezone.utc)
    q = db.query(UserSession).filter(UserSession.revoked_at.is_(None), UserSession.expires_at > now)
    if user_id:
        q = q.filter(UserSession.user_id == user_id)
    rows = q.order_by(UserSession.created_at.desc()).limit(500).all()
    names = {u.id: (u.name, u.email) for u in db.query(User.id, User.name, User.email).filter(User.id.in_({r.user_id for r in rows} or {-1}))}
    return [_session_out(s, names) for s in rows]


@router.post("/sessions/{session_id}/revoke")
async def revoke_session(session_id: int, db: Session = Depends(get_db), actor: User = Depends(_can_edit)):
    s = db.get(UserSession, session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found — it may have ended already. Reload the list.")
    if s.revoked_at is None:
        s.revoked_at, s.revoked_reason = datetime.now(timezone.utc), "admin"
        target = db.get(User, s.user_id)
        db.add(AuditLog(entity_type="login", entity_id=s.user_id, action="session_revoked", module_key="organization",
                        subtab_key="security", performed_by_id=actor.id,
                        summary=f"{actor.name} signed out {target.name if target else 'a user'} on one device"))
        db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/revoke-all")
async def revoke_all(user_id: int, db: Session = Depends(get_db), actor: User = Depends(_can_edit)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    now = datetime.now(timezone.utc)
    rows = db.query(UserSession).filter(UserSession.user_id == user_id, UserSession.revoked_at.is_(None)).all()
    for s in rows:
        s.revoked_at, s.revoked_reason = now, "admin"
    db.add(AuditLog(entity_type="login", entity_id=user_id, action="session_revoked", module_key="organization",
                    subtab_key="security", performed_by_id=actor.id,
                    summary=f"{actor.name} signed out {target.name} everywhere ({len(rows)} session(s))"))
    db.commit()
    return {"revoked": len(rows)}


@router.post("/users/{user_id}/app-password-reset")
async def send_app_password_reset(user_id: int, request: Request, db: Session = Depends(get_db), actor: User = Depends(_can_edit)):
    """Admin help for a user who can't reset their app password themselves:
    emails them a one-time temporary password (the admin never sees it)."""
    from app.modules.main.services.app_lock import send_temp_password
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"sent_to": await send_temp_password(db, target, request, by=actor)}


@router.get("/sign-ins")
async def sign_in_events(user_id: int | None = None, failed_only: bool = False, limit: int = 200,
                         db: Session = Depends(get_db), _user: User = Depends(_can_view)):
    q = db.query(AuditLog).filter(AuditLog.entity_type == "login")
    if user_id:
        q = q.filter(AuditLog.entity_id == user_id)
    if failed_only:
        q = q.filter(AuditLog.action == "login_failed")
    rows = q.order_by(AuditLog.id.desc()).limit(min(max(limit, 1), 1000)).all()
    return [{
        "id": r.id, "action": r.action, "summary": r.summary, "user_id": r.entity_id or None,
        "ip_address": r.ip_address, "user_agent": r.user_agent, "created_at": r.performed_at,
    } for r in rows]
