"""Technical Offer Request as an editable Word document.

The BD owner must create the TOR draft (and may edit it in Word) before
sending; the send then emails/stores SharePoint's PDF of that edited draft, files it under
the inquiry's Internal Documents, and the next send needs a fresh draft.
"""

from datetime import date, timedelta

from app.modules.crm.models.document import CrmDocument
from app.modules.crm.routes import inquiries as inquiry_routes
from app.tests.test_cov_crm_quotations_rnd import API, auth, make_inquiry, make_user
from app.tests.test_crm_quotation_documents import FakeSharePoint, sp  # noqa: F401 — fixture

DOCS = "/api/v1/managed-documents/crm_tor_inquiry"


def _send(client, inq_id, bd, rnd):
    return client.post(
        f"{API}/inquiries/{inq_id}/technical-offer-request",
        json={"response_due_date": (date.today() + timedelta(days=5)).isoformat()},
        headers=auth(bd),
    )


def _env(monkeypatch):
    emails = []

    async def fake_upload(site_id, folder, filename, content_type, data):
        return {"path": f"{folder}/{filename}", "webUrl": f"https://sp/{filename}", "size": len(data)}

    async def fake_email(db, **kwargs):
        emails.append(kwargs)
        return True, None

    monkeypatch.setattr(inquiry_routes, "upload_bytes_to_sharepoint", fake_upload)
    monkeypatch.setattr(inquiry_routes, "send_technical_offer_request_email", fake_email)
    return emails


def test_edited_word_draft_is_what_gets_sent_and_filed_internally(client, db, sp, monkeypatch):
    emails = _env(monkeypatch)
    bd = make_user(db, "tor.word.bd@premnathrail.com")
    rnd = make_user(db, "tor.word.rnd@premnathrail.com", apps=("rnd",))
    inq = make_inquiry(db, bd, product="RRV", product_spec="BG 1676")

    created = client.post(f"{DOCS}/{inq.id}", headers=auth(bd))
    assert created.status_code == 200, created.text
    assert client.post(f"{DOCS}/{inq.id}/edit", headers=auth(bd)).status_code == 200

    assert _send(client, inq.id, bd, rnd).status_code == 200
    assert emails[-1]["attachment_bytes"] == b"%PDF-from-word"  # the Word draft, not the system PDF

    doc = db.query(CrmDocument).filter(CrmDocument.related_id == inq.id).one()
    assert (doc.folder_type, doc.doc_category) == ("internal", "Technical Offer Request")
    assert doc.sharepoint_url and doc.shared_via_tor

    # The sent draft belongs to send #1 — the next send starts from a new draft.
    state = client.get(f"{DOCS}/{inq.id}", headers=auth(bd)).json()
    assert state["document"]["is_stale"] is True


def test_send_without_draft_is_refused(client, db, sp, monkeypatch):
    emails = _env(monkeypatch)
    bd = make_user(db, "tor.word.bd2@premnathrail.com")
    rnd = make_user(db, "tor.word.rnd2@premnathrail.com", apps=("rnd",))
    inq = make_inquiry(db, bd, uid="INQ-20261007-0002", product="RRV")
    resp = _send(client, inq.id, bd, rnd)
    assert resp.status_code == 400 and "Create the Technical Offer Word document first" in resp.json()["detail"]
    assert emails == [] and db.query(CrmDocument).count() == 0


def test_tor_needs_only_product_and_spec_or_requirement(client, db, sp, monkeypatch):
    _env(monkeypatch)
    bd = make_user(db, "tor.word.bd3@premnathrail.com")
    rnd = make_user(db, "tor.word.rnd3@premnathrail.com", apps=("rnd",))
    inq = make_inquiry(db, bd, uid="INQ-20261007-0003", product_spec=None)
    resp = _send(client, inq.id, bd, rnd)
    assert resp.status_code == 422 and "Specification or Requirement Description" in resp.json()["detail"]
    inq.requirement_desc = "Needs RDSO approval"  # no category / quantity — still fine
    db.commit()
    assert client.post(f"{DOCS}/{inq.id}", headers=auth(bd)).status_code == 200
    assert _send(client, inq.id, bd, rnd).status_code == 200
