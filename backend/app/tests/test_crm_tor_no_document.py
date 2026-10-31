"""Send Technical Requirement to R&D without a Technical Offer document (owner, 2026-10-30).

No Word draft is needed and no PDF is made, emailed or filed: R&D gets the
requirement in R&D › Requirements; only the picked client documents are shared.
"""

from datetime import date, timedelta

from app.core.record_ref import encode_ref
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.routes import inquiries as inquiry_routes
from app.tests.test_cov_crm_quotations_rnd import API, auth, make_inquiry, make_user


def _send(client, inq_id, bd):
    return client.post(
        f"{API}/inquiries/{inq_id}/technical-offer-request",
        json={"response_due_date": (date.today() + timedelta(days=5)).isoformat()},
        headers=auth(bd),
    )


def _env(monkeypatch):
    emails = []

    async def fake_email(db, **kwargs):
        emails.append(kwargs)
        return True, None

    monkeypatch.setattr(inquiry_routes, "send_technical_offer_request_email", fake_email)
    return emails


def test_send_needs_no_word_draft_and_files_no_document(client, db, monkeypatch):
    emails = _env(monkeypatch)
    bd = make_user(db, "tor.nodoc.bd@premnathrail.com")
    make_user(db, "tor.nodoc.rnd@premnathrail.com", apps=("rnd",))
    inq = make_inquiry(db, bd, product="RRV", product_spec="BG 1676")

    resp = _send(client, inq.id, bd)
    assert resp.status_code == 200, resp.text
    assert "attachment_bytes" not in emails[-1]
    # The email names the due date and links to the requirement page, where R&D accepts it.
    assert emails[-1]["response_due_date"] == date.today() + timedelta(days=5)
    assert f"/dashboard/rnd/requirements/inquiry/{encode_ref(inq.id)}" in emails[-1]["open_link"]
    assert db.query(CrmDocument).filter(CrmDocument.related_id == inq.id).count() == 0
    # A re-send works the same way, again without a document.
    assert _send(client, inq.id, bd).status_code == 200


def test_tor_needs_only_product_and_spec(client, db, monkeypatch):
    _env(monkeypatch)
    bd = make_user(db, "tor.nodoc.bd3@premnathrail.com")
    make_user(db, "tor.nodoc.rnd3@premnathrail.com", apps=("rnd",))
    inq = make_inquiry(db, bd, uid="INQ-20261007-0003", product_spec=None, requirement_desc="Needs RDSO approval")
    resp = _send(client, inq.id, bd)
    # Requirement description is no longer used: it does not unblock the send.
    assert resp.status_code == 422 and "Fill Specification" in resp.json()["detail"]
    inq.product_spec = "Needs RDSO approval"  # no category / quantity — still fine
    db.commit()
    assert _send(client, inq.id, bd).status_code == 200
