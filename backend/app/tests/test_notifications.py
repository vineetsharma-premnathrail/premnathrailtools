from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.utils.notifications import notify_user


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


def test_sr_creation_sends_no_notification(client, db):
    creator = make_user(db, "notif1@premnathrail.com", erp_permissions=("project_create", "sr_create"))
    other = make_user(db, "notif2@premnathrail.com")
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-N1"}, headers=auth_header(creator)).json()

    client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project["id"], "issue_title": "Notif test issue"},
        headers=auth_header(creator),
    )

    for u in (other, creator):
        notifications = client.get("/api/v1/notifications", headers=auth_header(u)).json()
        assert not any(n["notification_type"] == "sr_created" for n in notifications)


def test_sr_update_sends_no_notification(client, db):
    creator = make_user(db, "notif3@premnathrail.com", erp_permissions=("project_create", "sr_create"))
    admin = make_user(db, "notif4@premnathrail.com", role="admin")
    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-N2"}, headers=auth_header(creator)).json()
    sr = client.post(
        "/api/v1/erp/service-requests",
        json={"project_id": project["id"], "issue_title": "Update notif test"},
        headers=auth_header(creator),
    ).json()

    client.patch(f"/api/v1/erp/service-requests/{sr['id']}", json={"priority": "high"}, headers=auth_header(admin))

    creator_notifications = client.get("/api/v1/notifications", headers=auth_header(creator)).json()
    assert not any(n["notification_type"] == "sr_updated" for n in creator_notifications)


def test_approval_and_followup_notifications_still_sent(client, db):
    user = make_user(db, "notif9@premnathrail.com")
    notify_user(db, user_id=user.id, title="PR approved", message="m", notification_type="p2p_request_approved")
    notify_user(db, user_id=user.id, title="Follow-up due", message="m", notification_type="activity_followup_due_today")
    db.commit()

    types = {n["notification_type"] for n in client.get("/api/v1/notifications", headers=auth_header(user)).json()}
    assert {"p2p_request_approved", "activity_followup_due_today"} <= types


def test_unread_count_and_mark_all_read(client, db):
    other = make_user(db, "notif6@premnathrail.com")
    notify_user(db, user_id=other.id, title="PR approved", message="m", notification_type="p2p_request_approved")
    db.commit()

    unread = client.get("/api/v1/notifications/unread-count", headers=auth_header(other)).json()
    assert unread["count"] >= 1

    client.patch("/api/v1/notifications/read-all", headers=auth_header(other))

    unread_after = client.get("/api/v1/notifications/unread-count", headers=auth_header(other)).json()
    assert unread_after["count"] == 0


def test_project_creation_and_deletion_send_no_notification(client, db):
    creator = make_user(db, "notif7@premnathrail.com", erp_permissions=("project_create", "project_delete"))
    other = make_user(db, "notif8@premnathrail.com")

    project = client.post("/api/v1/erp/projects", json={"serial_number": "SN-N4"}, headers=auth_header(creator)).json()
    client.delete(f"/api/v1/erp/projects/{project['id']}", headers=auth_header(creator))

    types = {n["notification_type"] for n in client.get("/api/v1/notifications", headers=auth_header(other)).json()}
    assert not types & {"project_created", "project_deleted"}


def test_teams_push_only_for_opted_in_notifications(db, monkeypatch):
    """Teams gets only approval requests / reminders (teams=True); every other
    notice stays in the bell only."""
    from app.modules.main.models.user import User
    from app.utils import notifications

    pushed = []
    monkeypatch.setattr(notifications, "_notify_teams", lambda u, t, m: pushed.append(t))
    user = User(email="teamsgate@premnathrail.com", name="tg", role="user", is_active=True,
                assigned_apps=["p2p"], azure_id="azure-1")
    db.add(user)
    db.commit()

    notifications.notify_user(db, user.id, "PR Approved", "m", "p2p_request_approved")
    notifications.broadcast_notification(db, "New Purchase Requisition", "m", "pr_raised", app_name="p2p")
    notifications.notify_user(db, user.id, "PO Awaiting Approval", "m", "p2p_po_approval_pending", teams=True)
    db.commit()

    assert pushed == ["PO Awaiting Approval"]
    from app.modules.main.models.notification import Notification
    assert db.query(Notification).filter(Notification.user_id == user.id).count() == 3
