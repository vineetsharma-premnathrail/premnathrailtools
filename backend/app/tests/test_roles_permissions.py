"""Roles + deny-by-default permissions (Organization › Role & Permissions).

Users here are built WITHOUT `assigned_apps`, so the conftest legacy shim is
off and the real rules apply: access = roles + extra grants, nothing implied."""
import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.core.permission_registry import (
    can_access_module, can_perform, can_view_tab, legacy_access, restricted_subtabs, standard_module_grants,
)
from app.core.permissions import ensure_can_delete, has_erp_permission
from app.modules.main.models.role import Role
from app.modules.main.models.user import User


def _user(db, email, role="user", grants=None):
    u = User(email=email, name=email.split("@")[0].title(), role=role, is_active=True, granular_permissions=grants or [])
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _role(db, name, permissions, **kw):
    r = Role(name=name, permissions=permissions, **kw)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def test_no_grants_means_no_access(db):
    u = _user(db, "nobody@premnathrail.com")
    assert u.get_apps() == []
    assert not can_view_tab(u, "store", "issues")
    assert not can_perform(u, "store", "issues", "create")
    assert restricted_subtabs(u)["store"] == []


def test_role_grants_union_with_extras_and_derive_apps(db):
    keeper = _role(db, "Store Keeper", ["store:issues:view", "store:issues:create", "store:items:view"])
    viewer = _role(db, "Finance Viewer", ["accounts:*:view"])
    u = _user(db, "sk@premnathrail.com", grants=["quality:ncr:view"])
    u.roles = [keeper, viewer]
    db.commit()
    assert can_perform(u, "store", "issues", "create")
    assert not can_perform(u, "store", "issues", "approve")
    assert can_view_tab(u, "accounts", "journal_vouchers") and not can_perform(u, "accounts", "journal_vouchers", "create")
    assert can_view_tab(u, "quality", "ncr")
    assert u.get_apps() == ["accounts", "quality", "store"]
    assert can_access_module(u, "store") and not can_access_module(u, "hr")


def test_inactive_role_gives_nothing_and_default_role_applies_to_everyone(db):
    _role(db, "Old Store", ["store:*:*"], is_active=False)
    _role(db, "Employee self-service", ["hr:me:view", "hr:me:create"], is_default=True)
    u = _user(db, "e@premnathrail.com")
    u.roles = [db.query(Role).filter(Role.name == "Old Store").one()]
    db.commit()
    assert not can_view_tab(u, "store", "items")
    assert can_perform(u, "hr", "me", "create") and "hr" in u.get_apps()


def test_admin_passes_everything(db):
    a = _user(db, "admin@premnathrail.com", role="admin")
    assert can_perform(a, "accounts", "year_end_close", "approve")
    assert restricted_subtabs(a) == {}


def test_delete_only_own_records(db):
    u = _user(db, "d@premnathrail.com", grants=["store:issues:view", "store:issues:delete"])
    other = _user(db, "o@premnathrail.com")
    admin = _user(db, "a2@premnathrail.com", role="admin")

    class Rec:
        def __init__(self, created_by_id):
            self.created_by_id = created_by_id

    ensure_can_delete(u, Rec(u.id), "store", "issues")  # own: fine
    with pytest.raises(HTTPException) as exc:
        ensure_can_delete(u, Rec(other.id), "store", "issues", what="issue")
    assert exc.value.status_code == 403 and "you created yourself" in exc.value.detail
    ensure_can_delete(admin, Rec(other.id), "store", "issues")  # admin: anything
    viewer = _user(db, "v@premnathrail.com", grants=["store:issues:view"])
    with pytest.raises(HTTPException) as exc:
        ensure_can_delete(viewer, Rec(viewer.id), "store", "issues")
    assert "'delete' permission" in exc.value.detail


def test_legacy_erp_ids_map_to_matrix(db):
    u = _user(db, "erp@premnathrail.com", grants=["erp:projects:view", "erp:projects:edit"])
    assert has_erp_permission(u, "project_edit") and not has_erp_permission(u, "project_delete")
    assert not has_erp_permission(u, "sr_view")


def test_legacy_access_translation():
    keep, standard = legacy_access(["store", "erp", "quality"], ["project_create"], ["quality:ncr:view", "crm:dashboard:view"])
    assert standard == ["store"]                       # untouched module -> Standard (migrated) role
    assert "quality:ncr:view" in keep and not any(g.startswith("crm:") for g in keep)  # unassigned module dropped
    assert "erp:projects:create" in keep and "erp:projects:delete" not in keep        # erp from legacy ids
    assert "store:settings:edit" not in standard_module_grants("store")               # authority left out


# ---------------------------------------------------------------- API

def test_roles_api_crud_members_and_effective(client, db):
    admin = _user(db, "boss@premnathrail.com", role="admin")
    u = _user(db, "clerk@premnathrail.com")
    h = _auth(admin)

    cat = client.get("/api/v1/roles/catalog", headers=h).json()
    assert cat["modules"]["store"]["actions"]["stock"] == ["view", "export", "print"]

    r = client.post("/api/v1/roles", headers=h, json={"name": "Store Clerk", "permissions": ["store:*:view", "store:issues:create"]})
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert client.post("/api/v1/roles", headers=h, json={"name": "store clerk"}).status_code == 409
    bad = client.post("/api/v1/roles", headers=h, json={"name": "Bad", "permissions": ["store:stock:delete"]})
    assert bad.status_code == 400 and "Unknown permission" in bad.json()["detail"]

    assert client.put(f"/api/v1/users/{u.id}/roles", headers=h, json={"role_ids": [rid]}).status_code == 200
    eff = client.get(f"/api/v1/users/{u.id}/effective-permissions", headers=h).json()
    assert eff["grants"]["store:issues:create"] == ["Store Clerk"] and eff["apps"] == ["store"]

    me = client.get("/api/v1/auth/me", headers=_auth(u)).json()
    assert "store:issues:create" in me["permissions"] and me["roles"] == ["Store Clerk"] and me["apps"] == ["store"]
    assert me["tab_access"]["store"] and me["tab_access"]["accounts"] == []

    held = client.delete(f"/api/v1/roles/{rid}", headers=h)
    assert held.status_code == 409 and "still assigned" in held.json()["detail"]
    assert client.put(f"/api/v1/roles/{rid}/users", headers=h, json={"user_ids": []}).status_code == 200
    assert client.delete(f"/api/v1/roles/{rid}", headers=h).status_code == 200


def test_system_roles_are_read_only(client, db):
    admin = _user(db, "boss2@premnathrail.com", role="admin")
    sys_role = _role(db, "Store – Full Access", ["store:*:*"], is_system=True)
    r = client.patch(f"/api/v1/roles/{sys_role.id}", headers=_auth(admin), json={"name": "Store – Full Access", "permissions": []})
    assert r.status_code == 400 and "Copy" in r.json()["detail"]
    copy = client.post(f"/api/v1/roles/{sys_role.id}/copy", headers=_auth(admin), json={"name": "Store Lead"})
    assert copy.status_code == 200 and copy.json()["permissions"] == ["store:*:*"] and not copy.json()["is_system"]


def test_non_admin_role_manager_cannot_escalate(client, db):
    mgr = _user(db, "hrlead@premnathrail.com", grants=[
        "organization:roles:view", "organization:roles:create", "organization:roles:edit", "hr:*:view",
    ])
    ok = client.post("/api/v1/roles", headers=_auth(mgr), json={"name": "HR Viewer", "permissions": ["hr:*:view"]})
    assert ok.status_code == 200, ok.text
    esc = client.post("/api/v1/roles", headers=_auth(mgr), json={"name": "Sneaky", "permissions": ["accounts:*:*"]})
    assert esc.status_code == 403 and "don't hold yourself" in esc.json()["detail"]
    nobody = _user(db, "x@premnathrail.com")
    denied = client.get("/api/v1/roles", headers=_auth(nobody))
    assert denied.status_code == 403 and "Role & Permissions" in denied.json()["detail"]


def test_users_patch_rejects_legacy_module_access(client, db):
    admin = _user(db, "boss3@premnathrail.com", role="admin")
    u = _user(db, "y@premnathrail.com")
    r = client.patch(f"/api/v1/users/{u.id}", headers=_auth(admin), json={"assigned_apps": ["store"]})
    assert r.status_code == 400 and "roles" in r.json()["detail"]
