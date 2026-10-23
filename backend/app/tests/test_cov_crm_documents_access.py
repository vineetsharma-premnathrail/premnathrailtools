"""Coverage: the two CRM document routes that depend only on sign-in
(get_current_user) instead of require_app_access("crm"):
GET /crm/documents/{id}/content and GET /crm/documents/{id}/download-url
(crm/routes/documents.py:193 and :240). They do their own check inline:
a normal CRM document needs the 'crm' app; a document shared via a Technical
Offer Request (shared_via_tor) is readable without 'crm' so R&D engineers
can open it. Also covers the public share-token route and uploader-only delete."""
from datetime import datetime, timezone

import pytest

from app.auth.jwt_handler import create_access_token, create_document_share_token
from app.core.config import settings
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.routes import documents as documents_routes
from app.modules.main.models.user import User

API = "/api/v1/crm/documents"


def make_user(db, email, role="user", apps=("crm",)):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def sp(monkeypatch):
    async def fake_download(site_id, path):
        return b"%PDF-1.4 bytes", "application/pdf"

    async def fake_url(site_id, path):
        return f"https://sp.example/download/{path}"

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "test-site")
    monkeypatch.setattr(documents_routes, "download_file_content", fake_download)
    monkeypatch.setattr(documents_routes, "get_download_url", fake_url)


@pytest.fixture
def docs(db):
    owner = make_user(db, "doc.owner@premnathrail.com")
    # The inquiry the documents hang off, already sent to R&D (a TOR exists).
    org = Organization(name="Doc Org", org_type="Customer")
    db.add(org)
    db.flush()
    inq = Inquiry(universal_id="INQ-DOC-1", org_id=org.id, created_by_id=owner.id, lead_source="Direct",
                  technical_offer_sent_at=datetime.now(timezone.utc))
    db.add(inq)
    db.flush()
    assert inq.id == 1  # the tests below address it as related_id=1
    private = CrmDocument(related_module="inquiry", related_id=1, folder_type="client", file_name="private.pdf",
                          file_path="p/private.pdf", sharepoint_path="p/private.pdf", mime_type="application/pdf",
                          created_by_id=owner.id)
    shared = CrmDocument(related_module="inquiry", related_id=1, folder_type="technical_offer", file_name="TOR-1.pdf",
                         file_path="p/TOR-1.pdf", sharepoint_path="p/TOR-1.pdf", mime_type="application/pdf",
                         created_by_id=owner.id, shared_via_tor=True)
    db.add_all([private, shared])
    db.commit()
    return {"owner": owner, "private": private, "shared": shared}


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_signed_in_routes_require_login(client, docs, sp, suffix):
    assert client.get(f"{API}/{docs['private'].id}/{suffix}").status_code == 401


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_private_doc_needs_crm_app(client, db, docs, sp, suffix):
    rnd = make_user(db, "rnd.eng@premnathrail.com", apps=("rnd",))
    resp = client.get(f"{API}/{docs['private'].id}/{suffix}", headers=auth(rnd))
    # Inquiry documents are the Inquiries & Tenders › Documents feature (core/features/crm.py).
    assert resp.status_code == 403 and "'View' permission on CRM › Inquiries & Tenders › Documents" in resp.json()["detail"]


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_crm_user_and_admin_read_private_doc(client, db, docs, sp, suffix):
    admin = make_user(db, "doc.admin@premnathrail.com", role="admin", apps=())
    for user in (docs["owner"], admin):
        resp = client.get(f"{API}/{docs['private'].id}/{suffix}", headers=auth(user))
        assert resp.status_code == 200, resp.text


def test_content_streams_bytes_with_filename(client, docs, sp):
    resp = client.get(f"{API}/{docs['private'].id}/content", headers=auth(docs["owner"]))
    assert resp.content == b"%PDF-1.4 bytes"
    assert 'filename="private.pdf"' in resp.headers["content-disposition"]
    url = client.get(f"{API}/{docs['private'].id}/download-url", headers=auth(docs["owner"])).json()
    assert url == {"url": "https://sp.example/download/p/private.pdf", "file_name": "private.pdf"}


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_rnd_engineer_reads_tor_shared_doc_without_crm(client, db, docs, sp, suffix):
    """Intended exception: the R&D assignee of a Technical Offer Request has no CRM access."""
    rnd = make_user(db, "rnd.reader@premnathrail.com", apps=("rnd",))
    assert client.get(f"{API}/{docs['shared'].id}/{suffix}", headers=auth(rnd)).status_code == 200


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_rnd_user_without_requirement_access_cannot_read_tor_shared_doc(client, db, docs, sp, monkeypatch, suffix):
    """Having the R&D app isn't enough once R&D heads are set: a member with no
    access to this requirement can't walk TOR document ids (security fix)."""
    from app.modules.rnd.services import requirement_access as ra
    head = make_user(db, "rnd.head@premnathrail.com", apps=("rnd",))
    member = make_user(db, "rnd.member@premnathrail.com", apps=("rnd",))
    monkeypatch.setattr(ra, "team_roles", lambda _db: {head.id: "head"})
    assert client.get(f"{API}/{docs['shared'].id}/{suffix}", headers=auth(member)).status_code == 403
    assert client.get(f"{API}/{docs['shared'].id}/{suffix}", headers=auth(head)).status_code == 200


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_crm_user_outside_scope_cannot_read_tor_shared_doc(client, db, docs, sp, suffix):
    """A TOR file still follows the inquiry's CRM data scope for CRM users."""
    other = make_user(db, "crm.own.scope@premnathrail.com")
    other.data_access_scopes = {"crm": "own"}
    db.commit()
    assert client.get(f"{API}/{docs['shared'].id}/{suffix}", headers=auth(other)).status_code == 403
    other.data_access_scopes = {"crm": "organization"}
    db.commit()
    assert client.get(f"{API}/{docs['shared'].id}/{suffix}", headers=auth(other)).status_code == 200


def test_upload_rejects_rnd_sub_modules_and_unknown_parents(client, db, docs, sp):
    """A CRM upload can't pose as an R&D task / discussion file, and must hang
    off a real organization / inquiry / tender (else the scope check is skipped)."""
    h = auth(docs["owner"])
    files = {"files": ("a.pdf", b"%PDF-1.4 x", "application/pdf")}
    base = {"related_module": "inquiry", "related_id": "1", "folder_type": "internal"}
    resp = client.post(API, data={**base, "related_sub_module": "rnd_task", "related_sub_id": "5"}, files=files, headers=h)
    assert resp.status_code == 422 and "R&D task" in resp.json()["detail"]
    resp = client.post(API, data={**base, "related_module": "secret"}, files=files, headers=h)
    assert resp.status_code == 422
    resp = client.post(API, data={**base, "related_id": "999"}, files=files, headers=h)
    assert resp.status_code == 404


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_user_without_crm_or_rnd_cannot_read_tor_shared_doc(client, db, docs, sp, suffix):
    store_clerk = make_user(db, "store.clerk@premnathrail.com", apps=("store",))
    assert client.get(f"{API}/{docs['shared'].id}/{suffix}", headers=auth(store_clerk)).status_code == 403


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_deleted_or_missing_doc_is_404(client, db, docs, sp, suffix):
    docs["private"].is_deleted = True
    db.commit()
    assert client.get(f"{API}/{docs['private'].id}/{suffix}", headers=auth(docs["owner"])).status_code == 404
    assert client.get(f"{API}/9999/{suffix}", headers=auth(docs["owner"])).status_code == 404


@pytest.mark.parametrize("suffix", ["content", "download-url"])
def test_sharepoint_not_configured_is_503(client, docs, monkeypatch, suffix):
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")
    resp = client.get(f"{API}/{docs['private'].id}/{suffix}", headers=auth(docs["owner"]))
    assert resp.status_code == 503 and "SharePoint" in resp.json()["detail"]


def test_shared_content_works_without_any_login(client, docs, sp):
    token = create_document_share_token("crm_document", docs["shared"].id)
    resp = client.get(f"{API}/{docs['shared'].id}/shared-content?token={token}")
    assert resp.status_code == 200


def test_shared_content_exemption_is_exact_path_only(client, docs):
    # The middleware exemption must not open neighbouring document routes.
    assert client.get(f"{API}/{docs['shared'].id}/content").status_code == 401
    assert client.get(f"{API}/{docs['shared'].id}/shared-content/extra").status_code == 401


def test_shared_content_token_is_scoped_to_one_document(client, docs, sp):
    # A Bearer header gets past the middleware pre-check; the route itself
    # ignores it and trusts only the signed token.
    h = auth(docs["owner"])
    token = create_document_share_token("crm_document", docs["shared"].id)
    resp = client.get(f"{API}/{docs['shared'].id}/shared-content?token={token}", headers=h)
    assert resp.status_code == 200 and resp.content == b"%PDF-1.4 bytes"
    # Same token, another document id -> refused.
    resp = client.get(f"{API}/{docs['private'].id}/shared-content?token={token}", headers=h)
    assert resp.status_code == 403 and "invalid or has expired" in resp.json()["detail"]
    # Token minted for another entity type -> refused.
    other = create_document_share_token("design_document", docs["shared"].id)
    assert client.get(f"{API}/{docs['shared'].id}/shared-content?token={other}", headers=h).status_code == 403
    assert client.get(f"{API}/{docs['shared'].id}/shared-content?token=garbage", headers=h).status_code == 403


def test_delete_only_uploader_or_admin(client, db, docs, sp):
    other = make_user(db, "doc.other@premnathrail.com")
    resp = client.delete(f"{API}/{docs['private'].id}", headers=auth(other))
    assert resp.status_code == 403 and "created yourself" in resp.json()["detail"]
    assert client.delete(f"{API}/{docs['private'].id}", headers=auth(docs["owner"])).status_code == 200
    assert client.get(f"{API}?related_module=inquiry&related_id=1", headers=auth(docs["owner"])).json()[0]["file_name"] == "TOR-1.pdf"


def test_upload_session_requires_crm_app(client, db, sp):
    rnd = make_user(db, "rnd.up@premnathrail.com", apps=("rnd",))
    resp = client.post(f"{API}/upload-session", json={"related_module": "inquiry", "related_id": 1, "file_name": "a.pdf", "file_size": 10}, headers=auth(rnd))
    assert resp.status_code == 403
