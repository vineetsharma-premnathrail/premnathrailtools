from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.crm.routes import documents as documents_routes


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


def make_org(client, user, name="Doc Org"):
    return client.post("/api/v1/crm/organizations", json={"name": name}, headers=auth_header(user)).json()


def make_inquiry(client, user, org_id):
    return client.post("/api/v1/crm/inquiries", json={"org_id": org_id}, headers=auth_header(user)).json()


def test_upload_requires_sharepoint_config(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")

    user = make_user(db, "crmdoc1@premnathrail.com")
    org = make_org(client, user)
    inquiry = make_inquiry(client, user, org["id"])

    response = client.post(
        "/api/v1/crm/documents",
        data={"related_module": "inquiry", "related_id": inquiry["id"], "folder_type": "client"},
        files={"files": ("spec.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        headers=auth_header(user),
    )
    assert response.status_code == 503


def test_upload_list_and_delete_document(client, db, monkeypatch):
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

    monkeypatch.setattr(documents_routes, "upload_file_to_sharepoint", fake_upload)
    monkeypatch.setattr(documents_routes, "delete_file_from_sharepoint", fake_delete)

    user = make_user(db, "crmdoc2@premnathrail.com")
    org = make_org(client, user, "Doc Org 2")
    inquiry = make_inquiry(client, user, org["id"])

    upload_response = client.post(
        "/api/v1/crm/documents",
        data={
            "related_module": "inquiry",
            "related_id": inquiry["id"],
            "folder_type": "client",
            "doc_category": "RFQ",
            "universal_id": inquiry["universal_id"],
            "org_id": org["id"],
        },
        files={"files": ("spec.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        headers=auth_header(user),
    )
    assert upload_response.status_code == 200
    uploaded = upload_response.json()
    assert len(uploaded) == 1
    doc = uploaded[0]
    assert doc["file_name"] == "spec.pdf"
    assert doc["doc_category"] == "RFQ"
    assert doc["folder_type"] == "client"
    assert doc["sharepoint_url"] == "https://sharepoint.example/spec.pdf"

    list_response = client.get(
        "/api/v1/crm/documents",
        params={"related_module": "inquiry", "related_id": inquiry["id"]},
        headers=auth_header(user),
    )
    assert list_response.status_code == 200
    assert any(d["id"] == doc["id"] for d in list_response.json())

    delete_response = client.delete(f"/api/v1/crm/documents/{doc['id']}", headers=auth_header(user))
    assert delete_response.status_code == 200

    list_after_delete = client.get(
        "/api/v1/crm/documents",
        params={"related_module": "inquiry", "related_id": inquiry["id"]},
        headers=auth_header(user),
    )
    assert all(d["id"] != doc["id"] for d in list_after_delete.json())


def test_upload_multiple_files_creates_multiple_documents(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    async def fake_upload(site_id, folder_path, upload_file):
        return {"name": upload_file.filename, "path": f"{folder_path}/{upload_file.filename}", "webUrl": None, "size": 10}

    monkeypatch.setattr(documents_routes, "upload_file_to_sharepoint", fake_upload)

    user = make_user(db, "crmdoc3@premnathrail.com")
    org = make_org(client, user, "Doc Org 3")
    inquiry = make_inquiry(client, user, org["id"])

    response = client.post(
        "/api/v1/crm/documents",
        data={"related_module": "inquiry", "related_id": inquiry["id"], "folder_type": "internal"},
        files=[
            ("files", ("a.pdf", b"content a", "application/pdf")),
            ("files", ("b.pdf", b"content b", "application/pdf")),
        ],
        headers=auth_header(user),
    )
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_documents_requires_crm_access(client, db):
    user = make_user(db, "crmdocnoaccess@premnathrail.com", assigned_apps=[])
    response = client.get(
        "/api/v1/crm/documents",
        params={"related_module": "inquiry", "related_id": 1},
        headers=auth_header(user),
    )
    assert response.status_code == 403


def test_delete_nonexistent_document_returns_404(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    user = make_user(db, "crmdoc4@premnathrail.com")
    response = client.delete("/api/v1/crm/documents/999999", headers=auth_header(user))
    assert response.status_code == 404


def test_deleted_document_excluded_from_tender_list(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    async def fake_upload(site_id, folder_path, upload_file):
        return {"name": upload_file.filename, "path": f"{folder_path}/{upload_file.filename}", "webUrl": None, "size": 5}

    monkeypatch.setattr(documents_routes, "upload_file_to_sharepoint", fake_upload)

    user = make_user(db, "crmdoc5@premnathrail.com")
    org = make_org(client, user, "Doc Org 5")
    tender = client.post("/api/v1/crm/tenders", json={"org_id": org["id"]}, headers=auth_header(user)).json()

    upload_response = client.post(
        "/api/v1/crm/documents",
        data={"related_module": "tender", "related_id": tender["id"], "folder_type": "client"},
        files={"files": ("boq.xlsx", b"fake xlsx", "application/vnd.ms-excel")},
        headers=auth_header(user),
    )
    assert upload_response.status_code == 200

    list_response = client.get(
        "/api/v1/crm/documents",
        params={"related_module": "tender", "related_id": tender["id"]},
        headers=auth_header(user),
    )
    assert len(list_response.json()) == 1
