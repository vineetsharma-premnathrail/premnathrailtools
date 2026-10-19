"""SAP MM standards in P2P / Store (2026-10-13):

- MB5B: stock and closing-stock valuation as of a date, rebuilt from the ledger
  (Free + Quality + Blocked + with job-work vendor);
- MMPV/OMSY: no goods movement dated in a closed Finance period;
- ME21N item categories: service lines -> service entry sheet, asset lines ->
  GRN without store stock;
- MIGO 101: every GRN stock line is in Quality stock from receipt, the GRN
  inspection releases / blocks it;
- MIRO: line-level 3-way match per PO line, same unit, price/qty tolerances."""
from datetime import date, datetime, timezone

import pytest

from app.modules.accounts.models.period_close import PeriodClose
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_cov_controls_finance import books  # noqa: F401 — fixture
from app.tests.test_p2p_item_master_link import _inspect_all, _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_and_raise_po, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header, make_user,
)

GRN = "/api/v1/p2p/goods-receipts"


def _bal(db, item_id, loc_id) -> StoreStockBalance:
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=loc_id).one()


# ── MB5B ─────────────────────────────────────────────────────────────────────

def test_stock_as_of_date_is_rebuilt_from_the_ledger_with_every_stock_type(db):
    from app.modules.store.services.stock_asof import closing_stock_rows, quantities_as_of

    item = StoreItem(item_code="MB5B-1", item_name="Round bar", uom="KG", moving_average_cost=50, category="Raw")
    loc = StoreLocation(name="MB5B store", code="MB5B")
    db.add_all([item, loc])
    db.flush()
    post = lambda t, q, d: post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type=t, quantity=q,
                                                  transaction_date=d, reference_type="manual")
    post("receipt", 10, date(2026, 9, 5))
    post("quality_in", 2, date(2026, 9, 10))      # awaiting inspection — still ours
    post("free_block", 1, date(2026, 9, 12))      # blocked — still ours
    post("jobwork_out", 3, date(2026, 9, 20))     # with the job-work vendor — still ours
    post("issue", 4, date(2026, 10, 2))           # after period end — must not change September
    db.commit()

    sep = quantities_as_of(db, date(2026, 9, 30))[(item.id, loc.id)]
    assert (sep["free"], sep["quality"], sep["blocked"], sep["vendor"], sep["total"]) == (6, 2, 1, 3, 12)
    assert quantities_as_of(db, date(2026, 10, 2))[(item.id, loc.id)]["total"] == 8
    row = next(r for r in closing_stock_rows(db, date(2026, 9, 30)) if r["store_item_id"] == item.id)
    assert (row["quantity"], row["value"]) == (12, 600)


def test_closing_stock_valuation_uses_period_end_quantity_not_today(books):  # noqa: F811
    from app.modules.accounts.services import inventory

    db = books["db"]
    item = StoreItem(item_code="MB5B-2", item_name="Plate", uom="KG", moving_average_cost=80, category="Raw")
    loc = StoreLocation(name="Main MB5B", code="MB5B2")
    db.add_all([item, loc])
    db.flush()
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=100,
                           transaction_date=date(2026, 9, 1), reference_type="manual")
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="quality_in", quantity=10,
                           transaction_date=date(2026, 9, 2), reference_type="manual")
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="jobwork_out", quantity=5,
                           transaction_date=date(2026, 9, 3), reference_type="manual")
    # Issued in October: today's balance is 50 lower, September's closing stock is not.
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="issue", quantity=50,
                           transaction_date=date(2026, 10, 1), reference_type="manual")
    db.commit()
    val = inventory.create_valuation(db, accounting_period="2026-09", created_by_id=books["maker"].id)
    line = next(l for l in val.lines if l.store_item_id == item.id)
    assert line.quantity == 110  # 95 free + 10 quality + 5 with vendor - nothing issued yet
    assert line.value == 8800


def test_stock_on_date_report_and_future_date(client, db):
    item = master_item(db, "MB5B report item", code="MB5B-3", uom="NOS")
    loc = _store(db, "MB5B3")
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=7,
                           transaction_date=date(2026, 9, 3), reference_type="manual")
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="issue", quantity=2,
                           transaction_date=date(2026, 9, 20), reference_type="manual")
    db.commit()
    admin = make_user(db, "admin.mb5b@premnathrail.com", role="admin")
    r = client.get("/api/v1/store/stock/as-of", params={"date": "2026-09-30", "from_date": "2026-09-10", "item_id": item.id},
                   headers=auth_header(admin))
    assert r.status_code == 200, r.text
    row = r.json()["rows"][0]
    assert (row["opening_qty"], row["receipt_qty"], row["issue_qty"], row["closing_qty"]) == (7, 0, 2, 5)
    bad = client.get("/api/v1/store/stock/as-of", params={"date": "2999-01-01"}, headers=auth_header(admin))
    assert bad.status_code == 422 and "future" in bad.json()["detail"]
    xl = client.get("/api/v1/store/stock/as-of/export", params={"date": "2026-09-30"}, headers=auth_header(admin))
    assert xl.status_code == 200 and xl.content[:2] == b"PK"


# ── MMPV / OMSY ──────────────────────────────────────────────────────────────

def test_goods_movement_in_a_closed_period_is_refused(db):
    item = StoreItem(item_code="MMPV-1", item_name="Bolt", uom="NOS")
    loc = StoreLocation(name="MMPV store", code="MMPV")
    db.add_all([item, loc, PeriodClose(accounting_period="2026-08", status="closed")])
    db.commit()
    with pytest.raises(ValueError, match="Period Aug-2026 is closed in Finance › Period Close"):
        post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=1,
                               transaction_date=date(2026, 8, 20), reference_type="manual")
    db.rollback()
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=1,
                           transaction_date=date(2026, 9, 1), reference_type="manual")


def test_grn_dated_in_a_closed_period_is_refused(client, db):
    buyer, po, loc = _po(client, db, "MMPV2")
    db.add(PeriodClose(accounting_period="2026-09", status="closed"))
    db.commit()
    po_row = db.get(P2PPurchaseOrder, po["id"])
    po_row.po_date = date(2026, 9, 1)
    db.commit()
    r = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id, "received_date": "2026-09-15",
                               "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 1}]}, headers=auth_header(buyer))
    assert r.status_code == 409 and "closed in Finance" in r.json()["detail"]


# ── MIGO 101 ─────────────────────────────────────────────────────────────────

def _po(client, db, tag, qty=10, item_type=None):
    item = master_item(db, f"Item {tag}", code=f"RM-{tag}", uom="NOS")
    if item_type:
        item.item_type = item_type
        db.commit()
    loc = _store(db, tag)
    pr = _create_pr(client, _requester(db, f"req.{tag.lower()}@premnathrail.com"),
                    items=[{"store_item_id": item.id, "quantity": qty, "project_inhouse": "Project"}])
    buyer = _purchaser(db, f"buyer.{tag.lower()}@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    return buyer, _po_for(client, buyer, pr["id"]), loc


def test_grn_needs_a_store(client, db):
    buyer, po, _loc = _po(client, db, "M101A")
    r = client.post(GRN, json={"purchase_order_id": po["id"], "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 1}]},
                    headers=auth_header(buyer))
    assert r.status_code == 422 and "Pick the store" in r.json()["detail"]


def test_grn_posts_into_quality_stock_at_once_and_inspection_releases_and_blocks(client, db):
    buyer, po, loc = _po(client, db, "M101B")
    item_id = po["items"][0]["store_item_id"]
    g = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                               "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 10}]}, headers=auth_header(buyer))
    assert g.status_code == 200, g.text
    assert g.json()["items"][0]["receipt_posting"] == "quality"
    b = _bal(db, item_id, loc.id)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (0, 10, 0)  # visible at once, not issuable
    r = client.post(f"{GRN}/{g.json()['id']}/inspect", json={"items": [
        {"item_id": g.json()["items"][0]["id"], "accepted_quantity": 7, "rejected_quantity": 3, "quality_status": "partial",
         "rejection_reason": "dented"}]}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    b = _bal(db, item_id, loc.id)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (7, 0, 3)
    # Rejected goods leave Blocked stock when they go back to the vendor.
    rtv = client.post("/api/v1/p2p/vendor-returns", json={"goods_receipt_id": g.json()["id"], "reason": "quality_rejection", "items": [
        {"grn_item_id": g.json()["items"][0]["id"], "source": "rejected", "quantity": 3}]}, headers=auth_header(buyer))
    assert rtv.status_code == 201, rtv.text
    assert _bal(db, item_id, loc.id).quarantine_qty == 0


def test_draft_grn_in_quality_stock_can_be_reversed(client, db):
    buyer, po, loc = _po(client, db, "M101C")
    item_id = po["items"][0]["store_item_id"]
    g = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                               "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 4}]}, headers=auth_header(buyer)).json()
    r = client.post(f"{GRN}/{g['id']}/reverse", json={"reason": "wrong PO"}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    b = _bal(db, item_id, loc.id)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (0, 0, 0)


# ── ME21N item categories ────────────────────────────────────────────────────

def test_service_line_is_confirmed_by_service_entry_not_grn(client, db):
    buyer, po, loc = _po(client, db, "SRV1", qty=4, item_type="service")
    assert po["items"][0]["category"] == "service"
    r = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                               "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 1}]}, headers=auth_header(buyer))
    assert r.status_code == 422 and "service entry" in r.json()["detail"]
    pending = client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(buyer)).json()
    assert po["id"] not in [p["id"] for p in pending]

    admin = make_user(db, "admin.srv1@premnathrail.com", role="admin")
    too_much = client.post(f"/api/v1/p2p/purchase-orders/{po['id']}/service-entries", json={"po_item_id": po["items"][0]["id"], "quantity": 5},
                           headers=auth_header(admin))
    assert too_much.status_code == 409
    e = client.post(f"/api/v1/p2p/purchase-orders/{po['id']}/service-entries",
                    json={"po_item_id": po["items"][0]["id"], "quantity": 4, "description": "AMC Q3"}, headers=auth_header(admin))
    assert e.status_code == 201, e.text
    acc = client.post(f"/api/v1/p2p/service-entries/{e.json()['id']}/accept", headers=auth_header(admin))
    assert acc.status_code == 200 and acc.json()["status"] == "accepted"
    db.expire_all()
    assert db.get(P2PPurchaseOrder, po["id"]).status == "fulfilled"
    assert db.query(StoreStockBalance).filter_by(item_id=po["items"][0]["store_item_id"]).count() == 0
    overview = client.get(f"/api/v1/p2p/purchase-orders/{po['id']}/service-entries", headers=auth_header(admin)).json()
    assert overview["service_lines"][0]["accepted_quantity"] == 4


def test_asset_line_is_received_on_the_grn_without_store_stock(client, db):
    buyer, po, loc = _po(client, db, "AST1", qty=1, item_type="asset")
    assert po["items"][0]["category"] == "asset"
    g = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                               "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 1}]}, headers=auth_header(buyer))
    assert g.status_code == 200, g.text
    done = _inspect_all(client, buyer, g.json())
    assert done.status_code == 200 and done.json()["status"] == "completed"
    assert any("asset line" in n for n in done.json()["stock_sync_notes"])
    assert db.query(StoreStockBalance).filter_by(item_id=po["items"][0]["store_item_id"]).count() == 0


# ── MIRO line-level 3-way match ─────────────────────────────────────────────

def _two_line_po(db, number):
    now = datetime.now(timezone.utc)
    pr = P2PRequest(p2p_number=f"P2P-RAW-2026-L{number}", category_code="RAW", request_date=date(2026, 6, 1), status="po_approved")
    pr.purchase_head_approved_at = pr.director_approved_at = pr.partner_approved_at = now
    db.add(pr)
    db.flush()
    po = P2PPurchaseOrder(po_number=f"PO-L-{number}", p2p_request_id=pr.id, vendor_name="Pune Steels", status="issued",
                          po_date=date(2026, 6, 2), total_value=2000)
    db.add(po)
    db.flush()
    bolts = P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Bolt", unit="NOS", quantity=10, unit_price=100)
    wire = P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Wire", unit="KG", quantity=10, unit_price=100)
    db.add_all([bolts, wire])
    db.flush()
    grn = P2PGoodsReceipt(grn_number=f"GRN-L-{number}", purchase_order_id=po.id, status="completed", received_date=date(2026, 7, 1))
    db.add(grn)
    db.flush()
    for line, acc in ((bolts, 4), (wire, 6)):
        db.add(P2PGoodsReceiptItem(goods_receipt_id=grn.id, po_item_id=line.id, item_name=line.item_name, unit=line.unit,
                                   ordered_quantity=10, received_quantity=acc, accepted_quantity=acc, quality_status="passed"))
    db.commit()
    return po, bolts, wire


def _bill(b, po, number, lines):
    from app.modules.accounts import service
    inv = service.create_vendor_invoice(b["db"], purchase_order_id=po.id, invoice_number=number, invoice_date=date(2026, 7, 10),
                                        created_by_id=b["maker"].id, lines=[{"description": "x", "gst_rate": 18, **l} for l in lines])
    b["db"].commit()
    return inv


def test_offsetting_line_differences_no_longer_match(books):  # noqa: F811
    po, bolts, wire = _two_line_po(books["db"], "1")
    # 10 units in total = 4 + 6 received, but 6 bolts (only 4 received) and 4 wire.
    inv = _bill(books, po, "INV-L-1", [{"po_item_id": bolts.id, "quantity": 6, "rate": 100},
                                      {"po_item_id": wire.id, "quantity": 4, "rate": 100}])
    assert inv.matching_status == "variance"
    by_item = {l.po_item_id: l for l in inv.lines}
    assert by_item[bolts.id].match_status == "variance" and by_item[bolts.id].qty_variance == 2
    assert by_item[wire.id].match_status == "matched"


def test_line_match_within_tolerance_and_price_cap(books):  # noqa: F811
    po, bolts, wire = _two_line_po(books["db"], "2")
    ok = _bill(books, po, "INV-L-2", [{"po_item_id": bolts.id, "quantity": 4, "rate": 100.5},
                                     {"po_item_id": wire.id, "quantity": 6, "rate": 100}])
    assert ok.matching_status == "matched"
    po2, bolts2, _ = _two_line_po(books["db"], "3")
    dear = _bill(books, po2, "INV-L-3", [{"po_item_id": bolts2.id, "quantity": 4, "rate": 110}])
    assert dear.matching_status == "variance" and dear.lines[0].price_variance == 40


def test_line_in_another_unit_or_without_po_line_is_refused(books):  # noqa: F811
    po, bolts, wire = _two_line_po(books["db"], "4")
    with pytest.raises(ValueError, match="different units are never compared"):
        _bill(books, po, "INV-L-4", [{"po_item_id": wire.id, "quantity": 6, "rate": 100, "uom": "MTR"}])
    books["db"].rollback()
    with pytest.raises(ValueError, match="pick which line of PO"):
        _bill(books, po, "INV-L-5", [{"quantity": 4, "rate": 100}])
