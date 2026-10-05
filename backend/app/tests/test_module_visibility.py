import pytest

from app.auth.jwt_handler import create_access_token
from app.core import module_visibility
from app.modules.main.models.user import AVAILABLE_APPS, User


@pytest.fixture
def locked():
    """Re-enable the real lock that conftest switches off."""
    keys = {"quality": "Quality", "hr": "HR & Admin", "production": "Production"}
    module_visibility.RESTRICTED_APPS.update(keys)
    module_visibility._PACKAGE_TO_APP.update({k: k for k in keys})
    yield


def _user(db, email, role="user", apps=("quality", "hr", "crm")):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def test_restricted_apps_hidden_from_everyone_but_allow_list(db, locked):
    normal = _user(db, "someone@premnathrail.com")
    admin = _user(db, "boss@premnathrail.com", role="admin")
    vineet = _user(db, "Vineet.Sharma@premnathrail.com", apps=())
    assert normal.get_apps() == ["crm"]
    assert "quality" not in admin.get_apps() and "hr" not in admin.get_apps() and "crm" in admin.get_apps()
    # Allow-listed sees the WHOLE portal (store, p2p, crm…), not just the
    # locked modules — even as a plain user with nothing assigned.
    assert set(vineet.get_apps()) == AVAILABLE_APPS


def test_restricted_module_routes_403_even_for_admin(client, db, locked):
    admin = _user(db, "boss2@premnathrail.com", role="admin")
    r = client.get("/api/v1/hr/leave/requests/me", headers=_h(admin))
    assert r.status_code == 403
    assert "switched off" in r.json()["detail"]


def test_allow_listed_user_passes_gate(client, db, locked):
    vineet = _user(db, "vineet.sharma@premnathrail.com", apps=())
    r = client.get("/api/v1/hr/leave/requests/me", headers=_h(vineet))
    assert r.status_code == 200


def test_unrestricted_module_still_works(client, db, locked):
    normal = _user(db, "crmuser@premnathrail.com", apps=("crm",))
    r = client.get("/api/v1/auth/me", headers=_h(normal))
    assert r.status_code == 200
    assert "hr" not in r.json()["apps"]
