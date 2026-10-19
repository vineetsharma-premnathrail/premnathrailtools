"""Finance RBAC: tab permissions are enforced (deny by default) and deleting
follows the company rule — 'Delete' on the tab AND only your own record."""
from datetime import date

from app.modules.main.models.user import User
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts import service
from app.tests.test_accounts_finance import books, _headers  # noqa: F401  (books is a fixture)


def _user(db, email, grants):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True, granular_permissions=grants)
    db.add(u)
    db.commit()
    return u


def _vendor_payload(code):
    return {"code": code, "name": f"Vendor {code}", "gst_registration_type": "unregistered"}


def test_view_only_user_cannot_create_edit_or_delete(client, books):
    db = books["db"]
    viewer = _user(db, "viewer@premnathrail.com", ["accounts:vendors:view", "accounts:journal_vouchers:view"])
    h = _headers(viewer)
    assert client.get("/api/v1/accounts/vendors", headers=h).status_code == 200
    r = client.post("/api/v1/accounts/vendors", headers=h, json=_vendor_payload("V-X1"))
    assert r.status_code == 403 and "'create' permission" in r.json()["detail"].lower()
    v = books["v_local"]
    assert client.patch(f"/api/v1/accounts/vendors/{v.id}", headers=h, json={"city": "Pune"}).status_code == 403
    r = client.delete(f"/api/v1/accounts/vendors/{v.id}", headers=h)
    assert r.status_code == 403 and "'delete' permission" in r.json()["detail"].lower()
    # Journals: may list, may not draft or post.
    assert client.get("/api/v1/accounts/journal-entries", headers=h).status_code == 200
    r = client.post("/api/v1/accounts/journal-entries", headers=h, json={
        "posting_date": date.today().isoformat(), "description": "x", "posting_type": "manual", "lines": []})
    assert r.status_code == 403
    # A tab the user holds nothing on.
    assert client.get("/api/v1/accounts/ar-transactions", headers=h).status_code == 403


def test_delete_is_limited_to_own_records(client, books):
    db = books["db"]
    grants = ["accounts:vendors:view", "accounts:vendors:create", "accounts:vendors:delete"]
    alice = _user(db, "alice@premnathrail.com", grants)
    bob = _user(db, "bob@premnathrail.com", grants)
    r = client.post("/api/v1/accounts/vendors", headers=_headers(alice), json=_vendor_payload("V-AL"))
    assert r.status_code == 201, r.text
    vid = r.json()["id"]
    assert r.json()["created_by_id"] == alice.id
    denied = client.delete(f"/api/v1/accounts/vendors/{vid}", headers=_headers(bob))
    assert denied.status_code == 403 and "created yourself" in denied.json()["detail"]
    ok = client.delete(f"/api/v1/accounts/vendors/{vid}", headers=_headers(alice))
    assert ok.status_code == 200, ok.text
    assert db.query(Vendor).filter(Vendor.id == vid).first() is None


def test_discarding_a_draft_journal_is_a_delete(client, books):
    db, gl = books["db"], books["gl"]
    grants = ["accounts:journal_vouchers:view", "accounts:journal_vouchers:delete"]
    alice = _user(db, "alice2@premnathrail.com", grants)
    bob = _user(db, "bob2@premnathrail.com", grants)
    draft = service.create_draft_journal(db, posting_date=date(2026, 6, 30), posting_type="accrual", created_by_id=alice.id, lines=[
        {"gl_account_id": gl["5200"].id, "debit_amount": 100}, {"gl_account_id": gl["1121"].id, "credit_amount": 100}])
    db.commit()
    assert client.post(f"/api/v1/accounts/journal-entries/{draft.id}/discard", headers=_headers(bob)).status_code == 403
    ok = client.post(f"/api/v1/accounts/journal-entries/{draft.id}/discard", headers=_headers(alice))
    assert ok.status_code == 200, ok.text
    db.expire_all()
    assert db.query(JournalEntry).get(draft.id).status == "cancelled"


def test_vendor_lookup_open_to_procurement_users(client, books):
    buyer = _user(books["db"], "buyer@premnathrail.com", ["p2p:*:view"])
    assert client.get("/api/v1/accounts/vendors", headers=_headers(buyer)).status_code == 200
    assert client.post("/api/v1/accounts/vendors", headers=_headers(buyer), json=_vendor_payload("V-B1")).status_code == 403
