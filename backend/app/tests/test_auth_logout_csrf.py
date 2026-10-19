"""C-11 (logout without a valid access token) and C-07 (CSRF Origin check)."""
from app.auth.jwt_handler import create_access_token, create_refresh_token
from app.modules.main.models.user import User
from app.modules.main.models.user_session import UserSession


def _user(db, email):
    u = User(email=email, name=email.split("@")[0], role="admin", is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_logout_without_any_cookie_returns_200(client):
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 200


def test_logout_revokes_refresh_session_without_access_token(client, db):
    u = _user(db, "logout1@premnathrail.com")
    raw, token_hash = create_refresh_token()
    s = UserSession(user_id=u.id, token_hash=token_hash, **_session_extra())
    db.add(s)
    db.commit()

    client.cookies.set("refresh_token", raw)
    r = client.post("/api/v1/auth/logout")
    client.cookies.clear()
    assert r.status_code == 200
    db.refresh(s)
    assert s.revoked_at is not None
    set_cookie = " ".join(r.headers.get_list("set-cookie"))
    assert "session_token=" in set_cookie and "refresh_token=" in set_cookie


def _session_extra():
    from datetime import datetime, timedelta, timezone
    cols = UserSession.__table__.columns.keys()
    extra = {}
    if "expires_at" in cols:
        extra["expires_at"] = datetime.now(timezone.utc) + timedelta(days=1)
    return extra


def test_csrf_blocks_cross_site_cookie_post(client, db):
    u = _user(db, "csrf1@premnathrail.com")
    token = create_access_token({"sub": str(u.id), "email": u.email, "role": u.role})
    client.cookies.set("session_token", token)
    try:
        r = client.post("/api/v1/users/sync-azure", headers={"Origin": "https://evil.example.com"})
        assert r.status_code == 403
        assert "evil.example.com" in r.json()["detail"]
        assert "ALLOWED_ORIGINS" in r.json()["detail"]

        # Referer fallback when Origin is absent.
        r = client.patch(f"/api/v1/users/{u.id}/deactivate", headers={"Referer": "https://evil.example.com/x"})
        assert r.status_code == 403
    finally:
        client.cookies.clear()


def test_csrf_allows_allowed_origin_and_bearer_only(client, db):
    from app.core.config import settings
    u = _user(db, "csrf2@premnathrail.com")
    token = create_access_token({"sub": str(u.id), "email": u.email, "role": u.role})
    other = _user(db, "csrf2b@premnathrail.com")

    # Bearer-only (no cookie) from any origin is not CSRF-relevant.
    r = client.patch(
        f"/api/v1/users/{other.id}/deactivate",
        headers={"Authorization": f"Bearer {token}", "Origin": "https://evil.example.com"},
    )
    assert r.status_code == 200

    client.cookies.set("session_token", token)
    try:
        r = client.patch(
            f"/api/v1/users/{other.id}/activate", headers={"Origin": settings.allowed_origins_list[0]},
        )
        assert r.status_code == 200
    finally:
        client.cookies.clear()


def test_revoked_session_cuts_off_its_access_token_at_once(client, db):
    from datetime import datetime, timezone
    u = _user(db, "revoke1@premnathrail.com")
    raw, token_hash = create_refresh_token()
    s = UserSession(user_id=u.id, token_hash=token_hash, **_session_extra())
    db.add(s)
    db.commit()
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role, 'sid': s.id})}"}
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200

    s.revoked_at, s.revoked_reason = datetime.now(timezone.utc), "admin"
    db.commit()
    r = client.get("/api/v1/auth/me", headers=h)
    assert r.status_code == 401
    assert "signed out" in r.json()["detail"]


def test_issued_access_token_is_bound_to_its_live_session(db):
    from starlette.requests import Request
    from app.auth.jwt_handler import verify_access_token
    from app.modules.main.routes.auth import _issue_tokens
    u = _user(db, "revoke2@premnathrail.com")
    request = Request({"type": "http", "headers": [(b"user-agent", b"pytest")], "client": ("127.0.0.1", 1)})
    access, refresh = _issue_tokens(db, u, request)
    live = db.get(UserSession, verify_access_token(access)["sid"])
    assert refresh and live is not None and live.user_id == u.id and live.revoked_at is None
