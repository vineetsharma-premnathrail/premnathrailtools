from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.erp.models.project import Project


def make_user(db, email, role="user", assigned_apps=("erp",), erp_permissions=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=list(assigned_apps), erp_permissions=erp_permissions or [],
    )
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


def test_create_sr_requires_sr_create_permission(client, db):
    user = make_user(db, "noperm@premnathrail.com")
    project = make_project(db, "SN-SR-NOPERM")
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Engine noise"},
        headers=auth_header(user),
    )
    assert response.status_code == 403


def test_admin_can_create_sr_without_explicit_permission(client, db):
    admin = make_user(db, "sradmin_create@premnathrail.com", role="admin")
    project = make_project(db, "SN-SR-ADMIN")
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Engine noise"},
        headers=auth_header(admin),
    )
    assert response.status_code == 201


def test_create_sr_generates_request_number(client, db):
    user = make_user(db, "erp1@premnathrail.com", erp_permissions=["sr_create"])
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
    user = make_user(db, "erp2@premnathrail.com", erp_permissions=["sr_create"])
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": 9999, "issue_title": "Test"},
        headers=auth_header(user),
    )
    assert response.status_code == 404


def test_list_and_get_sr(client, db):
    user = make_user(db, "erp3@premnathrail.com", erp_permissions=["sr_create"])
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
    creator = make_user(db, "erp4@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    other = make_user(db, "erp5@premnathrail.com", erp_permissions=["sr_edit"])
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


def test_creator_without_sr_edit_permission_cannot_update_own_sr(client, db):
    creator = make_user(db, "erp4b@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-004B")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Overheating"},
        headers=auth_header(creator),
    ).json()

    response = client.patch(
        f"/api/v1/erp/service-requests/{created['id']}",
        json={"status": "acknowledged"},
        headers=auth_header(creator),
    )
    assert response.status_code == 403


def test_admin_can_update_others_sr_and_close_writes_audit(client, db):
    creator = make_user(db, "erp6@premnathrail.com", erp_permissions=["sr_create"])
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
    user = make_user(db, "erp7@premnathrail.com", erp_permissions=["sr_create", "sr_delete"])
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


def test_delete_sr_requires_sr_delete_permission(client, db):
    user = make_user(db, "erp7b@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-006B")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Sensor fault"},
        headers=auth_header(user),
    ).json()

    response = client.delete(f"/api/v1/erp/service-requests/{created['id']}", headers=auth_header(user))
    assert response.status_code == 403


def test_materials_crud(client, db):
    user = make_user(db, "erp8@premnathrail.com", erp_permissions=["sr_create", "sr_edit", "sr_delete"])
    project = make_project(db, "SN-SR-007")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Gearbox repair"},
        headers=auth_header(user),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": "Bearing", "quantity": 3},
        headers=auth_header(user),
    )
    assert response.status_code == 201
    mat = response.json()
    assert mat["quantity"] == 3

    response = client.patch(
        f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}",
        json={"quantity": 5},
        headers=auth_header(user),
    )
    assert response.status_code == 200
    assert response.json()["quantity"] == 5

    response = client.delete(f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}", headers=auth_header(user))
    assert response.status_code == 200

    materials = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(user)).json()
    assert all(m["id"] != mat["id"] for m in materials)


def test_materials_require_creator_or_admin(client, db):
    creator = make_user(db, "erp9@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    other = make_user(db, "erp10@premnathrail.com", erp_permissions=["sr_edit"])
    project = make_project(db, "SN-SR-008")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Valve replacement"},
        headers=auth_header(creator),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": "Valve", "quantity": 1},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_add_material_requires_sr_edit_permission(client, db):
    creator = make_user(db, "erp9b@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-008B")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Valve replacement"},
        headers=auth_header(creator),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": "Valve", "quantity": 1},
        headers=auth_header(creator),
    )
    assert response.status_code == 403


def test_search_and_status_filter(client, db):
    user = make_user(db, "erp11@premnathrail.com", erp_permissions=["sr_create"])
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

    user = make_user(db, "erp12@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
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


def test_upload_attachment_requires_sr_edit_permission(client, db):
    user = make_user(db, "erp12b@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-010B")
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
    assert response.status_code == 403


def _make_sr(client, user, project):
    return client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Cooling fan dead"},
        headers=auth_header(user),
    ).json()


def test_pr_form_meta_available_to_erp_user_without_p2p(client, db):
    user = make_user(db, "srmeta@premnathrail.com", erp_permissions=["sr_create"])
    response = client.get("/api/v1/erp/service-requests/pr-form-meta", headers=auth_header(user))
    assert response.status_code == 200
    body = response.json()
    assert body["categories"] and body["uoms"] and "requirement_types" in body


def test_raise_pr_from_form_items_skips_approval(client, db):
    from app.modules.p2p.models.p2p_request import P2PRequest

    user = make_user(db, "srpr1@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    project = make_project(db, "SN-SR-PR1")
    sr = _make_sr(client, user, project)

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/raise-pr",
        json={
            "priority": "high",
            "category_code": "OTH",
            "reason": "Fan controller faulty",
            "items": [
                {"item_name": "Compressor controller", "make": "Danfoss", "part_code": "CC-01",
                 "unit": "NOS", "quantity": 2, "project_inhouse": "Project", "category": "Elec", "ship_to": "Site"},
                {"item_name": "", "quantity": 1, "project_inhouse": "Project"},
            ],
        },
        headers=auth_header(user),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "approved"

    pr = db.query(P2PRequest).filter(P2PRequest.id == body["id"]).first()
    assert pr.approvals == []
    assert len(pr.items) == 1
    item = pr.items[0]
    assert (item.item_name, item.make, item.part_code, item.quantity, item.ship_to) == ("Compressor controller", "Danfoss", "CC-01", 2, "Site")

    mats = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(user)).json()
    assert len(mats) == 1 and mats[0]["pr_id"] == pr.id and mats[0]["material_name"] == "Compressor controller"


def test_raise_pr_rejects_missing_project_inhouse(client, db):
    user = make_user(db, "srpr2@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    sr = _make_sr(client, user, make_project(db, "SN-SR-PR2"))
    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/raise-pr",
        json={"category_code": "OTH", "items": [{"item_name": "Bolt", "quantity": 1, "project_inhouse": ""}]},
        headers=auth_header(user),
    )
    assert response.status_code == 400
    assert "Project or Inhouse" in response.json()["detail"]


def test_raise_pr_requires_creator(client, db):
    creator = make_user(db, "srpr3@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    other = make_user(db, "srpr4@premnathrail.com", erp_permissions=["sr_edit"])
    sr = _make_sr(client, creator, make_project(db, "SN-SR-PR3"))
    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/raise-pr",
        json={"category_code": "OTH", "items": [{"item_name": "Bolt", "quantity": 1, "project_inhouse": "Project"}]},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_pr_attachments_reject_pr_not_from_this_sr(client, db):
    user = make_user(db, "srpr5@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    sr = _make_sr(client, user, make_project(db, "SN-SR-PR5"))
    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/raise-pr/999/attachments",
        data={"doc_type": "supporting"},
        files={"files": ("a.txt", b"hi", "text/plain")},
        headers=auth_header(user),
    )
    assert response.status_code == 404
