"""Service (ERP) → Settings: permissions matrix, machine approval, SR closure
approval and configurable notification rules."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User

API = "/api/v1/erp"


def make_user(db, email, role="user", assigned_apps=None, erp_permissions=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=assigned_apps if assigned_apps is not None else ["erp"], erp_permissions=erp_permissions or [],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def set_approvers(client, admin, key, user_ids):
    """Approvers live in Organization › Approval Workflows now (they used to be
    Service → Settings 'project_approvers' / 'sr_close_approvers')."""
    r = client.put(f"/api/v1/organization/workflows/{key}", headers=h(admin),
                   json={"stages": [{"name": "Approvers", "approver_rule": "specific_users", "rule_config": {"user_ids": user_ids}}]})
    assert r.status_code == 200, r.text


def save(client, admin, values):
    r = client.put(f"{API}/settings", json={"values": values}, headers=h(admin))
    assert r.status_code == 200, r.text
    return r.json()


def test_settings_load_and_non_editor_cannot_save(client, db):
    user = make_user(db, "svc_plain@premnathrail.com")
    r = client.get(f"{API}/settings", headers=h(user))
    assert r.status_code == 200
    body = r.json()
    assert body["can_edit"] is False
    assert "notify_sr_create_enabled" in body["values"]
    r = client.put(f"{API}/settings", json={"values": {"project_approval_required": True}}, headers=h(user))
    assert r.status_code == 403


def test_notification_rule_needs_recipients(client, db):
    admin = make_user(db, "svc_admin1@premnathrail.com", role="admin")
    r = client.put(f"{API}/settings", json={"values": {"notify_sr_create_enabled": True}}, headers=h(admin))
    assert r.status_code == 422
    assert "nobody would receive it" in r.json()["detail"]
    r = client.put(f"{API}/settings", json={"values": {"notify_sr_create_emails": ["not-an-email"]}}, headers=h(admin))
    assert r.status_code == 422


def test_service_permissions_moved_to_roles(client, db):
    """The per-user Service permissions editor in Settings was retired —
    who may view/create/edit/delete machines and SRs is set by roles."""
    admin = make_user(db, "svc_admin2@premnathrail.com", role="admin")
    r = client.get(f"{API}/settings/permissions", headers=h(admin))
    assert r.status_code in (404, 405)


def test_machine_approval_blocks_srs_until_approved(client, db):
    admin = make_user(db, "svc_admin3@premnathrail.com", role="admin")
    approver = make_user(db, "svc_approver@premnathrail.com")
    creator = make_user(db, "svc_creator@premnathrail.com", erp_permissions=["project_create", "project_edit", "sr_create"])
    save(client, admin, {"project_approval_required": True})
    set_approvers(client, admin, "erp.machine", [approver.id])

    r = client.post(f"{API}/projects", json={"serial_number": "SN-APPR-1"}, headers=h(creator))
    assert r.status_code == 201, r.text
    project = r.json()
    assert project["approval_status"] == "pending"
    assert db.query(Notification).filter(Notification.user_id == approver.id, Notification.entity_id == project["id"]).count() == 1

    sr_payload = {"project_id": project["id"], "issue_title": "Noise", "service_type": "repair_breakdown"}
    r = client.post(f"{API}/service-requests", json=sr_payload, headers=h(creator))
    assert r.status_code == 409
    assert "not approved" in r.json()["detail"]

    assert client.post(f"{API}/projects/{project['id']}/approve", json={}, headers=h(creator)).status_code == 403
    r = client.post(f"{API}/projects/{project['id']}/reject", json={}, headers=h(approver))
    assert r.status_code == 422
    r = client.post(f"{API}/projects/{project['id']}/reject", json={"remarks": "Wrong client"}, headers=h(approver))
    assert r.json()["approval_status"] == "rejected"

    # correcting it re-submits
    r = client.patch(f"{API}/projects/{project['id']}", json={"client_company": "Right Co"}, headers=h(creator))
    assert r.json()["approval_status"] == "pending"
    r = client.post(f"{API}/projects/{project['id']}/approve", json={}, headers=h(approver))
    assert r.json()["approval_status"] == "approved"
    assert client.post(f"{API}/service-requests", json=sr_payload, headers=h(creator)).status_code == 201


def test_sr_close_approval_flow(client, db):
    admin = make_user(db, "svc_admin4@premnathrail.com", role="admin")
    approver = make_user(db, "svc_closer@premnathrail.com")
    eng = make_user(db, "svc_eng@premnathrail.com", erp_permissions=["project_create", "sr_create", "sr_edit"])
    save(client, admin, {"sr_close_approval_required": True})
    set_approvers(client, admin, "erp.sr_closure", [approver.id])
    project = client.post(f"{API}/projects", json={"serial_number": "SN-CLOSE-1"}, headers=h(eng)).json()
    sr = client.post(f"{API}/service-requests", json={"project_id": project["id"], "issue_title": "Leak",
                                                       "service_type": "repair_breakdown"}, headers=h(eng)).json()
    client.patch(f"{API}/service-requests/{sr['id']}", json={"resolution_description": "Seal replaced"}, headers=h(eng))

    r = client.patch(f"{API}/service-requests/{sr['id']}", json={"status": "closed"}, headers=h(eng))
    assert r.status_code == 403
    assert "Review" in r.json()["detail"]
    r = client.patch(f"{API}/service-requests/{sr['id']}", json={"status": "review"}, headers=h(eng))
    assert r.status_code == 200
    assert db.query(Notification).filter(Notification.user_id == approver.id, Notification.entity_id == sr["id"]).count() == 1

    r = client.post(f"{API}/service-requests/{sr['id']}/reject-close", json={"remarks": "Photos missing"}, headers=h(approver))
    assert r.json()["status"] == "in_progress"
    client.patch(f"{API}/service-requests/{sr['id']}", json={"status": "review"}, headers=h(eng))
    r = client.post(f"{API}/service-requests/{sr['id']}/approve-close", json={}, headers=h(approver))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "closed"


def test_notification_rule_sends_bell_to_selected_users(client, db):
    admin = make_user(db, "svc_admin5@premnathrail.com", role="admin")
    watcher = make_user(db, "svc_watch@premnathrail.com")
    other = make_user(db, "svc_other@premnathrail.com")
    creator = make_user(db, "svc_maker@premnathrail.com", erp_permissions=["project_create", "project_edit"])
    save(client, admin, {"notify_project_create_enabled": True, "notify_project_create_users": [watcher.id, creator.id],
                         "notify_dispatch_enabled": True, "notify_dispatch_users": [watcher.id]})
    project = client.post(f"{API}/projects", json={"serial_number": "SN-NOTE-1"}, headers=h(creator)).json()
    q = db.query(Notification).filter(Notification.entity_type == "project", Notification.entity_id == project["id"])
    assert q.filter(Notification.user_id == watcher.id, Notification.notification_type == "erp_rule_project_create").count() == 1
    assert q.filter(Notification.user_id == creator.id).count() == 0  # the actor isn't told about their own action
    assert q.filter(Notification.user_id == other.id).count() == 0

    client.patch(f"{API}/projects/{project['id']}", json={"delivery_date": "2026-10-01"}, headers=h(creator))
    assert q.filter(Notification.user_id == watcher.id, Notification.notification_type == "erp_rule_dispatch").count() == 1
