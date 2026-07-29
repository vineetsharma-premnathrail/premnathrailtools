"""
Tests for Microsoft OAuth authentication flow.

These tests verify that:
1. Users can login via Microsoft
2. User profiles are fetched correctly
3. Users are created/updated in database
4. JWT tokens are issued after login and delivered via an httponly cookie
5. Domain restrictions and inactive accounts redirect with ?error=...
"""

import time
import pytest
from urllib.parse import urlparse, parse_qs
from unittest.mock import patch, MagicMock

from app.modules.main.models.user import User
from app.modules.main.routes.auth import _oauth_states
from app.auth.jwt_handler import create_access_token, verify_access_token

# `client` and `db` fixtures come from app/tests/conftest.py — they point
# at an isolated in-memory SQLite database via a dependency override.
# Do NOT redefine them here: a prior version of this file shadowed them
# with a real TestClient() + the production SessionLocal(), which meant
# every test in this file was silently reading/writing the real Postgres
# database instead of a throwaway one.


def seed_state(state: str) -> None:
    """The callback route only accepts a state it handed out itself via
    /auth/microsoft-login. Tests that skip that step must seed it directly."""
    _oauth_states[state] = {"next_path": "/", "expiry": time.time() + 600}


def token_from_cookie(response) -> str:
    """The callback redirects to the frontend and sets the session as an
    httponly cookie rather than putting it in the URL."""
    assert response.status_code in (302, 307)
    token = response.cookies.get("session_token")
    assert token, "no session_token cookie set on the redirect response"
    return token


# ─────────────────────────────────────────────────────────────────
# Test 1: Microsoft Login Redirect
# ─────────────────────────────────────────────────────────────────

def test_microsoft_login_redirects_to_microsoft(client):
    """Test: GET /auth/microsoft-login redirects to Microsoft login page."""
    response = client.get("/api/v1/auth/microsoft-login", follow_redirects=False)

    # Should redirect (status 302)
    assert response.status_code == 302

    # Should redirect to Microsoft login
    redirect_url = response.headers["location"]
    assert "login.microsoftonline.com" in redirect_url
    assert "client_id" in redirect_url
    assert "scope=User.Read" in redirect_url


# ─────────────────────────────────────────────────────────────────
# Test 2: Microsoft OAuth Callback (Success)
# ─────────────────────────────────────────────────────────────────

@patch('app.modules.main.routes.auth.exchange_code_for_token')
@patch('app.modules.main.routes.auth.get_microsoft_user_profile')
def test_oauth_callback_creates_new_user(
    mock_get_profile,
    mock_exchange_code,
    client,
    db
):
    """Test: OAuth callback creates new user from Microsoft profile."""

    # Mock Microsoft responses
    mock_exchange_code.return_value = {
        "access_token": "mock-ms-token-123",
        "token_type": "Bearer"
    }

    mock_get_profile.return_value = {
        "id": "azure-user-id-123",
        "mail": "john@premnathrail.com",
        "displayName": "John Doe",
        "jobTitle": "Engineer",
        "department": "R&D"
    }

    # Simulate OAuth callback
    seed_state("test-state")
    response = client.get(
        "/api/v1/auth/callback?code=auth-code-123&state=test-state",
        follow_redirects=False,
    )

    # Should redirect to the frontend and set the session cookie
    token_from_cookie(response)
    assert response.headers["location"].startswith("http://localhost:3000")

    # Verify user was created in database
    user = db.query(User).filter(User.email == "john@premnathrail.com").first()
    assert user is not None
    assert user.name == "John Doe"
    assert user.azure_id == "azure-user-id-123"
    assert user.is_active is True
    assert user.role == "user"


# ─────────────────────────────────────────────────────────────────
# Test 3: OAuth Callback (Existing User)
# ─────────────────────────────────────────────────────────────────

@patch('app.modules.main.routes.auth.exchange_code_for_token')
@patch('app.modules.main.routes.auth.get_microsoft_user_profile')
def test_oauth_callback_updates_existing_user(
    mock_get_profile,
    mock_exchange_code,
    client,
    db
):
    """Test: OAuth callback updates existing user profile."""

    # Create existing user
    existing_user = User(
        email="john@premnathrail.com",
        name="John Smith",
        role="user",
        is_active=True
    )
    db.add(existing_user)
    db.commit()
    original_id = existing_user.id

    # Mock Microsoft responses
    mock_exchange_code.return_value = {
        "access_token": "mock-ms-token-456"
    }

    mock_get_profile.return_value = {
        "id": "azure-user-id-456",
        "mail": "john@premnathrail.com",
        "displayName": "John Doe (Updated)",  # Name changed
        "jobTitle": "Senior Engineer",
        "department": "R&D"
    }

    # Simulate OAuth callback again
    seed_state("test-state")
    response = client.get(
        "/api/v1/auth/callback?code=auth-code-456&state=test-state",
        follow_redirects=False,
    )

    # Should redirect to the frontend and set the session cookie
    token_from_cookie(response)

    # Verify user was updated, not duplicated
    user = db.query(User).filter(User.email == "john@premnathrail.com").first()
    assert user.id == original_id  # Same user (not new)
    assert user.name == "John Doe (Updated)"  # Name updated
    assert user.azure_id == "azure-user-id-456"


# ─────────────────────────────────────────────────────────────────
# Test 4: Domain Restriction
# ─────────────────────────────────────────────────────────────────

@patch('app.modules.main.routes.auth.exchange_code_for_token')
@patch('app.modules.main.routes.auth.get_microsoft_user_profile')
def test_oauth_callback_rejects_external_domain(
    mock_get_profile,
    mock_exchange_code,
    client,
    db
):
    """Test: OAuth callback redirects users from external domains back to
    the login page with ?error=unauthorized instead of logging them in."""

    mock_exchange_code.return_value = {
        "access_token": "mock-token"
    }

    # User from external domain (not @premnathrail.com)
    mock_get_profile.return_value = {
        "id": "external-user-id",
        "mail": "hacker@gmail.com",  # ← External domain!
        "displayName": "Hacker"
    }

    # Simulate OAuth callback
    seed_state("state")
    response = client.get(
        "/api/v1/auth/callback?code=code&state=state",
        follow_redirects=False,
    )

    # Should redirect back to the login page with an error, not log in
    assert response.status_code == 302
    location = response.headers["location"]
    assert location == "http://localhost:3000/login?error=unauthorized"
    assert "session_token" not in response.cookies

    # Verify user was NOT created
    user = db.query(User).filter(User.email == "hacker@gmail.com").first()
    assert user is None


def test_oauth_callback_redirects_inactive_user_with_error(client, db):
    """Test: an existing but deactivated user is redirected with ?error=inactive
    instead of being issued a session."""
    db.add(User(email="gone@premnathrail.com", name="Gone", role="user", is_active=False))
    db.commit()

    with patch('app.modules.main.routes.auth.exchange_code_for_token') as mock_exchange, \
         patch('app.modules.main.routes.auth.get_microsoft_user_profile') as mock_profile:
        mock_exchange.return_value = {"access_token": "mock-token"}
        mock_profile.return_value = {"id": "x", "mail": "gone@premnathrail.com", "displayName": "Gone"}

        seed_state("state-inactive")
        response = client.get(
            "/api/v1/auth/callback?code=code&state=state-inactive",
            follow_redirects=False,
        )

    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:3000/login?error=inactive"
    assert "session_token" not in response.cookies


# ─────────────────────────────────────────────────────────────────
# Test 5: JWT Token Validation
# ─────────────────────────────────────────────────────────────────

@patch('app.modules.main.routes.auth.exchange_code_for_token')
@patch('app.modules.main.routes.auth.get_microsoft_user_profile')
def test_oauth_callback_returns_valid_jwt(
    mock_get_profile,
    mock_exchange_code,
    client,
    db
):
    """Test: OAuth callback issues a valid JWT, delivered as a cookie."""

    mock_exchange_code.return_value = {
        "access_token": "mock-token"
    }

    mock_get_profile.return_value = {
        "id": "user-id-789",
        "mail": "alice@premnathrail.com",
        "displayName": "Alice Johnson"
    }

    # Get token from OAuth callback
    seed_state("state")
    response = client.get(
        "/api/v1/auth/callback?code=code&state=state",
        follow_redirects=False,
    )
    token = token_from_cookie(response)

    # Verify token is valid
    payload = verify_access_token(token)
    assert payload is not None
    assert payload["email"] == "alice@premnathrail.com"
    assert payload["role"] == "user"

    # The client's cookie jar now carries the session — use it directly.
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200
    user_info = response.json()
    assert user_info["email"] == "alice@premnathrail.com"


# ─────────────────────────────────────────────────────────────────
# Test 6: Get Current User (Protected Endpoint)
# ─────────────────────────────────────────────────────────────────

def test_get_current_user_requires_valid_token(client):
    """Test: GET /auth/me requires valid JWT token."""

    # Without token
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert "token" in response.json()["detail"].lower()

    # With invalid token
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid-token"}
    )
    assert response.status_code == 401


def test_get_current_user_with_valid_token(client, db):
    """Test: GET /auth/me returns user info with valid Bearer token."""

    # Create test user
    user = User(
        email="bob@premnathrail.com",
        name="Bob Smith",
        role="admin",
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Create token
    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role
    })

    # Call /auth/me with token
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "bob@premnathrail.com"
    assert data["name"] == "Bob Smith"
    assert data["role"] == "admin"
    assert data["is_active"] is True


def test_get_current_user_with_session_cookie(client, db):
    """Test: GET /auth/me also accepts the httponly session_token cookie."""
    user = User(email="cookie@premnathrail.com", name="Cookie User", role="user", is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    client.cookies.set("session_token", token)

    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == "cookie@premnathrail.com"


def test_get_current_user_inactive_denied(client, db):
    """Test: GET /auth/me denies access to inactive users."""

    # Create inactive user
    user = User(
        email="disabled@premnathrail.com",
        name="Disabled User",
        role="user",
        is_active=False  # ← Inactive!
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Create token
    token = create_access_token({
        "sub": str(user.id),
        "email": user.email
    })

    # Should be denied
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert "inactive" in response.json()["detail"].lower()


# ─────────────────────────────────────────────────────────────────
# Test 7: Microsoft Profile Fetching
# ─────────────────────────────────────────────────────────────────

@patch('app.auth.microsoft.httpx.AsyncClient.get')
async def test_get_microsoft_user_profile_success(mock_get):
    """Test: Successfully fetch user profile from Microsoft Graph API."""

    from app.auth.microsoft import get_microsoft_user_profile

    # Mock Microsoft Graph API response
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "id": "user-123",
        "displayName": "John Doe",
        "mail": "john@premnathrail.com",
        "jobTitle": "Engineer",
        "department": "R&D",
        "mobilePhone": "+1-555-1234"
    }
    mock_get.return_value = mock_response

    # Call function
    profile = await get_microsoft_user_profile("mock-access-token")

    # Verify profile fetched correctly
    assert profile["id"] == "user-123"
    assert profile["mail"] == "john@premnathrail.com"
    assert profile["displayName"] == "John Doe"


# ─────────────────────────────────────────────────────────────────
# Test 8: Invalid / Expired State Parameter
# ─────────────────────────────────────────────────────────────────

def test_oauth_callback_rejects_invalid_state(client):
    """Test: OAuth callback rejects a state parameter it never issued."""

    # Use state that was never issued by /auth/microsoft-login
    response = client.get("/api/v1/auth/callback?code=code&state=invalid-state-xyz")

    # Should reject
    assert response.status_code == 400
    assert "state" in response.json()["detail"].lower()


def test_oauth_callback_rejects_expired_state(client):
    """Test: a state past its 10-minute TTL is rejected even if it was
    genuinely issued (server-side expiry, not just single-use)."""
    _oauth_states["expired-state"] = {"next_path": "/", "expiry": time.time() - 1}

    response = client.get("/api/v1/auth/callback?code=code&state=expired-state")

    assert response.status_code == 400
    assert "state" in response.json()["detail"].lower()


def test_microsoft_login_caps_pending_states(client):
    """Test: once _MAX_PENDING_STATES is reached, new login attempts are
    rejected with 429 rather than growing the state store unboundedly."""
    from app.modules.main.routes import auth as auth_module

    saved = dict(auth_module._oauth_states)
    auth_module._oauth_states.clear()
    try:
        for i in range(auth_module._MAX_PENDING_STATES):
            auth_module._oauth_states[f"filler-{i}"] = {
                "next_path": "/", "expiry": time.time() + 600,
            }
        response = client.get("/api/v1/auth/microsoft-login", follow_redirects=False)
        assert response.status_code == 429
    finally:
        auth_module._oauth_states.clear()
        auth_module._oauth_states.update(saved)
