"""
Tests for the "who's viewing this" live presence indicator (ERP SR/Project
detail pages). Ported from legacy's app/api/v1/presence.py: an in-memory,
lazily-TTL'd store — clients heartbeat every 30s, entries older than 45s
are purged on the next touch of that resource's key.
"""
import time

from app.modules.main.models.user import User
from app.auth.jwt_handler import create_access_token
from app.modules.main.routes import presence as presence_module


def make_user(db, email, name):
    user = User(email=email, name=name, role="user", is_active=True, assigned_apps=["erp"])
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_heartbeat_registers_viewer_for_other_users(client, db):
    alice = make_user(db, "alice@premnathrail.com", "Alice")
    bob = make_user(db, "bob@premnathrail.com", "Bob")

    response = client.post(
        "/api/v1/presence/heartbeat",
        json={"resource_type": "sr", "resource_id": 42},
        headers=auth_header(alice),
    )
    assert response.status_code == 204

    viewers = client.get("/api/v1/presence/sr/42", headers=auth_header(bob)).json()
    assert viewers == [{"name": "Alice", "email": "alice@premnathrail.com"}]


def test_viewer_excludes_self(client, db):
    alice = make_user(db, "alice2@premnathrail.com", "Alice")

    client.post(
        "/api/v1/presence/heartbeat",
        json={"resource_type": "project", "resource_id": 7},
        headers=auth_header(alice),
    )
    viewers = client.get("/api/v1/presence/project/7", headers=auth_header(alice)).json()
    assert viewers == []


def test_stale_heartbeat_is_purged(client, db):
    alice = make_user(db, "alice3@premnathrail.com", "Alice")
    bob = make_user(db, "bob3@premnathrail.com", "Bob")

    presence_module._presence["sr:99"] = {
        alice.id: {"name": "Alice", "email": alice.email, "last_seen": time.time() - 999},
    }

    viewers = client.get("/api/v1/presence/sr/99", headers=auth_header(bob)).json()
    assert viewers == []


def test_different_resources_are_isolated(client, db):
    alice = make_user(db, "alice4@premnathrail.com", "Alice")
    bob = make_user(db, "bob4@premnathrail.com", "Bob")

    client.post(
        "/api/v1/presence/heartbeat",
        json={"resource_type": "sr", "resource_id": 1},
        headers=auth_header(alice),
    )

    assert client.get("/api/v1/presence/sr/2", headers=auth_header(bob)).json() == []
