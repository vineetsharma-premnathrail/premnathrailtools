"""Organization module RBAC: tab permissions replace the old admin-only gate,
and the authority rules on users/roles/partners stay in force."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department

ORG = "/api/v1/organization"


def make_user(db, email, role="user", grants=(), **extra):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True,
             granular_permissions=list(grants), **extra)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def test_view_only_department_user_cannot_create_edit_or_delete(client, db):
    d = Department(name="Design", code="Design")
    db.add(d)
    db.commit()
    viewer = make_user(db, "dept_view@premnathrail.com", grants=["organization:department:view"])
    h = auth(viewer)
    assert client.get(f"{ORG}/departments", headers=h).status_code == 200
    assert client.post(f"{ORG}/departments", json={"name": "QA"}, headers=h).status_code == 403
    assert client.patch(f"{ORG}/departments/{d.id}", json={"name": "X"}, headers=h).status_code == 403
    assert client.delete(f"{ORG}/departments/{d.id}", headers=h).status_code == 403
    # No grant at all -> no access.
    outsider = make_user(db, "dept_out@premnathrail.com")
    assert client.get(f"{ORG}/departments", headers=auth(outsider)).status_code == 403


def test_department_delete_grant_allows_delete(client, db):
    d = Department(name="Temp", code="Temp")
    db.add(d)
    db.commit()
    u = make_user(db, "dept_del@premnathrail.com", grants=["organization:department:view", "organization:department:delete"])
    assert client.delete(f"{ORG}/departments/{d.id}", headers=auth(u)).status_code == 204


def test_company_info_view_vs_edit(client, db):
    viewer = make_user(db, "info_view@premnathrail.com", grants=["organization:info:view"])
    assert client.get(f"{ORG}/company/partners", headers=auth(viewer)).status_code == 200
    assert client.put(f"{ORG}/company/partners", json={"user_ids": []}, headers=auth(viewer)).status_code == 403


def test_info_editor_cannot_make_themselves_partner(client, db):
    editor = make_user(db, "info_edit@premnathrail.com", grants=["organization:info:edit"])
    r = client.put(f"{ORG}/company/partners", json={"user_ids": [editor.id]}, headers=auth(editor))
    assert r.status_code == 403
    assert "yourself" in r.json()["detail"]


def test_users_editor_authority_limits(client, db):
    editor = make_user(db, "users_edit@premnathrail.com", grants=["organization:users:edit"])
    other = make_user(db, "users_other@premnathrail.com")
    admin = make_user(db, "users_admin@premnathrail.com", role="admin")
    h = auth(editor)
    assert client.get("/api/v1/users", headers=h).status_code == 200
    # Plain profile/flag edits on another non-admin are fine.
    assert client.patch(f"/api/v1/users/{other.id}", json={"is_director": True}, headers=h).status_code == 200
    # Granting/removing admin stays admin-only.
    assert client.patch(f"/api/v1/users/{other.id}", json={"role": "admin"}, headers=h).status_code == 403
    # Can't touch an admin account.
    assert client.patch(f"/api/v1/users/{admin.id}/deactivate", headers=h).status_code == 403
    # Can't give themselves approval flags.
    assert client.patch(f"/api/v1/users/{editor.id}", json={"is_director": True}, headers=h).status_code == 403
    # Azure sync is users:create.
    assert client.post("/api/v1/users/sync-azure", headers=h).status_code == 403


def test_users_viewer_cannot_edit(client, db):
    viewer = make_user(db, "users_view@premnathrail.com", grants=["organization:users:view"])
    other = make_user(db, "users_tgt@premnathrail.com")
    h = auth(viewer)
    assert client.get(f"/api/v1/users/{other.id}", headers=h).status_code == 200
    assert client.patch(f"/api/v1/users/{other.id}", json={"name": "X"}, headers=h).status_code == 403
    assert client.patch(f"/api/v1/users/{other.id}/deactivate", headers=h).status_code == 403
    # The directory stays open to every signed-in user.
    assert client.get("/api/v1/users/directory", headers=auth(make_user(db, "nobody@premnathrail.com"))).status_code == 200


def test_roles_editor_no_escalation_and_no_self_edit(client, db):
    mine = ["organization:roles:view", "organization:roles:edit", "store:issues:view"]
    manager = make_user(db, "roles_mgr@premnathrail.com", grants=mine)
    other = make_user(db, "roles_tgt@premnathrail.com")
    small = Role(name="Store viewer", permissions=["store:issues:view"])
    big = Role(name="Store boss", permissions=["store:*:*"])
    db.add_all([small, big])
    db.commit()
    h = auth(manager)
    assert client.put(f"/api/v1/users/{other.id}/roles", json={"role_ids": [small.id]}, headers=h).status_code == 200
    r = client.put(f"/api/v1/users/{other.id}/roles", json={"role_ids": [small.id, big.id]}, headers=h)
    assert r.status_code == 403 and "Store boss" in r.json()["detail"]
    assert client.patch(f"/api/v1/users/{other.id}/permissions", json={"granular_permissions": ["store:*:*"]}, headers=h).status_code == 403
    # Never their own roles / extras.
    assert client.put(f"/api/v1/users/{manager.id}/roles", json={"role_ids": [small.id]}, headers=h).status_code == 403
    assert client.patch(f"/api/v1/users/{manager.id}/permissions", json={"granular_permissions": mine}, headers=h).status_code == 403


def test_audit_logs_need_view(client, db):
    viewer = make_user(db, "audit_view@premnathrail.com", grants=["organization:audit_logs:view"])
    assert client.get(f"{ORG}/audit-logs", headers=auth(viewer)).status_code == 200
    assert client.get(f"{ORG}/audit-logs", headers=auth(make_user(db, "audit_no@premnathrail.com"))).status_code == 403


def test_users_editor_sets_every_approval_flag_but_not_partner(client, db):
    """The user page's Approval Roles section saves all routing flags in one
    PATCH; Partner stays in Company Info › Partners."""
    editor = make_user(db, "flags_edit@premnathrail.com", grants=["organization:users:edit"])
    other = make_user(db, "flags_tgt@premnathrail.com")
    flags = {f: True for f in (
        "is_director", "is_department_head", "is_plant_head", "is_project_head", "is_purchase_head",
        "is_finance_manager", "is_purchase_manager", "is_store_manager", "is_production_manager",
        "is_design_manager", "is_rnd_manager", "is_project_manager",
    )}
    r = client.patch(f"/api/v1/users/{other.id}", json={**flags, "is_partner": True}, headers=auth(editor))
    assert r.status_code == 200, r.text
    body = r.json()
    assert all(body[f] for f in flags)
    assert body["is_partner"] is False


def test_department_membership_follows_the_id_through_a_rename(client, db):
    """Members are linked by users.department_id, so renaming a department
    keeps its members, its head routing and the user's department text."""
    from app.modules.organization.services.approval_engine import _department_heads
    head = make_user(db, "dfk_head@premnathrail.com")
    d = Department(name="Purchase", code="Purchase-fk", head_user_id=head.id)
    db.add(d)
    db.commit()
    admin = make_user(db, "dfk_admin@premnathrail.com", role="admin")
    member = make_user(db, "dfk_member@premnathrail.com")
    h = auth(admin)
    assert client.post(f"{ORG}/departments/{d.id}/members", json={"user_id": member.id}, headers=h).status_code == 201
    db.refresh(member)
    assert member.department_id == d.id and member.department == "Purchase"

    assert client.patch(f"{ORG}/departments/{d.id}", json={"name": "Procurement"}, headers=h).status_code == 200
    db.refresh(member)
    assert member.department == "Procurement"
    ids = [m["id"] for m in client.get(f"{ORG}/departments/{d.id}/members", headers=h).json()]
    assert member.id in ids
    assert _department_heads(db, member) == [head.id]

    assert client.delete(f"{ORG}/departments/{d.id}/members/{member.id}", headers=h).status_code == 204
    db.refresh(member)
    assert member.department_id is None and member.department is None


def test_unlinked_user_still_matches_by_name(client, db):
    from app.modules.organization.services.approval_engine import _department_heads
    head = make_user(db, "dfk_head2@premnathrail.com")
    db.add(Department(name="Stores", code="Stores-fk", head_user_id=head.id))
    db.commit()
    legacy = make_user(db, "dfk_legacy@premnathrail.com", department=" stores ")
    assert _department_heads(db, legacy) == [head.id]
