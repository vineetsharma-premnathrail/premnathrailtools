"""Extra coverage for Organization → Company Info: one-time setup, admin-only
access, Partners (the only place is_partner is set), addresses/contacts
primary flag, financial years, and audit rows written on change."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User

API = "/api/v1/organization/company"


def make_user(db, email, role="user", active=True, **flags):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=active, assigned_apps=["erp"], **flags)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def setup_company(client, admin, **extra):
    r = client.post(API, json={"name": "Premnath Rail", "code": "PRT", **extra}, headers=auth(admin))
    assert r.status_code == 201, r.text
    return r.json()


def audit_rows(db, entity_type, action=None):
    q = db.query(AuditLog).filter(AuditLog.entity_type == entity_type)
    if action:
        q = q.filter(AuditLog.action == action)
    return q.order_by(AuditLog.id).all()


# --- Access -----------------------------------------------------------------

def test_company_info_is_admin_only(client, db):
    admin = make_user(db, "co_admin@premnathrail.com", role="admin")
    user = make_user(db, "co_user@premnathrail.com")
    setup_company(client, admin)
    h = auth(user)
    assert client.get(API, headers=h).status_code == 403
    assert client.patch(API, json={"name": "Hacked"}, headers=h).status_code == 403
    assert client.post(API, json={"name": "X", "code": "X"}, headers=h).status_code == 403
    assert client.get(f"{API}/partners", headers=h).status_code == 403
    assert client.put(f"{API}/partners", json={"user_ids": [user.id]}, headers=h).status_code == 403
    assert client.post(f"{API}/addresses", json={"address_line1": "x"}, headers=h).status_code == 403
    db.expire_all()
    assert db.get(User, user.id).is_partner is False


# --- Setup / update -----------------------------------------------------------

def test_company_setup_once_with_required_fields(client, db):
    admin = make_user(db, "co_setup@premnathrail.com", role="admin")
    h = auth(admin)
    r = client.get(API, headers=h)
    assert r.status_code == 404 and "not been set up" in r.json()["detail"]
    assert client.patch(API, json={"name": "x"}, headers=h).status_code == 404
    assert client.post(API, json={"name": "  ", "code": "PRT"}, headers=h).status_code == 422
    assert client.post(API, json={"name": "Premnath", "code": ""}, headers=h).status_code == 422
    setup_company(client, admin)
    r = client.post(API, json={"name": "Second", "code": "SEC"}, headers=h)
    assert r.status_code == 409


def test_company_update_writes_field_level_audit(client, db):
    admin = make_user(db, "co_upd@premnathrail.com", role="admin")
    company = setup_company(client, admin)
    r = client.patch(API, json={"legal_name": "Premnath Rail Tools Pvt Ltd"}, headers=auth(admin))
    assert r.status_code == 200 and r.json()["legal_name"] == "Premnath Rail Tools Pvt Ltd"
    rows = audit_rows(db, "company")
    assert [r.action for r in rows] == ["created", "updated"]
    assert rows[-1].entity_id == company["id"] and rows[-1].performed_by_id == admin.id
    assert "Premnath Rail Tools Pvt Ltd" in (rows[-1].new_value or "")
    assert rows[-1].module_key == "organization"


def test_company_patch_rejects_blank_name(client, db):
    admin = make_user(db, "co_blank@premnathrail.com", role="admin")
    setup_company(client, admin)
    r = client.patch(API, json={"name": "   "}, headers=auth(admin))
    assert r.status_code in (400, 422)


# --- Partners ---------------------------------------------------------------

def test_partners_set_add_remove_and_audited(client, db):
    admin = make_user(db, "pt_admin@premnathrail.com", role="admin")
    setup_company(client, admin)
    a, b = make_user(db, "pt_a@premnathrail.com"), make_user(db, "pt_b@premnathrail.com")
    h = auth(admin)

    r = client.put(f"{API}/partners", json={"user_ids": [a.id, b.id]}, headers=h)
    assert r.status_code == 200 and {p["id"] for p in r.json()} == {a.id, b.id}
    r = client.put(f"{API}/partners", json={"user_ids": [b.id]}, headers=h)
    assert [p["id"] for p in r.json()] == [b.id]
    db.expire_all()
    assert db.get(User, a.id).is_partner is False and db.get(User, b.id).is_partner is True

    rows = audit_rows(db, "company", "partners_updated")
    assert len(rows) == 2
    assert "added" in rows[0].summary and "pt_a" in rows[0].summary
    assert "removed pt_a" in rows[1].summary
    assert all(r.performed_by_id == admin.id for r in rows)

    # Same list again: nothing changes, no new audit row.
    client.put(f"{API}/partners", json={"user_ids": [b.id]}, headers=h)
    assert len(audit_rows(db, "company", "partners_updated")) == 2
    # Empty list clears every partner.
    assert client.put(f"{API}/partners", json={"user_ids": []}, headers=h).json() == []


def test_partners_reject_unknown_and_deactivated_users(client, db):
    admin = make_user(db, "pt_admin2@premnathrail.com", role="admin")
    gone = make_user(db, "pt_gone@premnathrail.com", active=False)
    ok = make_user(db, "pt_ok@premnathrail.com")
    h = auth(admin)
    r = client.put(f"{API}/partners", json={"user_ids": [ok.id, 99999]}, headers=h)
    assert r.status_code == 404 and "99999" in r.json()["detail"]
    r = client.put(f"{API}/partners", json={"user_ids": [ok.id, gone.id]}, headers=h)
    assert r.status_code == 422 and "deactivated" in r.json()["detail"]
    db.expire_all()
    assert db.get(User, ok.id).is_partner is False  # all-or-nothing


def test_is_partner_cannot_be_set_from_users_and_roles(client, db):
    admin = make_user(db, "pt_admin3@premnathrail.com", role="admin")
    target = make_user(db, "pt_target@premnathrail.com")
    r = client.patch(f"/api/v1/users/{target.id}", json={"is_partner": True, "is_director": True}, headers=auth(admin))
    assert r.status_code == 200
    db.expire_all()
    t = db.get(User, target.id)
    assert t.is_director is True and t.is_partner is False
    # And it can't be cleared from there either.
    client.put(f"{API}/partners", json={"user_ids": [target.id]}, headers=auth(admin))
    client.patch(f"/api/v1/users/{target.id}", json={"is_partner": False}, headers=auth(admin))
    db.expire_all()
    assert db.get(User, target.id).is_partner is True


def test_partner_set_in_company_info_becomes_letter_signatory(client, db):
    admin = make_user(db, "pt_admin4@premnathrail.com", role="admin")
    partner = make_user(db, "pt_signer@premnathrail.com")
    client.put(f"{API}/partners", json={"user_ids": [partner.id]}, headers=auth(admin))
    m = client.post("/api/v1/erp/projects", json={"serial_number": "PT-SIGN"}, headers=auth(admin)).json()
    body = client.get(f"/api/v1/erp/projects/{m['id']}/letter-defaults", headers=auth(admin)).json()
    assert body["source"] == "partner" and body["signatory_name"] == "pt_signer"


# --- Addresses / contacts / financial years ----------------------------------

def test_only_one_primary_address_and_contact(client, db):
    admin = make_user(db, "co_prim@premnathrail.com", role="admin")
    setup_company(client, admin)
    h = auth(admin)
    a1 = client.post(f"{API}/addresses", json={"address_line1": "Plot 1", "is_primary": True}, headers=h).json()
    a2 = client.post(f"{API}/addresses", json={"address_line1": "Plot 2", "is_primary": True}, headers=h).json()
    prim = {a["id"]: a["is_primary"] for a in client.get(f"{API}/addresses", headers=h).json()}
    assert prim == {a1["id"]: False, a2["id"]: True}
    client.patch(f"{API}/addresses/{a1['id']}", json={"is_primary": True}, headers=h)
    prim = {a["id"]: a["is_primary"] for a in client.get(f"{API}/addresses", headers=h).json()}
    assert prim == {a1["id"]: True, a2["id"]: False}

    c1 = client.post(f"{API}/contacts", json={"contact_person": "A", "is_primary": True}, headers=h).json()
    client.post(f"{API}/contacts", json={"contact_person": "B", "is_primary": True}, headers=h)
    assert [c["id"] for c in client.get(f"{API}/contacts", headers=h).json() if c["is_primary"]] != [c1["id"]]
    assert client.delete(f"{API}/contacts/99999", headers=h).status_code == 404
    assert client.delete(f"{API}/addresses/{a2['id']}", headers=h).status_code == 200
    assert client.patch(f"{API}/addresses/{a2['id']}", json={"city": "x"}, headers=h).status_code == 404


def test_address_child_rows_audited_on_parent_company(client, db):
    admin = make_user(db, "co_addr_audit@premnathrail.com", role="admin")
    company = setup_company(client, admin)
    h = auth(admin)
    addr = client.post(f"{API}/addresses", json={"address_line1": "Plot 9", "address_type": "registered"}, headers=h).json()
    client.delete(f"{API}/addresses/{addr['id']}", headers=h)
    actions = [r.action for r in audit_rows(db, "company") if r.entity_id == company["id"]]
    assert "address_added" in actions and "address_removed" in actions


def test_financial_year_dates_validated(client, db):
    admin = make_user(db, "co_fy@premnathrail.com", role="admin")
    setup_company(client, admin)
    h = auth(admin)
    r = client.post(f"{API}/financial-years", json={"name": "FY", "start_date": "2026-04-01", "end_date": "2026-03-31"}, headers=h)
    assert r.status_code == 400
    fy = client.post(f"{API}/financial-years", json={"name": "FY 2026-27", "start_date": "2026-04-01", "end_date": "2027-03-31"}, headers=h)
    assert fy.status_code == 200
    fid = fy.json()["id"]
    assert client.patch(f"{API}/financial-years/{fid}", json={"end_date": "2025-01-01"}, headers=h).status_code == 400
    assert client.patch(f"{API}/financial-years/{fid}", json={"status": "closed"}, headers=h).json()["status"] == "closed"
    # A closed year can't be deleted — reopen first.
    r = client.delete(f"{API}/financial-years/{fid}", headers=h)
    assert r.status_code == 409 and "Year-end close" in r.json()["detail"]
    assert client.patch(f"{API}/financial-years/{fid}", json={"status": "open"}, headers=h).status_code == 200
    assert client.delete(f"{API}/financial-years/{fid}", headers=h).status_code == 200
    assert client.get(f"{API}/financial-years", headers=h).json() == []


def test_financial_year_rejects_locked_status_and_overlap(client, db):
    admin = make_user(db, "co_fy2@premnathrail.com", role="admin")
    setup_company(client, admin)
    h = auth(admin)
    r = client.post(f"{API}/financial-years", json={"name": "FY 26-27", "start_date": "2026-04-01",
                                                     "end_date": "2027-03-31", "status": "locked"}, headers=h)
    assert r.status_code == 400 and "Lock Date" in r.json()["detail"]
    fid = client.post(f"{API}/financial-years", json={"name": "FY 26-27", "start_date": "2026-04-01",
                                                       "end_date": "2027-03-31"}, headers=h).json()["id"]
    r = client.patch(f"{API}/financial-years/{fid}", json={"status": "locked"}, headers=h)
    assert r.status_code == 400
    r = client.post(f"{API}/financial-years", json={"name": "Overlap", "start_date": "2027-01-01",
                                                     "end_date": "2027-12-31"}, headers=h)
    assert r.status_code == 400 and "overlaps FY 26-27" in r.json()["detail"]
    nxt = client.post(f"{API}/financial-years", json={"name": "FY 27-28", "start_date": "2027-04-01",
                                                       "end_date": "2028-03-31"}, headers=h)
    assert nxt.status_code == 200
    r = client.patch(f"{API}/financial-years/{nxt.json()['id']}", json={"start_date": "2027-03-01"}, headers=h)
    assert r.status_code == 400 and "overlaps" in r.json()["detail"]


def test_financial_year_legacy_locked_status_still_editable(client, db):
    """A year stored as legacy 'locked' can still have its name / lock date
    edited when the status itself is sent back unchanged."""
    from app.modules.organization.models.company_financial_year import CompanyFinancialYear

    admin = make_user(db, "co_fy3@premnathrail.com", role="admin")
    setup_company(client, admin)
    h = auth(admin)
    fid = client.post(f"{API}/financial-years", json={"name": "FY 26-27", "start_date": "2026-04-01",
                                                       "end_date": "2027-03-31"}, headers=h).json()["id"]
    db.query(CompanyFinancialYear).filter(CompanyFinancialYear.id == fid).update({"status": "locked"})
    db.commit()
    r = client.patch(f"{API}/financial-years/{fid}", json={"name": "FY 2026-27", "status": "locked"}, headers=h)
    assert r.status_code == 200 and r.json()["name"] == "FY 2026-27"
    r = client.patch(f"{API}/financial-years/{fid}", json={"status": "open"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "open"


def test_financial_year_with_postings_cannot_be_deleted_or_hand_closed(client, db):
    from datetime import date
    from app.modules.accounts.models.journal_entry import JournalEntry

    admin = make_user(db, "co_fy3@premnathrail.com", role="admin")
    setup_company(client, admin)
    h = auth(admin)
    fid = client.post(f"{API}/financial-years", json={"name": "FY 26-27", "start_date": "2026-04-01",
                                                       "end_date": "2027-03-31"}, headers=h).json()["id"]
    db.add(JournalEntry(entry_number="JV-T-1", financial_year="2026-27", posting_date=date(2026, 6, 1),
                        accounting_period="2026-06", status="posted"))
    db.commit()
    r = client.delete(f"{API}/financial-years/{fid}", headers=h)
    assert r.status_code == 409 and "1 posted journal entry" in r.json()["detail"]
    r = client.patch(f"{API}/financial-years/{fid}", json={"status": "closed"}, headers=h)
    assert r.status_code == 409 and "Year-end close" in r.json()["detail"]
