"""Organization › Security & Sessions: session policy and login audit.

Sign-in is Microsoft Entra ID (Azure AD) SSO, so MFA, password policy and
account lockout are configured in Entra (Conditional Access), not here. The
portal owns what happens after sign-in: how long a session lives, idle
timeout, how many concurrent sessions a user may keep, revoking sessions,
and an audit trail of sign-ins and blocked sign-ins."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user_session import UserSession
from app.modules.organization.models.approval import OrganizationSetting

SECURITY_KEY = "security"
LIMITS = {
    "access_token_minutes": (5, 120, "Access token lifetime must be 5–120 minutes."),
    "refresh_token_days": (1, 30, "Session lifetime must be 1–30 days."),
    "idle_timeout_minutes": (0, 7 * 24 * 60, "Idle timeout must be 0 (off) up to 10080 minutes (7 days)."),
    "max_sessions_per_user": (0, 20, "Concurrent sessions must be 0 (unlimited) up to 20."),
    "app_lock_idle_minutes": (1, 480, "App lock after idle must be 1–480 minutes."),
    "app_password_min_length": (4, 32, "App password minimum length must be 4–32 characters."),
}
# On/off switches (not numbers).
FLAGS = {"app_lock_enabled"}


def defaults() -> dict:
    return {
        "access_token_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        "refresh_token_days": settings.REFRESH_TOKEN_EXPIRE_DAYS,
        "idle_timeout_minutes": 0,
        "max_sessions_per_user": 0,
        # App password (services/app_lock.py) — shared laptops share the
        # Windows / Microsoft password, so the portal asks its own.
        "app_lock_enabled": True,
        "app_lock_idle_minutes": 15,
        "app_password_min_length": 6,
    }


def get_security_settings(db: Session) -> dict:
    row = db.query(OrganizationSetting).filter(OrganizationSetting.key == SECURITY_KEY).first()
    out = defaults()
    if row and isinstance(row.value, dict):
        out.update({k: v for k, v in row.value.items() if k in out})
    return out


def save_security_settings(db: Session, values: dict, actor) -> dict:
    current = get_security_settings(db)
    for key, value in values.items():
        if key in FLAGS and value is not None:
            current[key] = bool(value)
            continue
        if key not in LIMITS or value is None:
            continue
        lo, hi, msg = LIMITS[key]
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            raise HTTPException(status_code=422, detail=msg)
        current[key] = value
    row = db.query(OrganizationSetting).filter(OrganizationSetting.key == SECURITY_KEY).first()
    old = dict(row.value) if row and isinstance(row.value, dict) else defaults()
    if row is None:
        row = OrganizationSetting(key=SECURITY_KEY)
        db.add(row)
    row.value = current
    row.updated_by_id = actor.id
    changed = {k: (old.get(k), v) for k, v in current.items() if old.get(k) != v}
    if changed:
        db.add(AuditLog(
            entity_type="security_settings", entity_id=0, action="updated", module_key="organization", subtab_key="security",
            performed_by_id=actor.id,
            summary=f"{actor.name} changed security settings: " + ", ".join(f"{k} {a} → {b}" for k, (a, b) in changed.items()),
        ))
    return current


def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return request.client.host[:64] if request.client else None


def log_sign_in(db: Session, request: Request | None, *, user=None, email: str | None = None, ok: bool, reason: str = "",
                channel: str = "web") -> None:
    """Write a sign-in / blocked sign-in event to the audit trail (best effort)."""
    who = getattr(user, "name", None) or email or "unknown account"
    try:
        db.add(AuditLog(
            entity_type="login", entity_id=getattr(user, "id", None) or 0,
            action="login" if ok else "login_failed", module_key="organization", subtab_key="security",
            performed_by_id=getattr(user, "id", None),
            summary=(f"{who} signed in ({channel})" if ok else f"Blocked sign-in for {who} ({channel}): {reason}"),
            ip_address=client_ip(request),
            user_agent=(request.headers.get("user-agent", "")[:255] if request else None),
        ))
        if ok and user is not None:
            user.last_login_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()


def log_sign_out(db: Session, request: Request | None, user_id: int | None) -> None:
    if not user_id:
        return
    try:
        db.add(AuditLog(entity_type="login", entity_id=user_id, action="logout", module_key="organization",
                        subtab_key="security", performed_by_id=user_id, summary="Signed out",
                        ip_address=client_ip(request)))
        db.commit()
    except Exception:
        db.rollback()


def enforce_session_limit(db: Session, user_id: int) -> None:
    """Keep at most `max_sessions_per_user` live sessions: revoke the oldest
    before a new one is issued."""
    limit = get_security_settings(db)["max_sessions_per_user"]
    if not limit:
        return
    now = datetime.now(timezone.utc)
    live = (
        db.query(UserSession)
        .filter(UserSession.user_id == user_id, UserSession.revoked_at.is_(None), UserSession.expires_at > now)
        .order_by(UserSession.created_at.desc())
        .all()
    )
    for s in live[limit - 1:]:
        s.revoked_at, s.revoked_reason = now, "limit"


def session_expiry(db: Session) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=get_security_settings(db)["refresh_token_days"])


def is_idle(db: Session, session: UserSession) -> bool:
    minutes = get_security_settings(db)["idle_timeout_minutes"]
    if not minutes:
        return False
    started = session.created_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - started > timedelta(minutes=minutes)


def access_token_minutes(db: Session) -> int:
    return get_security_settings(db)["access_token_minutes"]
