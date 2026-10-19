"""PR lines are picked from the Store Item Master (2026-10-11).

The Item Master id (store_item_id) travels PR line → PO line → GRN line and
the GRN posts stock against it, valued at the PO unit price — lines are never
matched to the master by name."""
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _approve_and_raise_po, _create_payload, _create_pr, _pr_approvers, _purchaser, _requester,
    _sqlite_number_series, auth_header,
)
from app.tests.p2p_workflow_helpers import set_pr_workflow

GRN = "/api/v1/p2p/goods-receipts"


def _store(db, code="IM1"):
    loc = StoreLocation(name=f"Store {code}", code=code)
    db.add(loc)
    db.commit()
    return loc


def _po_for(client, buyer, pr_id):
    return next(p for p in client.get("/api/v1/p2p/purchase-orders", headers=auth_header(buyer)).json()
                if p["p2p_request_id"] == pr_id)


def _grn(client, buyer, po, loc, qty):
    return client.post(GRN, json={
        "purchase_order_id": po["id"], "store_location_id": loc.id,
        "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": qty}],
    }, headers=auth_header(buyer))


def _inspect_all(client, buyer, grn):
    return client.post(f"{GRN}/{grn['id']}/inspect", json={"items": [
        {"item_id": it["id"], "accepted_quantity": it["received_quantity"], "rejected_quantity": 0, "quality_status": "passed"}
        for it in grn["items"]]}, headers=auth_header(buyer))


def test_pr_line_must_be_an_active_item_master_item_and_master_fields_win(client, db):
    requester = _requester(db, "im.req1@premnathrail.com")
    set_pr_workflow(db, [u.id for u in _pr_approvers(db).values()], requester)

    # No store_item_id → 422 with what to do.
    r = client.post(BASE, json=_create_payload(items=[
        {"item_name": "Typed only", "quantity": 1, "unit": "pcs", "project_inhouse": "Project"}]), headers=auth_header(requester))
    assert r.status_code == 422, r.text
    assert "Line 1: pick the item from the Item Master" in r.json()["detail"]

    # Inactive master item → 422.
    old = master_item(db, "Old gasket", code="RM-GSK-OLD", status="inactive")
    r = client.post(BASE, json=_create_payload(items=[
        {"store_item_id": old.id, "quantity": 1, "project_inhouse": "Project"}]), headers=auth_header(requester))
    assert r.status_code == 422, r.text
    assert "RM-GSK-OLD" in r.json()["detail"] and "inactive" in r.json()["detail"]

    # Name / unit / part code / category sent by the client are ignored; make
    # defaults to the master's.
    good = master_item(db, "Hydraulic Cylinder 80", code="RM-CYL-80", uom="NOS", part_number="HC-80",
                       category="Hydraulic & Pneumatic", make="Bosch")
    r = client.post(BASE, json=_create_payload(items=[
        {"store_item_id": good.id, "item_name": "Something else", "unit": "KG", "part_code": "X-1", "category": "Junk",
         "quantity": 3, "project_inhouse": "Project"}]), headers=auth_header(requester))
    assert r.status_code == 200, r.text
    line = r.json()["items"][0]
    assert (line["store_item_id"], line["item_name"], line["unit"], line["part_code"], line["category"], line["make"]) == (
        good.id, "Hydraulic Cylinder 80", "NOS", "HC-80", "Hydraulic & Pneumatic", "Bosch")


def test_item_master_id_travels_pr_po_grn_and_stock_is_posted_at_po_rate(client, db):
    db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))
    db.commit()
    item = master_item(db, "Brake shoe", code="RM-BRK-01", uom="NOS")
    loc = _store(db)
    requester = _requester(db, "im.req2@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"store_item_id": item.id, "quantity": 5, "project_inhouse": "Project"}])
    assert pr["items"][0]["store_item_id"] == item.id
    buyer = _purchaser(db, "im.buyer2@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)  # PO priced at 100 per unit

    po = _po_for(client, buyer, pr["id"])
    assert po["items"][0]["store_item_id"] == item.id
    grn = _grn(client, buyer, po, loc, 5)
    assert grn.status_code == 200, grn.text
    assert grn.json()["items"][0]["store_item_id"] == item.id
    done = _inspect_all(client, buyer, grn.json())
    assert done.status_code == 200, done.text

    # SAP 101 into Quality stock when the GRN is recorded, then 321 to Free at inspection — both at the PO rate.
    rows = db.query(StoreStockTransaction).filter(StoreStockTransaction.reference_type == "grn").order_by(StoreStockTransaction.id).all()
    assert [(r.item_id, r.location_id, r.quantity, r.transaction_type) for r in rows] == [
        (item.id, loc.id, 5, "quality_in"), (item.id, loc.id, 5, "quality_release")]
    row = rows[0]
    assert row.unit_cost == 100 and row.cost_source == "po_rate"


def test_unlinked_po_line_blocks_grn_until_linked_once(client, db):
    item = master_item(db, "Coupling", code="RM-CPL-01", uom="NOS")
    loc = _store(db, "IM3")
    requester = _requester(db, "im.req3@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"store_item_id": item.id, "quantity": 2, "project_inhouse": "Project"}])
    buyer = _purchaser(db, "im.buyer3@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    po = _po_for(client, buyer, pr["id"])

    # An older PO line raised before lines carried the Item Master id.
    line = db.get(P2PPurchaseOrderItem, po["items"][0]["id"])
    line.store_item_id = None
    db.commit()

    refused = _grn(client, buyer, po, loc, 2)
    assert refused.status_code == 409, refused.text
    assert "Link to Item Master" in refused.json()["detail"]

    link_url = f"/api/v1/p2p/purchase-orders/{po['id']}/items/{line.id}/link-item"
    linked = client.post(link_url, json={"store_item_id": item.id}, headers=auth_header(buyer))
    assert linked.status_code == 200, linked.text
    db.expire_all()
    assert db.get(P2PPurchaseOrderItem, line.id).store_item_id == item.id

    ok = _grn(client, buyer, po, loc, 2)
    assert ok.status_code == 200, ok.text
    assert ok.json()["items"][0]["store_item_id"] == item.id

    # A linked line can't be re-pointed.
    other = master_item(db, "Coupling large", code="RM-CPL-02", uom="NOS")
    again = client.post(link_url, json={"store_item_id": other.id}, headers=auth_header(buyer))
    assert again.status_code == 409, again.text
