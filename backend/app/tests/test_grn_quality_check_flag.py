"""GRN posting is decided by the Item Master flag "Quality check on receipt"
(store_items.inspection_on_receipt), 2026-11-03:

  * item WITHOUT the flag -> the received quantity goes straight into Free
    stock when the GRN is recorded, the line is accepted (passed / free) and a
    GRN made only of such lines is Completed at once (nobody inspected it, so
    no inspector is stamped);
  * item WITH the flag -> Quality lot + Quality stock, line in_quality, GRN
    stays draft until Quality's usage decision;
  * asset line -> unchanged: no stock, line pending, accept / reject on the GRN.

`decide_grn_lots` is the shared stand-in for Quality's usage decision (the real
decision flow with plans / results is covered in test_quality_phase1); other
GRN tests import it to drive a flagged line to Free / Blocked stock."""
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.store.models.serial_number import StoreSerialEvent, StoreSerialNumber
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_item_master_link import _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _approve_and_raise_po, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header,
)
from app.tests.test_quality_phase1 import make_user

GRN = "/api/v1/p2p/goods-receipts"


def decide_grn_lots(db, grn_id, decision="accept", accepted_qty=None, rejected_qty=None):
    """Quality's usage decision on every incoming lot of a GRN (no plan / result
    entry): puts the lot at 'results recorded' and decides it through the same
    service the Quality page uses, so stock moves Quality -> Free / Blocked and
    the split is written back to the GRN line."""
    from app.modules.quality.services import lots as lot_svc
    head = make_user(db, f"qhead.grn{grn_id}@x.com", quality_role="head")
    lots = db.query(QualityInspectionLot).filter(QualityInspectionLot.source_type == "grn",
                                                 QualityInspectionLot.source_id == grn_id).all()
    assert lots, "the GRN raised no incoming lot"
    for lot in lots:
        lot.status = "results_recorded"
        lot_svc.decide(db, lot, decision=decision, user=head, accepted_qty=accepted_qty, rejected_qty=rejected_qty)
    db.commit()
    db.expire_all()


def _bal(db, item_id, loc_id) -> StoreStockBalance:
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=loc_id).one()


def _setup(client, db, tag, items):
    """items: [(name, qty, flagged, serial)] -> (master items, store, buyer, po, pr). PO is priced at 100 a unit."""
    masters = []
    for i, (name, qty, flagged, serial) in enumerate(items):
        it = master_item(db, f"{name} {tag}", code=f"QC-{tag}-{i}", uom="NOS")
        it.inspection_on_receipt = flagged
        it.serial_controlled = serial
        masters.append(it)
    db.commit()
    loc = _store(db, f"Q{tag}")
    pr = _create_pr(client, _requester(db, f"req.qc{tag.lower()}@premnathrail.com"),
                    items=[{"store_item_id": it.id, "quantity": spec[1], "project_inhouse": "Project"}
                           for it, spec in zip(masters, items)])
    buyer = _purchaser(db, f"buyer.qc{tag.lower()}@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    return masters, loc, buyer, _po_for(client, buyer, pr["id"]), pr


def _grn(client, buyer, po, loc, qtys, serials=None):
    lines = []
    for i, q in enumerate(qtys):
        line = {"po_item_id": po["items"][i]["id"], "received_quantity": q}
        if serials and serials.get(i):
            line["serials"] = serials[i]
        lines.append(line)
    return client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id, "items": lines}, headers=auth_header(buyer))


def _inspect_line(client, buyer, grn, idx=0):
    line = grn["items"][idx]
    return client.post(f"{GRN}/{grn['id']}/inspect", json={"items": [
        {"item_id": line["id"], "accepted_quantity": line["received_quantity"], "rejected_quantity": 0, "quality_status": "passed"}]},
        headers=auth_header(buyer))


def test_item_without_the_flag_goes_straight_to_free_stock_and_the_grn_completes_at_once(client, db):
    db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))  # stock is valued at the PO rate
    db.commit()
    (item,), loc, buyer, po, pr = _setup(client, db, "N1", [("Washer", 5, False, False)])
    r = _grn(client, buyer, po, loc, [5])
    assert r.status_code == 200, r.text
    grn = r.json()
    line = grn["items"][0]
    assert grn["status"] == "completed"
    assert grn["inspected_by_id"] is None and grn["inspected_at"] is None  # nobody inspected it
    assert (line["quality_status"], line["receipt_posting"]) == ("passed", "free")
    assert (line["accepted_quantity"], line["rejected_quantity"]) == (5, 0)

    b = _bal(db, item.id, loc.id)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (5, 0, 0)
    rows = db.query(StoreStockTransaction).filter(StoreStockTransaction.reference_type == "grn").all()
    assert [(t.item_id, t.transaction_type, t.quantity, t.unit_cost) for t in rows] == [(item.id, "receipt", 5, 100)]
    assert rows[0].cost_source == "po_rate"
    assert db.query(QualityInspectionLot).count() == 0  # no lot for an unflagged item

    # PO / PR receipt status rolled up at once.
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()["status"] == "received"

    # Audit trail on the requisition says why nobody inspected it.
    db.expire_all()
    done = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr["id"], action="grn_completed_on_receipt").all()
    assert len(done) == 1
    assert grn["grn_number"] in done[0].summary and "no quality check needed" in done[0].summary and "Free stock" in done[0].summary

    # Nothing left to inspect: a real reason, not a silent success.
    again = _inspect_line(client, buyer, grn)
    assert again.status_code == 409 and "already been completed" in again.json()["detail"]
    assert _bal(db, item.id, loc.id).on_hand_qty == 5  # and no double posting


def test_item_with_the_flag_gets_a_quality_lot_and_quality_stock_and_the_grn_stays_draft(client, db):
    (item,), loc, buyer, po, pr = _setup(client, db, "F1", [("Brake block", 5, True, False)])
    r = _grn(client, buyer, po, loc, [5])
    assert r.status_code == 200, r.text
    grn = r.json()
    line = grn["items"][0]
    assert grn["status"] == "draft"
    assert (line["quality_status"], line["receipt_posting"]) == ("in_quality", "lot")
    b = _bal(db, item.id, loc.id)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (0, 5, 0)  # visible, not issuable
    lot = db.query(QualityInspectionLot).filter_by(source_type="grn", source_id=grn["id"]).one()
    assert lot.quantity == 5 and lot.grn_item_id == line["id"]
    # The store can't decide a line Quality owns; the PR isn't received yet.
    refused = _inspect_line(client, buyer, grn)
    assert refused.status_code == 409 and "Quality" in refused.json()["detail"]
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()["status"] != "received"

    decide_grn_lots(db, grn["id"], "accept")
    b = _bal(db, item.id, loc.id)
    assert (b.on_hand_qty, b.quality_qty) == (5, 0)
    done = client.get(f"{GRN}/{grn['id']}", headers=auth_header(buyer)).json()
    assert done["status"] == "completed" and done["items"][0]["quality_status"] == "passed"
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()["status"] == "received"


def test_mixed_grn_unflagged_line_is_free_at_once_and_the_grn_completes_when_the_lot_is_decided(client, db):
    (plain, flagged), loc, buyer, po, pr = _setup(client, db, "M1", [("Washer", 4, False, False), ("Brake block", 6, True, False)])
    r = _grn(client, buyer, po, loc, [4, 6])
    assert r.status_code == 200, r.text
    grn = r.json()
    by_item = {i["store_item_id"]: i for i in grn["items"]}
    assert by_item[plain.id]["receipt_posting"] == "free" and by_item[plain.id]["quality_status"] == "passed"
    assert by_item[flagged.id]["receipt_posting"] == "lot" and by_item[flagged.id]["quality_status"] == "in_quality"
    assert grn["status"] == "draft"

    pb, fb = _bal(db, plain.id, loc.id), _bal(db, flagged.id, loc.id)
    assert (pb.on_hand_qty, pb.quality_qty) == (4, 0)  # usable at once
    assert (fb.on_hand_qty, fb.quality_qty) == (0, 6)  # still waiting for Quality
    # No completion audit row while a lot is open.
    assert db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr["id"], action="grn_completed_on_receipt").count() == 0

    decide_grn_lots(db, grn["id"], "partial", accepted_qty=5, rejected_qty=1)
    fb = _bal(db, flagged.id, loc.id)
    assert (fb.on_hand_qty, fb.quality_qty, fb.quarantine_qty) == (5, 0, 1)
    assert _bal(db, plain.id, loc.id).on_hand_qty == 4
    done = client.get(f"{GRN}/{grn['id']}", headers=auth_header(buyer)).json()
    assert done["status"] == "completed"
    assert {i["store_item_id"]: i["quality_status"] for i in done["items"]} == {plain.id: "passed", flagged.id: "partial"}


def test_reversing_a_completed_direct_grn_takes_the_stock_back_out_of_free(client, db):
    (item,), loc, buyer, po, pr = _setup(client, db, "R1", [("Washer", 5, False, False)])
    grn = _grn(client, buyer, po, loc, [5]).json()
    assert grn["status"] == "completed" and _bal(db, item.id, loc.id).on_hand_qty == 5
    r = client.post(f"{GRN}/{grn['id']}/reverse", json={"reason": "entered against the wrong PO"}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    b = _bal(db, item.id, loc.id)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (0, 0, 0)
    types = [t.transaction_type for t in db.query(StoreStockTransaction).filter_by(item_id=item.id).order_by(StoreStockTransaction.id)]
    assert types == ["receipt", "return_out"]
    db.expire_all()
    assert db.get(P2PGoodsReceipt, grn["id"]).status == "reversed"
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()["status"] != "received"


def test_return_to_vendor_of_a_direct_posted_line_takes_it_out_of_free_stock(client, db):
    (item,), loc, buyer, po, _pr = _setup(client, db, "V1", [("Washer", 5, False, False)])
    grn = _grn(client, buyer, po, loc, [5]).json()
    rtv = client.post("/api/v1/p2p/vendor-returns", json={"goods_receipt_id": grn["id"], "reason": "quality_rejection", "items": [
        {"grn_item_id": grn["items"][0]["id"], "source": "accepted", "quantity": 2}]}, headers=auth_header(buyer))
    assert rtv.status_code == 201, rtv.text
    assert _bal(db, item.id, loc.id).on_hand_qty == 3


def test_serialised_item_without_the_flag_has_its_units_in_stock_right_after_the_grn(client, db):
    (item,), loc, buyer, po, _pr = _setup(client, db, "S1", [("Hydraulic pump", 2, False, True)])
    r = _grn(client, buyer, po, loc, [2], serials={0: ["K-1", "K-2"]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    db.expire_all()
    assert {u.serial_no: u.status for u in db.query(StoreSerialNumber).filter_by(item_id=item.id)} == {"K-1": "in_stock", "K-2": "in_stock"}
    assert _bal(db, item.id, loc.id).on_hand_qty == 2
    unit = db.query(StoreSerialNumber).filter_by(item_id=item.id, serial_no="K-1").one()
    events = [e.event for e in db.query(StoreSerialEvent).filter_by(serial_id=unit.id).order_by(StoreSerialEvent.id)]
    assert events[0] == "received" and events[-1] == "inspection_accepted"


def test_asset_line_still_waits_for_accept_reject_on_the_grn(client, db):
    (item,), loc, buyer, po, _pr = _setup(client, db, "A1", [("Test rig", 1, False, False)])
    db.query(P2PPurchaseOrderItem).filter_by(id=po["items"][0]["id"]).update({"item_category": "asset"})
    db.commit()
    grn = _grn(client, buyer, po, loc, [1]).json()
    assert grn["status"] == "draft"
    assert (grn["items"][0]["quality_status"], grn["items"][0]["receipt_posting"]) == ("pending", "none")
    assert db.query(StoreStockBalance).filter_by(item_id=item.id).count() == 0
    done = _inspect_line(client, buyer, grn)
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "completed"


def test_flipping_the_quality_flag_on_an_item_is_written_to_the_audit_trail(client, db):
    admin = make_user(db, "flag.admin@x.com", role="admin", apps=("store",))
    item = master_item(db, "Audit washer", code="QC-AUD-1")
    r = client.patch(f"/api/v1/store/items/{item.id}", json={"inspection_on_receipt": True}, headers=auth_header(admin))
    assert r.status_code == 200, r.text
    # Saving the same value again is not a change.
    assert client.patch(f"/api/v1/store/items/{item.id}", json={"inspection_on_receipt": True}, headers=auth_header(admin)).status_code == 200
    db.expire_all()
    rows = db.query(AuditLog).filter_by(entity_type="store_item", entity_id=item.id, action="quality_flag_changed").all()
    assert len(rows) == 1 and rows[0].performed_by_id == admin.id
    assert "Quality check on receipt" in rows[0].summary and "from No to Yes" in rows[0].summary
