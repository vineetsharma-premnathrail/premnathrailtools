"""
Tests for the Microsoft Teams SSO integration:
- POST /auth/teams-token — validates a Teams getAuthToken() SSO token
  (JWKS signature check, audience/issuer validation, OBO exchange), then
  starts a session — or continues the tab's existing one.
- POST /auth/teams-exchange — swaps a one-time code (issued by /auth/callback
  for the Teams popup flow) for real session cookies in the main frame.
"""

import base64
import json
import time
from unittest.mock import patch, MagicMock

from datetime import datetime, timedelta, timezone

from jose import jwt

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.modules.main.models.user import User
from app.modules.main.models.user_session import UserSession
from app.modules.main.routes import auth as auth_module


def _b64url(data: dict) -> str:
    raw = json.dumps(data).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def make_teams_token(**overrides) -> str:
    """A syntactically valid (but unsigned) JWT — the route decodes the
    payload without verifying the signature before it even reaches jose_jwt.decode,
    so tests patch that decode step directly rather than hand-signing tokens."""
    payload = {
        "aud": f"api://premnathrail.example/{settings.AZURE_CLIENT_ID or 'test-client-id'}",
        "tid": settings.AZURE_TENANT_ID or "test-tenant-id",
        "iss": f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID or 'test-tenant-id'}/v2.0",
        "exp": time.time() + 3600,
        "jti": "unique-jti-1",
        "preferred_username": "teamsuser@premnathrail.com",
        "name": "Teams User",
        "oid": "azure-oid-1",
    }
    payload.update(overrides)
    header = _b64url({"alg": "RS256", "typ": "JWT"})
    body = _b64url(payload)
    return f"{header}.{body}.fakesignature"


def _patch_common():
    """Bypass real network calls: JWKS fetch, signature verification, OBO."""
    return (
        patch("app.modules.main.routes.auth.jose_jwt.decode"),
        patch("app.modules.main.routes.auth.httpx.AsyncClient"),
        patch("app.modules.main.routes.auth.msal.ConfidentialClientApplication"),
    )


def test_teams_token_rejects_missing_token(client):
    response = client.post("/api/v1/auth/teams-token", json={})
    assert response.status_code == 400


def test_teams_token_rejects_malformed_token(client):
    response = client.post("/api/v1/auth/teams-token", json={"token": "not-a-jwt"})
    assert response.status_code == 401


def test_teams_token_rejects_wrong_audience(client, db):
    token = make_teams_token(aud="api://someone-else/other-client-id")
    response = client.post("/api/v1/auth/teams-token", json={"token": token})
    assert response.status_code == 401
    assert "audience" in response.json()["detail"].lower() or "application" in response.json()["detail"].lower()


def test_teams_token_rejects_wrong_issuer(client, db):
    token = make_teams_token(iss="https://evil.example/v2.0")
    response = client.post("/api/v1/auth/teams-token", json={"token": token})
    assert response.status_code == 401
    assert "microsoft" in response.json()["detail"].lower()


def test_teams_token_creates_session_and_sets_cookie(client, db, monkeypatch):
    monkeypatch.setattr(settings, "AZURE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "AZURE_TENANT_ID", "test-tenant-id")
    token = make_teams_token()

    decode_patch, httpx_patch, msal_patch = _patch_common()
    with decode_patch as mock_decode, httpx_patch as mock_httpx_cls, msal_patch as mock_msal_cls:
        mock_decode.return_value = {
            "preferred_username": "teamsuser@premnathrail.com",
            "name": "Teams User",
            "oid": "azure-oid-1",
        }
        mock_http_client = MagicMock()
        mock_http_client.__aenter__.return_value.get.return_value = MagicMock(
            json=lambda: {"keys": []}
        )
        mock_httpx_cls.return_value = mock_http_client
        mock_msal_cls.return_value.acquire_token_on_behalf_of.return_value = {
            "access_token": "graph-token-xyz"
        }

        response = client.post("/api/v1/auth/teams-token", json={"token": token})

    assert response.status_code == 200
    assert response.json()["ok"] is True
    # Also in the body: the Teams iframe often drops our cookies, so the tab
    # sends this as a Bearer header.
    assert response.json()["access_token"] == response.cookies.get("session_token")
    assert response.cookies.get("session_token")
    assert response.cookies.get("ms_access_token") == "graph-token-xyz"

    user = db.query(User).filter(User.email == "teamsuser@premnathrail.com").first()
    assert user is not None
    assert user.azure_id == "azure-oid-1"


_real_decode = jwt.decode


def _login_with_teams(client, token, previous_token=None):
    decode_patch, httpx_patch, msal_patch = _patch_common()
    with decode_patch as mock_decode, httpx_patch as mock_httpx_cls, msal_patch as mock_msal_cls:
        teams_claims = {
            "preferred_username": "teamsuser@premnathrail.com",
            "name": "Teams User",
            "oid": "azure-oid-1",
        }
        # The patch replaces jose's decode everywhere: Teams tokens (checked
        # against the JWKS dict) get the fake claims, our own portal tokens
        # (checked with SECRET_KEY) still decode for real.
        mock_decode.side_effect = lambda tok, key, **kw: _real_decode(tok, key, **kw) if isinstance(key, str) else teams_claims
        mock_httpx_cls.return_value.__aenter__.return_value.get.return_value = MagicMock(
            json=lambda: {"keys": []}
        )
        mock_msal_cls.return_value.acquire_token_on_behalf_of.return_value = {"access_token": ""}
        body = {"token": token}
        if previous_token:
            body["previous_token"] = previous_token
        return client.post("/api/v1/auth/teams-token", json=body)


def test_teams_token_same_token_works_again(client, db, monkeypatch):
    """Teams caches the getAuthToken() token for ~1 hour and returns the same
    one on every call — a reload or silent renewal must not fail with
    "Token already used"."""
    monkeypatch.setattr(settings, "AZURE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "AZURE_TENANT_ID", "test-tenant-id")
    token = make_teams_token(jti="same-token-twice")

    first = _login_with_teams(client, token)
    second = _login_with_teams(client, token)

    assert first.status_code == 200
    assert second.status_code == 200


def test_teams_renewal_continues_the_tab_session(client, db, monkeypatch):
    """A tab renewing with its old portal token keeps its session (rotated,
    app-lock state carried over) instead of opening a new, locked one."""
    monkeypatch.setattr(settings, "AZURE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "AZURE_TENANT_ID", "test-tenant-id")
    token = make_teams_token(jti="renewal")

    first = _login_with_teams(client, token)
    old_access = first.json()["access_token"]
    old_sid = jwt.decode(old_access, settings.SECRET_KEY, algorithms=["HS256"])["sid"]
    old_session = db.get(UserSession, old_sid)
    old_session.app_lock_state = "unlocked"
    db.commit()

    renewed = _login_with_teams(client, token, previous_token=old_access)

    assert renewed.status_code == 200
    new_sid = jwt.decode(renewed.json()["access_token"], settings.SECRET_KEY, algorithms=["HS256"])["sid"]
    assert new_sid != old_sid
    db.expire_all()
    assert db.get(UserSession, old_sid).revoked_reason == "rotated"
    assert db.get(UserSession, new_sid).app_lock_state == "unlocked"


def test_teams_renewal_ignores_another_users_token(client, db, monkeypatch):
    """An old portal token of someone else never continues their session."""
    monkeypatch.setattr(settings, "AZURE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "AZURE_TENANT_ID", "test-tenant-id")
    other = User(email="someoneelse@premnathrail.com", name="Other", role="user", is_active=True)
    db.add(other)
    db.commit()
    other_session = UserSession(user_id=other.id, token_hash="x" * 64,
                                expires_at=datetime.now(timezone.utc) + timedelta(days=1), app_lock_state="unlocked")
    db.add(other_session)
    db.commit()
    other_token = create_access_token({"sub": str(other.id), "email": other.email, "role": "user", "sid": other_session.id})

    response = _login_with_teams(client, make_teams_token(jti="other"), previous_token=other_token)

    assert response.status_code == 200
    db.expire_all()
    assert db.get(UserSession, other_session.id).revoked_at is None
    sid = jwt.decode(response.json()["access_token"], settings.SECRET_KEY, algorithms=["HS256"])["sid"]
    assert db.get(UserSession, sid).app_lock_state == "locked"


def test_teams_token_still_logs_in_when_obo_fails(client, db, monkeypatch):
    """OBO is best-effort — a failed Graph exchange must not block the portal login."""
    monkeypatch.setattr(settings, "AZURE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "AZURE_TENANT_ID", "test-tenant-id")
    token = make_teams_token(jti="obo-fail-jti")

    decode_patch, httpx_patch, msal_patch = _patch_common()
    with decode_patch as mock_decode, httpx_patch as mock_httpx_cls, msal_patch as mock_msal_cls:
        mock_decode.return_value = {
            "preferred_username": "obofail@premnathrail.com",
            "name": "OBO Fail",
            "oid": "azure-oid-2",
        }
        mock_httpx_cls.return_value.__aenter__.return_value.get.return_value = MagicMock(
            json=lambda: {"keys": []}
        )
        mock_msal_cls.return_value.acquire_token_on_behalf_of.side_effect = Exception("boom")

        response = client.post("/api/v1/auth/teams-token", json={"token": token})

    assert response.status_code == 200
    assert response.cookies.get("session_token")
    assert not response.cookies.get("ms_access_token")


def test_teams_exchange_swaps_valid_code_for_cookies(client):
    auth_module._teams_exchange_codes["good-code"] = {
        "session_token": "sess-abc",
        "ms_access_token": "graph-abc",
        "expiry": time.time() + 60,
    }

    response = client.post("/api/v1/auth/teams-exchange", json={"code": "good-code"})

    assert response.status_code == 200
    assert response.json()["access_token"] == "sess-abc"
    assert response.cookies.get("session_token") == "sess-abc"
    assert response.cookies.get("ms_access_token") == "graph-abc"
    # One-time — a second attempt with the same code must fail.
    assert "good-code" not in auth_module._teams_exchange_codes


def test_teams_exchange_rejects_unknown_or_reused_code(client):
    response = client.post("/api/v1/auth/teams-exchange", json={"code": "never-issued"})
    assert response.status_code == 400


def test_teams_exchange_rejects_expired_code(client):
    auth_module._teams_exchange_codes["stale-code"] = {
        "session_token": "sess-xyz",
        "ms_access_token": "",
        "expiry": time.time() - 1,
    }

    response = client.post("/api/v1/auth/teams-exchange", json={"code": "stale-code"})
    assert response.status_code == 400


def test_logout_with_bearer_ends_the_teams_session(client, db, monkeypatch):
    """Inside Teams the refresh cookie is often dropped, so sign-out with the
    tab's Bearer token must still end the session on the server."""
    monkeypatch.setattr(settings, "AZURE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "AZURE_TENANT_ID", "test-tenant-id")
    access = _login_with_teams(client, make_teams_token(jti="logout")).json()["access_token"]
    sid = jwt.decode(access, settings.SECRET_KEY, algorithms=["HS256"])["sid"]
    client.cookies.clear()

    response = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {access}"})

    assert response.status_code == 200
    db.expire_all()
    assert db.get(UserSession, sid).revoked_reason == "logout"


def test_teams_token_requires_json(client):
    response = client.post("/api/v1/auth/teams-token", content="token=x", headers={"Content-Type": "text/plain"})
    assert response.status_code == 415
