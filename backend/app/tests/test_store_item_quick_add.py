"""Add a new item at inward (owner, 2026-11-14): quick add from the Before-PO
receipt form flags the item 'needs review', a "is it already there?" check runs
first, and the Item Master owner clears the flag with Mark reviewed."""
from app.modules.main.models.audit_log import AuditLog
from app.modules.store.models.item import StoreItem
from app.modules.store.services.item_similar import name_key, words
from app.tests.test_store_items import API, create, h  # noqa: F401 — h is a fixture
from app.tests.test_store_rbac import _h, _user


def test_words_and_name_key_ignore_case_order_and_dashes():
    assert words("Bolt M-12 x 50") == ["bolt", "m12", "x", "50"]
    assert name_key("M12 BOLT") == name_key("bolt m-12") == "bolt m12"


def test_quick_add_from_inward_flags_needs_review_and_never_batch(client, h, db):
    r = create(client, h, item_name="Hex Bolt M12", from_inward=True, batch_controlled=True, serial_controlled=True)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["needs_review"] is True
    item = db.get(StoreItem, body["id"])
    assert item.needs_review and not item.batch_controlled and not item.serial_controlled
    assert db.query(AuditLog).filter(AuditLog.entity_id == item.id, AuditLog.action == "item_added_at_inward").count() == 1
    # A normal add is not flagged.
    assert create(client, h, item_name="Washer M12").json()["needs_review"] is False
    # The Item Master can list only the flagged ones.
    rows = client.get(API, params={"needs_review": True}, headers=h).json()
    assert [x["item_name"] for x in rows] == ["Hex Bolt M12"]


def test_similar_finds_same_name_any_order_and_typos(client, h):
    for name in ("Hex Bolt M12", "Bearing 6205 2RS", "Grease Servo 3"):
        assert create(client, h, item_name=name).status_code == 200
    hits = client.get(f"{API}/similar", params={"name": "m-12 hex BOLT"}, headers=h).json()
    assert hits[0]["item_name"] == "Hex Bolt M12" and hits[0]["match"] == "same_name"
    hits = client.get(f"{API}/similar", params={"name": "Bearng 6205 2RS"}, headers=h).json()
    assert hits and hits[0]["item_name"] == "Bearing 6205 2RS" and hits[0]["match"] == "similar"
    assert client.get(f"{API}/similar", params={"name": "Copper wire 2.5 sq mm"}, headers=h).json() == []


def test_similar_uses_this_vendors_earlier_bill_names(client, h, db):
    from app.modules.accounts.models.vendor import Vendor
    from app.modules.store.models.pre_po_receipt import StoreItemVendorName, bill_name_key
    item_id = create(client, h, item_name="Hydraulic hose 1/2 inch").json()["id"]
    v = Vendor(code="V-QA1", name="Hose House", status="active", gst_registration_type="unregistered")
    db.add(v)
    db.flush()
    db.add(StoreItemVendorName(vendor_id=v.id, store_item_id=item_id, invoice_name="HOSE 1/2 R2",
                               name_key=bill_name_key("HOSE 1/2 R2")))
    db.commit()
    hits = client.get(f"{API}/similar", params={"name": "hose 1/2 r2", "vendor_id": v.id}, headers=h).json()
    assert hits[0]["id"] == item_id and hits[0]["match"] == "bill_name"


def test_mark_reviewed_clears_the_flag_and_is_audited(client, h, db):
    item_id = create(client, h, item_name="Quick item", from_inward=True).json()["id"]
    r = client.post(f"{API}/{item_id}/mark-reviewed", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["needs_review"] is False
    assert db.query(AuditLog).filter(AuditLog.entity_id == item_id, AuditLog.action == "item_reviewed").count() == 1
    assert client.post(f"{API}/999999/mark-reviewed", headers=h).status_code == 404


def test_permissions_similar_needs_create_and_review_needs_edit(client, h, db):
    item_id = create(client, h, item_name="Guarded item", from_inward=True).json()["id"]
    viewer = _user(db, "qa.viewer@premnathrail.com", ["store:items:view"])
    assert client.get(f"{API}/similar", params={"name": "Guarded item"}, headers=_h(viewer)).status_code == 403
    assert client.post(f"{API}/{item_id}/mark-reviewed", headers=_h(viewer)).status_code == 403
