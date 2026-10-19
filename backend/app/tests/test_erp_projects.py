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
        json={"project_id": project["id"], "issue_title": "Cascade test issue", "service_type": "repair_breakdown"},
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


def _letter_payload(**overrides):
    payload = {
        "letter_date": "2026-10-06",
        "recipient": "The General Manager\nDMRC\nNew Delhi",
        "subject": "Commissioning of machine",
        "body": "Dear Sir,\n\nThe machine is ready for commissioning.",
        "signatory_name": "Vineet",
        "signatory_designation": "Manager",
    }
    payload.update(overrides)
    return payload


def _cover_payload(invoice_no="INV/P1/26-27/005"):
    # General letters can no longer be created; the fixed delivery documents are.
    return {"letter_type": "delivery_cover", "letter_date": "2026-10-06", "signatory_name": "Vineet", "signatory_designation": "Manager",
            "data": {"client": "DMRC", "loa_ref": "DMRC/LOA/12", "invoice_no": invoice_no, "documents": ["Packing List"]}}


def test_project_letter_lifecycle_numbers_and_renders(client, db):
    admin = make_user(db, "letters_admin@premnathrail.com", role="admin")
    project = client.post("/api/v1/erp/projects", json={"serial_number": "PEW-LTR-1"}, headers=auth_header(admin)).json()
    base = f"/api/v1/erp/projects/{project['id']}/letters"

    first = client.post(base, json=_cover_payload(), headers=auth_header(admin))
    assert first.status_code == 201, first.text
    assert first.json()["letter_no"] == "PEW-LTR-1/LTR/001"
    assert first.json()["created_by_name"] == "letters_admin"
    second = client.post(base, json=_cover_payload("INV/P1/26-27/006"), headers=auth_header(admin)).json()
    assert second["letter_no"] == "PEW-LTR-1/LTR/002"

    listed = client.get(base, headers=auth_header(admin)).json()
    assert [l["letter_no"] for l in listed] == ["PEW-LTR-1/LTR/002", "PEW-LTR-1/LTR/001"]

    edited = client.patch(f"{base}/{first.json()['id']}", json=_cover_payload("INV/P1/26-27/009"), headers=auth_header(admin))
    assert edited.status_code == 200 and edited.json()["data"]["invoice_no"] == "INV/P1/26-27/009"
    assert edited.json()["letter_no"] == "PEW-LTR-1/LTR/001"

    pdf = client.get(f"{base}/{second['id']}/file", headers=auth_header(admin))
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    docx = client.get(f"{base}/{second['id']}/file?format=docx", headers=auth_header(admin))
    assert docx.status_code == 200 and docx.content[:2] == b"PK"

    assert client.delete(f"{base}/{second['id']}", headers=auth_header(admin)).status_code == 200
    # Deleted numbers are never reused — the next letter continues the sequence.
    third = client.post(base, json=_cover_payload(), headers=auth_header(admin)).json()
    assert third["letter_no"] == "PEW-LTR-1/LTR/003"


def test_project_letter_requires_edit_permission_and_content(client, db):
    admin = make_user(db, "letters_admin2@premnathrail.com", role="admin")
    viewer = make_user(db, "letters_viewer@premnathrail.com", assigned_apps=["erp"])
    project = client.post("/api/v1/erp/projects", json={"serial_number": "PEW-LTR-2"}, headers=auth_header(admin)).json()
    base = f"/api/v1/erp/projects/{project['id']}/letters"

    assert client.post(base, json=_letter_payload(), headers=auth_header(viewer)).status_code == 403
    assert client.get(base, headers=auth_header(viewer)).status_code == 200
    blank = client.post(base, json=_letter_payload(subject="   "), headers=auth_header(admin))
    assert blank.status_code == 422
    assert client.get(f"{base}/999999/file", headers=auth_header(admin)).status_code == 404


def test_project_templated_delivery_documents(client, db):
    admin = make_user(db, "letters_admin3@premnathrail.com", role="admin")
    project = client.post("/api/v1/erp/projects", json={"serial_number": "PEW-LTR-3"}, headers=auth_header(admin)).json()
    base = f"/api/v1/erp/projects/{project['id']}/letters"
    shared = {"client": "IRCON International Limited", "loa_ref": "IRCON/3026/520 DATE. 21/08/2024", "invoice_no": "INV/P1/26-27/005", "invoice_date": "2026-05-08"}
    docs = {
        "delivery_confirmation": {**shared, "delivery_note_no": "DN/P1/26-27/03", "items": [{"challan_no": "DC/0165", "description": "Liquid tank"}, {"challan_no": "", "description": ""}]},
        "delivery_cover": {**shared, "documents": ["Packing List", "  "]},
        "guarantee_certificate": {"loa_ref": shared["loa_ref"], "recipient": "The CGM Mechanical\nIRCON", "supply_description": "CAM Injection Car", "months_commissioning": "18", "months_supply": 24},
    }
    for letter_type, data in docs.items():
        res = client.post(base, json={"letter_type": letter_type, "letter_date": "2026-06-16", "data": data, "signatory_name": "Vipin Arora"}, headers=auth_header(admin))
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["letter_type"] == letter_type and body["subject"] and body["recipient"]
        pdf = client.get(f"{base}/{body['id']}/file", headers=auth_header(admin))
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
        docx = client.get(f"{base}/{body['id']}/file?format=docx", headers=auth_header(admin))
        assert docx.status_code == 200 and docx.content[:2] == b"PK"
        if letter_type == "delivery_confirmation":
            assert len(body["data"]["items"]) == 1  # blank challan rows dropped
            confirmation_id = body["id"]
        if letter_type == "delivery_cover":
            assert body["data"]["documents"] == ["Packing List"]

    missing = client.post(base, json={"letter_type": "delivery_confirmation", "letter_date": "2026-06-16", "data": {"client": "X"}}, headers=auth_header(admin))
    assert missing.status_code == 422 and "Invoice No." in missing.text
    # A document's type is fixed once created.
    switched = client.patch(f"{base}/{confirmation_id}", json={"letter_type": "delivery_cover", "letter_date": "2026-06-16", "data": docs["delivery_cover"]}, headers=auth_header(admin))
    assert switched.status_code == 422


def test_private_project_document_cannot_be_deleted_without_view_rights(client, db):
    from app.modules.erp.models.project_attachment import ProjectAttachment
    owner = make_user(db, "privdoc_owner@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_delete"])
    other = make_user(db, "privdoc_other@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_delete"])
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-PRIV-1"}, headers=auth_header(owner)).json()
    doc = ProjectAttachment(project_id=project["id"], filename="contract.pdf", created_by_id=owner.id, is_private=True)
    db.add(doc)
    db.commit()

    r = client.delete(f"/api/v1/erp/projects/{project['id']}/attachments/{doc.id}", headers=auth_header(other))
    assert r.status_code == 403
    assert "private document" in r.json()["detail"]

    r = client.delete(f"/api/v1/erp/projects/{project['id']}/attachments/{doc.id}", headers=auth_header(owner))
    assert r.status_code == 200
    audit = client.get(f"/api/v1/erp/projects/{project['id']}/audit", headers=auth_header(owner)).json()
    assert any(a["action"] == "attachment_deleted" for a in audit)


def test_project_restore_keeps_separately_deleted_srs_in_recycle_bin(client, db):
    user = make_user(
        db, "restore_scope@premnathrail.com", assigned_apps=["erp"],
        erp_permissions=["project_create", "project_delete", "sr_create", "sr_delete"],
    )
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-RESTORE-1"}, headers=auth_header(user)).json()
    body = {"project_id": project["id"], "issue_title": "Issue", "service_type": "repair_breakdown"}
    sr_kept = client.post("/api/v1/erp/service-requests", json=body, headers=auth_header(user)).json()
    sr_binned = client.post("/api/v1/erp/service-requests", json=body, headers=auth_header(user)).json()

    assert client.delete(f"/api/v1/erp/service-requests/{sr_binned['id']}", headers=auth_header(user)).status_code == 200
    assert client.delete(f"/api/v1/erp/projects/{project['id']}", headers=auth_header(user)).status_code == 204
    assert client.post(f"/api/v1/erp/projects/{project['id']}/restore", headers=auth_header(user)).status_code == 200

    assert client.get(f"/api/v1/erp/service-requests/{sr_kept['id']}", headers=auth_header(user)).status_code == 200
    assert client.get(f"/api/v1/erp/service-requests/{sr_binned['id']}", headers=auth_header(user)).status_code == 404
