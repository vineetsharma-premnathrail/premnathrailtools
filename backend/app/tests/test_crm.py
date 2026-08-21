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


def test_delete_organization_cascades_to_inquiries_and_tenders(client, db):
    user = make_user(db, "crmcascade@premnathrail.com")
    org = client.post("/api/v1/crm/organizations", json={"name": "Cascade Org"}, headers=auth_header(user)).json()
    inquiry = client.post("/api/v1/crm/inquiries", json={"org_id": org["id"]}, headers=auth_header(user)).json()
    tender = client.post("/api/v1/crm/tenders", json={"org_id": org["id"]}, headers=auth_header(user)).json()

    response = client.delete(f"/api/v1/crm/organizations/{org['id']}", headers=auth_header(user))
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
