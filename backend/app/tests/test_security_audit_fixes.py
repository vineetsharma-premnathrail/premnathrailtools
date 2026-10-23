"""Regression tests for the 2026-10-23 authentication / authorization audit
fixes that live outside a single module's workflow tests:

* upload validation compares the base Content-Type ("text/html; charset=…"
  is still HTML) and blocks XML; dot-only SharePoint path segments;
* user-typed text is HTML-escaped in outgoing emails;
* the in-memory presence store only takes known record types;
* GET /sales/proforma needs Finance › Sales Invoices (not just any Finance tab);
* Quality controlled-document upload needs Quality › Documents 'Create'.
"""
from app.core.permission_words import place
import asyncio
import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.utils import email as email_mod
from app.utils.sharepoint import _validate_uploaded_file, sanitize_folder_name


def make_user(db, email, grants=(), apps=None):
    """`grants` builds a roles-era user (deny by default, only these grants);
    `apps` builds a legacy full-module user (tests/conftest.py shim)."""
    user = User(email=email, name=email.split("@")[0], role="user", is_active=True,
                assigned_apps=list(apps or []), granular_permissions=list(grants))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _upload(name, content_type, data=b"hello"):
    return SimpleNamespace(filename=name, content_type=content_type, file=io.BytesIO(data))


# ── uploads ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("content_type", [
    "text/html; charset=utf-8", "TEXT/HTML", "text/xml", "application/xml", "application/javascript",
])
def test_upload_with_html_or_xml_content_type_is_rejected(content_type):
    """A '.txt' (allowed extension, no signature check) sent as HTML/XML used
    to pass and was then served back inline with that type."""
    with pytest.raises(HTTPException) as exc:
        _validate_uploaded_file(_upload("notes.txt", content_type))
    assert exc.value.status_code == 400 and "not allowed" in exc.value.detail


def test_plain_text_upload_still_allowed():
    assert _validate_uploaded_file(_upload("notes.txt", "text/plain; charset=utf-8")) == 5


@pytest.mark.parametrize("value,expected", [("..", "--"), (".", "-"), ("...", "---"), ("Pvt. Ltd.", "Pvt. Ltd."),
                                            ("a/../b", "a-..-b")])
def test_folder_segment_can_never_be_a_relative_step(value, expected):
    assert sanitize_folder_name(value) == expected


# ── email escaping ───────────────────────────────────────────────────────
@pytest.fixture
def sent(monkeypatch):
    mails = []

    async def fake_send(sender, subject, html, to_email, to_name, *a, **kw):
        mails.append(html)
        return True, None

    monkeypatch.setattr(email_mod.settings, "SENDER_EMAIL", "erp@premnathrail.com")
    monkeypatch.setattr(email_mod, "_send_graph_mail", fake_send)
    return mails


EVIL = '<a href="https://evil.example">Pay here</a>'


def test_client_sr_email_escapes_reported_by_name(db, sent):
    sr = SimpleNamespace(id=1, reported_by_email="client@example.com", reported_by_name=EVIL, request_number="SR-1",
                         issue_title="Pump", created_at=None)
    asyncio.run(email_mod.send_client_sr_email(db, sr, None, 1, "Tester", "created"))
    assert EVIL not in sent[0] and "&lt;a href=" in sent[0]


def test_purchase_requisition_email_escapes_material_names(db, sent):
    pr = SimpleNamespace(requested_by_id=None, created_at=None, p2p_number="PR-1")
    sr = SimpleNamespace(id=1, project_id=1, request_number="SR-1")
    mat = SimpleNamespace(material_name=EVIL, quantity=2, unit="<b>nos</b>")
    asyncio.run(email_mod.send_purchase_requisition_email(db, pr, sr, None, [mat], ["buyer@premnathrail.com"]))
    assert EVIL not in sent[0] and "<b>nos</b>" not in sent[0] and "&lt;b&gt;nos&lt;/b&gt;" in sent[0]


def test_tor_email_escapes_reference_document_names(db, monkeypatch, sent):
    monkeypatch.setattr(email_mod.settings, "RND_EMAIL", "rnd@premnathrail.com")
    asyncio.run(email_mod.send_technical_offer_request_email(
        db, "inquiry", 1, "TOR-1", "INQ-1", "Org", "Project", "", None, "BD",
        reference_documents=[{"url": 'https://x" onmouseover="alert(1)', "name": EVIL}]))
    assert EVIL not in sent[0] and 'x" onmouseover' not in sent[0]


# ── presence ─────────────────────────────────────────────────────────────
def test_presence_only_accepts_known_record_types(client, db):
    user = make_user(db, "presence.user@premnathrail.com", apps=["erp"])
    bad = client.post("/api/v1/presence/heartbeat", json={"resource_type": "x" * 5000, "resource_id": 1}, headers=auth(user))
    assert bad.status_code == 422
    ok = client.post("/api/v1/presence/heartbeat", json={"resource_type": "project", "resource_id": 1}, headers=auth(user))
    assert ok.status_code == 204


# ── Sales › proforma lookup ──────────────────────────────────────────────
def test_proforma_lookup_needs_sales_invoices_not_any_finance_tab(client, db):
    """It used to accept any Finance tab and then return every PI unscoped."""
    gst_clerk = make_user(db, "gst.clerk@premnathrail.com", grants=["accounts:gst:view"])
    resp = client.get("/api/v1/sales/proforma", headers=auth(gst_clerk))
    assert resp.status_code == 403 and place("accounts:sales_invoices:view").split(" › ")[-1] in resp.json()["detail"]
    billing = make_user(db, "billing@premnathrail.com", grants=["accounts:sales_invoices:view"])
    assert client.get("/api/v1/sales/proforma", headers=auth(billing)).status_code == 200


def test_proforma_lookup_needs_proforma_feature_for_sales_users(client, db):
    # A customised role (a feature picked) no longer inherits the others — no Proforma here.
    viewer = make_user(db, "so.viewer@premnathrail.com", grants=["sales:orders:view", "sales:orders.lines:view"])
    assert "sales:orders.proforma:view" not in viewer.effective_permissions
    resp = client.get("/api/v1/sales/proforma", headers=auth(viewer))
    assert resp.status_code == 403 and place("sales:orders.proforma:view").split(" › ")[-1] in resp.json()["detail"]
    full = make_user(db, "so.full@premnathrail.com", grants=["sales:orders:view"])  # inherits proforma + prices
    assert client.get("/api/v1/sales/proforma", headers=auth(full)).status_code == 200


# ── Quality › controlled documents ───────────────────────────────────────
def test_quality_document_upload_needs_documents_create(client, db):
    viewer = make_user(db, "q.viewer@premnathrail.com", grants=["quality:documents:view"])
    files = {"files": ("proc.pdf", b"%PDF-1.4 x", "application/pdf")}
    resp = client.post("/api/v1/quality/documents", data={"doc_type": "procedure", "title": "Fake SOP"},
                       files=files, headers=auth(viewer))
    assert resp.status_code == 403 and place("quality:documents:create").split(" › ")[-1] in resp.json()["detail"]
