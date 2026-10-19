"""App password lock (services/app_lock.py): every sign-in starts locked, the
first time the user sets an app password, wrong tries lock it for a while,
a forgotten password is reset with an emailed one-time temporary password,
idle time locks again — all enforced by the server (423), not just the page."""
from datetime import datetime, timedelta, timezone

import pytest

from app.auth.jwt_handler import create_access_token, create_refresh_token
from app.modules.main.models.user import User
from app.modules.main.models.user_session import UserSession

LOCK = "/api/v1/auth/app-lock"
PROTECTED = "/api/v1/organization/security/settings"  # any non-/auth route
ACTIVE = {"X-User-Active": "1"}


def _signed_in(db, email="lock1@premnathrail.com"):
    u = User(email=email, name=email.split("@")[0], role="admin", is_active=True)
    db.add(u)
    db.commit()
    _raw, token_hash = create_refresh_token()
    s = UserSession(user_id=u.id, token_hash=token_hash, expires_at=datetime.now(timezone.utc) + timedelta(days=1))
    db.add(s)
    db.commit()
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role, 'sid': s.id})}"}
    return u, s, h


@pytest.fixture
def mail(monkeypatch):
    """Capture the temporary password instead of sending mail."""
    from app.core.config import settings
    from app.modules.main.services import app_lock
    sent = {}
    real = app_lock.temp_password_email

    def capture(user, temp):
        sent["temp"], sent["to"] = temp, user.email
        return real(user, temp)

    async def fake_send(*args, **kwargs):
        return True, ""

    monkeypatch.setattr(settings, "SENDER_EMAIL", "erp@premnathrail.com")
    monkeypatch.setattr(app_lock, "temp_password_email", capture)
    monkeypatch.setattr("app.utils.email._send_graph_mail", fake_send)
    return sent


def test_first_sign_in_is_locked_until_the_app_password_is_set(client, db):
    _u, _s, h = _signed_in(db)
    r = client.get(PROTECTED, headers=h)
    assert r.status_code == 423 and "Set your app password" in r.json()["detail"]
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200  # /auth stays open
    st = client.get(f"{LOCK}/status", headers=h).json()
    assert st["has_password"] is False and st["state"] == "locked" and st["min_length"] == 6

    assert "at least 6" in client.post(f"{LOCK}/set", json={"new_password": "12ab"}, headers=h).json()["detail"]
    assert "too easy" in client.post(f"{LOCK}/set", json={"new_password": "123456"}, headers=h).json()["detail"]
    assert "repeated" in client.post(f"{LOCK}/set", json={"new_password": "111111"}, headers=h).json()["detail"]
    r = client.post(f"{LOCK}/set", json={"new_password": "Rail@26"}, headers=h)
    assert r.status_code == 200 and r.json()["state"] == "unlocked"
    assert client.get(PROTECTED, headers={**h, **ACTIVE}).status_code == 200


def test_lock_unlock_and_lockout_after_five_wrong_tries(client, db):
    u, _s, h = _signed_in(db, "lock2@premnathrail.com")
    client.post(f"{LOCK}/set", json={"new_password": "Rail@26"}, headers=h)
    client.post(f"{LOCK}/lock", headers=h)
    assert client.get(PROTECTED, headers=h).status_code == 423
    for left in (4, 3, 2, 1):
        r = client.post(f"{LOCK}/unlock", json={"password": "nope"}, headers=h)
        assert r.status_code == 422 and f"{left} tr" in r.json()["detail"]
    r = client.post(f"{LOCK}/unlock", json={"password": "nope"}, headers=h)
    assert "locked for 15 minutes" in r.json()["detail"]
    r = client.post(f"{LOCK}/unlock", json={"password": "Rail@26"}, headers=h)  # right one, but locked out
    assert r.status_code == 429 and "Forgot app password" in r.json()["detail"]
    u.app_password_locked_until = None
    db.commit()
    assert client.post(f"{LOCK}/unlock", json={"password": "Rail@26"}, headers=h).json()["state"] == "unlocked"
    assert client.get(PROTECTED, headers=h).status_code == 200


def test_forgot_emails_a_one_time_temp_password_to_reset_with(client, db, mail):
    _u, _s, h = _signed_in(db, "lock3@premnathrail.com")
    client.post(f"{LOCK}/set", json={"new_password": "Rail@26"}, headers=h)
    client.post(f"{LOCK}/lock", headers=h)
    r = client.post(f"{LOCK}/forgot", headers=h)
    assert r.status_code == 200 and r.json()["sent_to"].endswith("@premnathrail.com") and mail["to"] == "lock3@premnathrail.com"
    assert client.post(f"{LOCK}/forgot", headers=h).status_code == 429  # no resend right away
    r = client.post(f"{LOCK}/unlock", json={"password": mail["temp"]}, headers=h)
    assert r.json()["state"] == "reset"
    assert client.get(PROTECTED, headers=h).status_code == 423  # temp password only lets you set a new one
    r = client.post(f"{LOCK}/set", json={"new_password": "Bogie#77"}, headers=h)  # no current password needed
    assert r.status_code == 200 and r.json()["state"] == "unlocked"
    client.post(f"{LOCK}/lock", headers=h)
    assert client.post(f"{LOCK}/unlock", json={"password": mail["temp"]}, headers=h).status_code == 422  # one-time
    assert client.post(f"{LOCK}/unlock", json={"password": "Bogie#77"}, headers=h).json()["state"] == "unlocked"


def test_idle_time_locks_and_background_polling_does_not_count(client, db):
    _u, s, h = _signed_in(db, "lock4@premnathrail.com")
    client.post(f"{LOCK}/set", json={"new_password": "Rail@26"}, headers=h)
    s.app_activity_at = datetime.now(timezone.utc) - timedelta(minutes=14)
    db.commit()
    assert client.get(PROTECTED, headers=h).status_code == 200  # no activity header → not refreshed
    s.app_activity_at = datetime.now(timezone.utc) - timedelta(minutes=16)
    db.commit()
    r = client.get(PROTECTED, headers={**h, **ACTIVE})
    assert r.status_code == 423 and "enter your app password" in r.json()["detail"]


def test_change_needs_the_current_password(client, db):
    _u, _s, h = _signed_in(db, "lock5@premnathrail.com")
    client.post(f"{LOCK}/set", json={"new_password": "Rail@26"}, headers=h)
    r = client.post(f"{LOCK}/set", json={"new_password": "Bogie#77", "current_password": "wrong1"}, headers=h)
    assert r.status_code == 422 and "current app password is wrong" in r.json()["detail"]
    r = client.post(f"{LOCK}/set", json={"new_password": "Rail@26", "current_password": "Rail@26"}, headers=h)
    assert "same as the current" in r.json()["detail"]
    assert client.post(f"{LOCK}/set", json={"new_password": "Bogie#77", "current_password": "Rail@26"}, headers=h).status_code == 200


def test_refresh_keeps_the_lock_state_and_a_new_sign_in_starts_locked(db):
    from starlette.requests import Request
    from app.auth.jwt_handler import verify_access_token
    from app.modules.main.routes.auth import _issue_tokens
    u, s, _h = _signed_in(db, "lock6@premnathrail.com")
    s.app_lock_state, s.app_activity_at = "unlocked", datetime.now(timezone.utc)
    db.commit()
    request = Request({"type": "http", "headers": [(b"user-agent", b"pytest")], "client": ("127.0.0.1", 1)})
    access, _ = _issue_tokens(db, u, request, rotated_from=s)
    assert db.get(UserSession, verify_access_token(access)["sid"]).app_lock_state == "unlocked"
    access, _ = _issue_tokens(db, u, request)
    assert db.get(UserSession, verify_access_token(access)["sid"]).app_lock_state == "locked"


def test_switched_off_or_token_without_session_is_never_locked(client, db):
    from app.modules.organization.services.security import save_security_settings
    u, _s, h = _signed_in(db, "lock7@premnathrail.com")
    tool = {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}
    assert client.get(PROTECTED, headers=tool).status_code == 200
    assert client.get(PROTECTED, headers=h).status_code == 423
    save_security_settings(db, {"app_lock_enabled": False}, u)
    db.commit()
    assert client.get(PROTECTED, headers=h).status_code == 200


def test_admin_can_email_a_user_a_temp_password(client, db, mail):
    admin, _s, _h = _signed_in(db, "lockadmin@premnathrail.com")
    target = User(email="forgetful@premnathrail.com", name="forgetful", role="user", is_active=True)
    db.add(target)
    db.commit()
    tool = {"Authorization": f"Bearer {create_access_token({'sub': str(admin.id), 'email': admin.email, 'role': admin.role})}"}
    r = client.post(f"/api/v1/organization/security/users/{target.id}/app-password-reset", headers=tool)
    assert r.status_code == 200 and mail["to"] == "forgetful@premnathrail.com"


def test_heartbeat_keeps_an_active_form_unlocked_but_never_unlocks(client, db):
    _u, s, h = _signed_in(db, "lock8@premnathrail.com")
    client.post(f"{LOCK}/set", json={"new_password": "Rail@26"}, headers=h)
    s.app_activity_at = datetime.now(timezone.utc) - timedelta(minutes=14)
    db.commit()
    assert client.post(f"{LOCK}/heartbeat", headers=h).json()["state"] == "unlocked"
    db.refresh(s)
    beat = s.app_activity_at if s.app_activity_at.tzinfo else s.app_activity_at.replace(tzinfo=timezone.utc)
    assert datetime.now(timezone.utc) - beat < timedelta(minutes=1)  # idle clock restarted
    assert client.get(PROTECTED, headers=h).status_code == 200
    client.post(f"{LOCK}/lock", headers=h)
    assert client.post(f"{LOCK}/heartbeat", headers=h).json()["state"] == "locked"
    assert client.get(PROTECTED, headers=h).status_code == 423
