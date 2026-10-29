from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.erp.models.project import Project
from app.tests.p2p_workflow_helpers import master_item

# Closing / sending for closure needs both actual execution dates.
CLOSE_READY = {"actual_date_attended": "2026-10-01", "actual_completion_date": "2026-10-02"}


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
        json={"project_id": project.id, "issue_title": "Engine noise", "service_type": "repair_breakdown"},
        headers=auth_header(user),
    )
    assert response.status_code == 403


def test_create_sr_requires_sr_create_permission(client, db):
    user = make_user(db, "noperm@premnathrail.com")
    project = make_project(db, "SN-SR-NOPERM")
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Engine noise", "service_type": "repair_breakdown"},
        headers=auth_header(user),
    )
    assert response.status_code == 403


def test_admin_can_create_sr_without_explicit_permission(client, db):
    admin = make_user(db, "sradmin_create@premnathrail.com", role="admin")
    project = make_project(db, "SN-SR-ADMIN")
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Engine noise", "service_type": "repair_breakdown"},
        headers=auth_header(admin),
    )
    assert response.status_code == 201


def test_create_sr_generates_request_number(client, db):
    user = make_user(db, "erp1@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-002")
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Hydraulic leak", "service_type": "repair_breakdown", "priority": "urgent"},
        headers=auth_header(user),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["request_number"].startswith("SR-")
    assert body["status"] == "open"
    assert body["priority"] == "urgent"
    assert body["service_type"] == "repair_breakdown"
    assert body["created_by_id"] == user.id


def test_create_sr_rejects_missing_project(client, db):
    user = make_user(db, "erp2@premnathrail.com", erp_permissions=["sr_create"])
    response = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": 9999, "issue_title": "Test", "service_type": "repair_breakdown"},
        headers=auth_header(user),
    )
    assert response.status_code == 404


def test_list_and_get_sr(client, db):
    user = make_user(db, "erp3@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-003")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Brake failure", "service_type": "repair_breakdown"},
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
        json={"project_id": project.id, "issue_title": "Overheating", "service_type": "repair_breakdown"},
        headers=auth_header(creator),
    ).json()

    response = client.patch(
        f"/api/v1/erp/service-requests/{created['id']}",
        json={"status": "acknowledged"},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_creator_is_engineer_and_can_update_own_sr_without_sr_edit(client, db):
    creator = make_user(db, "erp4b@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-004B")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Overheating", "service_type": "repair_breakdown"},
        headers=auth_header(creator),
    ).json()

    response = client.patch(
        f"/api/v1/erp/service-requests/{created['id']}",
        json={"status": "acknowledged"},
        headers=auth_header(creator),
    )
    # The person who raises the SR is its engineer, so they work on it.
    assert created["assigned_service_person_id"] == creator.id
    assert response.status_code == 200, response.text


def test_admin_can_update_others_sr_and_close_writes_audit(client, db):
    creator = make_user(db, "erp6@premnathrail.com", erp_permissions=["sr_create"])
    admin = make_user(db, "erpadmin@premnathrail.com", role="admin")
    project = make_project(db, "SN-SR-005")
    created = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Pump failure", "service_type": "repair_breakdown"},
        headers=auth_header(creator),
    ).json()

    response = client.patch(
        f"/api/v1/erp/service-requests/{created['id']}",
        json={**CLOSE_READY, "status": "closed", "resolution_description": "Replaced pump seal."},
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
        json={"project_id": project.id, "issue_title": "Sensor fault", "service_type": "repair_breakdown"},
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
        json={"project_id": project.id, "issue_title": "Sensor fault", "service_type": "repair_breakdown"},
        headers=auth_header(user),
    ).json()

    response = client.delete(f"/api/v1/erp/service-requests/{created['id']}", headers=auth_header(user))
    assert response.status_code == 403


def test_materials_crud(client, db):
    user = make_user(db, "erp8@premnathrail.com", erp_permissions=["sr_create", "sr_edit", "sr_delete"])
    project = make_project(db, "SN-SR-007")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Gearbox repair", "service_type": "repair_breakdown"},
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
        json={"project_id": project.id, "issue_title": "Valve replacement", "service_type": "repair_breakdown"},
        headers=auth_header(creator),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": "Valve", "quantity": 1},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_creator_engineer_can_add_material(client, db):
    creator = make_user(db, "erp9b@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-008B")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Valve replacement", "service_type": "repair_breakdown"},
        headers=auth_header(creator),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": "Valve", "quantity": 1},
        headers=auth_header(creator),
    )
    assert response.status_code == 201, response.text


def test_search_and_status_filter(client, db):
    user = make_user(db, "erp11@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-009")
    client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Unique Widget Failure", "service_type": "repair_breakdown"},
        headers=auth_header(user),
    )
    client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Other issue", "service_type": "repair_breakdown"},
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
        json={"project_id": project.id, "issue_title": "Attachment test", "service_type": "repair_breakdown"},
        headers=auth_header(user),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/attachments",
        files={"files": ("test.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        headers=auth_header(user),
    )
    assert response.status_code == 503


def test_creator_engineer_can_upload_attachment(client, db):
    user = make_user(db, "erp12b@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-010B")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Attachment test", "service_type": "repair_breakdown"},
        headers=auth_header(user),
    ).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/attachments",
        files={"files": ("test.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        headers=auth_header(user),
    )
    assert response.status_code in (200, 201), response.text


def _make_sr(client, user, project):
    return client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Cooling fan dead", "service_type": "repair_breakdown"},
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
    # Lines are picked from the Item Master (2026-10-11): name / part code /
    # unit come from the master, make defaults to the master's.
    master = master_item(db, "Compressor controller", uom="NOS", part_number="CC-01", make="Danfoss", category="Elec")

    # A line not picked from the Item Master is refused, and nothing is raised.
    refused = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/raise-pr",
        json={"category_code": "OTH", "items": [{"item_name": "Typed part", "quantity": 1, "project_inhouse": "Project"}]},
        headers=auth_header(user),
    )
    assert refused.status_code == 422, refused.text
    assert "Item Master" in refused.json()["detail"]
    assert db.query(P2PRequest).count() == 0

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/raise-pr",
        json={
            "priority": "high",
            "category_code": "OTH",
            "reason": "Fan controller faulty",
            "items": [
                {"store_item_id": master.id, "item_name": "ignored", "unit": "KG",
                 "quantity": 2, "project_inhouse": "Project", "ship_to": "Site"},
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
    assert (item.store_item_id, item.unit) == (master.id, "NOS")

    mats = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(user)).json()
    assert len(mats) == 1 and mats[0]["pr_id"] == pr.id and mats[0]["material_name"] == "Compressor controller"


def test_raise_pr_rejects_missing_project_inhouse(client, db):
    user = make_user(db, "srpr2@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    sr = _make_sr(client, user, make_project(db, "SN-SR-PR2"))
    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/raise-pr",
        json={"category_code": "OTH", "items": [{"store_item_id": master_item(db, "Bolt").id, "quantity": 1, "project_inhouse": ""}]},
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
        json={"category_code": "OTH", "items": [{"store_item_id": master_item(db, "Bolt").id, "quantity": 1, "project_inhouse": "Project"}]},
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


def test_create_service_request_requires_valid_service_type(client, db):
    user = make_user(db, "srtype@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-SR-TYPE")
    missing = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "No type"},
        headers=auth_header(user),
    )
    assert missing.status_code == 422
    bad = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Bad type", "service_type": "free"},
        headers=auth_header(user),
    )
    assert bad.status_code == 422


# -- Hardening: Recycle-Bin SRs, material-photo scoping, lock, status rules --

def _add_material_with_photo(db, sr_id, name="Seal kit"):
    from app.modules.erp.models.service_material import ServiceMaterial
    from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment
    mat = ServiceMaterial(service_request_id=sr_id, material_name=name, quantity=1, unit="pcs")
    db.add(mat)
    db.flush()
    photo = ServiceMaterialAttachment(service_material_id=mat.id, filename="seal.jpg", content_type="image/jpeg")
    db.add(photo)
    db.commit()
    return mat.id, photo.id


def test_material_photo_delete_is_scoped_to_its_own_sr(client, db, monkeypatch):
    from app.core.config import settings
    from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")

    owner = make_user(db, "photo_owner@premnathrail.com", erp_permissions=["sr_create", "sr_edit", "sr_delete"])
    attacker = make_user(db, "photo_attacker@premnathrail.com", erp_permissions=["sr_create", "sr_edit", "sr_delete"])
    project = make_project(db, "SN-SR-PHOTO")
    victim_sr = _make_sr(client, owner, project)
    own_sr = _make_sr(client, attacker, project)
    mat_id, photo_id = _add_material_with_photo(db, victim_sr["id"])

    # Made-up sr_id used to skip the permission check.
    r = client.delete(f"/api/v1/erp/service-requests/999999/materials/{mat_id}/attachments/{photo_id}", headers=auth_header(attacker))
    assert r.status_code == 404
    # Attacker's own SR id with the victim's material.
    r = client.delete(f"/api/v1/erp/service-requests/{own_sr['id']}/materials/{mat_id}/attachments/{photo_id}", headers=auth_header(attacker))
    assert r.status_code == 404
    # Content route is scoped the same way.
    r = client.get(f"/api/v1/erp/service-requests/{own_sr['id']}/materials/{mat_id}/attachments/{photo_id}/content", headers=auth_header(attacker))
    assert r.status_code == 404
    # Right SR, wrong user.
    r = client.delete(f"/api/v1/erp/service-requests/{victim_sr['id']}/materials/{mat_id}/attachments/{photo_id}", headers=auth_header(attacker))
    assert r.status_code == 403
    assert db.get(ServiceMaterialAttachment, photo_id) is not None

    r = client.delete(f"/api/v1/erp/service-requests/{victim_sr['id']}/materials/{mat_id}/attachments/{photo_id}", headers=auth_header(owner))
    assert r.status_code == 200
    db.expire_all()
    assert db.get(ServiceMaterialAttachment, photo_id) is None
    audit = client.get(f"/api/v1/erp/service-requests/{victim_sr['id']}/audit", headers=auth_header(owner)).json()
    assert any(a["action"] == "material_photo_deleted" for a in audit)


def test_sr_in_recycle_bin_cannot_be_changed(client, db):
    user = make_user(db, "recycled_sr@premnathrail.com", erp_permissions=["sr_create", "sr_edit", "sr_delete"])
    project = make_project(db, "SN-SR-RECYCLED")
    sr = _make_sr(client, user, project)
    mat_id, _ = _add_material_with_photo(db, sr["id"])
    assert client.delete(f"/api/v1/erp/service-requests/{sr['id']}", headers=auth_header(user)).status_code == 200

    base = f"/api/v1/erp/service-requests/{sr['id']}"
    r = client.post(f"{base}/materials", json={"material_name": "Bolt", "quantity": 1}, headers=auth_header(user))
    assert r.status_code == 404
    assert "Recycle Bin" in r.json()["detail"]
    assert client.get(f"{base}/materials", headers=auth_header(user)).status_code == 404
    assert client.patch(f"{base}/materials/{mat_id}", json={"quantity": 2}, headers=auth_header(user)).status_code == 404
    assert client.delete(f"{base}/materials/{mat_id}", headers=auth_header(user)).status_code == 404
    assert client.post(f"{base}/materials/{mat_id}/receive", json={"received_quantity": 1}, headers=auth_header(user)).status_code == 404


def test_locked_sr_rejects_material_changes(client, db):
    from app.modules.erp.models.service_request import ServiceRequest
    user = make_user(db, "locked_sr@premnathrail.com", erp_permissions=["sr_create", "sr_edit", "sr_delete"])
    project = make_project(db, "SN-SR-LOCKED")
    sr = _make_sr(client, user, project)
    row = db.get(ServiceRequest, sr["id"])
    row.is_locked = True
    db.commit()

    r = client.post(f"/api/v1/erp/service-requests/{sr['id']}/materials", json={"material_name": "Bolt", "quantity": 1}, headers=auth_header(user))
    assert r.status_code == 423
    assert "locked" in r.json()["detail"]


def test_sr_status_must_be_a_known_value(client, db):
    user = make_user(db, "status_val@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    project = make_project(db, "SN-SR-STATUS")
    sr = _make_sr(client, user, project)

    r = client.patch(f"/api/v1/erp/service-requests/{sr['id']}", json={"status": "banana"}, headers=auth_header(user))
    assert r.status_code == 422
    assert "work_completed" in r.text

    r = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "x", "service_type": "repair_breakdown", "status": "closed"},
        headers=auth_header(user),
    )
    assert r.status_code == 422


def test_sr_closes_without_corrective_action(client, db):
    user = make_user(db, "close_rule@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    project = make_project(db, "SN-SR-CLOSE")
    sr = _make_sr(client, user, project)
    url = f"/api/v1/erp/service-requests/{sr['id']}"
    # Root cause / corrective action are optional; only the execution dates are needed.
    r = client.patch(url, json={**CLOSE_READY, "status": "closed"}, headers=auth_header(user))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "closed"


def test_sr_edit_accepts_null_expected_dates(client, db):
    user = make_user(db, "null_dates@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    project = make_project(db, "SN-SR-DATES")
    sr = _make_sr(client, user, project)
    r = client.patch(
        f"/api/v1/erp/service-requests/{sr['id']}",
        json={"expected_date_to_attend": None, "expected_completion_date": None, "issue_title": "Renamed"},
        headers=auth_header(user),
    )
    assert r.status_code == 200


def test_resend_client_email_requires_edit_rights(client, db):
    owner = make_user(db, "resend_owner@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    other = make_user(db, "resend_other@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    project = make_project(db, "SN-SR-RESEND")
    sr = _make_sr(client, owner, project)
    r = client.post(f"/api/v1/erp/service-requests/{sr['id']}/resend-client-email", headers=auth_header(other))
    assert r.status_code == 403


def test_test_email_is_admin_only(client, db):
    user = make_user(db, "testmail_user@premnathrail.com", erp_permissions=["sr_create"])
    r = client.post("/api/v1/erp/service-requests/test-email", headers=auth_header(user))
    assert r.status_code == 403


def _stock(db, item, qty):
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.models.stock_balance import StoreStockBalance
    loc = db.query(StoreLocation).filter(StoreLocation.code == "MR-MS").first()
    if loc is None:
        loc = StoreLocation(name="Main Store", code="MR-MS")
        db.add(loc)
        db.flush()
    db.add(StoreStockBalance(item_id=item.id, location_id=loc.id, on_hand_qty=qty, reserved_qty=0))
    db.commit()


def test_material_request_splits_store_stock_and_purchase(client, db):
    """Material Request: the user only gives item + qty. In-store qty becomes a
    spare for Store to issue; the shortfall an approved Service PR (Project line)."""
    from app.modules.p2p.models.p2p_request import P2PRequest

    user = make_user(db, "srmr1@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    sr = _make_sr(client, user, make_project(db, "SN-SR-MR1"))
    in_stock = master_item(db, "Filter element", uom="NOS")
    partial = master_item(db, "Hydraulic hose", uom="NOS")
    none = master_item(db, "Pump seal kit", uom="NOS")
    _stock(db, in_stock, 10)
    _stock(db, partial, 3)

    stock = client.get(f"/api/v1/erp/service-requests/{sr['id']}/material-request/stock",
                       params={"item_ids": f"{in_stock.id},{partial.id},{none.id}"}, headers=auth_header(user)).json()
    assert stock == {str(in_stock.id): 10, str(partial.id): 3, str(none.id): 0}

    r = client.post(f"/api/v1/erp/service-requests/{sr['id']}/material-request", json={
        "priority": "high", "remarks": "Breakdown at site",
        "items": [{"store_item_id": in_stock.id, "quantity": 4}, {"store_item_id": partial.id, "quantity": 5},
                  {"store_item_id": none.id, "quantity": 2}],
    }, headers=auth_header(user))
    assert r.status_code == 201, r.text
    body = r.json()
    assert sorted((x["item_name"], x["quantity"]) for x in body["from_store"]) == [("Filter element", 4), ("Hydraulic hose", 3)]
    assert sorted((x["item_name"], x["quantity"]) for x in body["to_buy"]) == [("Hydraulic hose", 2), ("Pump seal kit", 2)]

    pr = db.query(P2PRequest).one()
    assert body["pr_number"] == pr.p2p_number
    assert (pr.status, pr.requirement_type, pr.priority) == ("approved", "Service", "high")
    assert sorted((i.item_name, i.quantity, i.project_inhouse) for i in pr.items) == [
        ("Hydraulic hose", 2, "Project"), ("Pump seal kit", 2, "Project")]

    mats = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(user)).json()
    store_mats = sorted((m["material_name"], m["quantity"]) for m in mats if not m["pr_id"])
    assert store_mats == [("Filter element", 4), ("Hydraulic hose", 3)]
    assert len([m for m in mats if m["pr_id"] == pr.id]) == 2


def test_material_request_all_in_store_raises_no_pr(client, db):
    from app.modules.p2p.models.p2p_request import P2PRequest

    user = make_user(db, "srmr2@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    sr = _make_sr(client, user, make_project(db, "SN-SR-MR2"))
    item = master_item(db, "V-belt", uom="NOS")
    _stock(db, item, 5)
    # The same item on two lines is one requirement: 3 + 2 = 5, all in store.
    r = client.post(f"/api/v1/erp/service-requests/{sr['id']}/material-request", json={
        "items": [{"store_item_id": item.id, "quantity": 3}, {"store_item_id": item.id, "quantity": 2}],
    }, headers=auth_header(user))
    assert r.status_code == 201, r.text
    assert r.json()["pr_number"] is None and r.json()["from_store"] == [{"item_name": "V-belt", "quantity": 5, "unit": "NOS"}]
    assert db.query(P2PRequest).count() == 0


def test_material_request_rejects_bad_qty(client, db):
    user = make_user(db, "srmr3@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    sr = _make_sr(client, user, make_project(db, "SN-SR-MR3"))
    r = client.post(f"/api/v1/erp/service-requests/{sr['id']}/material-request", json={
        "items": [{"store_item_id": master_item(db, "Nut").id, "quantity": 0}],
    }, headers=auth_header(user))
    assert r.status_code == 400 and "quantity must be more than 0" in r.json()["detail"]


def test_material_request_returns_pr_id_for_attachments(client, db):
    user = make_user(db, "srmr4@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    sr = _make_sr(client, user, make_project(db, "SN-SR-MR4"))
    r = client.post(f"/api/v1/erp/service-requests/{sr['id']}/material-request", json={
        "items": [{"store_item_id": master_item(db, "Gasket").id, "quantity": 1}],
    }, headers=auth_header(user))
    assert r.status_code == 201, r.text
    assert r.json()["pr_id"] and r.json()["pr_number"]



def test_close_needs_execution_dates(client, db):
    admin = make_user(db, "erpclose@premnathrail.com", role="admin")
    sr = _make_sr(client, admin, make_project(db, "SN-SR-CLOSE2"))
    url = f"/api/v1/erp/service-requests/{sr['id']}"
    r = client.patch(url, json={"status": "closed", "actual_date_attended": "2026-10-01"}, headers=auth_header(admin))
    assert r.status_code == 400 and "Actual Completed" in r.json()["detail"]
    r = client.patch(url, json={**CLOSE_READY, "status": "closed"}, headers=auth_header(admin))
    assert r.status_code == 200, r.text
