from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User


def make_user(db, email, role="user", assigned_apps=None):
    apps = ["crm"] if assigned_apps is None else assigned_apps
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=apps)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_list_organizations_requires_crm_access(client, db):
    user = make_user(db, "nocrm@premnathrail.com", assigned_apps=[])
    response = client.get("/api/v1/crm/organizations", headers=auth_header(user))
    assert response.status_code == 403


def test_create_organization_and_get(client, db):
    user = make_user(db, "crmuser1@premnathrail.com")
    response = client.post("/api/v1/crm/organizations", json={"name": "Indian Railways Ltd"}, headers=auth_header(user))
    assert response.status_code == 201
    org_id = response.json()["id"]

    response = client.get(f"/api/v1/crm/organizations/{org_id}", headers=auth_header(user))
    assert response.status_code == 200
    assert response.json()["name"] == "Indian Railways Ltd"


def test_create_organization_rejects_duplicate_name(client, db):
    user = make_user(db, "crmuser2@premnathrail.com")
    client.post("/api/v1/crm/organizations", json={"name": "Dup Org"}, headers=auth_header(user))
    response = client.post("/api/v1/crm/organizations", json={"name": "Dup Org"}, headers=auth_header(user))
    assert response.status_code == 409


def test_create_organization_rejects_duplicate_gst(client, db):
    user = make_user(db, "crmuser3@premnathrail.com")
    client.post("/api/v1/crm/organizations", json={"name": "Org A", "gst_number": "27ABCDE1234F1Z5"}, headers=auth_header(user))
    response = client.post("/api/v1/crm/organizations", json={"name": "Org B", "gst_number": "27ABCDE1234F1Z5"}, headers=auth_header(user))
    assert response.status_code == 409


def test_create_inquiry_generates_universal_id_and_stage_log(client, db):
    user = make_user(db, "crmuser4@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Inquiry Org"}, headers=auth_header(user)).json()

    response = client.post(
        "/api/v1/crm/inquiries",
        json={"org_id": org["id"], "product": "Brake System"},
        headers=auth_header(user),
    )
    assert response.status_code == 201
    inquiry = response.json()
    assert inquiry["universal_id"].startswith("INQ-")
    assert inquiry["current_stage"] == "Customer Requirement"

    stages = client.get(f"/api/v1/crm/inquiries/{inquiry['id']}/stages", headers=auth_header(user)).json()
    assert any(s["stage"] == "Inquiry created" for s in stages)


def test_inquiry_stage_change_logs_and_updates_current_stage(client, db):
    user = make_user(db, "crmuser5@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Stage Org"}, headers=auth_header(user)).json()
    inquiry = client.post("/api/v1/crm/inquiries", json={"org_id": org["id"]}, headers=auth_header(user)).json()

    response = client.patch(
        f"/api/v1/crm/inquiries/{inquiry['id']}", json={"current_stage": "Design"}, headers=auth_header(user)
    )
    assert response.status_code == 200
    assert response.json()["current_stage"] == "Design"

    stages = client.get(f"/api/v1/crm/inquiries/{inquiry['id']}/stages", headers=auth_header(user)).json()
    assert any(s["stage"] == "Stage updated" for s in stages)


def test_create_tender_rejects_duplicate_number_same_zone_division(client, db):
    user = make_user(db, "crmuser6@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Tender Org"}, headers=auth_header(user)).json()

    payload = {"org_id": org["id"], "tender_number": "TND-001", "railway_zone": "Northern Railway", "division": "Delhi"}
    r1 = client.post("/api/v1/crm/tenders", json=payload, headers=auth_header(user))
    assert r1.status_code == 201

    r2 = client.post("/api/v1/crm/tenders", json=payload, headers=auth_header(user))
    assert r2.status_code == 409

    # Different division is allowed
    payload_diff = {**payload, "division": "Mumbai"}
    r3 = client.post("/api/v1/crm/tenders", json=payload_diff, headers=auth_header(user))
    assert r3.status_code == 201


def test_update_permission_rejects_non_owner_non_admin(client, db):
    owner = make_user(db, "crmowner@premnathrail.com")
    other = make_user(db, "crmother@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Perm Org"}, headers=auth_header(owner)).json()

    response = client.patch(
        f"/api/v1/crm/organizations/{org['id']}", json={"city": "Delhi"}, headers=auth_header(other)
    )
    assert response.status_code == 403


def test_search_organization_name(client, db):
    user = make_user(db, "crmsearch@premnathrail.com")
    client.post("/api/v1/crm/organizations", json={"name": "Zonal Railway Workshop"}, headers=auth_header(user))
    client.post("/api/v1/crm/organizations", json={"name": "Unrelated Vendor"}, headers=auth_header(user))

    response = client.get("/api/v1/crm/organizations/search-name?q=Zonal", headers=auth_header(user))
    assert response.status_code == 200
    names = [o["name"] for o in response.json()]
    assert "Zonal Railway Workshop" in names
    assert "Unrelated Vendor" not in names


def test_organization_detail_includes_contacts_and_counts(client, db):
    user = make_user(db, "crmdetail@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Detail Org"}, headers=auth_header(user)).json()
    client.post(f"/api/v1/crm/organizations/{org['id']}/contacts", json={"name": "Contact A"}, headers=auth_header(user))
    client.post("/api/v1/crm/inquiries", json={"org_id": org["id"]}, headers=auth_header(user))
    client.post("/api/v1/crm/tenders", json={"org_id": org["id"]}, headers=auth_header(user))

    response = client.get(f"/api/v1/crm/organizations/{org['id']}/detail", headers=auth_header(user))
    assert response.status_code == 200
    detail = response.json()
    assert len(detail["contacts"]) == 1
    assert detail["contacts"][0]["name"] == "Contact A"
    assert detail["inquiry_count"] == 1
    assert detail["tender_count"] == 1


def test_organization_audit_log_records_create_and_update(client, db):
    user = make_user(db, "crmaudit@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Audit Org"}, headers=auth_header(user)).json()
    client.patch(f"/api/v1/crm/organizations/{org['id']}", json={"city": "Chennai"}, headers=auth_header(user))

    response = client.get(f"/api/v1/crm/organizations/{org['id']}/audit", headers=auth_header(user))
    assert response.status_code == 200
    actions = [a["action"] for a in response.json()]
    assert "created" in actions
    assert "updated" in actions


def test_org_contact_crud(client, db):
    user = make_user(db, "crmcontact@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Contact Org"}, headers=auth_header(user)).json()

    response = client.post(
        f"/api/v1/crm/organizations/{org['id']}/contacts", json={"name": "John Doe"}, headers=auth_header(user)
    )
    assert response.status_code == 201
    contact = response.json()
    assert contact["name"] == "John Doe"

    response = client.get(f"/api/v1/crm/organizations/{org['id']}/contacts", headers=auth_header(user))
    assert response.status_code == 200
    assert any(c["id"] == contact["id"] for c in response.json())

    response = client.patch(
        f"/api/v1/crm/organizations/{org['id']}/contacts/{contact['id']}",
        json={"name": "Jane Doe"},
        headers=auth_header(user),
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Jane Doe"

    response = client.delete(
        f"/api/v1/crm/organizations/{org['id']}/contacts/{contact['id']}", headers=auth_header(user)
    )
    assert response.status_code == 200

    remaining = client.get(f"/api/v1/crm/organizations/{org['id']}/contacts", headers=auth_header(user)).json()
    assert all(c["id"] != contact["id"] for c in remaining)


def test_org_contact_update_rejects_non_owner_non_admin(client, db):
    owner = make_user(db, "crmcontactowner@premnathrail.com")
    other = make_user(db, "crmcontactother@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Contact Perm Org"}, headers=auth_header(owner)).json()
    contact = client.post(
        f"/api/v1/crm/organizations/{org['id']}/contacts", json={"name": "Owner Contact"}, headers=auth_header(owner)
    ).json()

    response = client.patch(
        f"/api/v1/crm/organizations/{org['id']}/contacts/{contact['id']}",
        json={"name": "Hijacked"},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_list_organizations_filters_by_search_and_railway_zone(client, db):
    user = make_user(db, "crmfilter@premnathrail.com")
    client.post(
        "/api/v1/crm/organizations",
        json={"name": "Northern Zone Depot", "railway_zone": "Northern Railway"},
        headers=auth_header(user),
    )
    client.post(
        "/api/v1/crm/organizations",
        json={"name": "Southern Zone Depot", "railway_zone": "Southern Railway"},
        headers=auth_header(user),
    )

    response = client.get("/api/v1/crm/organizations?railway_zone=Northern Railway", headers=auth_header(user))
    assert response.status_code == 200
    names = [o["name"] for o in response.json()]
    assert "Northern Zone Depot" in names
    assert "Southern Zone Depot" not in names

    response = client.get("/api/v1/crm/organizations?search=Southern", headers=auth_header(user))
    assert response.status_code == 200
    names = [o["name"] for o in response.json()]
    assert "Southern Zone Depot" in names
    assert "Northern Zone Depot" not in names


def test_delete_organization_cascades_to_inquiries_and_tenders(client, db):
    # Deleting an organization is admin-only (app.modules.crm.routes.organizations.delete_organization).
    user = make_user(db, "crmcascade@premnathrail.com")
    admin = make_user(db, "crmcascade-admin@premnathrail.com", role="admin")
    org = client.post("/api/v1/crm/organizations", json={"name": "Cascade Org"}, headers=auth_header(user)).json()
    inquiry = client.post("/api/v1/crm/inquiries", json={"org_id": org["id"]}, headers=auth_header(user)).json()
    tender = client.post("/api/v1/crm/tenders", json={"org_id": org["id"]}, headers=auth_header(user)).json()

    response = client.delete(f"/api/v1/crm/organizations/{org['id']}", headers=auth_header(admin))
    assert response.status_code == 204

    assert client.get(f"/api/v1/crm/inquiries/{inquiry['id']}", headers=auth_header(user)).status_code == 404
    assert client.get(f"/api/v1/crm/tenders/{tender['id']}", headers=auth_header(user)).status_code == 404


def test_dashboard_returns_counts(client, db):
    user = make_user(db, "crmdash@premnathrail.com")
    client.post("/api/v1/crm/organizations", json={"name": "Dash Org"}, headers=auth_header(user))
    response = client.get("/api/v1/crm/dashboard", headers=auth_header(user))
    assert response.status_code == 200
    data = response.json()
    assert data["total_organizations"] >= 1


def test_inquiry_task_permission_check(client, db):
    owner = make_user(db, "crmtaskowner@premnathrail.com")
    other = make_user(db, "crmtaskother@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Task Org"}, headers=auth_header(owner)).json()
    inquiry = client.post("/api/v1/crm/inquiries", json={"org_id": org["id"]}, headers=auth_header(owner)).json()
    task = client.post(
        f"/api/v1/crm/inquiries/{inquiry['id']}/tasks",
        json={"department": "Design", "task_title": "Prepare drawing"},
        headers=auth_header(owner),
    ).json()

    response = client.patch(
        f"/api/v1/crm/inquiries/{inquiry['id']}/tasks/{task['id']}",
        json={"status": "Completed"},
        headers=auth_header(other),
    )
    assert response.status_code == 403
