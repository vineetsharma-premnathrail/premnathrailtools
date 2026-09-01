import base64
import hashlib
import json as _json
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
from app.auth.jwt_handler import create_access_token, verify_access_token
from app.auth.microsoft import get_auth_url, exchange_code_for_token, get_microsoft_user_profile, get_microsoft_manager_profile
from app.modules.organization.services.provisioning import sync_user_org_links
from app.core.config import settings
from app.middleware.api_key import get_api_key_record

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

# Replay protection for Teams SSO tokens (keyed by jti, or a hash if absent).
_used_token_ids: Dict[str, float] = {}  # token id → expiry timestamp
_MAX_USED_TOKENS = 10000


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


def _check_replay(token_id: str, expiry: float) -> bool:
    """Return True if this token id was already used (i.e. a replay)."""
    now = time.time()
    expired = [k for k, v in _used_token_ids.items() if v < now]
    for k in expired:
        del _used_token_ids[k]
    if token_id in _used_token_ids:
        return True
    if len(_used_token_ids) < _MAX_USED_TOKENS:
        _used_token_ids[token_id] = expiry
    return False


def _set_auth_cookies(response, session_token: str, ms_access_token: str = "") -> None:
    secure = settings.SECURE_COOKIES
    samesite = "none" if secure else "lax"
    response.set_cookie(
        "session_token", session_token, httponly=True, secure=secure,
        max_age=86400, samesite=samesite,
    )
    if ms_access_token:
        response.set_cookie(
            "ms_access_token", ms_access_token, httponly=True, secure=secure,
            max_age=3600, samesite=samesite,
        )


def _make_api_key_user(api_key) -> User:
    """In-memory User standing in for an API key — acts like a service account
    scoped to whatever apps the key was granted (never persisted, id=0)."""
    return User(
        id=0,
        email=f"apikey:{api_key.name}",
        name=api_key.name,
        role="api_service",
        is_active=True,
        assigned_apps=api_key.allowed_apps or [],
        erp_permissions=[],
    )


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Dependency: authenticate via API key first (external integrations),
    then the session_token httponly cookie, then a JWT Bearer header
    (kept for API clients / tooling that can't rely on cookies)."""
    api_key = get_api_key_record(request, db)
    if api_key is not None:
        return _make_api_key_user(api_key)

    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    payload = verify_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


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
    auth_url = get_auth_url(state, redirect_uri)
    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/callback")
async def oauth_callback(code: str, state: str, db: Session = Depends(get_db)):
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
        else:
            user.name = name
            user.azure_id = azure_id
            user.designation = designation
            user.department = department
            user.phone = phone
            user.office_location = office_location
            db.commit()
            db.refresh(user)

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
                user.reporting_manager_id = manager_user.id if manager_user else user.reporting_manager_id
                db.commit()
        except Exception:
            pass

        # Auto-link this user to a Branch (from office_location) and
        # Department (from department) — see provisioning.py docstring.
        sync_user_org_links(db, user)
        db.commit()

        if not user.is_active:
            return RedirectResponse(url=f"{frontend_url}/login?error=inactive", status_code=302)

        session_token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})

        redirect_to = state_data["next_path"]
        if redirect_to == "/auth/teams-success":
            # Teams popup: hand off via a one-time code instead of a cookie —
            # the popup's cookie jar is isolated from the main Teams frame.
            _purge_expired_teams_codes()
            auth_code = secrets.token_urlsafe(32)
            _teams_exchange_codes[auth_code] = {
                "session_token": session_token,
                "ms_access_token": ms_access_token,
                "expiry": time.time() + _TEAMS_CODE_TTL_SECONDS,
            }
            return RedirectResponse(url=f"{frontend_url}/auth/teams-success?code={auth_code}", status_code=302)

        response = RedirectResponse(url=f"{frontend_url}{redirect_to}", status_code=302)
        _set_auth_cookies(response, session_token, ms_access_token)
        return response

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/teams-token")
async def teams_token_login(request: Request, db: Session = Depends(get_db)):
    """Validate a Teams getAuthToken() SSO token and start a session directly
    (no popup/redirect needed — used for Teams' silent single-sign-on)."""
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
        token_exp = unverified.get("exp", time.time() + 3600)
        token_jti = unverified.get("jti") or hashlib.sha256(token.encode()).hexdigest()[:32]
    except Exception:
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

    if _check_replay(token_jti, token_exp):
        raise HTTPException(status_code=401, detail="Token already used")

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
            raise HTTPException(status_code=403, detail="Account not authorized for this portal")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, name=name, azure_id=azure_id, role="user", is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.azure_id = azure_id
        db.commit()
        db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated")

    session_token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})

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
        pass

    response = JSONResponse({"ok": True})
    _set_auth_cookies(response, session_token, ms_access_token)
    return response


@router.post("/teams-exchange")
async def teams_exchange(request: Request):
    """Exchange a one-time Teams auth code (issued by /callback for the popup
    flow) for the actual session cookies, in the main-frame context."""
    body = await request.json()
    code = body.get("code", "")
    _purge_expired_teams_codes()
    code_data = _teams_exchange_codes.pop(code, None)
    if not code_data or code_data["expiry"] < time.time():
        raise HTTPException(status_code=400, detail="Invalid or expired Teams auth code")

    response = JSONResponse({"ok": True})
    _set_auth_cookies(response, code_data["session_token"], code_data["ms_access_token"])
    return response


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_user_info(user: User = Depends(get_current_user)):
    """Get current logged-in user info."""
    return CurrentUserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        designation=user.designation,
        department=user.department,
        phone=user.phone,
        assigned_apps=user.assigned_apps or [],
        erp_permissions=user.erp_permissions or [],
        apps=user.get_apps(),
    )


@router.post("/logout")
async def logout(user: User = Depends(get_current_user)):
    """Logout: clear the session cookies (frontend Bearer-token clients clear
    their own storage on their side)."""
    response = JSONResponse({"message": "Logged out successfully", "status": "ok"})
    response.delete_cookie("session_token")
    response.delete_cookie("ms_access_token")
    return response
