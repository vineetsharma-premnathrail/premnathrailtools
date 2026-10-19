from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import AVAILABLE_APPS, User


def _user(db, email, role="user", apps=("crm",), azure_admin=False, azure_id=None):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps),
             is_azure_admin=azure_admin, azure_id=azure_id)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def test_users_see_exactly_their_assigned_modules(db):
    normal = _user(db, "someone@premnathrail.com", apps=("quality", "hr", "crm"))
    admin = _user(db, "boss@premnathrail.com", role="admin", apps=())
    azure_admin = _user(db, "tenant.admin@premnathrail.com", apps=(), azure_admin=True)
    # No module is locked any more: assigned = visible.
    assert set(normal.get_apps()) == {"quality", "hr", "crm"}
    assert set(admin.get_apps()) == AVAILABLE_APPS
    assert set(azure_admin.get_apps()) == AVAILABLE_APPS


def test_hr_routes_need_the_hr_app(client, db):
    no_hr = _user(db, "crmuser@premnathrail.com", apps=("crm",))
    r = client.get("/api/v1/hr/leave/requests/me", headers=_h(no_hr))
    assert r.status_code == 403
    assert "HR & Administration" in r.json()["detail"]


def test_hr_app_user_can_use_hr(client, db):
    hr_user = _user(db, "hruser@premnathrail.com", apps=("hr",))
    r = client.get("/api/v1/hr/leave/requests/me", headers=_h(hr_user))
    assert r.status_code == 200


def test_admin_can_use_hr(client, db):
    admin = _user(db, "boss2@premnathrail.com", role="admin", apps=())
    r = client.get("/api/v1/hr/leave/requests/me", headers=_h(admin))
    assert r.status_code == 200


def test_login_refreshes_azure_admin_flag_and_promotes(db, monkeypatch):
    import asyncio
    from app.modules.main.routes import auth

    u = _user(db, "newly.admin@premnathrail.com", azure_id="az-1")

    async def admins():
        return {"az-1"}
    monkeypatch.setattr(auth, "get_azure_admin_ids", admins)
    asyncio.run(auth._refresh_azure_admin(db, u))
    assert u.is_azure_admin is True and u.role == "admin"

    # A failed Graph lookup keeps the last known value instead of stripping it.
    async def broken():
        raise RuntimeError("Graph 403")
    monkeypatch.setattr(auth, "get_azure_admin_ids", broken)
    asyncio.run(auth._refresh_azure_admin(db, u))
    assert u.is_azure_admin is True

    # Removed from the Azure admin role -> flag cleared (portal role kept).
    async def none():
        return set()
    monkeypatch.setattr(auth, "get_azure_admin_ids", none)
    asyncio.run(auth._refresh_azure_admin(db, u))
    assert u.is_azure_admin is False and u.role == "admin"
