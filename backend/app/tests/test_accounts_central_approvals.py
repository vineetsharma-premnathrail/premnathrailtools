"""Finance & Accounting on the central approval engine and data scope
(app/modules/accounts/access.py): journal submit → approve → posted,
return / reject, the AP 3-way-match variance stage, the period-end
processes, in-flight drafts and data scope on finance records."""
from app.core.data_scope import user_scope
from app.modules.accounts import access
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.tests.test_cov_controls_finance import (  # noqa: F401 — `books` is a fixture
    VI, _approved_po_with_grn, _bill, _h, _po_bill, books,
)

JE = "/api/v1/accounts/journal-entries"
APPR = "/api/v1/approvals"


def _draft_payload(b, amount=5000):
    gl = b["gl"]
    return {"posting_date": "2026-07-15", "posting_type": "adjustment", "description": "Provision for audit fee",
            "lines": [{"gl_account_id": gl["5210"].id, "debit_amount": amount},
                      {"gl_account_id": gl["2070"].id, "credit_amount": amount}]}


def _decide(client, user, entity_type, entity_id, decision, comment=None):
    st = client.get(f"{APPR}/entity/{entity_type}/{entity_id}", headers=_h(user)).json()
    return client.post(f"{APPR}/requests/{st['current']['id']}/decide", headers=_h(user),
                       json={"decision": decision, "comment": comment})


# ── Journals ────────────────────────────────────────────────────────────

def test_journal_submit_approve_posts(client, books):
    maker, checker = books["maker"], books["checker"]
    r = client.post(JE, headers=_h(maker), json=_draft_payload(books))
    assert r.status_code == 201, r.text
    jid = r.json()["id"]
    assert r.json()["status"] == "draft" and r.json()["approval_status"] is None

    sub = client.post(f"{JE}/{jid}/submit", headers=_h(maker))
    assert sub.status_code == 200, sub.text
    assert sub.json()["approval_status"] == "pending" and sub.json()["approval_stage"] == "Journal approver"
    again = client.post(f"{JE}/{jid}/submit", headers=_h(maker))
    assert again.status_code == 409 and "already waiting" in again.json()["detail"]

    # The maker is not among the approvers (maker-checker = no self approval).
    own = _decide(client, maker, access.ET_JOURNAL, jid, "approve")
    assert own.status_code == 403
    ok = _decide(client, checker, access.ET_JOURNAL, jid, "approve")
    assert ok.status_code == 200 and ok.json()["status"] == "approved"

    je = client.get(f"{JE}/{jid}", headers=_h(maker)).json()
    assert je["status"] == "posted" and je["entry_number"].startswith("JV/2026-27/")
    assert je["posted_by_name"] == checker.name and je["approval_status"] == "approved"


def test_journal_return_keeps_draft_and_reject_discards(client, books):
    maker, checker = books["maker"], books["checker"]
    jid = client.post(JE, headers=_h(maker), json=_draft_payload(books)).json()["id"]
    client.post(f"{JE}/{jid}/submit", headers=_h(maker))
    no_reason = _decide(client, checker, access.ET_JOURNAL, jid, "return")
    assert no_reason.status_code == 422
    assert _decide(client, checker, access.ET_JOURNAL, jid, "return", "Attach the audit engagement letter").status_code == 200
    je = client.get(f"{JE}/{jid}", headers=_h(maker)).json()
    assert je["status"] == "draft" and je["approval_status"] == "returned"

    assert client.post(f"{JE}/{jid}/submit", headers=_h(maker)).status_code == 200  # resubmission = revision 2
    assert _decide(client, checker, access.ET_JOURNAL, jid, "reject", "Already provided in June").status_code == 200
    assert client.get(f"{JE}/{jid}", headers=_h(maker)).json()["status"] == "cancelled"


def test_unsubmitted_draft_is_still_posted_by_one_click(client, books):
    """In-flight drafts (recorded before the engine, never submitted): the old
    Post button submits on the maker's behalf and approves in one go."""
    maker, checker = books["maker"], books["checker"]
    jid = client.post(JE, headers=_h(maker), json=_draft_payload(books)).json()["id"]
    own = client.post(f"{JE}/{jid}/post", headers=_h(maker))
    assert own.status_code == 403 and "another finance user" in own.json()["detail"]
    ok = client.post(f"{JE}/{jid}/post", headers=_h(checker))
    assert ok.status_code == 200 and ok.json()["status"] == "posted"
    req = engine.latest_request(books["db"], access.ET_JOURNAL, jid)
    assert req.requester_id == maker.id and req.status == "approved"


def test_discarding_a_submitted_draft_withdraws_its_approval(client, books):
    maker = books["maker"]
    jid = client.post(JE, headers=_h(maker), json=_draft_payload(books)).json()["id"]
    client.post(f"{JE}/{jid}/submit", headers=_h(maker))
    assert client.post(f"{JE}/{jid}/discard", headers=_h(maker)).status_code == 200
    assert engine.latest_request(books["db"], access.ET_JOURNAL, jid).status == "cancelled"


# ── Purchase invoices: 3-way-match variance stage ───────────────────────

def test_ap_variance_stage_then_posting(client, books):
    db, maker, checker, clerk = books["db"], books["maker"], books["checker"], books["clerk"]
    po = _approved_po_with_grn(db, number="CA1")
    inv = _po_bill(books, po, "INV-CA-1", qty=10, rate=100)  # 10 billed, 4 accepted → variance
    assert inv.matching_status == "variance"

    r = client.post(f"{VI}/{inv.id}/submit", headers=_h(maker))
    assert r.status_code == 200, r.text
    req = engine.latest_request(db, access.ET_VENDOR_INVOICE, inv.id)
    assert [s.stage_name for s in req.steps if s.sequence == 1] == ["3-way-match variance (Finance Manager)"]
    assert {s.approver_id for s in req.steps if s.sequence == 1} == {checker.id}  # FMs except the maker
    assert {s.approver_id for s in req.steps if s.sequence == 2} == {checker.id, clerk.id}

    assert _decide(client, clerk, access.ET_VENDOR_INVOICE, inv.id, "approve").status_code == 403  # not a Finance Manager
    assert _decide(client, checker, access.ET_VENDOR_INVOICE, inv.id, "approve").status_code == 200
    mid = client.get(f"{VI}/{inv.id}", headers=_h(maker)).json()
    assert mid["status"] == "pending" and mid["approval_stage"] == "Posting approver"
    assert _decide(client, clerk, access.ET_VENDOR_INVOICE, inv.id, "approve").status_code == 200

    out = client.get(f"{VI}/{inv.id}", headers=_h(maker)).json()
    assert out["status"] == "posted" and out["matching_status"] == "approved_variance"
    assert out["variance_approved_by_id"] == checker.id and out["journal_entry_number"].startswith("PI/")


def test_invoice_without_variance_skips_the_finance_manager_stage(client, books):
    inv = _bill(books, "PS/CA-2")
    assert inv.matching_status != "variance"
    client.post(f"{VI}/{inv.id}/submit", headers=_h(books["maker"]))
    req = engine.latest_request(books["db"], access.ET_VENDOR_INVOICE, inv.id)
    assert {s.stage_name for s in req.steps} == {"Posting approver"}
    assert _decide(client, books["clerk"], access.ET_VENDOR_INVOICE, inv.id, "approve").status_code == 200
    assert client.get(f"{VI}/{inv.id}", headers=_h(books["maker"])).json()["status"] == "posted"


# ── Period-end processes ────────────────────────────────────────────────

def test_finance_manager_closes_in_one_click_others_wait_for_one(client, books):
    db, checker, clerk = books["db"], books["checker"], books["clerk"]
    r = client.post("/api/v1/accounts/period-close/2026-07/close", headers=_h(checker), json={"notes": "July books final"})
    assert r.status_code == 200 and r.json()["status"] == "closed"

    r = client.post("/api/v1/accounts/period-close/2026-06/close", headers=_h(clerk), json={})
    assert r.status_code == 202 and r.json()["approval_status"] == "pending" and "cov.checker" in r.json()["message"]
    assert db.query(PeriodClose).filter(PeriodClose.accounting_period == "2026-06").first() is None
    assert _decide(client, checker, access.ET_PERIOD_CLOSE, 202606, "approve").status_code == 200
    db.expire_all()
    pc = db.query(PeriodClose).filter(PeriodClose.accounting_period == "2026-06").one()
    assert pc.status == "closed" and pc.closed_by_id == checker.id


# ── Data scope ──────────────────────────────────────────────────────────

def test_finance_records_follow_the_role_data_scope(client, books):
    db, maker = books["db"], books["maker"]
    role = Role(name="Accounts – own records", permissions=["accounts:*:*"], data_scopes={"accounts": "own"})
    db.add(role)
    scoped = User(email="ca.scoped@premnathrail.com", name="Scoped", role="user", is_active=True)
    db.add(scoped)
    db.commit()
    scoped.roles = [role]
    db.commit()
    assert user_scope(scoped, "accounts") == "own"

    mine = client.post(JE, headers=_h(scoped), json=_draft_payload(books)).json()["id"]
    theirs = client.post(JE, headers=_h(maker), json=_draft_payload(books)).json()["id"]
    listed = {e["id"] for e in client.get(JE, headers=_h(scoped)).json()}
    assert mine in listed and theirs not in listed
    blocked = client.get(f"{JE}/{theirs}", headers=_h(scoped))
    assert blocked.status_code == 403 and "Own records" in blocked.json()["detail"]
    # Organization-wide (default) users still see everything.
    assert {mine, theirs} <= {e["id"] for e in client.get(JE, headers=_h(maker)).json()}
    assert db.get(JournalEntry, theirs) is not None


def test_submit_cancel_grant_migration(db):
    from app.modules.accounts.migrations import migrate_accounts_submit_cancel_grants

    role = Role(name="Finance clerk", permissions=["accounts:journal_vouchers:view", "accounts:journal_vouchers:create",
                                                   "accounts:ledgers:create"])
    db.add(role)
    db.commit()
    assert migrate_accounts_submit_cancel_grants(db.connection()) == 1
    db.expire_all()
    assert set(db.get(Role, role.id).permissions) == {
        "accounts:journal_vouchers:view", "accounts:journal_vouchers:create", "accounts:ledgers:create",
        "accounts:journal_vouchers:submit", "accounts:journal_vouchers:cancel"}
    assert migrate_accounts_submit_cancel_grants(db.connection()) == 0  # idempotent
