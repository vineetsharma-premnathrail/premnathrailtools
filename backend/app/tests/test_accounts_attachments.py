"""Finance supporting documents (voucher proof): upload / list / delete on
journals, purchase invoices and payment vouchers, the Finance › Settings ›
Supporting documents rules (bill compulsory on purchase invoices, working on
manual journals, optional proof on payments) and the audit lock on posted
documents."""
import pytest

from app.core import settings_framework
from app.core.config import settings
from app.modules.accounts.models.attachment import FinanceAttachment
from app.modules.accounts import access
from app.tests.test_accounts_central_approvals import JE, _decide, _draft_payload
from app.tests.test_cov_controls_finance import VI, _bill, _h, books  # noqa: F401 — `books` is a fixture

pytestmark = pytest.mark.finance_proof

ATT = "/api/v1/accounts/attachments"
PAY = "/api/v1/accounts/payments"


@pytest.fixture(autouse=True)
def _fake_sharepoint(monkeypatch):
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "test-site")
    counter = {"n": 0}

    async def up(_site, folder, f):
        counter["n"] += 1
        return {"name": f.filename, "path": f"{folder}/{counter['n']}-{f.filename}", "webUrl": "https://sp/x", "size": 10}

    async def rm(_site, _path):
        return None

    monkeypatch.setattr("app.modules.accounts.routes.attachments.upload_file_to_sharepoint", up)
    monkeypatch.setattr("app.modules.accounts.routes.attachments.delete_file_from_sharepoint", rm)


def _upload(client, user, entity_type, entity_id, doc_type="other", name="proof.pdf"):
    return client.post(ATT, headers=_h(user), data={"entity_type": entity_type, "entity_id": str(entity_id), "doc_type": doc_type},
                       files=[("files", (name, b"%PDF-1.4", "application/pdf"))])


def test_journal_needs_working_before_submit_and_proof_locks_once_posted(client, books):
    maker, checker = books["maker"], books["checker"]
    jid = client.post(JE, headers=_h(maker), json=_draft_payload(books)).json()["id"]

    no_proof = client.post(f"{JE}/{jid}/submit", headers=_h(maker))
    assert no_proof.status_code == 400 and "Attach the working" in no_proof.json()["detail"]

    up = _upload(client, maker, "journal", jid, "working", "audit-fee-working.xlsx")
    assert up.status_code == 200, up.text
    att_id = up.json()[0]["id"]
    listed = client.get(ATT, headers=_h(checker), params={"entity_type": "journal", "entity_id": jid}).json()
    assert [a["filename"] for a in listed] == ["audit-fee-working.xlsx"]
    assert client.get(f"{ATT}/counts", headers=_h(checker), params={"entity_type": "journal", "ids": f"{jid},999"}).json() == {str(jid): 1}

    # Only the uploader (or an admin) removes a file.
    assert client.delete(f"{ATT}/{att_id}", headers=_h(checker)).status_code == 403

    assert client.post(f"{JE}/{jid}/submit", headers=_h(maker)).status_code == 200
    assert _decide(client, checker, access.ET_JOURNAL, jid, "approve").status_code == 200
    assert client.get(f"{JE}/{jid}", headers=_h(maker)).json()["status"] == "posted"

    # Posted: part of the audit trail — more proof may be added, none removed.
    locked = client.delete(f"{ATT}/{att_id}", headers=_h(maker))
    assert locked.status_code == 400 and "audit trail" in locked.json()["detail"]
    assert _upload(client, maker, "journal", jid).status_code == 200


def test_purchase_invoice_needs_the_bill_on_submit_and_on_approval(client, books):
    maker, checker = books["maker"], books["checker"]
    inv = _bill(books, "PS/101")
    r = client.post(f"{VI}/{inv.id}/submit", headers=_h(maker))
    assert r.status_code == 400 and "Attach the vendor's bill" in r.json()["detail"]

    att_id = _upload(client, maker, "vendor_invoice", inv.id, "bill").json()[0]["id"]
    assert client.post(f"{VI}/{inv.id}/submit", headers=_h(maker)).status_code == 200
    # Removing the bill while it waits for approval blocks the approval too.
    assert client.delete(f"{ATT}/{att_id}", headers=_h(maker)).status_code == 200
    blocked = _decide(client, checker, access.ET_VENDOR_INVOICE, inv.id, "approve")
    assert blocked.status_code == 400 and "Attach the vendor's bill" in blocked.json()["detail"]
    books["db"].rollback()  # a request's own session is discarded on error; tests share one
    assert client.get(f"{VI}/{inv.id}", headers=_h(maker)).json()["status"] == "pending"

    _upload(client, maker, "vendor_invoice", inv.id, "bill")
    assert _decide(client, checker, access.ET_VENDOR_INVOICE, inv.id, "approve").status_code == 200
    assert client.get(f"{VI}/{inv.id}", headers=_h(maker)).json()["status"] == "posted"


def test_rules_can_be_switched_off_in_settings(client, books):
    maker = books["maker"]
    settings_framework.save(books["db"], "accounts", {"proof_required_purchase_invoice": False}, maker)
    books["db"].commit()
    inv = _bill(books, "PS/102")
    assert client.post(f"{VI}/{inv.id}/submit", headers=_h(maker)).status_code == 200


def _receipt(books, **extra):
    return {"payment_type": "other_receipt", "bank_account_id": books["bank"].id, "amount": 2500, "payment_mode": "neft",
            "payment_date": "2026-07-20", "lines": [{"gl_account_id": books["gl"]["4100"].id, "amount": 2500}], **extra}


def test_payment_proof_is_staged_then_linked_when_the_rule_is_on(client, books):
    maker, checker = books["maker"], books["checker"]
    # Off by default: a voucher saves without a file.
    assert client.post(PAY, headers=_h(maker), json=_receipt(books)).status_code == 201

    settings_framework.save(books["db"], "accounts", {"proof_required_payment": True, "proof_required_payment_above": 1000}, maker)
    books["db"].commit()
    missing = client.post(PAY, headers=_h(maker), json=_receipt(books))
    assert missing.status_code == 400 and "above 1,000.00" in missing.json()["detail"]
    small = _receipt(books, amount=500, lines=[{"gl_account_id": books["gl"]["4100"].id, "amount": 500}])
    assert client.post(PAY, headers=_h(maker), json=small).status_code == 201

    staged = client.post(f"{ATT}/staged", headers=_h(maker), data={"doc_type": "bank_proof"},
                         files=[("files", ("utr.png", b"png", "image/png"))])
    assert staged.status_code == 200, staged.text
    sid = staged.json()[0]["id"]
    # Someone else's staged file can't be used.
    other = client.post(PAY, headers=_h(checker), json=_receipt(books, attachment_ids=[sid]))
    assert other.status_code == 400 and "no longer waiting" in other.json()["detail"]

    ok = client.post(PAY, headers=_h(maker), json=_receipt(books, attachment_ids=[sid]))
    assert ok.status_code == 201, ok.text
    row = books["db"].get(FinanceAttachment, sid)
    books["db"].refresh(row)
    assert (row.entity_type, row.entity_id) == ("payment", ok.json()["id"])
    # The voucher posted at once, so its proof is locked.
    assert client.delete(f"{ATT}/{sid}", headers=_h(maker)).status_code == 400


def test_bad_inputs_get_real_reasons(client, books):
    maker = books["maker"]
    assert "Invalid document type" in client.get(ATT, headers=_h(maker), params={"entity_type": "x", "entity_id": 1}).json()["detail"]
    assert client.get(ATT, headers=_h(maker), params={"entity_type": "journal", "entity_id": 9999}).status_code == 404
    jid = client.post(JE, headers=_h(maker), json=_draft_payload(books)).json()["id"]
    assert "Invalid document kind" in _upload(client, maker, "journal", jid, "selfie").json()["detail"]
