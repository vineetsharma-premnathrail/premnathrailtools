import base64
import json as _json
import logging
import secrets
import time
from typing import Dict
from urllib.parse import urlparse

import httpx
import msal
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from jose import JWTError, jwt as jose_jwt
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.schemas.auth import TokenResponse, CurrentUserResponse
from app.auth.jwt_handler import create_access_token, verify_access_token, create_refresh_token, hash_refresh_token
from app.modules.organization.services import security as org_security
from app.modules.main.models.user_session import UserSession
from datetime import datetime, timedelta, timezone
from app.auth.microsoft import get_auth_url, exchange_code_for_token, get_microsoft_user_profile, get_microsoft_manager_profile, get_azure_admin_ids
from app.modules.organization.services.provisioning import sync_user_org_links
from app.modules.hr.services.employee_sync import is_org_locked
from app.modules.hr.services.exit_guard import is_exited, exited_login_message
from app.core.config import settings
from app.core.permission_registry import is_admin_user, legacy_erp_permissions, restricted_subtabs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# ── Server-side OAuth state (avoids all browser cookie/SameSite issues with
# the redirect-based flow) ───────────────────────────────────────────────────
# Maps state token → {"next_path": ..., "expiry": ...}.
_oauth_states: Dict[str, dict] = {}
_MAX_PENDING_STATES = 500  # cap against DoS via repeated unauthenticated hits
_STATE_TTL_SECONDS = 600   # 10 minutes

# One-time codes for the Teams popup hand-off (popup cookies are isolated
# from the main frame, so the popup passes a short-lived code instead).
_teams_exchange_codes: Dict[str, dict] = {}
_TEAMS_CODE_TTL_SECONDS = 120

# JWKS cache — avoid fetching Azure AD's public keys on every Teams SSO call.
_jwks_cache: Dict[str, dict] = {}  # tenant_id → {"keys": ..., "expires": ...}
_JWKS_TTL_SECONDS = 3600

# No one-time-use check on Teams SSO tokens (owner decision 2026-10-27,
# Microsoft's Teams SSO pattern): Teams caches the getAuthToken() token for
# about an hour and returns the SAME token on every call, so rejecting a second
# use broke every retry, reload and silent renewal with "Token already used".
# The token is still signature-, audience-, tenant- and expiry-checked.


def _purge_expired_states() -> None:
    now = time.time()
    expired = [k for k, v in _oauth_states.items() if v["expiry"] < now]
    for k in expired:
        del _oauth_states[k]


def _purge_expired_teams_codes() -> None:
    now = time.time()
    expired = [k for k, v in _teams_exchange_codes.items() if v["expiry"] < now]
    for k in expired:
        del _teams_exchange_codes[k]


def _get_cached_jwks(tenant_id: str) -> dict | None:
    entry = _jwks_cache.get(tenant_id)
    if entry and time.time() < entry["expires"]:
        return entry["keys"]
    return None


def _set_cached_jwks(tenant_id: str, jwks: dict) -> None:
    _jwks_cache[tenant_id] = {"keys": jwks, "expires": time.time() + _JWKS_TTL_SECONDS}


def _require_json(request: Request) -> None:
    """The Teams sign-in routes take no cookie, so the CSRF middleware skips
    them; requiring a JSON body means a browser can only send them from our
    own pages (a cross-site form can't set this type without a CORS preflight)."""
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(status_code=415, detail="Send this sign-in request as JSON (Content-Type: application/json).")


def _continued_session(db: Session, raw_token: str, user: User) -> UserSession | None:
    """The still-valid session behind the (usually expired) portal token a
    Teams tab already holds. Teams blocks our cookies in its iframe on many
    devices, so the tab re-signs in with a fresh Teams token instead of the
    refresh cookie; continuing that session keeps its app-lock state, so the
    person is not asked for the app password again every 15 minutes."""
    if not raw_token:
        return None
    try:
        payload = jose_jwt.decode(raw_token, settings.SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False})
    except JWTError:
        return None
    sid = payload.get("sid")
    if payload.get("purpose") or str(payload.get("sub")) != str(user.id) or not str(sid or "").isdigit():
        return None
    session = db.get(UserSession, int(sid))
    if session is None or session.user_id != user.id or session.revoked_at is not None:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc) or org_security.is_idle(db, session):
        return None
    return session


def _set_auth_cookies(response, session_token: str, ms_access_token: str = "", refresh_token: str = "") -> None:
    secure = settings.SECURE_COOKIES
    samesite = "none" if secure else "lax"
    response.set_cookie(
        "session_token", session_token, httponly=True, secure=secure,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60, samesite=samesite,
    )
    if ms_access_token:
        response.set_cookie(
            "ms_access_token", ms_access_token, httponly=True, secure=secure,
            max_age=3600, samesite=samesite,
        )
    if refresh_token:
        # Scoped to /auth so it's never sent to (or leaked by) unrelated
        # routes — the refresh token only ever needs to reach /auth/refresh
        # and /auth/logout.
        response.set_cookie(
            "refresh_token", refresh_token, httponly=True, secure=secure,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400, samesite=samesite,
            path="/api/v1/auth",
        )


def _issue_refresh_session(db: Session, user: User, user_agent: str = "", request: Request | None = None,
                           rotated_from: UserSession | None = None) -> tuple[str, int]:
    """Creates a `user_sessions` row and returns (raw refresh token for the
    cookie, session id). Only the hash is persisted. Lifetime and the
    concurrent-session cap come from Organization › Security & Sessions.
    A new sign-in starts app-locked; a refresh rotation keeps the lock state
    and last activity of the session it replaces (services/app_lock.py)."""
    raw, token_hash = create_refresh_token()
    org_security.enforce_session_limit(db, user.id)
    session = UserSession(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=org_security.session_expiry(db),
        user_agent=user_agent[:255] if user_agent else None,
        ip_address=org_security.client_ip(request),
        app_lock_state=(rotated_from.app_lock_state if rotated_from is not None else "locked"),
        app_activity_at=(rotated_from.app_activity_at if rotated_from is not None else None),
    )
    db.add(session)
    db.commit()
    return raw, session.id


def _adopt_hr_record(db: Session, user: User) -> None:
    """A brand-new account takes over the HR record waiting for its email
    (HR > Employees, Portal Access = Yes). Never blocks the sign-in."""
    from app.modules.hr.services.workforce_link import link_pending_profile

    try:
        if link_pending_profile(db, user):
            db.commit()
            db.refresh(user)
    except Exception:  # noqa: BLE001 — HR linking must never stop someone signing in
        db.rollback()
        logger.exception("Linking the pending HR record to new account %s failed", user.email)


def _issue_tokens(db: Session, user: User, request: Request, rotated_from: UserSession | None = None) -> tuple[str, str]:
    """(access token, refresh token) for a new sign-in or refresh. The access
    token carries the session id (`sid`) so revoking the session — logout,
    admin revoke, deactivation — cuts the access token off at once instead of
    when it expires (see get_current_user)."""
    refresh_token, session_id = _issue_refresh_session(db, user, request.headers.get("user-agent", ""), request, rotated_from)
    access_token = create_access_token(
        {"sub": str(user.id), "email": user.email, "role": user.role, "sid": session_id},
        org_security.access_token_minutes(db),
    )
    return access_token, refresh_token


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Dependency: authenticate via the session_token httponly cookie, then a
    JWT Bearer header (kept for API clients / tooling that can't rely on
    cookies).

    The access token is deliberately short-lived (15 min) and this
    dependency does NOT renew it — keeping a daily-active user signed in is
    the job of POST /auth/refresh (called by the frontend on a 401), backed
    by a revocable `user_sessions` row. See that route's docstring for why
    silently re-minting the JWT here instead would be the wrong fix."""
    from app.core.audit_context import set_api_source, set_current_user_id

    token = request.cookies.get("session_token")
    if token:
        set_api_source("web_app")
    else:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            set_api_source("bearer_token")

    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    payload = verify_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    # Document-share and upload tokens are signed with the same key but are not
    # sign-in tokens (they carry a `purpose` and no `sub`): refuse them here
    # with a 401 instead of crashing on int(None).
    if payload.get("purpose") or not str(user_id or "").isdigit():
        raise HTTPException(status_code=401, detail="This token isn't a sign-in token — sign in again to get one.")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    sid = payload.get("sid")
    if sid is not None:
        # Tokens from a sign-in are tied to their refresh session: once it is
        # revoked (logout, admin revoke, deactivation, session limit) the
        # access token stops working immediately. Rotation is safe — the
        # frontend only refreshes after the old access token is rejected.
        session = db.get(UserSession, int(sid))
        if session is None or session.user_id != user.id or session.revoked_at is not None:
            raise HTTPException(status_code=401, detail="Your session was signed out — sign in again.")
        request.state.app_session = session
        from app.modules.main.services.app_lock import enforce as enforce_app_lock
        enforce_app_lock(request, db, user, session)
    set_current_user_id(user.id)
    return user


async def _refresh_azure_admin(db: Session, user: User) -> None:
    """Re-reads whether this user is an Azure tenant Global Administrator
    and stores it on is_azure_admin (Azure admins see every module and are
    portal admins). Best-effort: if Graph can't be asked, the last known
    value stays — a failed lookup must never strip someone's access."""
    if not user.azure_id:
        return
    try:
        is_admin = user.azure_id in await get_azure_admin_ids()
    except Exception as e:  # noqa: BLE001 — login must not fail on this
        logger.warning("Azure admin lookup failed for %s: %s", user.email, e)
        return
    changed = user.is_azure_admin != is_admin
    user.is_azure_admin = is_admin
    if is_admin and user.role == "user":
        user.role = "admin"
        changed = True
    if changed:
        db.commit()
        db.refresh(user)


@router.get("/microsoft-login")
async def microsoft_login(request: Request):
    """Redirect to Microsoft login."""
    if not settings.AZURE_CLIENT_ID or not settings.AZURE_TENANT_ID:
        raise HTTPException(status_code=503, detail="Microsoft OAuth not configured")

    _purge_expired_states()
    if len(_oauth_states) >= _MAX_PENDING_STATES:
        raise HTTPException(status_code=429, detail="Too many pending login attempts. Try again later.")

    state = secrets.token_urlsafe(32)
    next_path = request.query_params.get("next", "/") or "/"
    parsed = urlparse(next_path)
    if parsed.scheme or parsed.netloc or not next_path.startswith("/"):
        next_path = "/"
    _oauth_states[state] = {"next_path": next_path, "expiry": time.time() + _STATE_TTL_SECONDS}

    redirect_uri = settings.AZURE_REDIRECT_URI
    auth_url = get_auth_url(state, redirect_uri, pick_account=request.query_params.get("account") == "pick")
    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/callback")
async def oauth_callback(request: Request, code: str, state: str, db: Session = Depends(get_db)):
    """Handle Microsoft OAuth callback."""
    _purge_expired_states()
    state_data = _oauth_states.pop(state, None)
    if not state_data or state_data["expiry"] < time.time():
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")

    redirect_uri = settings.AZURE_REDIRECT_URI
    frontend_url = settings.FRONTEND_URL or "http://localhost:3000"

    try:
        token_result = await exchange_code_for_token(code, redirect_uri)
        ms_access_token = token_result.get("access_token")
        if not ms_access_token:
            raise HTTPException(status_code=400, detail="Failed to obtain access token")

        profile = await get_microsoft_user_profile(ms_access_token)
        email = profile.get("mail") or profile.get("userPrincipalName", "")
        name = profile.get("displayName", email.split("@")[0])
        azure_id = profile.get("id")
        designation = profile.get("jobTitle")
        department = profile.get("department")
        phone = profile.get("mobilePhone")
        office_location = profile.get("officeLocation")

        if settings.DOMAIN_EMAIL:
            allowed_domain = settings.DOMAIN_EMAIL.strip().lstrip("@").lower()
            if not email.lower().endswith(f"@{allowed_domain}"):
                org_security.log_sign_in(db, request, email=email, ok=False, reason="not a company account")
                return RedirectResponse(url=f"{frontend_url}/login?error=unauthorized", status_code=302)

        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                email=email, name=name, azure_id=azure_id, role="user", is_active=True,
                designation=designation, department=department, phone=phone,
                office_location=office_location,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            _adopt_hr_record(db, user)
        else:
            # An employee HR has exited stays out even though their Entra
            # account may still be enabled (handover period) — only a new
            # HR joining event re-activates them (security finding S-10).
            if is_exited(db, user.id):
                if user.is_active:
                    user.is_active = False
                    db.commit()
                org_security.log_sign_in(db, request, user=user, ok=False, reason="employee exited in HR")
                return RedirectResponse(url=f"{frontend_url}/login?error=exited", status_code=302)
            user.name = name
            user.azure_id = azure_id
            # HR & Administration owns these once an employee profile locks
            # them (see app/modules/hr/services/employee_sync.py).
            if not is_org_locked(db, user.id):
                user.designation = designation
                user.department = department
            user.phone = phone
            user.office_location = office_location
            db.commit()
            db.refresh(user)

        await _refresh_azure_admin(db, user)

        # Best-effort manager resolution — reading the manager relationship
        # needs more than the plain User.Read delegated scope this flow
        # requests, so a 403 here is expected on tenants that haven't granted
        # it; the admin's Sync Azure Users action (app-only token) is the
        # reliable path for this, this is just a bonus on regular login.
        try:
            manager_profile = await get_microsoft_manager_profile(ms_access_token)
            if manager_profile:
                manager_email = manager_profile.get("mail") or manager_profile.get("userPrincipalName")
                manager_user = db.query(User).filter(User.email == manager_email).first() if manager_email else None
                if not is_org_locked(db, user.id):
                    user.reporting_manager_id = manager_user.id if manager_user else user.reporting_manager_id
                db.commit()
        except Exception:
            # Best-effort per the comment above — a 403 here is the expected,
            # common case, but still log it so a genuinely broken case (DB
            # error, Graph outage) doesn't disappear without a trace.
            logger.info("Manager resolution during login skipped for user %s", user.id, exc_info=True)

        # Auto-link this user to a Branch (from office_location) and
        # Department (from department) — see provisioning.py docstring.
        sync_user_org_links(db, user)
        db.commit()

        if not user.is_active:
            org_security.log_sign_in(db, request, user=user, ok=False, reason="account deactivated")
            return RedirectResponse(url=f"{frontend_url}/login?error=inactive", status_code=302)

        session_token, refresh_token = _issue_tokens(db, user, request)
        org_security.log_sign_in(db, request, user=user, ok=True)

        redirect_to = state_data["next_path"]
        if redirect_to == "/auth/teams-success":
            # Teams popup: hand off via a one-time code instead of a cookie —
            # the popup's cookie jar is isolated from the main Teams frame.
            _purge_expired_teams_codes()
            auth_code = secrets.token_urlsafe(32)
            _teams_exchange_codes[auth_code] = {
                "session_token": session_token,
                "ms_access_token": ms_access_token,
                "refresh_token": refresh_token,
                "expiry": time.time() + _TEAMS_CODE_TTL_SECONDS,
            }
            return RedirectResponse(url=f"{frontend_url}/auth/teams-success?code={auth_code}", status_code=302)

        response = RedirectResponse(url=f"{frontend_url}{redirect_to}", status_code=302)
        _set_auth_cookies(response, session_token, ms_access_token, refresh_token)
        return response

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/teams-token")
async def teams_token_login(request: Request, db: Session = Depends(get_db)):
    """Validate a Teams getAuthToken() SSO token and start a session directly
    (no popup/redirect needed — used for Teams' silent single-sign-on)."""
    _require_json(request)
    body = await request.json()
    token = body.get("token", "")
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")

    tenant_id = settings.AZURE_TENANT_ID
    client_id = settings.AZURE_CLIENT_ID
    if not tenant_id or not client_id:
        raise HTTPException(status_code=503, detail="Azure AD not configured")

    try:
        parts = token.split(".")
        pad = 4 - len(parts[1]) % 4
        unverified = _json.loads(base64.urlsafe_b64decode(parts[1] + "=" * pad))
        actual_aud = unverified.get("aud", "")
        actual_iss = unverified.get("iss", "")
        token_tid = unverified.get("tid", "")
    except Exception as e:
        # This is an anonymous, pre-auth endpoint (Teams silent SSO) decoding a
        # caller-supplied token before it's verified — keep the client message
        # generic (don't echo raw parser internals back to an unauthenticated
        # caller), but log the real cause (bad base64, bad JSON, too few
        # dot-separated segments, etc.) so a genuine bug is diagnosable.
        logger.warning("Teams token login: malformed token (%s)", e)
        raise HTTPException(status_code=401, detail="Malformed token")

    if not actual_aud or not actual_aud.endswith(f"/{client_id}"):
        raise HTTPException(status_code=401, detail="Token not issued for this application")
    # Cheap early rejection of obviously-wrong issuers, before ever touching
    # JWKS/network — this is NOT the trust boundary (that's the tenant_id
    # equality check + the fixed `expected_issuers` passed to jose_jwt.decode
    # below), just a fast-fail so a bogus domain never reaches real crypto.
    if not actual_iss.startswith("https://login.microsoftonline.com/") and \
       not actual_iss.startswith("https://sts.windows.net/"):
        raise HTTPException(status_code=401, detail="Token not issued by Microsoft")
    # Enforce the token was issued by *our configured* tenant — do not trust
    # the unverified payload's own "tid"/"iss" as the source of truth for the
    # check we're about to perform with them, or the check is tautological.
    if token_tid != tenant_id:
        raise HTTPException(status_code=401, detail="Token not issued by the expected Azure AD tenant")
    expected_issuers = (
        f"https://login.microsoftonline.com/{tenant_id}/v2.0",
        f"https://sts.windows.net/{tenant_id}/",
    )

    jwks = _get_cached_jwks(tenant_id)
    if jwks is None:
        jwks_url = f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
        async with httpx.AsyncClient() as hc:
            jwks_resp = await hc.get(jwks_url, timeout=10)
            jwks = jwks_resp.json()
        _set_cached_jwks(tenant_id, jwks)

    last_error: JWTError | None = None
    payload = None
    for expected_iss in expected_issuers:
        try:
            payload = jose_jwt.decode(
                token, jwks, algorithms=["RS256"], audience=actual_aud, issuer=expected_iss,
            )
            break
        except JWTError as exc:
            last_error = exc
    if payload is None:
        raise HTTPException(status_code=401, detail=f"Invalid Teams token: {last_error}")

    email = payload.get("preferred_username") or payload.get("upn") or ""
    name = payload.get("name", email.split("@")[0] if email else "User")
    azure_id = payload.get("oid")

    if settings.DOMAIN_EMAIL:
        allowed_domain = settings.DOMAIN_EMAIL.strip().lstrip("@").lower()
        if not email.lower().endswith(f"@{allowed_domain}"):
            org_security.log_sign_in(db, request, email=email, ok=False, reason="not a company account", channel="teams")
            raise HTTPException(status_code=403, detail="Account not authorized for this portal")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, name=name, azure_id=azure_id, role="user", is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
        _adopt_hr_record(db, user)
    else:
        user.azure_id = azure_id
        db.commit()
        db.refresh(user)

    if is_exited(db, user.id):
        org_security.log_sign_in(db, request, user=user, ok=False, reason="employee exited in HR", channel="teams")
        raise HTTPException(status_code=403, detail=exited_login_message(db, user.id))

    if not user.is_active:
        org_security.log_sign_in(db, request, user=user, ok=False, reason="account deactivated", channel="teams")
        raise HTTPException(status_code=403, detail="Account deactivated")

    await _refresh_azure_admin(db, user)
    # On-Behalf-Of exchange: swap the Teams SSO token for a Graph delegated
    # token. Requires the Azure app to expose "access_as_user" and pre-authorize
    # the Teams desktop/web client IDs. If it fails, we still complete the
    # portal login — OBO only affects Graph-backed features, not the session.
    ms_access_token = ""
    try:
        msal_app = msal.ConfidentialClientApplication(
            client_id=client_id,
            client_credential=settings.AZURE_CLIENT_SECRET,
            authority=f"https://login.microsoftonline.com/{token_tid}",
        )
        obo_result = msal_app.acquire_token_on_behalf_of(
            user_assertion=token,
            scopes=[
                "https://graph.microsoft.com/User.Read",
                "https://graph.microsoft.com/Directory.Read.All",
                "https://graph.microsoft.com/User.Read.All",
            ],
        )
        ms_access_token = obo_result.get("access_token", "")
    except Exception:
        logger.info("Graph on-behalf-of token acquisition failed for Teams login", exc_info=True)

    # A tab that already had a session continues it (rotated, like /refresh);
    # only a first sign-in opens a new one.
    previous = _continued_session(db, str(body.get("previous_token") or ""), user)
    if previous is not None:
        now = datetime.now(timezone.utc)
        previous.revoked_at, previous.revoked_reason, previous.last_used_at = now, "rotated", now
        db.commit()
    session_token, refresh_token = _issue_tokens(db, user, request, rotated_from=previous)
    if previous is None:
        org_security.log_sign_in(db, request, user=user, ok=True, channel="teams")
    # The access token also goes back in the body: inside the Teams iframe the
    # browser often drops our cookies (third-party), so the tab sends it as a
    # Bearer header instead. It lives 15 minutes; the tab renews it silently
    # with a new Teams token. The refresh token stays cookie-only.
    response = JSONResponse({"ok": True, "access_token": session_token})
    _set_auth_cookies(response, session_token, ms_access_token, refresh_token)
    return response


@router.post("/teams-exchange")
async def teams_exchange(request: Request):
    """Exchange a one-time Teams auth code (issued by /callback for the popup
    flow) for the actual session cookies, in the main-frame context."""
    _require_json(request)
    body = await request.json()
    code = body.get("code", "")
    _purge_expired_teams_codes()
    code_data = _teams_exchange_codes.pop(code, None)
    if not code_data or code_data["expiry"] < time.time():
        raise HTTPException(status_code=400, detail="Invalid or expired Teams auth code")

    # Access token in the body too — see teams_token_login.
    response = JSONResponse({"ok": True, "access_token": code_data["session_token"]})
    _set_auth_cookies(response, code_data["session_token"], code_data["ms_access_token"], code_data.get("refresh_token", ""))
    return response


def _p2p_approver_flags(db: Session, user: User) -> tuple[bool, bool]:
    """(is_pr_approver, is_po_approver) for the P2P approval-queue tabs:
    a PR approver is anyone named in an approver slot on at least one PR
    (matrix approval rows or the legacy head columns); a PO approver is any
    holder of a PO-approval role flag. Admins count as both."""
    from app.modules.p2p.models.p2p_request import P2PRequest, P2P_PO_APPROVER_FLAGS
    from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval

    if user.role == "admin":
        return True, True
    # New PRs / POs are routed by the central approval engine.
    from app.modules.p2p.approvals import is_approver_user

    engine_pr, engine_po = is_approver_user(db, user)
    if engine_pr and engine_po:
        return True, True
    is_pr_approver = engine_pr or (
        db.query(P2PRequestApproval.id).filter(P2PRequestApproval.approver_id == user.id).first() is not None
        or db.query(P2PRequest.id).filter(
            (P2PRequest.approver_id == user.id)
            | (P2PRequest.project_head_id == user.id)
            | (P2PRequest.plant_head_id == user.id)
        ).first() is not None
    )
    from app.modules.p2p.models.p2p_request_po_approver import P2PRequestPOApprover
    is_po_approver = engine_po or (
        any(getattr(user, flag, False) for flag in P2P_PO_APPROVER_FLAGS)
        or db.query(P2PRequestPOApprover.id).filter(P2PRequestPOApprover.approver_id == user.id).first() is not None
    )
    return is_pr_approver, is_po_approver


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_user_info(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current logged-in user info."""
    is_pr_approver, is_po_approver = _p2p_approver_flags(db, user)
    return CurrentUserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        designation=user.designation,
        department=user.department,
        phone=user.phone,
        assigned_apps=user.get_apps(),
        erp_permissions=legacy_erp_permissions(user),
        apps=user.get_apps(),
        is_department_head=user.is_department_head,
        is_project_head=user.is_project_head,
        is_plant_head=user.is_plant_head,
        is_purchase_head=user.is_purchase_head,
        is_director=user.is_director,
        is_partner=user.is_partner,
        is_azure_admin=bool(user.is_azure_admin),
        is_finance_manager=user.is_finance_manager,
        is_design_manager=user.is_design_manager,
        is_rnd_manager=user.is_rnd_manager,
        is_production_manager=user.is_production_manager,
        is_project_manager=user.is_project_manager,
        is_store_manager=user.is_store_manager,
        is_purchase_manager=user.is_purchase_manager,
        is_pr_approver=is_pr_approver,
        is_po_approver=is_po_approver,
        notifications_enabled=user.notifications_enabled,
        tab_access=restricted_subtabs(user),
        permissions=[] if is_admin_user(user) else sorted(user.effective_permissions),
        roles=sorted(r.name for r in user.roles or [] if r.is_active),
    )


@router.post("/refresh")
async def refresh_session(request: Request, db: Session = Depends(get_db)):
    """Mints a fresh short-lived access token from the long-lived refresh
    token cookie. This — not a long-lived access token, and not silently
    re-minting the access token on every request — is what keeps a
    daily-active user signed in: the frontend calls this once when an API
    call comes back 401, then retries.

    The refresh token itself is rotated on every use (old row revoked, new
    one issued) so a stolen-and-replayed refresh token is detectable and a
    compromised session can be cut off server-side — properties a bare JWT
    (however long-lived) cannot offer, since a JWT can't be un-issued before
    its `exp`."""
    raw = request.cookies.get("refresh_token")
    if not raw:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    token_hash = hash_refresh_token(raw)
    session = db.query(UserSession).filter(UserSession.token_hash == token_hash).first()
    now = datetime.now(timezone.utc)
    if not session or session.revoked_at is not None or session.expires_at < now:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    if org_security.is_idle(db, session):
        session.revoked_at, session.revoked_reason = now, "idle"
        db.commit()
        raise HTTPException(status_code=401, detail="Signed out after inactivity — sign in again.")

    user = db.query(User).filter(User.id == session.user_id).first()
    if not user or not user.is_active:
        session.revoked_at = now
        db.commit()
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Rotate: revoke this refresh token and issue a new one, so each cookie
    # value is single-use — replay of an intercepted old cookie fails outright.
    session.revoked_at = now
    session.revoked_reason = "rotated"
    session.last_used_at = now
    db.commit()
    session_token, new_refresh_token = _issue_tokens(db, user, request, rotated_from=session)
    response = JSONResponse({"ok": True})
    _set_auth_cookies(response, session_token, refresh_token=new_refresh_token)
    return response


@router.post("/logout")
async def logout(request: Request, db: Session = Depends(get_db)):
    """Logout: revoke the refresh session server-side (so the refresh cookie
    can't be used to silently sign back in) and clear all auth cookies.

    Deliberately does NOT require a valid access token — the 15-minute
    session_token is usually already expired when someone clicks Sign out on a
    shared PC, and the refresh session must still be revoked. Always 200."""
    raw = request.cookies.get("refresh_token")
    if raw:
        token_hash = hash_refresh_token(raw)
        session = db.query(UserSession).filter(UserSession.token_hash == token_hash).first()
        if session and session.revoked_at is None:
            session.revoked_at = datetime.now(timezone.utc)
            session.revoked_reason = "logout"
            db.commit()
            org_security.log_sign_out(db, request, session.user_id)
    else:
        # Inside Teams the refresh cookie is often dropped; the tab signs out
        # with its Bearer token instead, so end the session that token names.
        auth_header = request.headers.get("Authorization", "")
        bearer = auth_header[7:] if auth_header.startswith("Bearer ") else ""
        try:
            payload = jose_jwt.decode(bearer, settings.SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False}) if bearer else {}
        except JWTError:
            payload = {}
        sid, sub = payload.get("sid"), str(payload.get("sub") or "")
        if not payload.get("purpose") and str(sid or "").isdigit() and sub.isdigit():
            session = db.get(UserSession, int(sid))
            if session and session.user_id == int(sub) and session.revoked_at is None:
                session.revoked_at = datetime.now(timezone.utc)
                session.revoked_reason = "logout"
                db.commit()
                org_security.log_sign_out(db, request, session.user_id)

    response = JSONResponse({"message": "Logged out successfully", "status": "ok"})
    # Delete with the same attributes the cookies were set with — browsers
    # ignore a deletion whose secure/samesite don't match (Teams iframe case).
    secure = settings.SECURE_COOKIES
    samesite = "none" if secure else "lax"
    for name in ("session_token", "ms_access_token"):
        response.delete_cookie(name, httponly=True, secure=secure, samesite=samesite)
    response.delete_cookie(
        "refresh_token", path="/api/v1/auth", httponly=True, secure=secure, samesite=samesite,
    )
    return response
