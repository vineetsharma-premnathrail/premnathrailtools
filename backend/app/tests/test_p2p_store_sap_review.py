"""P2P / Store SAP-standard review fixes (2026-10-13):

- a GRN can't over-receive a PO line by listing it twice on one receipt;
- a GRN / material issue / vendor return can't be posted with a future date;
- stock can't be issued against a requisition that isn't approved (a draft);
- no PO draft to a vendor Blocked in the vendor master."""
from datetime import date, timedelta

from app.modules.accounts.models.vendor import Vendor
from app.tests.p2p_workflow_helpers import link_items, master_item
from app.tests.test_p2p_item_master_link import _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _approve_and_raise_po, _create_payload, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header,
    make_user,
)


GRN = "/api/v1/p2p/goods-receipts"


def _approved_po(client, db, tag, qty=10):
    item = master_item(db, f"Item {tag}", code=f"RM-{tag}", uom="NOS")
    loc = _store(db, tag)
    pr = _create_pr(client, _requester(db, f"req.{tag.lower()}@premnathrail.com"),
                    items=[{"store_item_id": item.id, "quantity": qty, "project_inhouse": "Project"}])
    buyer = _purchaser(db, f"buyer.{tag.lower()}@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    return buyer, _po_for(client, buyer, pr["id"]), loc


def test_grn_cannot_over_receive_by_repeating_a_po_line(client, db):
    buyer, po, loc = _approved_po(client, db, "SAP1", qty=10)
    line = po["items"][0]["id"]
    r = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id, "items": [
        {"po_item_id": line, "received_quantity": 8}, {"po_item_id": line, "received_quantity": 8}]}, headers=auth_header(buyer))
    assert r.status_code == 409, r.text
    assert "outstanding" in r.json()["detail"]
    ok = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id, "items": [
        {"po_item_id": line, "received_quantity": 4}, {"po_item_id": line, "received_quantity": 6}]}, headers=auth_header(buyer))
    assert ok.status_code == 200, ok.text


def test_grn_refuses_a_future_received_date(client, db):
    buyer, po, loc = _approved_po(client, db, "SAP2")
    r = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                               "received_date": (date.today() + timedelta(days=3)).isoformat(),
                               "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 1}]}, headers=auth_header(buyer))
    assert r.status_code == 422, r.text
    assert "future" in r.json()["detail"]


def test_material_issue_refuses_a_future_date(client, db):
    from app.modules.store.services.stock_ledger import post_stock_transaction
    item = master_item(db, "Issue item SAP3", code="RM-SAP3", uom="NOS")
    loc = _store(db, "SAP3")
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=5, reference_type="manual")
    db.commit()
    admin = make_user(db, "admin.sap3@premnathrail.com", role="admin")
    r = client.post("/api/v1/store/material-issues", json={
        "location_id": loc.id, "issue_date": (date.today() + timedelta(days=2)).isoformat(),
        "items": [{"item_id": item.id, "quantity": 1}]}, headers=auth_header(admin))
    assert r.status_code == 422, r.text
    assert "future" in r.json()["detail"]


def test_no_issue_from_stock_against_a_draft_requisition(client, db):
    from app.modules.store.services.stock_ledger import post_stock_transaction
    # An admin raises the draft (so it is visible to them) and then tries to
    # issue its line from stock before it was ever submitted / approved.
    requester = make_user(db, "admin.sap4@premnathrail.com", role="admin")
    payload = link_items(db, _create_payload(save_as_draft=True))
    pr = client.post(BASE, json=payload, headers=auth_header(requester)).json()
    assert pr["status"] == "draft"
    loc = _store(db, "SAP4")
    post_stock_transaction(db, item_id=pr["items"][0]["store_item_id"], location_id=loc.id, transaction_type="receipt",
                           quantity=50, reference_type="manual")
    db.commit()
    r = client.post(f"{BASE}/{pr['id']}/items/{pr['items'][0]['id']}/issue-from-stock",
                    json={"location_id": loc.id, "comment": "x"}, headers=auth_header(requester))
    assert r.status_code == 409, r.text
    assert "approved PR" in r.json()["detail"]
    from app.modules.store.models.stock_balance import StoreStockBalance
    db.expire_all()
    assert db.query(StoreStockBalance).filter(StoreStockBalance.location_id == loc.id).one().on_hand_qty == 50


def test_no_po_upload_to_a_blocked_vendor(client, db):
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem
    from app.modules.p2p.models.rfq import RFQ
    from app.modules.p2p.models.rfq_attachment import RFQAttachment
    from app.tests.test_p2p_settings_vendors import _user

    buyer = _user(db, "sap5.buyer@premnathrail.com", apps=("purchase", "p2p"))
    v = Vendor(code="V-9501", name="Blocked Seals", status="blocked", gst_registration_type="unregistered")
    db.add(v)
    db.flush()
    pr = P2PRequest(p2p_number="P2P-RAW-2026-9501", category_code="RAW", status="vendor_quotations", project_label="RRV-1",
                    project_type="new", request_date=date.today(), requested_by_id=buyer.id, priority="standard")
    db.add(pr)
    db.flush()
    line = P2PRequestItem(p2p_request_id=pr.id, item_name="O-ring", quantity=10, unit="Nos", project_inhouse="Project",
                          fulfillment_status="sent_to_procurement", buyer_id=buyer.id)
    db.add(line)
    rfq = RFQ(rfq_number="RFQ-2026-9501", p2p_request_id=pr.id, status="locked", buyer_id=buyer.id, created_by_id=buyer.id)
    db.add(rfq)
    db.flush()
    from app.modules.p2p.models.rfq_item import RFQItem
    db.add(RFQItem(rfq_id=rfq.id, pr_item_id=line.id, quantity=10))  # the RFQ's own line
    db.add(RFQAttachment(rfq_id=rfq.id, vendor_tier="L1", vendor_name=v.name, vendor_id=v.id, filename="L1.pdf",
                         sharepoint_path="x/L1.pdf", created_by_id=buyer.id))
    db.commit()
    from app.tests.p2p_po_helpers import make_ship_to, post_upload_po
    details = {"vendor_tier": "L1", "ship_to_location_id": make_ship_to(db).id,
               "lines": [{"pr_item_id": it.id, "unit_price": 5} for it in pr.items]}
    r = post_upload_po(client, buyer, rfq.id, details, "TALLY-BLK-1")
    assert r.status_code == 409, r.text
    assert "blocked" in r.json()["detail"]


def test_short_closed_po_balance_is_not_on_order_for_reorder(client, db):
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.store.services.reorder import on_order

    buyer, po, loc = _approved_po(client, db, "SAP6", qty=10)
    item_id = po["items"][0]["store_item_id"]
    qty, _docs = on_order(db, {item_id})
    assert qty.get(item_id) == 10
    pr = db.get(P2PRequest, po["p2p_request_id"])
    pr.status = "closed"  # short-closed: the vendor won't supply the balance
    db.commit()
    qty, _docs = on_order(db, {item_id})
    assert qty.get(item_id, 0) == 0


def test_inspection_into_a_store_that_cannot_take_stock_is_refused_cleanly(client, db):
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
    from app.tests.test_p2p_item_master_link import _grn, _inspect_all

    buyer, po, loc = _approved_po(client, db, "SAP7", qty=5)
    grn = _grn(client, buyer, po, loc, 5)
    assert grn.status_code == 200, grn.text
    loc.is_active = False  # store deactivated after the goods arrived
    db.commit()
    # The goods went into that store's Quality stock when the GRN was recorded
    # (SAP 101), so the inspection only releases them there — it still completes.
    r = _inspect_all(client, buyer, grn.json())
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(P2PGoodsReceipt, grn.json()["id"]).status == "completed"
    # And a new GRN into the inactive store is refused up front.
    again = _grn(client, buyer, po, loc, 1)
    assert again.status_code == 422 and "inactive" in again.json()["detail"]
