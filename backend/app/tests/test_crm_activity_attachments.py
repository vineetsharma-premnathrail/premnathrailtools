from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.crm.routes import activities as activities_routes


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


def make_org(client, user, name="Photo Org"):
    return client.post("/api/v1/crm/organizations", json={"name": name}, headers=auth_header(user)).json()


def make_activity(client, user, org_id):
    return client.post("/api/v1/crm/activities", json={"org_id": org_id, "activity_type": "Call"}, headers=auth_header(user)).json()


def test_upload_requires_sharepoint_config(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")

    user = make_user(db, "actphoto1@premnathrail.com")
    org = make_org(client, user)
    activity = make_activity(client, user, org["id"])

    response = client.post(
        f"/api/v1/crm/activities/{activity['id']}/attachments",
        files={"files": ("photo.jpg", b"fake-bytes", "image/jpeg")},
        headers=auth_header(user),
    )
    assert response.status_code == 503


def test_upload_rejects_non_image(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    user = make_user(db, "actphoto2@premnathrail.com")
    org = make_org(client, user)
    activity = make_activity(client, user, org["id"])

    response = client.post(
        f"/api/v1/crm/activities/{activity['id']}/attachments",
        files={"files": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
        headers=auth_header(user),
    )
    assert response.status_code == 400


def test_upload_requires_creator_or_admin(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    owner = make_user(db, "actphoto3@premnathrail.com")
    other = make_user(db, "actphoto3b@premnathrail.com")
    org = make_org(client, owner)
    activity = make_activity(client, owner, org["id"])

    response = client.post(
        f"/api/v1/crm/activities/{activity['id']}/attachments",
        files={"files": ("photo.jpg", b"fake-bytes", "image/jpeg")},
        headers=auth_header(other),
    )
    assert response.status_code == 403


def test_upload_list_and_delete_activity_attachment(client, db, monkeypatch):
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

    monkeypatch.setattr(activities_routes, "upload_file_to_sharepoint", fake_upload)
    monkeypatch.setattr(activities_routes, "delete_file_from_sharepoint", fake_delete)

    user = make_user(db, "actphoto4@premnathrail.com")
    org = make_org(client, user)
    activity = make_activity(client, user, org["id"])

    upload_response = client.post(
        f"/api/v1/crm/activities/{activity['id']}/attachments",
        files={"files": ("photo.jpg", b"fake-bytes", "image/jpeg")},
        headers=auth_header(user),
    )
    assert upload_response.status_code == 200
    attachments = upload_response.json()["attachments"]
    assert len(attachments) == 1
    assert attachments[0]["filename"] == "photo.jpg"
    assert attachments[0]["sharepoint_url"] == "https://sharepoint.example/photo.jpg"

    # Attachments ride along on every list/get too, not just the upload response.
    listed = client.get("/api/v1/crm/activities", params={"org_id": org["id"]}, headers=auth_header(user)).json()
    assert len(next(a for a in listed if a["id"] == activity["id"])["attachments"]) == 1

    delete_response = client.delete(
        f"/api/v1/crm/activities/{activity['id']}/attachments/{attachments[0]['id']}",
        headers=auth_header(user),
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["attachments"] == []


def test_delete_unknown_attachment_404s(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    user = make_user(db, "actphoto5@premnathrail.com")
    org = make_org(client, user)
    activity = make_activity(client, user, org["id"])

    response = client.delete(
        f"/api/v1/crm/activities/{activity['id']}/attachments/999999",
        headers=auth_header(user),
    )
    assert response.status_code == 404
