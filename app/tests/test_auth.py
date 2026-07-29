import pytest
from app.auth.jwt_handler import create_access_token, verify_access_token


def test_create_and_verify_token():
    """Test JWT token creation and verification."""
    data = {"sub": "1", "email": "test@example.com", "role": "user"}
    token = create_access_token(data)

    # Token should be a string
    assert isinstance(token, str)
    assert len(token) > 0


def test_verify_valid_token():
    """Test that valid token is verified correctly."""
    data = {"sub": "1", "email": "test@example.com", "role": "user"}
    token = create_access_token(data)

    payload = verify_access_token(token)
    assert payload is not None
    assert payload["sub"] == "1"
    assert payload["email"] == "test@example.com"


def test_verify_invalid_token():
    """Test that invalid token returns None."""
    payload = verify_access_token("invalid-token")
    assert payload is None


def test_health_endpoint(client):
    """Test health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
