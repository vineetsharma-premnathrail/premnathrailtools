from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.erp.models.project import Project


def make_user(db, email, role="user", assigned_apps=("erp",)):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(assigned_apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_project(db, serial="SN-SR-001"):
    project = Project(serial_number=serial, model_name="Test Machine")
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_create_sr_requires_erp_access(client, db):
    user = make_user(db, "noerp@premnathrail.com", assigned_apps=())
    project = make_project(db)
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Engine noise"},
        headers=auth_header(user),
    )
    assert response.status_code == 403


def test_create_sr_generates_request_number(client, db):
    user = make_user(db, "erp1@premnathrail.com")
    project = make_project(db, "SN-SR-002")
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Hydraulic leak", "priority": "high"},
        headers=auth_header(user),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["request_number"].startswith("SR-")
    assert body["status"] == "open"
    assert body["priority"] == "high"
    assert body["created_by_id"] == user.id


def test_create_sr_rejects_missing_project(client, db):
    user = make_user(db, "erp2@premnathrail.com")
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": 9999, "issue_title": "Test"},
        headers=auth_header(user),
    )
    assert response.status_code == 404


def test_list_and_get_sr(client, db):
    user = make_user(db, "erp3@premnathrail.com")
    project = make_project(db, "SN-SR-003")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Brake failure"},
        headers=auth_header(user),
    ).json()

    response = client.get("/api/v1/erp/service-requests", headers=auth_header(user))
    assert response.status_code == 200
    assert any(sr["id"] == created["id"] for sr in response.json())

    response = client.get(f"/api/v1/erp/service-requests/{created['id']}", headers=auth_header(user))
    assert response.status_code == 200
    assert response.json()["issue_title"] == "Brake failure"


def test_non_creator_cannot_update_sr(client, db):
    creator = make_user(db, "erp4@premnathrail.com")
    other = make_user(db, "erp5@premnathrail.com")
    project = make_project(db, "SN-SR-004")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Overheating"},
        headers=auth_header(creator),
    ).json()

    response = client.patch(
        f"/api/v1/erp/service-requests/{created['id']}",
        json={"status": "acknowledged"},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_admin_can_update_others_sr_and_close_writes_audit(client, db):
    creator = make_user(db, "erp6@premnathrail.com")
    admin = make_user(db, "erpadmin@premnathrail.com", role="admin")
    project = make_project(db, "SN-SR-005")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Pump failure"},
        headers=auth_header(creator),
    ).json()

    response = client.patch(
        f"/api/v1/erp/service-requests/{created['id']}",
        json={"status": "closed"},
        headers=auth_header(admin),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert response.json()["closed_at"] is not None

    audit = client.get(f"/api/v1/erp/service-requests/{created['id']}/audit", headers=auth_header(admin)).json()
    actions = [a["action"] for a in audit]
    assert "created" in actions
    assert "field_updated" in actions


def test_soft_delete_and_restore_sr(client, db):
    user = make_user(db, "erp7@premnathrail.com")
    project = make_project(db, "SN-SR-006")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Sensor fault"},
        headers=auth_header(user),
    ).json()

    response = client.delete(f"/api/v1/erp/service-requests/{created['id']}", headers=auth_header(user))
    assert response.status_code == 200

    response = client.get(f"/api/v1/erp/service-requests/{created['id']}", headers=auth_header(user))
    assert response.status_code == 404

    recycle = client.get("/api/v1/erp/service-requests/recycle-bin", headers=auth_header(user)).json()
    assert any(item["id"] == created["id"] for item in recycle)

    response = client.post(f"/api/v1/erp/service-requests/{created['id']}/restore", headers=auth_header(user))
    assert response.status_code == 200

    response = client.get(f"/api/v1/erp/service-requests/{created['id']}", headers=auth_header(user))
    assert response.status_code == 200


def test_materials_crud_and_total_price_computation(client, db):
    user = make_user(db, "erp8@premnathrail.com")
    project = make_project(db, "SN-SR-007")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Gearbox repair"},
        headers=auth_header(user),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": "Bearing", "quantity": 3, "unit_price": 150},
        headers=auth_header(user),
    )
    assert response.status_code == 201
    mat = response.json()
    assert mat["total_price"] == 450

    response = client.patch(
        f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}",
        json={"quantity": 5},
        headers=auth_header(user),
    )
    assert response.status_code == 200
    assert response.json()["total_price"] == 750

    response = client.delete(f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}", headers=auth_header(user))
    assert response.status_code == 200

    materials = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(user)).json()
    assert all(m["id"] != mat["id"] for m in materials)


def test_materials_require_creator_or_admin(client, db):
    creator = make_user(db, "erp9@premnathrail.com")
    other = make_user(db, "erp10@premnathrail.com")
    project = make_project(db, "SN-SR-008")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Valve replacement"},
        headers=auth_header(creator),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": "Valve", "quantity": 1, "unit_price": 500},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_search_and_status_filter(client, db):
    user = make_user(db, "erp11@premnathrail.com")
    project = make_project(db, "SN-SR-009")
    client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Unique Widget Failure"},
        headers=auth_header(user),
    )
    client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Other issue"},
        headers=auth_header(user),
    )

    response = client.get("/api/v1/erp/service-requests?search=Widget", headers=auth_header(user))
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert "Widget" in results[0]["issue_title"]

    response = client.get("/api/v1/erp/service-requests?status=open", headers=auth_header(user))
    assert response.status_code == 200
    assert all(sr["status"] == "open" for sr in response.json())


def test_attachments_require_sharepoint_config(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")

    user = make_user(db, "erp12@premnathrail.com")
    project = make_project(db, "SN-SR-010")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Attachment test"},
        headers=auth_header(user),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/attachments",
        files={"files": ("test.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        headers=auth_header(user),
    )
    assert response.status_code == 503
