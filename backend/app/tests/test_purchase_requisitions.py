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


def make_project(db, serial="SN-PR-001"):
    project = Project(serial_number=serial, model_name="Test Machine", client_company="Test Client", site_name="Test Site")
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def _make_sr_with_material(client, db, creator, serial, material_name="Bearing", quantity=3):
    project = make_project(db, serial)
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "Gearbox repair"},
        headers=auth_header(creator),
    ).json()
    mat = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": material_name, "quantity": quantity},
        headers=auth_header(creator),
    ).json()
    return project, sr, mat


def _make_purchase_user(db, email="purchase1@premnathrail.com"):
    return make_user(db, email, assigned_apps=("purchase",))


# ── Raising a PR from a Service Request ─────────────────────────────────────

def test_raise_pr_requires_sr_edit_permission(client, db):
    creator = make_user(db, "raiser1@premnathrail.com", erp_permissions=["sr_create"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-002")

    response = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator))
    assert response.status_code == 403


def test_raise_pr_fails_with_no_unlinked_materials(client, db):
    creator = make_user(db, "raiser2@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    project = make_project(db, "SN-PR-003")
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project.id, "issue_title": "No parts yet"},
        headers=auth_header(creator),
    ).json()

    response = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator))
    assert response.status_code == 400


def test_raise_pr_creates_requisition_and_links_material(client, db):
    creator = make_user(db, "raiser3@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    project, sr, mat = _make_sr_with_material(client, db, creator, "SN-PR-004")

    response = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator))
    assert response.status_code == 201
    pr = response.json()
    assert pr["pr_number"].startswith("PR-")
    assert pr["status"] == "submitted"
    assert pr["project_id"] == project.id
    assert pr["service_request_id"] == sr["id"]
    assert pr["sr_request_number"] == sr["request_number"]
    assert len(pr["items"]) == 1
    assert pr["items"][0]["quantity_requested"] == 3

    materials = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(creator)).json()
    assert materials[0]["pr_id"] == pr["id"]
    assert materials[0]["pr_number"] == pr["pr_number"]
    assert materials[0]["pr_status"] == "submitted"


def test_raise_pr_only_includes_unlinked_materials(client, db):
    creator = make_user(db, "raiser4@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-005")
    first = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()

    # A second material added afterwards is not yet linked to any PR.
    client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials",
        json={"material_name": "Seal Kit", "quantity": 2},
        headers=auth_header(creator),
    )
    second = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator))
    assert second.status_code == 201
    assert second.json()["id"] != first["id"]
    assert len(second.json()["items"]) == 1
    assert second.json()["items"][0]["material_name"] == "Seal Kit"

    # No more unlinked materials left — raising again should fail.
    third = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator))
    assert third.status_code == 400


# ── Purchase module access & listing ────────────────────────────────────────

def test_purchase_list_requires_purchase_app_access(client, db):
    creator = make_user(db, "raiser5@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    response = client.get("/api/v1/purchase/requisitions", headers=auth_header(creator))
    assert response.status_code == 403


def test_purchase_user_can_list_and_get_requisition(client, db):
    creator = make_user(db, "raiser6@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-006")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()

    purchaser = _make_purchase_user(db, "purchase6@premnathrail.com")
    response = client.get("/api/v1/purchase/requisitions", headers=auth_header(purchaser))
    assert response.status_code == 200
    assert any(p["id"] == pr["id"] for p in response.json())

    response = client.get(f"/api/v1/purchase/requisitions/{pr['id']}", headers=auth_header(purchaser))
    assert response.status_code == 200
    assert response.json()["pr_number"] == pr["pr_number"]


# ── Approve / reject / cancel ────────────────────────────────────────────────

def test_approve_requisition(client, db):
    creator = make_user(db, "raiser7@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-007")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()

    purchaser = _make_purchase_user(db, "purchase7@premnathrail.com")
    response = client.post(f"/api/v1/purchase/requisitions/{pr['id']}/approve", headers=auth_header(purchaser))
    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    assert response.json()["approved_by_id"] == purchaser.id

    # Approving twice is rejected — already past "submitted".
    response = client.post(f"/api/v1/purchase/requisitions/{pr['id']}/approve", headers=auth_header(purchaser))
    assert response.status_code == 409


def test_reject_requisition_unlinks_materials(client, db):
    creator = make_user(db, "raiser8@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-008")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()

    purchaser = _make_purchase_user(db, "purchase8@premnathrail.com")
    response = client.post(f"/api/v1/purchase/requisitions/{pr['id']}/reject", json={"reason": "Wrong part"}, headers=auth_header(purchaser))
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"

    materials = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(creator)).json()
    assert materials[0]["pr_id"] is None
    assert materials[0]["pr_status"] is None

    # The now-unlinked material can be raised into a fresh PR.
    response = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator))
    assert response.status_code == 201
    assert response.json()["id"] != pr["id"]


def test_cancel_requisition_requires_non_terminal_status(client, db):
    creator = make_user(db, "raiser9@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-009")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()

    purchaser = _make_purchase_user(db, "purchase9@premnathrail.com")
    client.post(f"/api/v1/purchase/requisitions/{pr['id']}/cancel", json={}, headers=auth_header(purchaser))

    response = client.post(f"/api/v1/purchase/requisitions/{pr['id']}/cancel", json={}, headers=auth_header(purchaser))
    assert response.status_code == 409


# ── Receiving materials & closing a PR ──────────────────────────────────────

def test_receive_material_requires_sr_edit_permission(client, db):
    creator = make_user(db, "raiser10@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    other = make_user(db, "other10@premnathrail.com", erp_permissions=["sr_edit"])
    _, sr, mat = _make_sr_with_material(client, db, creator, "SN-PR-010")
    client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator))

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}/receive",
        json={"received_quantity": 1},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_partial_then_full_receive_advances_pr_to_received(client, db):
    creator = make_user(db, "raiser11@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, mat = _make_sr_with_material(client, db, creator, "SN-PR-011", quantity=3)
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}/receive",
        json={"received_quantity": 1},
        headers=auth_header(creator),
    )
    assert response.status_code == 200
    assert response.json()["receiving_status"] == "partial"

    pr_after_partial = client.get(f"/api/v1/purchase/requisitions/{pr['id']}", headers=auth_header(_make_purchase_user(db))).json()
    assert pr_after_partial["status"] == "partially_received"

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}/receive",
        json={"received_quantity": 3},
        headers=auth_header(creator),
    )
    assert response.json()["receiving_status"] == "received"

    pr_after_full = client.get(f"/api/v1/purchase/requisitions/{pr['id']}", headers=auth_header(_make_purchase_user(db, "purchase11b@premnathrail.com"))).json()
    assert pr_after_full["status"] == "received"
    assert pr_after_full["items"][0]["quantity_received"] == 3
    assert pr_after_full["items"][0]["item_status"] == "received"


def test_received_quantity_clamped_to_material_quantity(client, db):
    creator = make_user(db, "raiser12@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, mat = _make_sr_with_material(client, db, creator, "SN-PR-012", quantity=2)
    client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator))

    response = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}/receive",
        json={"received_quantity": 99},
        headers=auth_header(creator),
    )
    assert response.status_code == 200
    assert response.json()["received_quantity"] == 2
    assert response.json()["receiving_status"] == "received"


def test_close_requires_received_status(client, db):
    creator = make_user(db, "raiser13@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, mat = _make_sr_with_material(client, db, creator, "SN-PR-013", quantity=1)
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()
    purchaser = _make_purchase_user(db, "purchase13@premnathrail.com")

    response = client.post(f"/api/v1/purchase/requisitions/{pr['id']}/close", headers=auth_header(purchaser))
    assert response.status_code == 409

    client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/materials/{mat['id']}/receive",
        json={"received_quantity": 1},
        headers=auth_header(creator),
    )
    response = client.post(f"/api/v1/purchase/requisitions/{pr['id']}/close", headers=auth_header(purchaser))
    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert response.json()["closed_by_id"] == purchaser.id

    # A closed PR is reflected back onto the material it covers.
    materials = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(creator)).json()
    assert materials[0]["pr_status"] == "closed"


# ── Item remarks & photos ────────────────────────────────────────────────────

def test_update_item_remarks(client, db):
    creator = make_user(db, "raiser14@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-014")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()
    item_id = pr["items"][0]["id"]

    purchaser = _make_purchase_user(db, "purchase14@premnathrail.com")
    response = client.patch(
        f"/api/v1/purchase/requisitions/{pr['id']}/items/{item_id}",
        json={"remarks": "Vendor quoted 2-week lead time"},
        headers=auth_header(purchaser),
    )
    assert response.status_code == 200
    updated_item = next(i for i in response.json()["items"] if i["id"] == item_id)
    assert updated_item["remarks"] == "Vendor quoted 2-week lead time"

    # Persists on a fresh GET, not just the mutating response.
    refetched = client.get(f"/api/v1/purchase/requisitions/{pr['id']}", headers=auth_header(purchaser)).json()
    assert next(i for i in refetched["items"] if i["id"] == item_id)["remarks"] == "Vendor quoted 2-week lead time"


def test_update_item_remarks_unknown_item_404s(client, db):
    creator = make_user(db, "raiser15@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-015")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()

    purchaser = _make_purchase_user(db, "purchase15@premnathrail.com")
    response = client.patch(
        f"/api/v1/purchase/requisitions/{pr['id']}/items/999999",
        json={"remarks": "n/a"},
        headers=auth_header(purchaser),
    )
    assert response.status_code == 404


def test_item_attachments_require_sharepoint_config(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")

    creator = make_user(db, "raiser16@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-016")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()
    item_id = pr["items"][0]["id"]

    purchaser = _make_purchase_user(db, "purchase16@premnathrail.com")
    response = client.post(
        f"/api/v1/purchase/requisitions/{pr['id']}/items/{item_id}/attachments",
        files={"files": ("photo.jpg", b"fake-bytes", "image/jpeg")},
        headers=auth_header(purchaser),
    )
    assert response.status_code == 503


def test_item_attachment_rejects_non_image(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    creator = make_user(db, "raiser17@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-017")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()
    item_id = pr["items"][0]["id"]

    purchaser = _make_purchase_user(db, "purchase17@premnathrail.com")
    response = client.post(
        f"/api/v1/purchase/requisitions/{pr['id']}/items/{item_id}/attachments",
        files={"files": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
        headers=auth_header(purchaser),
    )
    assert response.status_code == 400


def test_upload_and_delete_item_attachment(client, db, monkeypatch):
    import app.modules.purchase.routes.purchase_requisitions as purchase_routes
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    async def fake_upload(site_id, folder_path, upload_file):
        return {
            "name": upload_file.filename,
            "path": f"{folder_path}/{upload_file.filename}",
            "webUrl": f"https://sharepoint.example/{upload_file.filename}",
            "size": 123,
        }

    async def fake_delete(site_id, file_path):
        return None

    monkeypatch.setattr(purchase_routes, "upload_file_to_sharepoint", fake_upload)
    monkeypatch.setattr(purchase_routes, "delete_file_from_sharepoint", fake_delete)

    creator = make_user(db, "raiser18@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-018")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()
    item_id = pr["items"][0]["id"]

    purchaser = _make_purchase_user(db, "purchase18@premnathrail.com")
    upload_response = client.post(
        f"/api/v1/purchase/requisitions/{pr['id']}/items/{item_id}/attachments",
        files={"files": ("photo.jpg", b"fake-bytes", "image/jpeg")},
        headers=auth_header(purchaser),
    )
    assert upload_response.status_code == 200
    item_after_upload = next(i for i in upload_response.json()["items"] if i["id"] == item_id)
    assert len(item_after_upload["attachments"]) == 1
    attachment = item_after_upload["attachments"][0]
    assert attachment["filename"] == "photo.jpg"
    assert attachment["sharepoint_url"] == "https://sharepoint.example/photo.jpg"

    # The photo is also visible from the ERP side, since it's the same
    # underlying ServiceMaterial gallery — not a separate copy.
    materials = client.get(f"/api/v1/erp/service-requests/{sr['id']}/materials", headers=auth_header(creator)).json()
    assert len(materials[0]["attachments"]) == 1

    delete_response = client.delete(
        f"/api/v1/purchase/requisitions/{pr['id']}/items/{item_id}/attachments/{attachment['id']}",
        headers=auth_header(purchaser),
    )
    assert delete_response.status_code == 200
    item_after_delete = next(i for i in delete_response.json()["items"] if i["id"] == item_id)
    assert item_after_delete["attachments"] == []


def test_delete_unknown_item_attachment_404s(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    creator = make_user(db, "raiser19@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    _, sr, _ = _make_sr_with_material(client, db, creator, "SN-PR-019")
    pr = client.post(f"/api/v1/erp/service-requests/{sr['id']}/raise-pr", headers=auth_header(creator)).json()
    item_id = pr["items"][0]["id"]

    purchaser = _make_purchase_user(db, "purchase19@premnathrail.com")
    response = client.delete(
        f"/api/v1/purchase/requisitions/{pr['id']}/items/{item_id}/attachments/999999",
        headers=auth_header(purchaser),
    )
    assert response.status_code == 404
