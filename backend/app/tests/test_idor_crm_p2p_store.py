"""IDOR / object-level authorization regressions for CRM, Procurement and
Store: child rows are bound to the parent in the URL / record, soft-deleted
parents 404, by-id actions check the record's data scope, and by-id reads
need a real tab permission (not just module access)."""
from datetime import date, datetime, timezone


from app.modules.crm.models.activity import Activity
from app.modules.crm.models.activity_attachment import ActivityAttachment
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.models.tender import Tender
from app.modules.main.models.user import User
from app.modules.store.models.bin import StoreBin
from app.tests.test_crm_data_scope import API as CRM, _auth, _user
from app.tests.test_store_plant_access import API as STORE, _headers, _scope, setup  # noqa: F401 — fixture


# ── CRM ─────────────────────────────────────────────────────────────────

def _two_orgs(db, owner):
    now = datetime.now(timezone.utc)
    mine = Organization(name="IDOR Org A", created_by_id=owner.id)
    other = Organization(name="IDOR Org B", created_by_id=owner.id)
    db.add_all([mine, other])
    db.flush()
    c_mine = OrgContact(org_id=mine.id, name="Asha (A)", created_at=now)
    c_other = OrgContact(org_id=other.id, name="Bina (B)", created_at=now)
    db.add_all([c_mine, c_other])
    db.commit()
    return mine, other, c_mine, c_other


def test_inquiry_mom_rejects_contact_of_another_organization(client, db):
    admin = _user(db, "idor.crm.admin@premnathrail.com", "Idor Admin", role="admin")
    mine, _other, c_mine, c_other = _two_orgs(db, admin)
    inq = Inquiry(universal_id="INQ-IDOR-1", org_id=mine.id, created_by_id=admin.id)
    db.add(inq)
    db.commit()
    body = {"subject": "Kick-off", "meeting_date": str(date.today()), "client_contact_ids": [c_mine.id, c_other.id]}
    r = client.post(f"{CRM}/inquiries/{inq.id}/mom-docx", json=body, headers=_auth(admin))
    assert r.status_code == 422 and "doesn't belong to this inquiry's customer organization" in r.json()["detail"]


def test_tender_mom_rejects_contact_of_another_organization(client, db):
    admin = _user(db, "idor.crm.admin2@premnathrail.com", "Idor Admin2", role="admin")
    mine, _other, _c_mine, c_other = _two_orgs(db, admin)
    tnd = Tender(universal_id="TND-IDOR-1", org_id=mine.id, created_by_id=admin.id)
    db.add(tnd)
    db.commit()
    body = {"subject": "Pre-bid", "meeting_date": str(date.today()), "client_contact_ids": [c_other.id]}
    r = client.post(f"{CRM}/tenders/{tnd.id}/mom-docx", json=body, headers=_auth(admin))
    assert r.status_code == 422 and "doesn't belong to this tender's customer organization" in r.json()["detail"]


def test_stage_history_of_deleted_inquiry_and_tender_404(client, db):
    admin = _user(db, "idor.crm.admin3@premnathrail.com", "Idor Admin3", role="admin")
    org = Organization(name="IDOR Org C", created_by_id=admin.id)
    db.add(org)
    db.flush()
    inq = Inquiry(universal_id="INQ-IDOR-2", org_id=org.id, created_by_id=admin.id, is_deleted=True)
    tnd = Tender(universal_id="TND-IDOR-2", org_id=org.id, created_by_id=admin.id, is_deleted=True)
    db.add_all([inq, tnd])
    db.commit()
    assert client.get(f"{CRM}/inquiries/{inq.id}/stages", headers=_auth(admin)).status_code == 404
    assert client.get(f"{CRM}/tenders/{tnd.id}/stages", headers=_auth(admin)).status_code == 404


def test_photo_of_deleted_follow_up_404(client, db):
    admin = _user(db, "idor.crm.admin4@premnathrail.com", "Idor Admin4", role="admin")
    org = Organization(name="IDOR Org D", created_by_id=admin.id)
    db.add(org)
    db.flush()
    act = Activity(subject="Visit", org_id=org.id, related_module="organization", related_id=org.id,
                   created_by_id=admin.id, is_deleted=True)
    db.add(act)
    db.flush()
    att = ActivityAttachment(activity_id=act.id, filename="site.jpg", sharepoint_path="x/site.jpg")
    db.add(att)
    db.commit()
    r = client.get(f"{CRM}/activities/{act.id}/attachments/{att.id}/content", headers=_auth(admin))
    assert r.status_code == 404 and "was deleted" in r.json()["detail"]


# ── Store ───────────────────────────────────────────────────────────────

def test_bin_parent_must_be_in_the_same_store(client, db, setup):  # noqa: F811
    s1, s2 = setup["s1"], setup["s2"]
    other_rack = StoreBin(location_id=s2.id, bin_type="rack", code="R-U2")
    my_bin = StoreBin(location_id=s1.id, bin_type="bin", code="B-U1")
    db.add_all([other_rack, my_bin])
    db.commit()
    r = client.post(f"{STORE}/bins", json={"location_id": s1.id, "bin_type": "bin", "code": "B-U1-2",
                                           "parent_id": other_rack.id}, headers=setup["admin"])
    assert r.status_code == 422 and "belongs to another store" in r.json()["detail"]
    r = client.patch(f"{STORE}/bins/{my_bin.id}", json={"parent_id": other_rack.id}, headers=setup["admin"])
    assert r.status_code == 422 and "belongs to another store" in r.json()["detail"]
    r = client.patch(f"{STORE}/bins/{my_bin.id}", json={"parent_id": my_bin.id}, headers=setup["admin"])
    assert r.status_code == 422


def test_bin_of_another_plants_store_403(client, db, setup):  # noqa: F811
    _scope(setup["keeper_user"], "plant")
    other = StoreBin(location_id=setup["s2"].id, bin_type="bin", code="B-U2")
    db.add(other)
    db.commit()
    r = client.patch(f"{STORE}/bins/{other.id}", json={"name": "Mine now"}, headers=setup["keeper"])
    assert r.status_code == 403 and "Store data access" in r.json()["detail"]
    assert client.delete(f"{STORE}/bins/{other.id}", headers=setup["keeper"]).status_code == 403


def test_transfer_actions_check_data_scope(client, db, setup):  # noqa: F811
    t = client.post(f"{STORE}/stock-transfers", json={
        "from_location_id": setup["s1"].id, "to_location_id": setup["s2"].id,
        "items": [{"item_id": setup["item"].id, "quantity": 1}]}, headers=setup["admin"])
    assert t.status_code == 200, t.text
    tid = t.json()["id"]
    # keeper2 (Unit 2) on "own" scope: neither raised it nor in scope.
    _scope(setup["keeper2_user"], "own")
    for action in ("cancel", "dispatch"):
        r = client.post(f"{STORE}/stock-transfers/{tid}/{action}", json={}, headers=setup["keeper2"])
        assert r.status_code == 403 and "outside your data access" in r.json()["detail"], (action, r.text)


def test_stock_entry_read_needs_a_store_view_permission(client, db, setup):  # noqa: F811
    # Record Stock Entry is removed (2026-10-12) — an entry recorded before it.
    from datetime import date
    from app.modules.store.models.stock_entry import StoreStockEntry
    old = StoreStockEntry(entry_number="SE-2026-0001", entry_type="receipt", location_id=setup["s1"].id,
                          entry_date=date.today(), created_by_id=setup["keeper_user"].id)
    db.add(old)
    db.commit()
    entry = {"id": old.id, "entry_number": old.entry_number}
    items_only = User(email="idor.items@premnathrail.com", name="items only", role="user", is_active=True,
                      granular_permissions=["store:items:view"])
    db.add(items_only)
    db.commit()
    h = _headers(items_only)
    r = client.get(f"{STORE}/stock/entries/{entry['id']}", headers=h)
    assert r.status_code == 403 and "Store › Movements" in r.json()["detail"]
    assert client.get(f"{STORE}/stock/entries/by-number/{entry['entry_number']}", headers=h).status_code == 403
    viewer = User(email="idor.moves@premnathrail.com", name="movements", role="user", is_active=True,
                  granular_permissions=["store:movements:view"])
    db.add(viewer)
    db.commit()
    assert client.get(f"{STORE}/stock/entries/{entry['id']}", headers=_headers(viewer)).status_code == 200
