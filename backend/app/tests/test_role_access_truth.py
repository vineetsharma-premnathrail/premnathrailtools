"""Role saves reach the user, and the admin's access screens tell the truth.

- /users/{id}/effective-permissions honours validity windows, inactive roles and
  "applies to everyone" roles (same rules as User.role_grant_lists).
- /auth/me roles leave out off-window roles and list everyone-roles.
- validate_grants aliases retired-module ids and reports the dropped ones.
- An Edit scope ("<module>:edit") round-trips through the role API.
- The person whose access changed gets a bell ("access_changed").

Users are built WITHOUT assigned_apps so the real roles + deny-by-default rules
apply (see conftest's legacy shim)."""
from datetime import timedelta

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.grc import AccessValidity
from app.modules.main.models.notification import Notification
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.main.routes.roles import validate_grants
from app.modules.main.services import grc


def _user(db, email, role="user", grants=None, **kw):
    u = User(email=email, name=email.split("@")[0].title(), role=role, is_active=True,
             granular_permissions=grants or [], **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, name, permissions, **kw):
    r = Role(name=name, permissions=permissions, **kw)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _bells(db, user_id):
    return db.query(Notification).filter(Notification.user_id == user_id, Notification.notification_type == "access_changed").all()


# ------------------------------------------------------------ effective access

def test_effective_permissions_honour_validity_windows(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    store = _role(db, "Store Keeper", ["store:issues:view", "store:issues:create"])
    quality = _role(db, "Quality Viewer", ["quality:ncr:view"])
    old = _role(db, "Old Finance", ["accounts:*:view"], is_active=False)
    _role(db, "Employee self-service", ["hr:me:view"], is_default=True)
    u = _user(db, "temp@premnathrail.com", grants=["crm:dashboard:view"])
    u.roles = [store, quality, old]
    db.commit()
    d = grc.today()
    db.add(AccessValidity(user_id=u.id, kind="role", role_id=store.id, valid_to=d - timedelta(days=1)))
    db.add(AccessValidity(user_id=u.id, kind="grant", permission="crm:dashboard:view", valid_from=d + timedelta(days=5)))
    db.commit()

    r = client.get(f"/api/v1/users/{u.id}/effective-permissions", headers=_auth(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    grants, inactive = body["grants"], body["inactive_grants"]
    # In force today: the in-window role and the everyone-role only.
    assert grants["quality:ncr:view"] == ["Quality Viewer"]
    assert grants["hr:me:view"] == ["Employee self-service (everyone)"]
    assert "store:issues:create" not in grants and "crm:dashboard:view" not in grants
    assert not any(k.startswith("accounts:") for k in grants)
    # Shown, but marked "not active today".
    assert "not active today" in inactive["store:issues:create"][0] and "ended" in inactive["store:issues:create"][0]
    assert "not active today" in inactive["crm:dashboard:view"][0] and "starts" in inactive["crm:dashboard:view"][0]
    by_name = {s["name"]: s for s in body["sources"]}
    assert by_name["Store Keeper"]["active"] is False and by_name["Quality Viewer"]["active"] is True
    assert by_name["Old Finance"]["active"] is False and "inactive" in by_name["Old Finance"]["reason"]
    assert by_name["Employee self-service (everyone)"]["kind"] == "everyone"
    assert body["user_active"] is True
    # The screen and the user's real role access agree (User.role_grant_lists; the off-window
    # extra grant gives nothing). conftest's effective_permissions shim ignores grant windows,
    # so compare with the model's role lists directly.
    from app.core.permission_registry import expand_grant_sources
    assert set(grants) == expand_grant_sources(*u.role_grant_lists())

    u.is_active = False
    db.commit()
    assert client.get(f"/api/v1/users/{u.id}/effective-permissions", headers=_auth(admin)).json()["user_active"] is False


def test_auth_me_roles_skip_off_window_and_list_everyone_roles(client, db):
    store = _role(db, "Store Keeper", ["store:issues:view"])
    quality = _role(db, "Quality Viewer", ["quality:ncr:view"])
    _role(db, "Employee self-service", ["hr:me:view"], is_default=True)
    _role(db, "Dormant everyone", ["hr:me:view"], is_default=True, is_active=False)
    u = _user(db, "me@premnathrail.com")
    u.roles = [store, quality]
    db.commit()
    db.add(AccessValidity(user_id=u.id, kind="role", role_id=store.id, valid_from=grc.today() + timedelta(days=2)))
    db.commit()
    r = client.get("/api/v1/auth/me", headers=_auth(u))
    assert r.status_code == 200, r.text
    assert r.json()["roles"] == ["Quality Viewer", "Employee self-service (everyone)"]


def test_grc_today_is_india_and_table_check_not_cached_false(db, monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    assert grc.today() == datetime.now(ZoneInfo("Asia/Kolkata")).date()
    monkeypatch.setattr(grc, "_TABLE_READY", None)
    assert grc._table_ready(db) is True and grc._TABLE_READY is True


# ------------------------------------------------------------ validate_grants

def test_validate_grants_aliases_retired_module_ids_and_reports_dropped(db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    dropped: list[str] = []
    out = validate_grants(["purchase:requests:view", "store:items:view", "p2p:rfq:approve", "rnd:project_work:view"],
                          admin, dropped)
    from app.core.permission_registry import PURCHASE_DESK_GRANT
    assert PURCHASE_DESK_GRANT in out and "store:items:view" in out
    assert "projects:my_tasks:view" in out                       # department Ongoing Projects -> My Tasks
    assert not any(g.startswith(("purchase:", "rnd:project_work")) for g in out)
    assert dropped == ["p2p:rfq:approve"]                         # retired row: dropped, not refused


def test_role_with_retired_ids_saves_and_says_what_was_dropped(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    role = _role(db, "Buyer (old)", ["purchase:*:*", "p2p:rfq:approve", "store:items:view"])
    r = client.patch(f"/api/v1/roles/{role.id}", json={"name": role.name, "permissions": list(role.permissions)},
                     headers=_auth(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dropped_permissions"] == ["p2p:rfq:approve"]
    assert not any(g.startswith("purchase:") for g in body["permissions"])


# ------------------------------------------------------------ edit scope

def test_edit_scope_round_trip(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    role = _role(db, "CRM Exec", ["crm:*:view", "crm:*:edit"])
    r = client.patch(f"/api/v1/roles/{role.id}", headers=_auth(admin), json={
        "name": role.name, "permissions": list(role.permissions),
        "data_scopes": {"crm": "organization", "crm:edit": "department"}})
    assert r.status_code == 200, r.text
    assert r.json()["data_scopes"] == {"crm": "organization", "crm:edit": "department"}
    got = client.get(f"/api/v1/roles/{role.id}", headers=_auth(admin)).json()
    assert got["data_scopes"]["crm:edit"] == "department"
    db.expire_all()
    assert db.get(Role, role.id).data_scopes["crm:edit"] == "department"


# ------------------------------------------------------------ access-changed bell

def test_access_changed_bell_on_role_save_and_membership(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    holder = _user(db, "holder@premnathrail.com")
    other = _user(db, "other@premnathrail.com")
    role = _role(db, "Store Keeper", ["store:issues:view"])
    holder.roles = [role]
    db.commit()

    r = client.patch(f"/api/v1/roles/{role.id}", headers=_auth(admin),
                     json={"name": role.name, "permissions": ["store:issues:view", "store:issues:create"]})
    assert r.status_code == 200, r.text
    bells = _bells(db, holder.id)
    assert len(bells) == 1 and bells[0].title == "Your access changed" and "Store Keeper" in bells[0].message
    assert "open the page again" in bells[0].message.lower()
    assert _bells(db, other.id) == [] and _bells(db, admin.id) == []

    # A save that changes nothing about access tells nobody.
    client.patch(f"/api/v1/roles/{role.id}", headers=_auth(admin),
                 json={"name": role.name, "description": "Stores", "permissions": ["store:issues:create", "store:issues:view"]})
    assert len(_bells(db, holder.id)) == 1

    r = client.put(f"/api/v1/roles/{role.id}/users", headers=_auth(admin), json={"user_ids": [other.id]})
    assert r.status_code == 200, r.text
    assert len(_bells(db, other.id)) == 1 and "gave you" in _bells(db, other.id)[0].message
    assert len(_bells(db, holder.id)) == 2 and "removed" in _bells(db, holder.id)[-1].message


def test_access_changed_bell_on_user_roles(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    u = _user(db, "clerk@premnathrail.com")
    role = _role(db, "Quality Viewer", ["quality:ncr:view"])
    r = client.put(f"/api/v1/users/{u.id}/roles", json={"role_ids": [role.id]}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    bells = _bells(db, u.id)
    assert len(bells) == 1 and "Quality Viewer" in bells[0].message
