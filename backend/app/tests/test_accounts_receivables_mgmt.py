"""FI receivables management (sap-gap-analysis.json "fi"):

  S_ALR_87012078/87012168  key-date aging: open items as of a past date
  FD32 / UKM               credit exposure, block on SO confirmation / dispatch,
                           release through the central approval engine
  F150 / FSCM Collections  worklist, dunning run + letters, promises to pay
  FSCM Dispute Mgmt        disputed amounts apart in aging, out of dunning,
                           resolved by credit note / write-off
"""
from datetime import date, timedelta

import pytest

from app.modules.accounts import reports
from app.modules.accounts.models.collections import AccountsCreditRelease, AccountsDispute
from app.modules.accounts.services import collections as coll
from app.modules.accounts.services import credit, disputes, outstanding, vouchers
from app.modules.accounts.services.balances import party_balance
from app.modules.accounts.receivables_access import ET_CREDIT_RELEASE
from app.modules.main.models.user import User
from app.tests.test_accounts_finance import books, _capital, _sale  # noqa: F401 — `books` is a fixture
from app.tests.test_accounts_payment_differences import fi, _h, _decide, MIG  # noqa: F401

TODAY = date.today()


def _receipt(b, customer, amount, inv, d):
    return vouchers.create_voucher(b["db"], payment_type="customer", bank_account_id=b["bank"].id, amount=amount,
                                   payment_mode="neft", payment_date=d, customer_id=customer.id, created_by_id=b["checker"].id,
                                   allocations=[{"target_type": "ar_transaction", "target_id": inv.id, "amount": amount}])


# ── Key-date aging ───────────────────────────────────────────────────────

def test_key_date_aging_uses_amounts_open_on_that_date(fi):
    db, cust = fi["db"], fi["c_local"]
    inv1 = _sale(fi, cust, 100000, d=date(2026, 7, 15))     # 118,000, due 14-Aug
    _receipt(fi, cust, 18000, inv1, date(2026, 8, 10))       # before key date
    _receipt(fi, cust, 50000, inv1, date(2026, 9, 10))       # after key date — added back
    _sale(fi, cust, 10000, d=date(2026, 9, 5))               # posted after key date — excluded
    db.commit()
    key = date(2026, 8, 31)
    docs = outstanding.open_documents(db, party_type="customer", party_id=cust.id, as_of=key)
    assert [(d["id"], d["amount_due"]) for d in docs] == [(inv1.id, 100000)]
    assert docs[0]["days_overdue"] == (key - inv1.due_date).days and docs[0]["bucket"] == "1_30"
    # Ties to the ledger on the key date.
    summary = outstanding.party_outstanding(db, party_type="customer", as_of=key)
    row = next(r for r in summary["rows"] if r["party_id"] == cust.id)
    assert row["net"] == party_balance(db, as_of=key, customer_id=cust.id) == 100000
    # Today's view is unaffected (50,000 due on inv1 + 11,800 on the later one).
    today_docs = outstanding.open_documents(db, party_type="customer", party_id=cust.id)
    assert sorted(d["amount_due"] for d in today_docs) == [11800, 50000]
    aging = reports.get_ar_aging(db, as_of=key)
    assert aging["total_due"] == 100000 and aging["as_of"] == key


def test_key_date_counts_voucher_cancelled_later_as_credit(fi):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 10000, d=date(2026, 7, 15))
    r = _receipt(fi, cust, 11800, inv, date(2026, 8, 1))
    db.commit()
    vouchers.cancel_voucher(db, payment_id=r.id, reason="cheque bounced", user_id=fi["checker"].id, cancel_date=date(2026, 9, 5))
    db.commit()
    key = date(2026, 8, 31)
    row = next(x for x in outstanding.party_outstanding(db, party_type="customer", as_of=key)["rows"] if x["party_id"] == cust.id)
    assert row["net"] == party_balance(db, as_of=key, customer_id=cust.id) == 0


# ── Disputes ─────────────────────────────────────────────────────────────

def test_dispute_shown_apart_in_aging_and_resolved_by_write_off(fi):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 10000, d=TODAY - timedelta(days=60))  # 11,800, 30 days overdue
    db.commit()
    with pytest.raises(ValueError, match="only"):
        disputes.create_dispute(db, ar_transaction_id=inv.id, disputed_amount=20000, reason="ld", description="LD",
                                owner_user_id=None, created_by_id=fi["maker"].id)
    d = disputes.create_dispute(db, ar_transaction_id=inv.id, disputed_amount=1800, reason="ld",
                                description="LD deducted for 2 weeks", owner_user_id=None, created_by_id=fi["maker"].id)
    db.commit()
    row = next(r for r in outstanding.party_outstanding(db, party_type="customer")["rows"] if r["party_id"] == cust.id)
    assert row["disputed"] == 1800 and row["overdue"] == 10000 and row["outstanding"] == 11800
    # Out of dunning / worklist amounts.
    items = coll.overdue_items(db, customer_id=cust.id)
    assert items[0]["undisputed_due"] == 10000
    # Resolve by write-off (checker is a Finance Manager).
    disputes.resolve_dispute(db, d, resolution="write_off", note="Agreed LD", user=fi["checker"])
    db.commit()
    db.refresh(inv)
    assert d.status == "written_off" and inv.amount_due == 10000 and d.settlement_adjustment_id


def test_dispute_resolution_needs_matching_credit_note(fi):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 10000, d=TODAY - timedelta(days=40))
    d = disputes.create_dispute(db, ar_transaction_id=inv.id, disputed_amount=500, reason="price", description="rate",
                                owner_user_id=None, created_by_id=fi["maker"].id)
    with pytest.raises(ValueError, match="credit note"):
        disputes.resolve_dispute(db, d, resolution="credit_note", note="x", user=fi["checker"])
    with pytest.raises(ValueError, match="resolution note"):
        disputes.resolve_dispute(db, d, resolution="paid", note=" ", user=fi["checker"])
    disputes.resolve_dispute(db, d, resolution="paid", note="Customer withdrew the claim", user=fi["checker"])
    assert d.status == "resolved_paid"


# ── Dunning / collections ────────────────────────────────────────────────

def test_dunning_run_levels_letters_and_dispute_exclusion(fi):
    db, cust, other = fi["db"], fi["c_local"], fi["c_other"]
    old = _sale(fi, cust, 100000, d=TODAY - timedelta(days=30 + 45))   # 45 days overdue -> level 2
    _sale(fi, cust, 10000, d=TODAY - timedelta(days=30 + 10))          # 10 days overdue -> level 1
    disputed = _sale(fi, other, 10000, d=TODAY - timedelta(days=60 + 20))  # fully disputed
    disputes.create_dispute(db, ar_transaction_id=disputed.id, disputed_amount=disputed.amount_due, reason="quality",
                            description="failed", owner_user_id=None, created_by_id=fi["maker"].id)
    db.commit()
    prop = coll.dunning_proposal(db)
    assert [p["customer_id"] for p in prop] == [cust.id] and prop[0]["level"] == 2
    letters = coll.run_dunning(db, user_id=fi["checker"].id)
    db.commit()
    assert len(letters) == 1 and letters[0].dunning_level == 2 and letters[0].total_overdue == 118000 + 11800
    db.refresh(old)
    assert old.dunning_level == 2
    assert coll.dunning_proposal(db) == []  # nothing new to raise today
    spec = coll.letter_spec(db, letters[0])
    assert spec["title"] == "SECOND REMINDER" and len(spec["sections"][0]["rows"]) == 3
    from app.modules.quality.reports.render import render_docx
    assert render_docx(spec)[:2] == b"PK"
    coll.cancel_letter(db, letters[0], "paid before sending")
    db.refresh(old)
    assert old.dunning_level == 0
    wl = coll.worklist(db)
    assert [r["customer_id"] for r in wl] == [cust.id] and wl[0]["priority"] in ("medium", "high")


def test_promise_to_pay_kept_and_broken(fi):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 10000, d=TODAY - timedelta(days=50))
    db.commit()
    with pytest.raises(ValueError, match="promised date"):
        coll.add_note(db, customer_id=cust.id, note_type="promise_to_pay", remarks="will pay", created_by_id=fi["maker"].id)
    kept = coll.add_note(db, customer_id=cust.id, note_type="promise_to_pay", remarks="will pay 5k", ar_transaction_id=inv.id,
                         note_date=TODAY - timedelta(days=5), promised_date=TODAY - timedelta(days=2), promised_amount=5000,
                         created_by_id=fi["maker"].id)
    broken = coll.add_note(db, customer_id=cust.id, note_type="promise_to_pay", remarks="rest", note_date=TODAY - timedelta(days=5),
                           promised_date=TODAY - timedelta(days=1), promised_amount=99999, created_by_id=fi["maker"].id)
    _receipt(fi, cust, 5000, inv, TODAY - timedelta(days=3))
    db.commit()
    newly_broken = coll.refresh_promises(db)
    assert kept.promise_status == "kept" and broken.promise_status == "broken" and newly_broken == [broken]
    assert kept.follow_up_date == kept.promised_date


# ── Credit management ────────────────────────────────────────────────────

def test_credit_exposure_and_overdue_block(fi):
    db, cust = fi["db"], fi["c_local"]
    cust.credit_limit = 50000
    _sale(fi, cust, 10000, d=TODAY - timedelta(days=5))  # 11,800 not yet due
    db.commit()
    pos = credit.credit_exposure(db, cust.id)
    assert pos["open_ar"] == 11800 and pos["exposure"] == 11800 and not pos["would_block"]
    _sale(fi, cust, 10000, d=TODAY - timedelta(days=40))  # overdue
    db.commit()
    pos = credit.credit_check(db, cust.id, "dispatch")
    assert pos["blocked"] and "overdue" in pos["block_reasons"][0]
    with pytest.raises(credit.CreditBlocked, match="credit hold"):
        credit.ensure_credit_ok(db, cust.id, "dispatch", what="Dispatch")


def test_credit_release_via_engine(fi, client):
    db, cust = fi["db"], fi["c_local"]
    cust.credit_limit = 5000
    _sale(fi, cust, 10000, d=TODAY - timedelta(days=5))  # over limit
    db.commit()
    r = client.post("/api/v1/accounts/credit/releases", headers=_h(fi["maker"]),
                    json={"customer_id": cust.id, "checkpoint": "dispatch", "reason": "Payment confirmed for Friday"})
    assert r.status_code == 201, r.text
    rel = r.json()
    assert rel["status"] == "pending_approval"
    # Requester can't approve own request; approval needs a comment.
    assert _decide(client, fi["maker"], ET_CREDIT_RELEASE, rel["id"], comment="ok").status_code == 403
    assert _decide(client, fi["checker"], ET_CREDIT_RELEASE, rel["id"], comment="Confirmed with customer").status_code == 200
    db.expire_all()
    row = db.get(AccountsCreditRelease, rel["id"])
    assert row.status == "released" and row.valid_until >= TODAY
    assert not credit.credit_check(db, cust.id, "dispatch")["blocked"]
    assert credit.credit_check(db, cust.id, "so_confirmation")["blocked"]  # other checkpoint still held
    pos = client.get(f"/api/v1/accounts/credit/customers/{cust.id}", params={"checkpoint": "dispatch"}, headers=_h(fi["checker"]))
    assert pos.status_code == 200 and pos.json()["release"]["release_number"] == row.release_number


def test_routes_collections_and_disputes(fi, client):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 10000, d=TODAY - timedelta(days=60))
    db.commit()
    h = _h(fi["checker"])
    d = client.post("/api/v1/accounts/disputes", headers=h, json={"ar_transaction_id": inv.id, "disputed_amount": 800,
                                                                  "reason": "quantity", "description": "1 item short"})
    assert d.status_code == 201, d.text
    assert client.get("/api/v1/accounts/disputes", params={"status": "open_all"}, headers=h).json()[0]["invoice_number"] == inv.invoice_number
    wl = client.get("/api/v1/accounts/collections/worklist", headers=h).json()
    assert wl["rows"][0]["overdue_amount"] == 11000 and wl["rows"][0]["disputed"] == 800
    run = client.post("/api/v1/accounts/collections/dunning-run", headers=h, json={})
    assert run.status_code == 201, run.text
    again = client.post("/api/v1/accounts/collections/dunning-run", headers=h, json={})
    assert again.status_code == 409 and "Nothing to remind" in again.json()["detail"]
    n = client.post("/api/v1/accounts/collections/notes", headers=h, json={"customer_id": cust.id, "note_type": "call",
                                                                            "remarks": "Spoke to AO, bill under process"})
    assert n.status_code == 201
    assert client.get("/api/v1/accounts/outstanding", params={"party_type": "customer", "as_of": str(TODAY - timedelta(days=1))},
                      headers=h).status_code == 200
    assert db.query(AccountsDispute).count() == 1
