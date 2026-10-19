"""
Tests for Maintenance Phase 2 — spares: the asset bill of spares (PUT/GET,
validation), the read-only Spares page over Store stock (below-minimum maths,
filters, 90-day consumption) and the below-minimum alert after an issue.
"""
from app.modules.main.models.notification import Notification
from app.modules.organization.models.branch import Branch
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_maintenance import make_user, hdr, create_asset, BASE


def _setup(db):
    branch = Branch(name="Faridabad Plant", code="FBD")
    db.add(branch)
    db.commit()
    db.refresh(branch)
    loc = StoreLocation(name="Main Store", code="MS01", branch_id=branch.id)
    brg = StoreItem(item_code="SP-BRG", item_name="Bearing 6205-2RS", uom="NOS", item_type="spare_part",
                    standard_cost=250, minimum_stock=5, reorder_level=8, reorder_quantity=20)
    belt = StoreItem(item_code="SP-BLT", item_name="V-Belt B-52", uom="NOS", item_type="spare_part", reorder_level=3)
    oil = StoreItem(item_code="CN-OIL", item_name="Hydraulic Oil 68", uom="LTR", item_type="consumable", minimum_stock=50)
    steel = StoreItem(item_code="MT-STL", item_name="MS Plate 10mm", uom="KG", item_type="material")
    db.add_all([loc, brg, belt, oil, steel])
    db.commit()
    for o in (loc, brg, belt, oil, steel):
        db.refresh(o)
    post_stock_transaction(db, item_id=brg.id, location_id=loc.id, transaction_type="receipt", quantity=6, reference_type="manual")
    post_stock_transaction(db, item_id=belt.id, location_id=loc.id, transaction_type="receipt", quantity=10, reference_type="manual")
    post_stock_transaction(db, item_id=oil.id, location_id=loc.id, transaction_type="receipt", quantity=40, reference_type="manual")
    db.commit()
    return branch, loc, brg, belt, oil, steel


def test_bill_of_spares_put_get_and_validation(client, db):
    branch, loc, brg, belt, oil, steel = _setup(db)
    h = hdr(make_user(db, "sp1@premnathrail.com"))
    asset = create_asset(client, h, branch)
    url = f"{BASE}/assets/{asset['id']}/spares"

    assert client.get(url, headers=h).json() == []
    r = client.put(url, json={"lines": [
        {"store_item_id": brg.id, "qty_per_replacement": 2, "is_critical": True, "remarks": "Spindle front"},
        {"store_item_id": oil.id, "qty_per_replacement": 20},
    ]}, headers=h)
    assert r.status_code == 200, r.text
    lines = {l["item_code"]: l for l in r.json()}
    assert lines["SP-BRG"]["is_critical"] and lines["SP-BRG"]["on_hand_total"] == 6 and not lines["SP-BRG"]["below_min"]
    assert lines["CN-OIL"]["below_min"] and lines["CN-OIL"]["uom"] == "LTR"

    # Duplicate item, bad qty and unknown item are rejected with the reason.
    r = client.put(url, json={"lines": [{"store_item_id": brg.id}, {"store_item_id": brg.id}]}, headers=h)
    assert r.status_code == 400 and "twice" in r.json()["detail"]
    r = client.put(url, json={"lines": [{"store_item_id": brg.id, "qty_per_replacement": 0}]}, headers=h)
    assert r.status_code == 400 and "greater than 0" in r.json()["detail"]
    r = client.put(url, json={"lines": [{"store_item_id": 99999}]}, headers=h)
    assert r.status_code == 404
    assert len(client.get(url, headers=h).json()) == 2  # failed PUTs changed nothing

    # Replace: drop oil, keep the bearing (updated).
    r = client.put(url, json={"lines": [{"store_item_id": brg.id, "qty_per_replacement": 4, "is_critical": False}]}, headers=h)
    assert r.status_code == 200
    assert [(l["item_code"], l["qty_per_replacement"], l["is_critical"]) for l in r.json()] == [("SP-BRG", 4, False)]

    # Requester (production-only) can't read or edit it.
    prod = make_user(db, "sp1p@premnathrail.com", apps=("production",))
    assert client.get(url, headers=hdr(prod)).status_code == 403


def test_spares_list_below_min_and_filters(client, db):
    branch, loc, brg, belt, oil, steel = _setup(db)
    h = hdr(make_user(db, "sp2@premnathrail.com"))
    asset = create_asset(client, h, branch)
    client.put(f"{BASE}/assets/{asset['id']}/spares", json={"lines": [
        {"store_item_id": brg.id, "qty_per_replacement": 2, "is_critical": True},
        {"store_item_id": oil.id, "qty_per_replacement": 20},
    ]}, headers=h)

    r = client.get(f"{BASE}/spares", headers=h)
    assert r.status_code == 200, r.text
    rows = {s["item_code"]: s for s in r.json()}
    # spare_part items + anything on a bill of spares; plain material is not listed.
    assert set(rows) == {"SP-BRG", "SP-BLT", "CN-OIL"}
    assert rows["SP-BRG"]["on_hand_total"] == 6 and not rows["SP-BRG"]["below_min"] and rows["SP-BRG"]["at_reorder"]
    assert rows["SP-BRG"]["is_critical"] and rows["SP-BRG"]["assets"][0]["asset_code"] == asset["asset_code"]
    assert rows["SP-BRG"]["locations"][0]["location_name"] == "Main Store"
    assert rows["CN-OIL"]["below_min"] and not rows["CN-OIL"]["is_critical"]
    assert rows["SP-BLT"]["below_min"] is False  # 10 on hand vs reorder level 3 (no minimum → reorder level)
    assert rows["SP-BRG"]["suggested_order_qty"] == 20  # reorder quantity

    assert [s["item_code"] for s in client.get(f"{BASE}/spares", params={"below_min_only": True}, headers=h).json()] == ["CN-OIL"]
    assert [s["item_code"] for s in client.get(f"{BASE}/spares", params={"critical_only": True}, headers=h).json()] == ["SP-BRG"]
    assert [s["item_code"] for s in client.get(f"{BASE}/spares", params={"search": "belt"}, headers=h).json()] == ["SP-BLT"]

    other = Branch(name="Other Plant", code="OTH")
    db.add(other)
    db.commit()
    assert client.get(f"{BASE}/spares", params={"branch_id": other.id}, headers=h).json() == []


def test_issue_triggers_below_min_alert_once_a_day(client, db):
    branch, loc, brg, belt, oil, steel = _setup(db)
    planner = make_user(db, "sp3@premnathrail.com")
    h = hdr(planner)
    asset = create_asset(client, h, branch)
    client.put(f"{BASE}/assets/{asset['id']}/spares", json={"lines": [
        {"store_item_id": brg.id, "qty_per_replacement": 2, "is_critical": True},
    ]}, headers=h)
    wo = client.post(f"{BASE}/work-orders", json={
        "asset_id": asset["id"], "title": "Replace bearing", "wo_type": "corrective", "assigned_to_id": planner.id,
    }, headers=h)
    assert wo.status_code == 200, wo.text
    wo_id = wo.json()["id"]
    assert client.post(f"{BASE}/work-orders/{wo_id}/start", headers=h).status_code == 200

    def alerts():
        return db.query(Notification).filter(Notification.notification_type == "maintenance_spare_below_min").count()

    # 6 → 5: still at minimum (5), no alert.
    r = client.post(f"{BASE}/work-orders/{wo_id}/spares/issue", json={"store_item_id": brg.id, "location_id": loc.id, "quantity": 1}, headers=h)
    assert r.status_code == 200, r.text
    assert alerts() == 0
    # 5 → 4: below minimum → planner alerted, pointing at the item.
    client.post(f"{BASE}/work-orders/{wo_id}/spares/issue", json={"store_item_id": brg.id, "location_id": loc.id, "quantity": 1}, headers=h)
    n = db.query(Notification).filter(Notification.notification_type == "maintenance_spare_below_min").all()
    assert len(n) == 1 and n[0].user_id == planner.id and n[0].entity_type == "maintenance_spare" and n[0].entity_id == brg.id
    # Another issue the same day doesn't alert again.
    client.post(f"{BASE}/work-orders/{wo_id}/spares/issue", json={"store_item_id": brg.id, "location_id": loc.id, "quantity": 1}, headers=h)
    assert alerts() == 1

    # Consumption shows on the Spares page (3 issued, 1 returned).
    spare_id = client.get(f"{BASE}/work-orders/{wo_id}", headers=h).json()["spares"][0]["id"]
    client.post(f"{BASE}/work-orders/{wo_id}/spares/return", json={"spare_id": spare_id, "quantity": 1}, headers=h)
    row = next(s for s in client.get(f"{BASE}/spares", headers=h).json() if s["item_code"] == "SP-BRG")
    assert row["consumed_90d"] == 2 and row["on_hand_total"] == 4 and row["below_min"]
