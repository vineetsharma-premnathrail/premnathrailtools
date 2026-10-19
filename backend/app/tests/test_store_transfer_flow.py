"""Stock transfer: raise → approval (sending store's manager, four-eyes) →
dispatch (stock leaves the source, in transit) → receive (stock lands at the
destination). The Stock Transfer Note is available from approval on."""
from app.modules.store.models.stock_balance import StoreStockBalance
from app.tests.test_store_plant_access import API, setup  # noqa: F401 — fixture


def _bal(db, item_id, loc_id):
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=loc_id).first().on_hand_qty


def _approve(client, h, transfer_id):
    st = client.get(f"/api/v1/approvals/entity/stock_transfer/{transfer_id}", headers=h).json()
    req_id = st["current"]["id"]
    return client.post(f"/api/v1/approvals/requests/{req_id}/decide", json={"decision": "approve"}, headers=h)


def test_transfer_needs_approval_then_dispatch_and_receipt(client, db, setup):  # noqa: F811
    s1, s2, item = setup["s1"], setup["s2"], setup["item"]
    t = client.post(f"{API}/stock-transfers", json={
        "from_location_id": s1.id, "to_location_id": s2.id, "reason": "Unit 2 shortage",
        "items": [{"item_id": item.id, "quantity": 4}]}, headers=setup["admin"])
    assert t.status_code == 200, t.text
    tid = t.json()["id"]
    assert t.json()["status"] == "pending_approval"
    assert _bal(db, item.id, s1.id) == 10  # nothing moved yet

    # The note isn't available before approval; dispatch is refused.
    assert client.get(f"{API}/stock-transfers/{tid}/transfer-note.pdf", headers=setup["admin"]).status_code == 409
    assert client.post(f"{API}/stock-transfers/{tid}/dispatch", json={}, headers=setup["keeper"]).status_code == 409

    # The sending store's manager (keeper) approves.
    r = _approve(client, setup["keeper"], tid)
    assert r.status_code == 200, r.text
    assert client.get(f"{API}/stock-transfers/{tid}", headers=setup["keeper"]).json()["status"] == "approved"

    d = client.post(f"{API}/stock-transfers/{tid}/dispatch", json={"vehicle_number": "hr55 ab 1234", "driver_name": "Ram"},
                    headers=setup["keeper"])
    assert d.status_code == 200, d.text
    assert d.json()["status"] == "in_transit" and d.json()["vehicle_number"] == "HR55 AB 1234"
    assert _bal(db, item.id, s1.id) == 6 and _bal(db, item.id, s2.id) == 10  # in transit

    pdf = client.get(f"{API}/stock-transfers/{tid}/transfer-note.pdf", headers=setup["keeper"])
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    rc = client.post(f"{API}/stock-transfers/{tid}/receive", json={"remarks": "OK"}, headers=setup["keeper2"])
    assert rc.status_code == 200, rc.text
    assert rc.json()["status"] == "received"
    assert _bal(db, item.id, s2.id) == 14
    # Can't be received twice.
    assert client.post(f"{API}/stock-transfers/{tid}/receive", json={}, headers=setup["keeper2"]).status_code == 409


def test_transfer_refuses_more_than_available_and_can_be_cancelled(client, db, setup):  # noqa: F811
    s1, s2, item = setup["s1"], setup["s2"], setup["item"]
    big = client.post(f"{API}/stock-transfers", json={
        "from_location_id": s1.id, "to_location_id": s2.id, "items": [{"item_id": item.id, "quantity": 50}]}, headers=setup["admin"])
    assert big.status_code == 409 and "Only 10" in big.json()["detail"]

    t = client.post(f"{API}/stock-transfers", json={
        "from_location_id": s1.id, "to_location_id": s2.id, "items": [{"item_id": item.id, "quantity": 2}]}, headers=setup["admin"])
    c = client.post(f"{API}/stock-transfers/{t.json()['id']}/cancel", headers=setup["admin"])
    assert c.status_code == 200 and c.json()["status"] == "cancelled"
    assert _bal(db, item.id, s1.id) == 10
