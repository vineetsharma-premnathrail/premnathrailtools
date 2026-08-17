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


def test_admin_can_assign_apps(client, db):
    admin = make_user(db, "admin6@premnathrail.com", role="admin")
    target = make_user(db, "target4@premnathrail.com", role="user")

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"assigned_apps": ["erp", "crm"]},
        headers=auth_header(admin),
    )
    assert response.status_code == 200
    body = response.json()
    assert sorted(body["assigned_apps"]) == ["crm", "erp"]
    assert sorted(body["apps"]) == ["crm", "erp"]


def test_admin_gets_all_apps_regardless_of_assignment(client, db):
    admin = make_user(db, "admin7@premnathrail.com", role="admin")
    response = client.get("/api/v1/users", headers=auth_header(admin))
    assert response.status_code == 200
    me = next(u for u in response.json() if u["id"] == admin.id)
    assert sorted(me["apps"]) == ["crm", "erp", "p2p", "purchase", "rnd"]


def test_admin_rejects_invalid_app_name(client, db):
    admin = make_user(db, "admin8@premnathrail.com", role="admin")
    target = make_user(db, "target5@premnathrail.com", role="user")

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"assigned_apps": ["nonexistent"]},
        headers=auth_header(admin),
    )
    assert response.status_code == 400


def test_admin_can_set_erp_permissions(client, db):
    admin = make_user(db, "admin_perm1@premnathrail.com", role="admin")
    target = make_user(db, "target_perm1@premnathrail.com", role="user")

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"assigned_apps": ["erp"], "erp_permissions": ["project_view", "project_delete"]},
        headers=auth_header(admin),
    )
    assert response.status_code == 200
    assert sorted(response.json()["erp_permissions"]) == ["project_delete", "project_view"]


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
