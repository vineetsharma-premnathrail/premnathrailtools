"""App password — a portal lock on top of Microsoft sign-in.

Why: the company's laptops share one Windows / Microsoft password, so an
open laptop (or anyone who knows that password) gets straight into the
portal through SSO. Each user therefore keeps a short app password of their
own, asked:

  * after every new sign-in (a new session starts 'locked'),
  * after `app_lock_idle_minutes` without real user activity,
  * whenever the user presses "Lock now".

It is enforced on the server (get_current_user → enforce), not only drawn
over the page, so a locked session gets 423 on every API call except the
/auth routes. A forgotten password is reset by the user: a one-time
temporary password is emailed to their Microsoft mailbox; entering it lets
them set a new one (session state 'reset'), nothing else.

Tokens without a session id (API tooling, tests) are not sign-in sessions
and are not locked."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.models.user_session import UserSession

LOCKED, UNLOCKED, RESET = "locked", "unlocked", "reset"
MAX_FAILED = 5
LOCKOUT_MINUTES = 15
TEMP_VALID_MINUTES = 15
TEMP_RESEND_SECONDS = 120
_ACTIVITY_WRITE_SECONDS = 30
_PBKDF2_ITERATIONS = 260_000
# Routes a locked session may still call: sign-in/out, refresh, /auth/me and
# the app-lock routes themselves.
_OPEN_PREFIX = "/api/v1/auth/"
# The frontend sends this header only while the person is really using the
# page (mouse / keys in the last minute) — background polling (the bell)
# must not keep an unattended laptop unlocked.
ACTIVITY_HEADER = "x-user-active"
# Easy-to-read temporary passwords: no 0/O, 1/l/I.
_TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def hash_password(raw: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS).hex()
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(raw: str, stored: str | None) -> bool:
    if not stored or not raw:
        return False
    try:
        _algo, iterations, salt, digest = stored.split("$")
        check = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), bytes.fromhex(salt), int(iterations)).hex()
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(check, digest)


def policy(db: Session) -> dict:
    from app.modules.organization.services.security import get_security_settings
    s = get_security_settings(db)
    return {"enabled": bool(s["app_lock_enabled"]), "idle_minutes": s["app_lock_idle_minutes"], "min_length": s["app_password_min_length"]}


def _audit(db: Session, user: User, action: str, summary: str, request: Request | None = None) -> None:
    from app.modules.organization.services.security import client_ip
    db.add(AuditLog(entity_type="login", entity_id=user.id, action=action, module_key="organization", subtab_key="security",
                    performed_by_id=user.id, summary=summary, ip_address=client_ip(request)))


def session_state(db: Session, session: UserSession, pol: dict | None = None) -> str:
    """The session's lock state, applying the idle lock: an unlocked session
    with no real activity for `idle_minutes` is locked (and saved so)."""
    pol = pol or policy(db)
    state = session.app_lock_state or LOCKED
    if state == UNLOCKED:
        last = _aware(session.app_activity_at)
        if last is None or _now() - last > timedelta(minutes=pol["idle_minutes"]):
            session.app_lock_state = state = LOCKED
            db.commit()
    return state


def enforce(request: Request, db: Session, user: User, session: UserSession) -> None:
    """Called by get_current_user for every sign-in session: 423 while the
    session is locked (except the /auth routes); records real activity."""
    pol = policy(db)
    if not pol["enabled"]:
        return
    if request.url.path.startswith(_OPEN_PREFIX):
        return
    state = session_state(db, session, pol)
    if state != UNLOCKED:
        if not user.app_password_hash:
            msg = "Set your app password to continue — it protects your account if someone else uses your laptop."
        elif state == RESET:
            msg = "Set a new app password to continue."
        else:
            msg = "The portal is locked — enter your app password to continue."
        raise HTTPException(status_code=423, detail=msg, headers={"X-App-Lock": state})
    if request.headers.get(ACTIVITY_HEADER) == "1":
        last = _aware(session.app_activity_at)
        if last is None or _now() - last > timedelta(seconds=_ACTIVITY_WRITE_SECONDS):
            session.app_activity_at = _now()
            db.commit()


def heartbeat(db: Session, session: UserSession) -> None:
    """The page reports real activity (mouse / keys) even when the person makes
    no API call for a while — e.g. filling a long form — so the idle lock
    doesn't fire on them mid-form. Never unlocks a locked session."""
    if session_state(db, session) == UNLOCKED:
        session.app_activity_at = _now()
        db.commit()


def status(db: Session, user: User, session: UserSession | None) -> dict:
    pol = policy(db)
    locked_until = _aware(user.app_password_locked_until)
    temp_until = _aware(user.app_temp_password_expires_at)
    return {
        "enabled": pol["enabled"],
        "idle_minutes": pol["idle_minutes"],
        "min_length": pol["min_length"],
        "has_password": bool(user.app_password_hash),
        "state": session_state(db, session, pol) if session is not None else UNLOCKED,
        "locked_until": locked_until if locked_until and locked_until > _now() else None,
        "temp_password_pending": bool(user.app_temp_password_hash and temp_until and temp_until > _now()),
        "email": mask_email(user.email),
    }


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return email
    name, domain = email.split("@", 1)
    return f"{name[:2]}{'•' * max(len(name) - 2, 3)}@{domain}"


def _check_new_password(db: Session, user: User, new: str) -> None:
    pol = policy(db)
    new = new or ""
    if len(new) < pol["min_length"]:
        raise HTTPException(status_code=422, detail=f"The app password must be at least {pol['min_length']} characters.")
    if len(new) > 128:
        raise HTTPException(status_code=422, detail="The app password can be at most 128 characters.")
    if new.strip() != new or not new.strip():
        raise HTTPException(status_code=422, detail="The app password can't start or end with a space.")
    if len(set(new)) == 1:
        raise HTTPException(status_code=422, detail="Pick an app password that isn't one character repeated (like 111111).")
    if new.lower() in {"123456", "1234567", "12345678", "123456789", "password", "qwerty", "abcdef", "abc123"}:
        raise HTTPException(status_code=422, detail="That app password is too easy to guess — pick another one.")
    if user.app_password_hash and verify_password(new, user.app_password_hash):
        raise HTTPException(status_code=422, detail="The new app password is the same as the current one — pick a different one.")


def set_password(db: Session, user: User, session: UserSession, new: str, current: str | None, request: Request) -> None:
    """First-time set, a reset after the emailed temporary password, or a
    change (needs the current password)."""
    state = session_state(db, session)
    first_time = not user.app_password_hash
    if not first_time and state != RESET:
        if state != UNLOCKED:
            raise HTTPException(status_code=423, detail="Unlock first with your app password, or use 'Forgot app password'.")
        if not verify_password(current or "", user.app_password_hash):
            _failed(db, user, request)
            raise HTTPException(status_code=422, detail="The current app password is wrong.")
    _check_new_password(db, user, new)
    user.app_password_hash = hash_password(new)
    user.app_password_set_at = _now()
    user.app_password_failed = 0
    user.app_password_locked_until = None
    user.app_temp_password_hash = user.app_temp_password_expires_at = None
    session.app_lock_state, session.app_activity_at = UNLOCKED, _now()
    what = "set their app password" if first_time else ("reset their app password" if state == RESET else "changed their app password")
    _audit(db, user, "app_password_set", f"{user.name or user.email} {what}", request)
    db.commit()


def _failed(db: Session, user: User, request: Request) -> str:
    user.app_password_failed = (user.app_password_failed or 0) + 1
    if user.app_password_failed >= MAX_FAILED:
        user.app_password_failed = 0
        user.app_password_locked_until = _now() + timedelta(minutes=LOCKOUT_MINUTES)
        _audit(db, user, "app_password_lockout", f"App password locked for {LOCKOUT_MINUTES} min after {MAX_FAILED} wrong tries ({user.name or user.email})", request)
        db.commit()
        return (f"Wrong app password {MAX_FAILED} times — locked for {LOCKOUT_MINUTES} minutes. "
                "Use 'Forgot app password' to get a temporary password by email.")
    db.commit()
    left = MAX_FAILED - user.app_password_failed
    return f"Wrong app password — {left} {'try' if left == 1 else 'tries'} left before a {LOCKOUT_MINUTES}-minute lock."


def unlock(db: Session, user: User, session: UserSession, password: str, request: Request) -> str:
    """Unlock with the app password, or with the emailed temporary password
    (→ 'reset': the session may only set a new password). Returns the new state."""
    password = password or ""
    temp_until = _aware(user.app_temp_password_expires_at)
    if user.app_temp_password_hash and temp_until and temp_until > _now() and verify_password(password.strip(), user.app_temp_password_hash):
        user.app_temp_password_hash = user.app_temp_password_expires_at = None  # one-time
        user.app_password_failed, user.app_password_locked_until = 0, None
        session.app_lock_state, session.app_activity_at = RESET, _now()
        _audit(db, user, "app_password_temp_used", f"{user.name or user.email} signed in with an emailed temporary app password", request)
        db.commit()
        return RESET
    locked_until = _aware(user.app_password_locked_until)
    if locked_until and locked_until > _now():
        mins = max(1, int((locked_until - _now()).total_seconds() // 60) + 1)
        raise HTTPException(status_code=429, detail=(f"Too many wrong tries — the app password is locked for {mins} more minute(s). "
                                                     "Use 'Forgot app password' to get a temporary password by email."))
    if not user.app_password_hash:
        raise HTTPException(status_code=409, detail="You haven't set an app password yet — set one first.")
    if not verify_password(password, user.app_password_hash):
        raise HTTPException(status_code=422, detail=_failed(db, user, request))
    user.app_password_failed, user.app_password_locked_until = 0, None
    session.app_lock_state, session.app_activity_at = UNLOCKED, _now()
    db.commit()
    return UNLOCKED


def lock(db: Session, session: UserSession) -> None:
    session.app_lock_state = LOCKED
    db.commit()


def issue_temp_password(db: Session, user: User, request: Request | None, *, by: User | None = None) -> str:
    """Make a one-time temporary password (valid TEMP_VALID_MINUTES) and
    return it for emailing. Refuses a resend within TEMP_RESEND_SECONDS."""
    if not user.email:
        raise HTTPException(status_code=422, detail="This user has no email address, so a temporary password can't be sent — ask an admin.")
    sent = _aware(user.app_temp_password_sent_at)
    if by is None and sent and (_now() - sent).total_seconds() < TEMP_RESEND_SECONDS:
        wait = int(TEMP_RESEND_SECONDS - (_now() - sent).total_seconds()) + 1
        raise HTTPException(status_code=429, detail=f"A temporary password was just sent to {mask_email(user.email)} — check your inbox (and Junk), or ask again in {wait} seconds.")
    temp = "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(10))
    user.app_temp_password_hash = hash_password(temp)
    user.app_temp_password_expires_at = _now() + timedelta(minutes=TEMP_VALID_MINUTES)
    user.app_temp_password_sent_at = _now()
    who = f"{by.name or by.email} sent" if by else "Requested"
    _audit(db, user, "app_password_temp_sent", f"{who} a temporary app password to {user.email}", request)
    return temp


def temp_password_email(user: User, temp: str) -> tuple[str, str]:
    from html import escape
    from app.utils.email import _wrap_email_html
    subject = "Your temporary app password — Premnathrail ERP"
    body = f"""
    <p style="margin:0 0 4px;font-size:14px;color:#1e293b;font-weight:700">Dear {escape(user.name or user.email)},</p>
    <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.7">You asked to reset your ERP portal app password. Enter this temporary password on the lock screen, then set a new app password.</p>
    <p style="margin:0 0 18px;text-align:center"><span style="display:inline-block;font-family:Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:3px;padding:12px 22px;border-radius:10px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412">{escape(temp)}</span></p>
    <p style="margin:0 0 6px;font-size:13px;color:#475569">It works once and expires in {TEMP_VALID_MINUTES} minutes.</p>
    <p style="margin:0;font-size:13px;color:#b91c1c">Didn't ask for this? Someone may be trying to use your laptop — tell your admin. Your current app password keeps working.</p>"""
    return subject, _wrap_email_html(body)


async def send_temp_password(db: Session, user: User, request: Request | None, *, by: User | None = None) -> str:
    """Issue + email a temporary password. Returns the masked address; raises
    503 with the real reason when the mail can't go out (nothing is kept)."""
    from app.core.config import settings
    from app.utils.email import _send_graph_mail
    if not settings.SENDER_EMAIL:
        raise HTTPException(status_code=503, detail="Email isn't set up on the server (SENDER_EMAIL is empty), so a temporary password can't be sent — ask an admin to set it.")
    temp = issue_temp_password(db, user, request, by=by)
    subject, html = temp_password_email(user, temp)
    ok, err = await _send_graph_mail(settings.SENDER_EMAIL, subject, html, user.email, user.name or user.email, sender_name="Premnathrail ERP")
    if not ok:
        db.rollback()
        raise HTTPException(status_code=503, detail=f"The temporary password email couldn't be sent ({err[:160]}). Try again in a minute, or ask an admin.")
    db.commit()
    return mask_email(user.email)
