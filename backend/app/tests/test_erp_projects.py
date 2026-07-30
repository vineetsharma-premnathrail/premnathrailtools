from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User


def make_user(db, email, role="user", assigned_apps=None, erp_permissions=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=assigned_apps or [], erp_permissions=erp_permissions or [],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_list_projects_requires_erp_access(client, db):
    user = make_user(db, "noerp@premnathrail.com", assigned_apps=[])
    response = client.get("/api/v1/erp/projects", headers=auth_header(user))
    assert response.status_code == 403


def test_admin_bypasses_app_assignment(client, db):
    admin = make_user(db, "admin@premnathrail.com", role="admin")
    response = client.get("/api/v1/erp/projects", headers=auth_header(admin))
    assert response.status_code == 200


def test_create_project_requires_project_create_permission(client, db):
    user = make_user(db, "erpuser_nocreate@premnathrail.com", assigned_apps=["erp"])
    response = client.post(
        "/api/v1/erp/projects",
        json={"serial_number": "SN-000"},
        headers=auth_header(user),
    )
    assert response.status_code == 403


def test_admin_can_create_project_without_explicit_permission(client, db):
    admin = make_user(db, "erpadmin_create@premnathrail.com", role="admin")
    response = client.post(
        "/api/v1/erp/projects",
        json={"serial_number": "SN-000-ADMIN"},
        headers=auth_header(admin),
    )
    assert response.status_code == 201


def test_create_and_get_project(client, db):
    user = make_user(db, "erpuser@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    response = client.post(
        "/api/v1/erp/projects",
        json={"serial_number": "SN-001", "model_name": "Model X", "client_company": "Acme"},
        headers=auth_header(user),
    )
    assert response.status_code == 201
    project_id = response.json()["id"]

    response = client.get(f"/api/v1/erp/projects/{project_id}", headers=auth_header(user))
    assert response.status_code == 200
    assert response.json()["serial_number"] == "SN-001"


def test_create_project_rejects_duplicate_serial_number(client, db):
    user = make_user(db, "erpuser2@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    client.post("/api/v1/erp/projects", json={"serial_number": "SN-DUP"}, headers=auth_header(user))
    response = client.post("/api/v1/erp/projects", json={"serial_number": "SN-DUP"}, headers=auth_header(user))
    assert response.status_code == 409


def test_update_project_requires_project_edit_permission(client, db):
    creator = make_user(db, "erpuser3_creator@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    other = make_user(db, "erpuser3_noedit@premnathrail.com", assigned_apps=["erp"])
    created = client.post("/api/v1/erp/projects", json={"serial_number": "SN-002B"}, headers=auth_header(creator)).json()

    response = client.patch(
        f"/api/v1/erp/projects/{created['id']}",
        json={"status": "inactive"},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_update_project(client, db):
    user = make_user(db, "erpuser3@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_edit"])
    created = client.post("/api/v1/erp/projects", json={"serial_number": "SN-002"}, headers=auth_header(user)).json()

    response = client.patch(
        f"/api/v1/erp/projects/{created['id']}",
        json={"status": "inactive", "client_company": "New Co"},
        headers=auth_header(user),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "inactive"
    assert response.json()["client_company"] == "New Co"


def test_delete_project_requires_project_delete_permission(client, db):
    user = make_user(db, "erpuser_noperm@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    created = client.post("/api/v1/erp/projects", json={"serial_number": "SN-004"}, headers=auth_header(user)).json()

    response = client.delete(f"/api/v1/erp/projects/{created['id']}", headers=auth_header(user))
    assert response.status_code == 403

    # Confirmed still there — the permission check must reject before touching the row.
    response = client.get(f"/api/v1/erp/projects/{created['id']}", headers=auth_header(user))
    assert response.status_code == 200


def test_admin_can_delete_project_without_explicit_permission(client, db):
    admin = make_user(db, "erpadmin_delete@premnathrail.com", role="admin")
    created = client.post("/api/v1/erp/projects", json={"serial_number": "SN-005"}, headers=auth_header(admin)).json()

    response = client.delete(f"/api/v1/erp/projects/{created['id']}", headers=auth_header(admin))
    assert response.status_code == 204


def test_soft_delete_project_hides_it_from_list_and_get(client, db):
    user = make_user(db, "erpuser4@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_delete"])
    created = client.post("/api/v1/erp/projects", json={"serial_number": "SN-003"}, headers=auth_header(user)).json()

    response = client.delete(f"/api/v1/erp/projects/{created['id']}", headers=auth_header(user))
    assert response.status_code == 204

    response = client.get(f"/api/v1/erp/projects/{created['id']}", headers=auth_header(user))
    assert response.status_code == 404

    response = client.get("/api/v1/erp/projects", headers=auth_header(user))
    assert all(p["id"] != created["id"] for p in response.json())


def test_search_filters_projects(client, db):
    user = make_user(db, "erpuser5@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    client.post("/api/v1/erp/projects", json={"serial_number": "SN-100", "client_company": "Zenith Corp"}, headers=auth_header(user))
    client.post("/api/v1/erp/projects", json={"serial_number": "SN-101", "client_company": "Other Co"}, headers=auth_header(user))

    response = client.get("/api/v1/erp/projects?search=Zenith", headers=auth_header(user))
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["serial_number"] == "SN-100"


def test_status_and_application_type_filters(client, db):
    user = make_user(db, "erpuser6@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    client.post("/api/v1/erp/projects", json={"serial_number": "SN-200", "status": "active", "application_type": "OHE"}, headers=auth_header(user))
    client.post("/api/v1/erp/projects", json={"serial_number": "SN-201", "status": "inactive", "application_type": "FBW"}, headers=auth_header(user))

    response = client.get("/api/v1/erp/projects?status=active", headers=auth_header(user))
    assert response.status_code == 200
    assert all(p["status"] == "active" for p in response.json())

    response = client.get("/api/v1/erp/projects?application_type=FBW", headers=auth_header(user))
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["serial_number"] == "SN-201"


def test_filter_options_returns_distinct_values(client, db):
    user = make_user(db, "erpuser7@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    client.post("/api/v1/erp/projects", json={"serial_number": "SN-300", "status": "active", "application_type": "OHE", "client_company": "Acme"}, headers=auth_header(user))
    client.post("/api/v1/erp/projects", json={"serial_number": "SN-301", "status": "active", "application_type": "OHE", "client_company": "Acme"}, headers=auth_header(user))

    response = client.get("/api/v1/erp/projects/filter-options", headers=auth_header(user))
    assert response.status_code == 200
    body = response.json()
    assert body["statuses"].count("active") == 1  # distinct, not duplicated
    assert "OHE" in body["application_types"]
    assert "Acme" in body["client_companies"]


def test_project_audit_trail_records_lifecycle(client, db):
    user = make_user(db, "erpuser8@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_edit"])
    created = client.post("/api/v1/erp/projects", json={"serial_number": "SN-400"}, headers=auth_header(user)).json()

    client.patch(f"/api/v1/erp/projects/{created['id']}", json={"status": "inactive"}, headers=auth_header(user))

    audit = client.get(f"/api/v1/erp/projects/{created['id']}/audit", headers=auth_header(user)).json()
    actions = [a["action"] for a in audit]
    assert "created" in actions
    assert "updated" in actions


def test_project_soft_delete_restore_and_recycle_bin(client, db):
    user = make_user(db, "erpuser9@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_delete"])
    created = client.post("/api/v1/erp/projects", json={"serial_number": "SN-500"}, headers=auth_header(user)).json()

    response = client.delete(f"/api/v1/erp/projects/{created['id']}", headers=auth_header(user))
    assert response.status_code == 204

    response = client.get(f"/api/v1/erp/projects/{created['id']}", headers=auth_header(user))
    assert response.status_code == 404

    recycle = client.get("/api/v1/erp/projects/recycle-bin/list", headers=auth_header(user)).json()
    assert any(item["id"] == created["id"] for item in recycle)

    response = client.post(f"/api/v1/erp/projects/{created['id']}/restore", headers=auth_header(user))
    assert response.status_code == 200

    response = client.get(f"/api/v1/erp/projects/{created['id']}", headers=auth_header(user))
    assert response.status_code == 200


def test_project_delete_cascades_to_its_service_requests(client, db):
    user = make_user(
        db, "erpuser10@premnathrail.com", assigned_apps=["erp"],
        erp_permissions=["project_create", "project_delete", "sr_create"],
    )
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-600"}, headers=auth_header(user)).json()
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project["id"], "issue_title": "Cascade test issue"},
        headers=auth_header(user),
    ).json()

    response = client.delete(f"/api/v1/erp/projects/{project['id']}", headers=auth_header(user))
    assert response.status_code == 204

    # The SR should now be soft-deleted too, not left dangling as "active" on a deleted project.
    response = client.get(f"/api/v1/erp/service-requests/{sr['id']}", headers=auth_header(user))
    assert response.status_code == 404

    sr_recycle_bin = client.get("/api/v1/erp/service-requests/recycle-bin", headers=auth_header(user)).json()
    assert any(item["id"] == sr["id"] for item in sr_recycle_bin)

    # Restoring the project should bring its SR back too.
    response = client.post(f"/api/v1/erp/projects/{project['id']}/restore", headers=auth_header(user))
    assert response.status_code == 200

    response = client.get(f"/api/v1/erp/service-requests/{sr['id']}", headers=auth_header(user))
    assert response.status_code == 200


def test_project_attachments_require_sharepoint_config(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")

    user = make_user(db, "erpuser11@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_edit"])
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-700"}, headers=auth_header(user)).json()

    response = client.post(
        f"/api/v1/erp/projects/{project['id']}/attachments",
        files={"files": ("test.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        headers=auth_header(user),
    )
    assert response.status_code == 503


def test_upload_project_attachment_requires_project_edit_permission(client, db):
    user = make_user(db, "erpuser11b@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-700B"}, headers=auth_header(user)).json()

    response = client.post(
        f"/api/v1/erp/projects/{project['id']}/attachments",
        files={"files": ("test.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        headers=auth_header(user),
    )
    assert response.status_code == 403


def test_list_project_attachments_empty(client, db):
    user = make_user(db, "erpuser12@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-701"}, headers=auth_header(user)).json()

    response = client.get(f"/api/v1/erp/projects/{project['id']}/attachments", headers=auth_header(user))
    assert response.status_code == 200
    assert response.json() == []


def test_delete_nonexistent_project_attachment_returns_404(client, db):
    user = make_user(db, "erpuser13@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_delete"])
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-702"}, headers=auth_header(user)).json()

    response = client.delete(f"/api/v1/erp/projects/{project['id']}/attachments/9999", headers=auth_header(user))
    assert response.status_code == 404


def test_delete_project_attachment_requires_project_delete_permission(client, db):
    user = make_user(db, "erpuser13b@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create"])
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-702B"}, headers=auth_header(user)).json()

    response = client.delete(f"/api/v1/erp/projects/{project['id']}/attachments/9999", headers=auth_header(user))
    assert response.status_code == 403
