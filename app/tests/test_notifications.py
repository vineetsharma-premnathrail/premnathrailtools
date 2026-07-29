from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User


def make_user(db, email, role="user", assigned_apps=("erp",), erp_permissions=()):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=list(assigned_apps), erp_permissions=list(erp_permissions),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_sr_creation_notifies_other_erp_users_and_the_actor(client, db):
    creator = make_user(db, "notif1@premnathrail.com")
    other = make_user(db, "notif2@premnathrail.com")
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-N1"}, headers=auth_header(creator)).json()

    client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project["id"], "issue_title": "Notif test issue"},
        headers=auth_header(creator),
    )

    other_notifications = client.get("/api/v1/notifications", headers=auth_header(other)).json()
    assert any(n["notification_type"] == "sr_created" for n in other_notifications)

    # The creator also gets a self-confirmation notification, clickable straight to the new SR.
    creator_notifications = client.get("/api/v1/notifications", headers=auth_header(creator)).json()
    assert any(n["notification_type"] == "sr_created" for n in creator_notifications)


def test_sr_update_notifies_creator_when_someone_else_changes_it(client, db):
    creator = make_user(db, "notif3@premnathrail.com")
    admin = make_user(db, "notif4@premnathrail.com", role="admin")
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-N2"}, headers=auth_header(creator)).json()
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project["id"], "issue_title": "Update notif test"},
        headers=auth_header(creator),
    ).json()

    client.patch(f"/api/v1/erp/service-requests/{sr['id']}", json={"priority": "high"}, headers=auth_header(admin))

    creator_notifications = client.get("/api/v1/notifications", headers=auth_header(creator)).json()
    assert any(n["notification_type"] == "sr_updated" for n in creator_notifications)


def test_unread_count_and_mark_all_read(client, db):
    creator = make_user(db, "notif5@premnathrail.com")
    other = make_user(db, "notif6@premnathrail.com")
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-N3"}, headers=auth_header(creator)).json()
    client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project["id"], "issue_title": "Unread count test"},
        headers=auth_header(creator),
    )

    unread = client.get("/api/v1/notifications/unread-count", headers=auth_header(other)).json()
    assert unread["count"] >= 1

    client.patch("/api/v1/notifications/read-all", headers=auth_header(other))

    unread_after = client.get("/api/v1/notifications/unread-count", headers=auth_header(other)).json()
    assert unread_after["count"] == 0


def test_project_creation_and_deletion_notify_other_erp_users(client, db):
    creator = make_user(db, "notif7@premnathrail.com", erp_permissions=("project_delete",))
    other = make_user(db, "notif8@premnathrail.com")

    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-N4"}, headers=auth_header(creator)).json()
    other_notifications = client.get("/api/v1/notifications", headers=auth_header(other)).json()
    assert any(n["notification_type"] == "project_created" for n in other_notifications)

    client.delete(f"/api/v1/erp/projects/{project['id']}", headers=auth_header(creator))
    other_notifications = client.get("/api/v1/notifications", headers=auth_header(other)).json()
    assert any(n["notification_type"] == "project_deleted" for n in other_notifications)
