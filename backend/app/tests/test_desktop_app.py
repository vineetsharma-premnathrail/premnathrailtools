"""Windows app installer: admin uploads once (browser -> SharePoint directly),
everyone downloads (owner, 2026-11-13)."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.services import desktop_app as svc

API = "/api/v1/desktop-app"


def _user(db, email, role="user"):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _fake_sharepoint(monkeypatch, items):
    """items: item_id -> (name, size, head bytes, folder)."""
    deleted = []

    async def session(site, folder, name):
        return {"upload_url": f"https://upload.example/{name}", "expires_at": None}

    async def item(site, item_id):
        name, size, _, folder = items[item_id]
        return {"id": item_id, "name": name, "size": size, "parentReference": {"path": f"/drive/root:/{folder}"}}

    async def head(site, item_id, length=16):
        return items[item_id][2][:length]

    async def delete(site, item_id):
        deleted.append(item_id)

    async def link(site, path):
        return f"https://sharepoint.example/download?p={path}"

    monkeypatch.setattr(svc.settings, "SHAREPOINT_SITE_ID", "site-1")
    monkeypatch.setattr(svc, "create_upload_session", session)
    monkeypatch.setattr(svc, "get_drive_item", item)
    monkeypatch.setattr(svc, "read_item_head", head)
    monkeypatch.setattr(svc, "delete_drive_item", delete)
    monkeypatch.setattr(svc, "get_download_url", link)
    return deleted


def test_admin_uploads_and_everyone_downloads(client, db, monkeypatch):
    folder = svc._folder()
    deleted = _fake_sharepoint(monkeypatch, {
        "i1": ("PremnathrailPortal-Setup-1.0.2.exe", 94_000_000, b"MZ\x90", folder),
        "i2": ("PremnathrailPortal-Setup-1.0.3.exe", 95_000_000, b"MZ\x90", folder),
    })
    admin = _user(db, "desk.admin@premnathrail.com", role="admin")
    person = _user(db, "desk.user@premnathrail.com")

    assert client.get(API, headers=_h(person)).json() == {"available": False}
    r = client.get(f"{API}/download-link", headers=_h(person))
    assert r.status_code == 404 and "admin" in r.json()["detail"]

    r = client.post(f"{API}/upload-session", headers=_h(admin),
                    json={"version": "1.0.2", "file_name": "Premnathrail Portal Setup 1.0.2.exe", "file_size": 94_000_000})
    assert r.status_code == 200, r.text
    assert r.json()["file_name"] == "PremnathrailPortal-Setup-1.0.2.exe" and r.json()["upload_url"].startswith("https://")

    r = client.post(f"{API}/complete", headers=_h(admin), json={"version": "1.0.2", "item_id": "i1"})
    assert r.status_code == 200, r.text
    assert r.json()["available"] and r.json()["version"] == "1.0.2"

    info = client.get(API, headers=_h(person)).json()
    assert info["version"] == "1.0.2" and "path" not in info and "item_id" not in info
    link = client.get(f"{API}/download-link", headers=_h(person)).json()
    assert link["url"].startswith("https://sharepoint.example/") and link["file_name"].endswith("1.0.2.exe")

    # A new version replaces the old file.
    client.post(f"{API}/complete", headers=_h(admin), json={"version": "1.0.3", "item_id": "i2"})
    assert client.get(API, headers=_h(person)).json()["version"] == "1.0.3"
    assert deleted == ["i1"]


def test_upload_is_admin_only_and_checks_the_file(client, db, monkeypatch):
    deleted = _fake_sharepoint(monkeypatch, {
        "fake": ("PremnathrailPortal-Setup-1.0.2.exe", 1000, b"PK\x03\x04", svc._folder()),
        "elsewhere": ("x.exe", 1000, b"MZ", "ERP-media/Other"),
    })
    admin = _user(db, "desk.admin2@premnathrail.com", role="admin")
    person = _user(db, "desk.user2@premnathrail.com")

    body = {"version": "1.0.2", "file_name": "setup.exe", "file_size": 1000}
    assert client.post(f"{API}/upload-session", headers=_h(person), json=body).status_code == 403
    assert client.post(f"{API}/complete", headers=_h(person), json={"version": "1.0.2", "item_id": "fake"}).status_code == 403

    r = client.post(f"{API}/upload-session", headers=_h(admin), json={**body, "file_name": "setup.zip"})
    assert r.status_code == 422 and "not a Windows installer" in r.json()["detail"]
    assert client.post(f"{API}/upload-session", headers=_h(admin), json={**body, "version": "1 0 2"}).status_code == 422
    assert client.post(f"{API}/upload-session", headers=_h(admin), json={**body, "file_size": 600 * 1024 * 1024}).status_code == 413

    r = client.post(f"{API}/complete", headers=_h(admin), json={"version": "1.0.2", "item_id": "fake"})
    assert r.status_code == 422 and "renamed" in r.json()["detail"]
    r = client.post(f"{API}/complete", headers=_h(admin), json={"version": "1.0.2", "item_id": "elsewhere"})
    assert r.status_code == 422 and "folder" in r.json()["detail"]
    assert deleted == ["fake", "elsewhere"]
    assert client.get(API, headers=_h(person)).json() == {"available": False}
    assert client.get(API).status_code == 401
