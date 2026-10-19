"""Store › Inventory › Bins: the store team keeps its own racks / shelves /
bins (tab 'bins'), one store's bins never mix with another's, and a bin that
holds stock can't be switched off or deleted."""
from app.modules.main.models.user import User
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_store_plant_access import API, _headers, setup  # noqa: F401 — fixture

BINS = f"{API}/bins"


def _add(client, headers, location_id, bin_type, code, parent_id=None):
    return client.post(BINS, json={"location_id": location_id, "bin_type": bin_type, "code": code, "parent_id": parent_id}, headers=headers)


def test_rack_shelf_bin_hierarchy(client, db, setup):  # noqa: F811
    s1, h = setup["s1"].id, setup["admin"]
    rack = _add(client, h, s1, "rack", "r1")
    assert rack.status_code == 200, rack.text
    assert rack.json()["code"] == "R1"  # codes are kept upper-case
    rack_id = rack.json()["id"]
    assert "top level" in _add(client, h, s1, "rack", "R2", parent_id=rack_id).json()["detail"]
    assert "must sit in a rack" in _add(client, h, s1, "shelf", "R1-S1").json()["detail"]
    shelf = _add(client, h, s1, "shelf", "R1-S1", parent_id=rack_id)
    assert shelf.status_code == 200, shelf.text
    assert _add(client, h, s1, "bin", "R1-S1-B1", parent_id=shelf.json()["id"]).status_code == 200
    assert _add(client, h, s1, "bin", "LOOSE-1").status_code == 200  # small store: bin without a rack
    # A rack can't be turned into a shelf under its own shelf (loop).
    r = client.patch(f"{BINS}/{rack_id}", json={"bin_type": "shelf", "parent_id": shelf.json()["id"]}, headers=h)
    assert r.status_code == 422


def test_codes_are_unique_per_store_only(client, db, setup):  # noqa: F811
    h = setup["admin"]
    assert _add(client, h, setup["s1"].id, "bin", "B-01").status_code == 200
    dup = _add(client, h, setup["s1"].id, "bin", "b-01")
    assert dup.status_code == 409 and "already used" in dup.json()["detail"]
    assert _add(client, h, setup["s2"].id, "bin", "B-01").status_code == 200  # other store — a different bin


def test_bins_need_the_bins_grant(client, db, setup):  # noqa: F811
    clerk = User(email="clerk@premnathrail.com", name="clerk", role="user", is_active=True, assigned_apps=["store"],
                 granular_permissions=["store:stock:view"])
    db.add(clerk)
    db.commit()
    r = _add(client, _headers(clerk), setup["s1"].id, "bin", "B-X")
    assert r.status_code == 403
    clerk.granular_permissions = ["store:bins:view", "store:bins:create"]
    db.commit()
    assert _add(client, _headers(clerk), setup["s1"].id, "bin", "B-X").status_code == 200


def test_bin_holding_stock_cant_be_deactivated_or_deleted(client, db, setup):  # noqa: F811
    h = setup["admin"]
    b = _add(client, h, setup["s1"].id, "bin", "B-STK").json()
    post_stock_transaction(db, item_id=setup["item"].id, location_id=setup["s1"].id, transaction_type="receipt", quantity=4, bin_id=b["id"])
    db.commit()
    r = client.patch(f"{BINS}/{b['id']}", json={"is_active": False}, headers=h)
    assert r.status_code == 409 and "still holds 4" in r.json()["detail"]
    r = client.delete(f"{BINS}/{b['id']}", headers=h)
    assert r.status_code == 409 and "Deactivate it instead" in r.json()["detail"]
