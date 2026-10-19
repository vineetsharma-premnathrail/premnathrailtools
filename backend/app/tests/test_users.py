from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.main.routes import users as users_routes


def make_user(db, email, role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_list_users_requires_admin(client, db):
    normal_user = make_user(db, "normal@premnathrail.com", role="user")
    response = client.get("/api/v1/users", headers=auth_header(normal_user))
    assert response.status_code == 403


def test_list_users_as_admin(client, db):
    admin = make_user(db, "admin@premnathrail.com", role="admin")
    make_user(db, "someone@premnathrail.com", role="user")

    response = client.get("/api/v1/users", headers=auth_header(admin))
    assert response.status_code == 200
    emails = [u["email"] for u in response.json()]
    assert "admin@premnathrail.com" in emails
    assert "someone@premnathrail.com" in emails


def test_admin_can_update_user_role(client, db):
    admin = make_user(db, "admin2@premnathrail.com", role="admin")
    target = make_user(db, "target@premnathrail.com", role="user")

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"role": "admin"},
        headers=auth_header(admin),
    )
    assert response.status_code == 200
    assert response.json()["role"] == "admin"


def test_admin_cannot_set_invalid_role(client, db):
    admin = make_user(db, "admin3@premnathrail.com", role="admin")
    target = make_user(db, "target2@premnathrail.com", role="user")

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"role": "superuser"},
        headers=auth_header(admin),
    )
    assert response.status_code == 400


def test_admin_cannot_deactivate_self(client, db):
    admin = make_user(db, "admin4@premnathrail.com", role="admin")
    response = client.patch(f"/api/v1/users/{admin.id}/deactivate", headers=auth_header(admin))
    assert response.status_code == 400


def test_admin_can_deactivate_other_user(client, db):
    admin = make_user(db, "admin5@premnathrail.com", role="admin")
    target = make_user(db, "target3@premnathrail.com", role="user")

    response = client.patch(f"/api/v1/users/{target.id}/deactivate", headers=auth_header(admin))
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    response = client.patch(f"/api/v1/users/{target.id}/activate", headers=auth_header(admin))
    assert response.status_code == 200
    assert response.json()["is_active"] is True


def test_module_access_comes_from_roles_not_assigned_apps(client, db):
    """Module access is granted through roles now; the old assigned_apps
    write is refused with a pointer to roles."""
    from app.modules.main.models.role import Role

    admin = make_user(db, "admin6@premnathrail.com", role="admin")
    target = make_user(db, "target4@premnathrail.com", role="user")

    refused = client.patch(f"/api/v1/users/{target.id}", json={"assigned_apps": ["erp", "crm"]}, headers=auth_header(admin))
    assert refused.status_code == 400 and "roles" in refused.json()["detail"]

    role = Role(name="ERP + CRM viewer", permissions=["erp:*:view", "crm:*:view"])
    db.add(role)
    db.commit()
    response = client.put(f"/api/v1/users/{target.id}/roles", json={"role_ids": [role.id]}, headers=auth_header(admin))
    assert response.status_code == 200
    body = response.json()
    assert sorted(body["apps"]) == ["crm", "erp"] and body["role_names"] == ["ERP + CRM viewer"]


def test_admin_gets_all_apps_regardless_of_assignment(client, db):
    admin = make_user(db, "admin7@premnathrail.com", role="admin")
    response = client.get("/api/v1/users", headers=auth_header(admin))
    assert response.status_code == 200
    me = next(u for u in response.json() if u["id"] == admin.id)
    from app.modules.main.models.user import AVAILABLE_APPS
    assert sorted(me["apps"]) == sorted(AVAILABLE_APPS)


def test_admin_rejects_invalid_app_name(client, db):
    admin = make_user(db, "admin8@premnathrail.com", role="admin")
    target = make_user(db, "target5@premnathrail.com", role="user")

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"assigned_apps": ["nonexistent"]},
        headers=auth_header(admin),
    )
    assert response.status_code == 400


def test_admin_rejects_invalid_erp_permission(client, db):
    admin = make_user(db, "admin_perm2@premnathrail.com", role="admin")
    target = make_user(db, "target_perm2@premnathrail.com", role="user")

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"erp_permissions": ["not_a_real_permission"]},
        headers=auth_header(admin),
    )
    assert response.status_code == 400


def test_non_admin_cannot_set_erp_permissions(client, db):
    normal_user = make_user(db, "normal3@premnathrail.com", role="user")
    target = make_user(db, "target_perm3@premnathrail.com", role="user")

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"erp_permissions": ["project_delete"]},
        headers=auth_header(normal_user),
    )
    assert response.status_code == 403


def test_deactivated_user_cannot_access_protected_route(client, db):
    user = make_user(db, "inactive@premnathrail.com", role="user")
    user.is_active = False
    db.commit()

    response = client.get("/api/v1/auth/me", headers=auth_header(user))
    assert response.status_code == 401


def test_sync_azure_requires_admin(client, db):
    normal_user = make_user(db, "normal2@premnathrail.com", role="user")
    response = client.post("/api/v1/users/sync-azure", headers=auth_header(normal_user))
    assert response.status_code == 403


async def _fake_list_azure_org_users():
    return [
        {"id": "az-1", "mail": "newperson@premnathrail.com", "userPrincipalName": "newperson@premnathrail.com",
         "displayName": "New Person", "jobTitle": "Engineer", "department": "R&D", "mobilePhone": None},
    ]


async def _fake_get_azure_admin_ids():
    return {"az-1"}


def test_sync_azure_creates_and_promotes_users(client, db, monkeypatch):
    admin = make_user(db, "admin9@premnathrail.com", role="admin")

    monkeypatch.setattr(users_routes, "list_azure_org_users", _fake_list_azure_org_users)
    monkeypatch.setattr(users_routes, "get_azure_admin_ids", _fake_get_azure_admin_ids)

    response = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    assert response.status_code == 200
    body = response.json()
    new_person = next(u for u in body if u["email"] == "newperson@premnathrail.com")
    assert new_person["role"] == "admin"  # promoted: Azure Global Admin
    assert new_person["designation"] == "Engineer"
    assert new_person["department"] == "R&D"


def test_sync_azure_deactivates_users_no_longer_in_tenant(client, db, monkeypatch):
    admin = make_user(db, "admin10@premnathrail.com", role="admin")
    gone = make_user(db, "gone@premnathrail.com", role="user")
    gone.azure_id = "az-old-gone"
    db.commit()

    monkeypatch.setattr(users_routes, "list_azure_org_users", _fake_list_azure_org_users)
    monkeypatch.setattr(users_routes, "get_azure_admin_ids", _fake_get_azure_admin_ids)

    response = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    assert response.status_code == 200
    body = response.json()
    gone_user = next(u for u in body if u["email"] == "gone@premnathrail.com")
    assert gone_user["is_active"] is False


def test_sync_azure_returns_503_on_graph_failure(client, db, monkeypatch):
    admin = make_user(db, "admin11@premnathrail.com", role="admin")

    async def _boom():
        raise ValueError("Graph API error 403: insufficient privileges")

    monkeypatch.setattr(users_routes, "list_azure_org_users", _boom)

    response = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    assert response.status_code == 503


async def _fake_list_two_azure_users():
    return [
        {"id": "az-kept-off", "mail": "keptoff@premnathrail.com", "userPrincipalName": "keptoff@premnathrail.com",
         "displayName": "Kept Off"},
        {"id": "az-came-back", "mail": "cameback@premnathrail.com", "userPrincipalName": "cameback@premnathrail.com",
         "displayName": "Came Back"},
    ]


async def _fake_no_admin_ids():
    return set()


def test_sync_azure_keeps_admin_deactivated_users_inactive(client, db, monkeypatch):
    """C-10: a user an admin deactivated stays deactivated across Azure syncs,
    while someone deactivated only because they left the tenant comes back."""
    from app.modules.main.models.audit_log import AuditLog

    admin = make_user(db, "admin12@premnathrail.com", role="admin")
    kept_off = make_user(db, "keptoff@premnathrail.com")
    kept_off.azure_id = "az-kept-off"
    came_back = make_user(db, "cameback@premnathrail.com")
    came_back.azure_id = "az-came-back"
    came_back.is_active = False  # Azure-driven deactivation (sync writes this row)
    db.add(AuditLog(entity_type="user", entity_id=came_back.id, action="azure_deactivated",
                    module_key="organization"))
    db.commit()

    r = client.patch(f"/api/v1/users/{kept_off.id}/deactivate", headers=auth_header(admin))
    assert r.status_code == 200
    row = db.query(AuditLog).filter(AuditLog.entity_type == "user", AuditLog.entity_id == kept_off.id).one()
    assert row.action == "deactivated" and row.module_key == "organization"

    monkeypatch.setattr(users_routes, "list_azure_org_users", _fake_list_two_azure_users)
    monkeypatch.setattr(users_routes, "get_azure_admin_ids", _fake_no_admin_ids)
    r = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    assert r.status_code == 200
    by_email = {u["email"]: u for u in r.json()}
    assert by_email["keptoff@premnathrail.com"]["is_active"] is False
    assert by_email["cameback@premnathrail.com"]["is_active"] is True

    # Re-activating by hand clears the hold — the next sync keeps them active.
    r = client.patch(f"/api/v1/users/{kept_off.id}/activate", headers=auth_header(admin))
    assert r.status_code == 200
    r = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    by_email = {u["email"]: u for u in r.json()}
    assert by_email["keptoff@premnathrail.com"]["is_active"] is True


def test_sync_azure_keeps_legacy_inactive_users_inactive(client, db, monkeypatch):
    """C-10: an inactive user with no activation audit rows (e.g. deactivated
    by an admin before those rows existed) stays inactive even though they
    are still in the tenant — re-activation by the sync is opt-in."""
    admin = make_user(db, "admin12b@premnathrail.com", role="admin")
    legacy = make_user(db, "keptoff@premnathrail.com")
    legacy.azure_id = "az-kept-off"
    legacy.is_active = False
    db.commit()

    monkeypatch.setattr(users_routes, "list_azure_org_users", _fake_list_two_azure_users)
    monkeypatch.setattr(users_routes, "get_azure_admin_ids", _fake_no_admin_ids)
    r = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    assert r.status_code == 200
    by_email = {u["email"]: u for u in r.json()}
    assert by_email["keptoff@premnathrail.com"]["is_active"] is False


def test_sync_azure_audits_tenant_leavers_and_brings_them_back(client, db, monkeypatch):
    from app.modules.main.models.audit_log import AuditLog

    admin = make_user(db, "admin12c@premnathrail.com", role="admin")
    leaver = make_user(db, "cameback@premnathrail.com")
    leaver.azure_id = "az-came-back"
    db.commit()

    async def _empty():
        return []

    monkeypatch.setattr(users_routes, "list_azure_org_users", _empty)
    monkeypatch.setattr(users_routes, "get_azure_admin_ids", _fake_no_admin_ids)
    r = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    assert r.status_code == 200
    db.refresh(leaver)
    assert leaver.is_active is False
    row = db.query(AuditLog).filter(AuditLog.entity_type == "user", AuditLog.entity_id == leaver.id).one()
    assert row.action == "azure_deactivated" and row.module_key == "organization"

    monkeypatch.setattr(users_routes, "list_azure_org_users", _fake_list_two_azure_users)
    r = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    by_email = {u["email"]: u for u in r.json()}
    assert by_email["cameback@premnathrail.com"]["is_active"] is True


def test_sync_azure_response_excludes_shared_mailboxes(client, db, monkeypatch):
    admin = make_user(db, "admin13@premnathrail.com", role="admin")
    make_user(db, "info@premnathrail.com")
    monkeypatch.setattr(users_routes, "list_azure_org_users", _fake_list_azure_org_users)
    monkeypatch.setattr(users_routes, "get_azure_admin_ids", _fake_get_azure_admin_ids)
    r = client.post("/api/v1/users/sync-azure", headers=auth_header(admin))
    assert r.status_code == 200
    assert "info@premnathrail.com" not in [u["email"] for u in r.json()]


def test_update_user_writes_audit_diff(client, db):
    import json as _json
    from app.modules.main.models.audit_log import AuditLog

    admin = make_user(db, "admin14@premnathrail.com", role="admin")
    target = make_user(db, "target14@premnathrail.com")
    r = client.patch(f"/api/v1/users/{target.id}", json={"role": "admin", "is_director": True},
                     headers=auth_header(admin))
    assert r.status_code == 200
    row = db.query(AuditLog).filter(AuditLog.entity_type == "user", AuditLog.entity_id == target.id).one()
    assert row.action == "updated" and row.performed_by_id == admin.id
    assert _json.loads(row.new_value) == {"is_director": True, "role": "admin"}
    assert _json.loads(row.old_value)["role"] == "user"


def test_list_users_not_capped_at_100(client, db):
    admin = make_user(db, "admin15@premnathrail.com", role="admin")
    for i in range(120):
        db.add(User(email=f"bulk{i:03d}@premnathrail.com", name=f"Bulk {i:03d}", role="user", is_active=True))
    db.commit()
    r = client.get("/api/v1/users", headers=auth_header(admin))
    assert r.status_code == 200
    assert len([u for u in r.json() if u["email"].startswith("bulk")]) == 120
