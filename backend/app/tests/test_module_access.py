from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import AVAILABLE_APPS, User
from app.core.permission_registry import MODULES  # labels follow the registry


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
    # No module is locked any more: assigned = visible. A department module (Quality) also opens
    # Project Management for its task screens (the removed Ongoing Projects row, 2026-11-03).
    assert set(normal.get_apps()) == {"quality", "hr", "crm", "projects"}
    assert set(admin.get_apps()) == AVAILABLE_APPS
    # Microsoft tenant admin is not portal admin (owner, 2026-11-04): no module by that alone.
    assert set(azure_admin.get_apps()) != AVAILABLE_APPS


def test_hr_routes_need_the_hr_app(client, db):
    no_hr = _user(db, "crmuser@premnathrail.com", apps=("crm",))
    r = client.get("/api/v1/hr/leave/requests/me", headers=_h(no_hr))
    assert r.status_code == 403
    assert MODULES["hr"]["label"] in r.json()["detail"]


def test_hr_app_user_can_use_hr(client, db):
    hr_user = _user(db, "hruser@premnathrail.com", apps=("hr",))
    r = client.get("/api/v1/hr/leave/requests/me", headers=_h(hr_user))
    assert r.status_code == 200


def test_admin_can_use_hr(client, db):
    admin = _user(db, "boss2@premnathrail.com", role="admin", apps=())
    r = client.get("/api/v1/hr/leave/requests/me", headers=_h(admin))
    assert r.status_code == 200


def test_login_refreshes_azure_admin_flag_without_promoting(db, monkeypatch):
    import asyncio
    from app.modules.main.routes import auth
    from app.core.permission_registry import is_admin_user

    _user(db, "existing.portal.admin@premnathrail.com", role="admin")
    u = _user(db, "newly.admin@premnathrail.com", azure_id="az-1")

    async def admins():
        return {"az-1"}
    monkeypatch.setattr(auth, "get_azure_admin_ids", admins)
    asyncio.run(auth._refresh_azure_admin(db, u))
    # Flag stored for information only; a portal admin exists, so no promotion.
    assert u.is_azure_admin is True and u.role == "user" and not is_admin_user(u)

    # A failed Graph lookup keeps the last known value instead of stripping it.
    async def broken():
        raise RuntimeError("Graph 403")
    monkeypatch.setattr(auth, "get_azure_admin_ids", broken)
    asyncio.run(auth._refresh_azure_admin(db, u))
    assert u.is_azure_admin is True

    # Removed from the Azure admin role -> flag cleared (portal role untouched).
    async def none():
        return set()
    monkeypatch.setattr(auth, "get_azure_admin_ids", none)
    asyncio.run(auth._refresh_azure_admin(db, u))
    assert u.is_azure_admin is False and u.role == "user"


def test_first_install_bootstrap_makes_first_azure_admin_portal_admin(db, monkeypatch):
    import asyncio
    from app.modules.main.routes import auth

    # No active portal admin at all (fresh / emptied database).
    for other in db.query(User).filter(User.role == "admin").all():
        other.role = "user"
    db.commit()
    u = _user(db, "first.admin@premnathrail.com", azure_id="az-boot")

    async def admins():
        return {"az-boot"}
    monkeypatch.setattr(auth, "get_azure_admin_ids", admins)
    asyncio.run(auth._refresh_azure_admin(db, u))
    assert u.role == "admin"

    # Once an admin exists, the next Azure admin is not promoted.
    v = _user(db, "second.tenant.admin@premnathrail.com", azure_id="az-boot2")

    async def admins2():
        return {"az-boot", "az-boot2"}
    monkeypatch.setattr(auth, "get_azure_admin_ids", admins2)
    asyncio.run(auth._refresh_azure_admin(db, v))
    assert v.role == "user"
