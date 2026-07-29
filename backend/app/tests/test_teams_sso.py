"""
Tests for the Microsoft Teams SSO integration:
- POST /auth/teams-token — validates a Teams getAuthToken() SSO token
  (JWKS signature check, audience/issuer validation, replay protection,
  OBO exchange), then starts a session.
- POST /auth/teams-exchange — swaps a one-time code (issued by /auth/callback
  for the Teams popup flow) for real session cookies in the main frame.
"""

import base64
import json
import time
from unittest.mock import patch, MagicMock

from app.core.config import settings
from app.modules.main.models.user import User
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
    assert response.json() == {"ok": True}
    assert response.cookies.get("session_token")
    assert response.cookies.get("ms_access_token") == "graph-token-xyz"

    user = db.query(User).filter(User.email == "teamsuser@premnathrail.com").first()
    assert user is not None
    assert user.azure_id == "azure-oid-1"


def test_teams_token_rejects_replayed_token(client, db, monkeypatch):
    monkeypatch.setattr(settings, "AZURE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "AZURE_TENANT_ID", "test-tenant-id")
    token = make_teams_token(jti="replay-me")

    decode_patch, httpx_patch, msal_patch = _patch_common()
    with decode_patch as mock_decode, httpx_patch as mock_httpx_cls, msal_patch as mock_msal_cls:
        mock_decode.return_value = {
            "preferred_username": "teamsuser@premnathrail.com",
            "name": "Teams User",
            "oid": "azure-oid-1",
        }
        mock_httpx_cls.return_value.__aenter__.return_value.get.return_value = MagicMock(
            json=lambda: {"keys": []}
        )
        mock_msal_cls.return_value.acquire_token_on_behalf_of.return_value = {"access_token": ""}

        first = client.post("/api/v1/auth/teams-token", json={"token": token})
        assert first.status_code == 200

        second = client.post("/api/v1/auth/teams-token", json={"token": token})

    assert second.status_code == 401
    assert "already used" in second.json()["detail"].lower()
    auth_module._used_token_ids.clear()


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
