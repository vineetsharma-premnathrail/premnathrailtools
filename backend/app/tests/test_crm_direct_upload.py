"""Large-file direct uploads for CRM documents: the API opens a SharePoint
upload session, the browser uploads to it, and complete-upload verifies the
stored file before recording it. Graph calls are faked in-memory."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.modules.main.models.user import User
from app.modules.crm.models.document import CrmDocument

API = "/api/v1/crm/documents"
GB = 1024 ** 3


@pytest.fixture
def graph(monkeypatch):
    """In-memory stand-in for the SharePoint drive: items by id."""
    state = {"items": {}, "deleted": [], "sessions": []}

    async def create_upload_session(site_id, folder_path, filename):
        state["sessions"].append((folder_path, filename))
        return {"upload_url": f"https://sp.example/upload/{len(state['sessions'])}", "expires_at": "2026-10-01T00:00:00Z"}

    async def get_drive_item(site_id, item_id):
        return state["items"][item_id]

    async def read_item_head(site_id, item_id, length=16):
        return state["items"][item_id]["_head"][:length]

    async def delete_drive_item(site_id, item_id):
        state["deleted"].append(item_id)

    import app.utils.sharepoint as sp
    import app.modules.crm.routes.documents as routes
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site")
    monkeypatch.setattr(routes, "create_upload_session", create_upload_session)
    monkeypatch.setattr(sp, "get_drive_item", get_drive_item)
    monkeypatch.setattr(sp, "read_item_head", read_item_head)
    monkeypatch.setattr(sp, "delete_drive_item", delete_drive_item)
    return state


def make_user(db, email):
    user = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=["crm"])
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def start(client, user, **over):
    body = {"related_module": "inquiry", "related_id": 7, "universal_id": "INQ-2026-0007", "file_name": "GA drawing set.pdf",
            "file_size": 42 * GB, "content_type": "application/pdf", **over}
    return client.post(f"{API}/upload-session", json=body, headers=auth(user))


def stored(graph, folder, name, size, head=b"%PDF-1.7 ....."):
    graph["items"]["ITEM1"] = {"id": "ITEM1", "name": name, "size": size, "webUrl": "https://sp.example/x",
                               "parentReference": {"path": f"/drive/root:/{folder}"}, "_head": head}


def test_session_for_a_42_gb_file_and_complete(client, db, graph):
    user = make_user(db, "crm.user@premnathrail.com")
    r = start(client, user)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["upload_url"].startswith("https://sp.example/upload/")
    assert body["chunk_size"] % (320 * 1024) == 0
    folder, name = graph["sessions"][0]
    assert folder.startswith("CRM-media/crm.user/") and folder.endswith("General/crm-inquiry-INQ-2026-0007")  # same sanitised folder as the regular upload

    stored(graph, folder, name, 42 * GB)
    done = client.post(f"{API}/complete-upload", json={"upload_token": body["upload_token"], "drive_item_id": "ITEM1", "folder_type": "inquiry"}, headers=auth(user))
    assert done.status_code == 200, done.text
    doc = db.get(CrmDocument, done.json()["id"])
    assert doc.file_size == 42 * GB and doc.sharepoint_path == f"{folder}/{name}" and doc.related_id == 7


def test_limits_and_dangerous_types(client, db, graph):
    user = make_user(db, "crm.user2@premnathrail.com")
    too_big = start(client, user, file_size=101 * GB)
    assert too_big.status_code == 413 and "100 GB" in too_big.json()["detail"]
    html = start(client, user, file_name="evil.html", content_type="text/html")
    assert html.status_code == 400


def test_size_mismatch_or_fake_content_is_rejected_and_deleted(client, db, graph):
    user = make_user(db, "crm.user3@premnathrail.com")
    body = start(client, user, file_size=5 * GB).json()
    folder, name = graph["sessions"][0]

    stored(graph, folder, name, 3 * GB)  # upload cut short
    r = client.post(f"{API}/complete-upload", json={"upload_token": body["upload_token"], "drive_item_id": "ITEM1", "folder_type": "inquiry"}, headers=auth(user))
    assert r.status_code == 400 and "incomplete" in r.json()["detail"]
    assert graph["deleted"] == ["ITEM1"]

    stored(graph, folder, name, 5 * GB, head=b"MZ\x90\x00 not a pdf")
    r = client.post(f"{API}/complete-upload", json={"upload_token": body["upload_token"], "drive_item_id": "ITEM1", "folder_type": "inquiry"}, headers=auth(user))
    assert r.status_code == 400 and "does not match its file type" in r.json()["detail"]
    assert db.query(CrmDocument).count() == 0


def test_token_is_bound_to_the_user(client, db, graph):
    alice, bob = make_user(db, "alice@premnathrail.com"), make_user(db, "bob@premnathrail.com")
    body = start(client, alice).json()
    folder, name = graph["sessions"][0]
    stored(graph, folder, name, 42 * GB)
    r = client.post(f"{API}/complete-upload", json={"upload_token": body["upload_token"], "drive_item_id": "ITEM1", "folder_type": "inquiry"}, headers=auth(bob))
    assert r.status_code == 403
    bad = client.post(f"{API}/complete-upload", json={"upload_token": "garbage", "drive_item_id": "ITEM1", "folder_type": "inquiry"}, headers=auth(alice))
    assert bad.status_code == 400
