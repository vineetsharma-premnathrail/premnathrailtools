"""Before-PO receipt (BPO) puts the goods into stock the moment it is saved (owner, 2026-11-06); the GRN on the
PO made from it SETTLES that quantity instead of posting it again.

A1 non-QC item -> Free stock at once, issuable, ledger row carries the BPO number
A2 QC-flagged item -> Quality stock + a 'pre_po_receipt' lot; accepting the lot -> Free
A3 typed rate -> ledger unit_cost = rate (valuation on)
A4 GRN for the same quantity -> stock unchanged, line.pre_po_qty, receipt closes when the PO is fulfilled
A5 GRN for more than the BPO quantity -> only the excess posts
A6 cancel the BPO before its PO -> stock goes back; refused with the reason when issued / lot undecided
A7 an old BPO (stock_posted False) -> its GRN posts the stock as before
plus: refusals (no store, batch-tracked, zero rate), GRN store must match, GRN reversal of a settled line,
permission and data-scope on cancel, the GRN form fields."""
from types import SimpleNamespace

from app.modules.main.models.module_setting import ModuleSetting
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.valuation import StoreItemValuation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow
from app.tests.test_mm_po_split_amend_quotes import _decide_all
from app.tests.test_p2p_item_master_link import _grn
from app.tests.test_p2p_requests import (  # noqa: F401 - _sqlite_number_series is an autouse fixture
    _purchaser, _sqlite_number_series, auth_header, make_user,
)
from app.tests.test_pre_po_receipts import PROC, STORE, _body, _store, _store_user, _upload_on, _vendor
from app.tests.test_quality_phase1 import make_user as make_quality_user

GRN = "/api/v1/p2p/goods-receipts"
_n = {"lot": 0}


def _flow(client, db, tag, qty=7, flagged=False, rate=None, unit_price=9, approve=True):
    """BPO (Free / Quality stock) -> requisition -> Tally PO uploaded -> PO approved. Returns the pieces."""
    admin = make_user(db, f"bps.admin.{tag}@premnathrail.com", role="admin")
    approver = make_user(db, f"bps.approver.{tag}@premnathrail.com")
    partner = make_user(db, f"bps.partner.{tag}@premnathrail.com", is_partner=True)
    set_po_workflow(db, [approver.id], admin, partner=True)
    keeper = _store_user(db, f"bps.keeper.{tag}@premnathrail.com")
    vendor = _vendor(db, f"V-S{tag}")
    item = master_item(db, f"Item S{tag}", code=f"BS-{tag}", uom="Nos", inspection_on_receipt=flagged)
    body = _body(vendor, item, qty)
    if rate is not None:
        body["items"][0]["unit_rate"] = rate
    r = client.post(STORE, json=body, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    rec = r.json()
    buyer = _purchaser(db, f"bps.buyer.{tag}@premnathrail.com")
    out = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=auth_header(buyer))
    assert out.status_code == 200, out.text
    pr_id = db.get(StorePrePoReceipt, rec["id"]).p2p_request_id
    up = _upload_on(client, db, buyer, out.json()["rfq"]["id"], pr_id, tally=f"TALLY-S{tag}", unit_price=unit_price)
    assert up.status_code == 200, up.text
    po = up.json()
    if approve:
        _decide_all(client, db, "p2p_purchase_order", po["id"], [approver, partner])
    full = client.get(f"/api/v1/p2p/purchase-orders/{po['id']}", headers=auth_header(buyer)).json()
    loc = db.query(StoreLocation).filter_by(manager_user_id=keeper.id).one()
    return SimpleNamespace(keeper=keeper, buyer=buyer, item=item, rec=rec, po=full, loc=loc, vendor=vendor)


def _balance(db, item_id, loc_id) -> StoreStockBalance | None:
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=loc_id).first()


def _decide_lots(db, source_type, source_id, decision="accept"):
    """Quality's usage decision on every open lot of a source (stand-in for the plan / result entry)."""
    from app.modules.quality.services import lots as lot_svc
    _n["lot"] += 1
    head = make_quality_user(db, f"qhead.bps{_n['lot']}@x.com", quality_role="head")
    lots = db.query(QualityInspectionLot).filter(QualityInspectionLot.source_type == source_type,
                                                 QualityInspectionLot.source_id == source_id,
                                                 QualityInspectionLot.decision.is_(None)).all()
    assert lots, "no undecided lot"
    for lot in lots:
        lot.status = "results_recorded"
        lot_svc.decide(db, lot, decision=decision, user=head)
    db.commit()
    db.expire_all()


# ---------------------------------------------------------------- A1 Free stock at once

def test_a1_a_non_qc_receipt_goes_into_free_stock_at_once_and_is_issuable(client, db):
    keeper = _store_user(db, "bps.a1@premnathrail.com")
    v, item = _vendor(db, "V-A1"), master_item(db, "Bolt A1", code="BPS-A1", uom="Nos")
    r = client.post(STORE, json=_body(v, item, 10), headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stock_posted"] is True
    line = body["items"][0]
    assert line["receipt_posting"] == "free" and line["inspection_lot_id"] is None and line["settled_qty"] == 0
    bal = _balance(db, item.id, body["store_location_id"])
    assert (bal.on_hand_qty, bal.quality_qty, bal.quarantine_qty) == (10, 0, 0)
    txn = db.query(StoreStockTransaction).filter_by(item_id=item.id).one()
    assert (txn.transaction_type, txn.reference_type, txn.reference_number) == ("receipt", "pre_po_receipt", body["receipt_number"])
    assert txn.vendor_name == v.name
    # Ordinary Free stock: it can be issued straight away.
    post_stock_transaction(db, item_id=item.id, location_id=bal.location_id, transaction_type="issue", quantity=4,
                           reference_type="material_issue", reference_number="MI-A1")
    db.commit()
    assert _balance(db, item.id, bal.location_id).on_hand_qty == 6


def test_a1_refusals_name_the_reason_and_leave_nothing_behind(client, db):
    keeper = _store_user(db, "bps.ref@premnathrail.com")
    v = _vendor(db, "V-REF")
    plain = master_item(db, "Plain REF", code="BPS-R0", uom="Nos")
    batch = master_item(db, "Heat REF", code="BPS-R1", uom="Nos", batch_controlled=True)
    serial = master_item(db, "Serial REF", code="BPS-R2", uom="Nos", serial_controlled=True)
    r = client.post(STORE, json=_body(v, batch), headers=auth_header(keeper))
    assert r.status_code == 422 and "batch-tracked" in r.json()["detail"] and "GRN" in r.json()["detail"]
    r = client.post(STORE, json=_body(v, serial), headers=auth_header(keeper))
    assert r.status_code == 422 and "serial" in r.json()["detail"]
    zero = _body(v, plain)
    zero["items"][0]["unit_rate"] = 0
    r = client.post(STORE, json=zero, headers=auth_header(keeper))
    assert r.status_code == 422 and "more than 0" in str(r.json()["errors"])
    neg = _body(v, plain)
    neg["items"][0]["unit_rate"] = -1
    assert client.post(STORE, json=neg, headers=auth_header(keeper)).status_code == 422
    # An admin has no store of their own: the store is mandatory now (no store = no stock).
    admin = make_user(db, "bps.admin.ref@premnathrail.com", role="admin")
    r = client.post(STORE, json=_body(v, plain), headers=auth_header(admin))
    assert r.status_code == 422 and "Pick the store" in r.json()["detail"]
    assert db.query(StorePrePoReceipt).count() == 0 and db.query(StoreStockTransaction).count() == 0


def test_a_posting_refusal_rolls_the_whole_receipt_back_with_the_ledger_reason(client, db, monkeypatch):
    keeper = _store_user(db, "bps.freeze@premnathrail.com")
    v, item = _vendor(db, "V-FRZ"), master_item(db, "Frozen FRZ", code="BPS-F1", uom="Nos")
    other = master_item(db, "Second FRZ", code="BPS-F2", uom="Nos")
    # The ledger refuses a posting (closed period / count in progress / inactive store): the receipt is not saved.
    from app.modules.store.services import posting_period
    monkeypatch.setattr(posting_period, "stock_posting_block_reason", lambda db_, d: "Period Oct-2026 is closed in Finance > Period Close.")
    body = _body(v, item)
    body["items"].append({"store_item_id": other.id, "quantity": 2})
    r = client.post(STORE, json=body, headers=auth_header(keeper))
    assert r.status_code == 409 and "Period Oct-2026 is closed" in r.json()["detail"] and "was not saved" in r.json()["detail"]
    assert db.query(StorePrePoReceipt).count() == 0 and db.query(StoreStockTransaction).count() == 0
    assert db.query(StoreStockBalance).count() == 0


# ---------------------------------------------------------------- A2 Quality stock + lot

def test_a2_a_qc_flagged_item_goes_into_quality_stock_with_a_lot_and_accepting_it_frees_it(client, db):
    keeper = _store_user(db, "bps.a2@premnathrail.com")
    v = _vendor(db, "V-A2")
    item = master_item(db, "Shaft A2", code="BPS-A2", uom="Nos", inspection_on_receipt=True)
    r = client.post(STORE, json=_body(v, item, 5), headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    body = r.json()
    line = body["items"][0]
    assert line["receipt_posting"] == "quality" and line["inspection_lot_id"] and line["inspection_lot_number"]
    bal = _balance(db, item.id, body["store_location_id"])
    assert (bal.on_hand_qty, bal.quality_qty) == (0, 5)  # not issuable until Quality decides
    lot = db.get(QualityInspectionLot, line["inspection_lot_id"])
    assert lot.source_type == "pre_po_receipt" and lot.source_id == body["id"] and lot.source_reference == body["receipt_number"]
    assert lot.quantity == 5 and lot.stock_in_quality is True and lot.vendor_name == v.name
    _decide_lots(db, "pre_po_receipt", body["id"])
    bal = _balance(db, item.id, bal.location_id)
    assert (bal.on_hand_qty, bal.quality_qty) == (5, 0)


# ---------------------------------------------------------------- A3 rate

def test_a3_a_typed_rate_values_the_stock_when_valuation_is_on(client, db):
    db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))
    db.commit()
    keeper = _store_user(db, "bps.a3@premnathrail.com")
    v, item = _vendor(db, "V-A3"), master_item(db, "Plate A3", code="BPS-A3", uom="Nos")
    body = _body(v, item, 4)
    body["items"][0]["unit_rate"] = 12.5
    r = client.post(STORE, json=body, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["unit_rate"] == 12.5
    txn = db.query(StoreStockTransaction).filter_by(item_id=item.id).one()
    assert (txn.unit_cost, txn.value, txn.cost_source) == (12.5, 50.0, "pre_po_rate")
    assert db.get(StoreItemValuation, item.id).value == 50.0


# ---------------------------------------------------------------- A4 GRN settles

def test_a4_the_grn_for_the_same_quantity_settles_it_stock_unchanged_receipt_closes(client, db):
    f = _flow(client, db, "A4", qty=7)
    assert _balance(db, f.item.id, f.loc.id).on_hand_qty == 7
    # The GRN form shows what is already in stock via the BPO.
    pend = client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(f.buyer)).json()
    line = next(p for p in pend if p["id"] == f.po["id"])["items"][0]
    assert line["pre_po_receipt_number"] == f.rec["receipt_number"] and line["pre_po_unsettled_qty"] == 7
    g = _grn(client, f.buyer, f.po, f.loc, 7)
    assert g.status_code == 200, g.text
    out = g.json()
    assert out["status"] == "completed"
    gl = out["items"][0]
    assert (gl["pre_po_qty"], gl["accepted_quantity"], gl["quality_status"], gl["receipt_posting"]) == (7, 7, "passed", "free")
    assert _balance(db, f.item.id, f.loc.id).on_hand_qty == 7  # not 14
    assert db.query(StoreStockTransaction).filter_by(item_id=f.item.id).count() == 1  # no second ledger row
    rec = db.get(StorePrePoReceipt, f.rec["id"])
    assert rec.status == "closed" and rec.items[0].settled_qty == 7
    again = client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(f.buyer)).json()
    assert all(p["id"] != f.po["id"] for p in again)  # fulfilled


def test_a4_a_different_store_is_refused_and_nothing_is_saved(client, db):
    f = _flow(client, db, "A4B", qty=3)
    other = _store(db, "A4B2")
    r = _grn(client, f.buyer, f.po, other, 3)
    assert r.status_code == 422 and "same store" in r.json()["detail"] and f.loc.name in r.json()["detail"]
    assert db.query(P2PGoodsReceipt).count() == 0
    assert _balance(db, f.item.id, other.id) is None


def test_the_po_rate_revalues_the_stock_the_bpo_put_in_without_moving_quantity(client, db):
    db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))
    db.commit()
    f = _flow(client, db, "VAL", qty=7, rate=5, unit_price=9)
    assert db.get(StoreItemValuation, f.item.id).value == 35.0  # 7 x the BPO's rate of 5
    assert _grn(client, f.buyer, f.po, f.loc, 7).status_code == 200
    db.expire_all()
    val = db.get(StoreItemValuation, f.item.id)
    assert (val.qty, val.value, val.avg_rate) == (7, 63.0, 9.0)  # 7 x the PO rate of 9, value-only
    assert db.query(StoreStockTransaction).filter_by(item_id=f.item.id).count() == 1


# ---------------------------------------------------------------- A5 excess posts

def test_a5_a_grn_for_more_than_the_bpo_posts_only_the_excess(client, db):
    f = _flow(client, db, "A5", qty=7)
    db.query(P2PPurchaseOrderItem).filter_by(id=f.po["items"][0]["id"]).update({"quantity": 10})
    db.commit()
    g = _grn(client, f.buyer, f.po, f.loc, 10)
    assert g.status_code == 200, g.text
    gl = g.json()["items"][0]
    assert (gl["received_quantity"], gl["pre_po_qty"], gl["accepted_quantity"]) == (10, 7, 10)
    assert _balance(db, f.item.id, f.loc.id).on_hand_qty == 10  # 7 from the BPO + the 3 extra
    rows = db.query(StoreStockTransaction).filter_by(item_id=f.item.id).order_by(StoreStockTransaction.id).all()
    assert [(r.reference_type, r.quantity) for r in rows] == [("pre_po_receipt", 7), ("grn", 3)]


def test_a5_qc_item_excess_gets_its_own_lot_and_the_line_counts_the_settled_part_as_accepted(client, db):
    f = _flow(client, db, "A5Q", qty=7, flagged=True)
    assert _balance(db, f.item.id, f.loc.id).quality_qty == 7
    _decide_lots(db, "pre_po_receipt", f.rec["id"])  # Quality accepts the BPO's lot -> Free
    from app.modules.quality.models.first_article import QualityFirstArticle
    db.query(QualityFirstArticle).update({"status": "approved"})  # the new item's first article is approved by Quality
    db.query(P2PPurchaseOrderItem).filter_by(id=f.po["items"][0]["id"]).update({"quantity": 10})
    db.commit()
    g = _grn(client, f.buyer, f.po, f.loc, 10).json()
    gl = g["items"][0]
    assert g["status"] == "draft" and gl["quality_status"] == "in_quality" and gl["pre_po_qty"] == 7
    lots = db.query(QualityInspectionLot).filter_by(source_type="grn", source_id=g["id"]).all()
    assert [lt.quantity for lt in lots] == [3]  # only the excess is inspected
    bal = _balance(db, f.item.id, f.loc.id)
    assert (bal.on_hand_qty, bal.quality_qty) == (7, 3)
    _decide_lots(db, "grn", g["id"])
    done = client.get(f"{GRN}/{g['id']}", headers=auth_header(f.buyer)).json()
    assert done["status"] == "completed" and done["items"][0]["accepted_quantity"] == 10
    assert db.get(StorePrePoReceipt, f.rec["id"]).status == "closed"


def test_a_quality_line_settles_only_what_quality_accepted(client, db):
    f = _flow(client, db, "PART", qty=7, flagged=True)
    from app.modules.quality.services import lots as lot_svc
    head = make_quality_user(db, "qhead.part@x.com", quality_role="head")
    lot = db.query(QualityInspectionLot).filter_by(source_type="pre_po_receipt", source_id=f.rec["id"]).one()
    lot.status = "results_recorded"
    lot_svc.decide(db, lot, decision="partial", user=head, accepted_qty=5, rejected_qty=2)
    db.commit()
    pend = client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(f.buyer)).json()
    assert next(p for p in pend if p["id"] == f.po["id"])["items"][0]["pre_po_unsettled_qty"] == 5  # not the rejected 2
    g = _grn(client, f.buyer, f.po, f.loc, 5)
    assert g.status_code == 200, g.text
    gl = g.json()["items"][0]
    assert (gl["pre_po_qty"], gl["accepted_quantity"], gl["quality_status"]) == (5, 5, "passed")
    bal = _balance(db, f.item.id, f.loc.id)
    assert (bal.on_hand_qty, bal.quarantine_qty) == (5, 2)  # nothing posted again; the rejected 2 stay Blocked


# ---------------------------------------------------------------- GRN reversal

def test_reversing_a_grn_never_takes_the_settled_part_out_and_gives_it_back_to_the_bpo(client, db):
    f = _flow(client, db, "REV", qty=7)
    db.query(P2PPurchaseOrderItem).filter_by(id=f.po["items"][0]["id"]).update({"quantity": 10})
    db.commit()
    g = _grn(client, f.buyer, f.po, f.loc, 10).json()
    assert _balance(db, f.item.id, f.loc.id).on_hand_qty == 10
    admin = make_user(db, "bps.rev.admin@premnathrail.com", role="admin", assigned_apps=("purchase", "store"))
    r = client.post(f"{GRN}/{g['id']}/reverse", json={"reason": "wrong PO"}, headers=auth_header(admin))
    assert r.status_code == 200, r.text
    assert _balance(db, f.item.id, f.loc.id).on_hand_qty == 7  # only the GRN's own 3 came out; the BPO's 7 stay
    rec = db.get(StorePrePoReceipt, f.rec["id"])
    assert rec.items[0].settled_qty == 0


# ---------------------------------------------------------------- A6 cancel

def test_a6_cancelling_a_free_receipt_takes_the_stock_back_out(client, db):
    keeper = _store_user(db, "bps.a6@premnathrail.com")
    v, item = _vendor(db, "V-A6"), master_item(db, "Washer A6", code="BPS-A6", uom="Nos")
    body = client.post(STORE, json=_body(v, item, 6), headers=auth_header(keeper)).json()
    r = client.post(f"{STORE}/{body['id']}/cancel", json={"reason": "Vendor took it back"}, headers=auth_header(keeper))
    assert r.status_code == 200 and r.json()["status"] == "cancelled", r.text
    assert _balance(db, item.id, body["store_location_id"]).on_hand_qty == 0
    out = db.query(StoreStockTransaction).filter_by(item_id=item.id, reference_type="pre_po_receipt_cancelled").one()
    assert (out.transaction_type, out.quantity, out.reference_number) == ("return_out", 6, body["receipt_number"])


def test_a6_cancel_is_refused_with_the_reason_when_the_goods_were_issued(client, db):
    keeper = _store_user(db, "bps.a6i@premnathrail.com")
    v, item = _vendor(db, "V-A6I"), master_item(db, "Nut A6I", code="BPS-A6I", uom="Nos")
    body = client.post(STORE, json=_body(v, item, 6), headers=auth_header(keeper)).json()
    post_stock_transaction(db, item_id=item.id, location_id=body["store_location_id"], transaction_type="issue", quantity=2,
                           reference_type="material_issue", reference_number="MI-A6I")
    db.commit()
    r = client.post(f"{STORE}/{body['id']}/cancel", json={"reason": "Wrong delivery"}, headers=auth_header(keeper))
    assert r.status_code == 409 and "issued already" in r.json()["detail"] and "returned to store" in r.json()["detail"]
    assert db.get(StorePrePoReceipt, body["id"]).status == "pending_po"
    assert _balance(db, item.id, body["store_location_id"]).on_hand_qty == 4  # untouched


def test_a6_a_quality_receipt_can_be_cancelled_only_after_quality_decides_its_lot(client, db):
    keeper = _store_user(db, "bps.a6q@premnathrail.com")
    v = _vendor(db, "V-A6Q")
    item = master_item(db, "Gear A6Q", code="BPS-A6Q", uom="Nos", inspection_on_receipt=True)
    body = client.post(STORE, json=_body(v, item, 5), headers=auth_header(keeper)).json()
    lot_no = body["items"][0]["inspection_lot_number"]
    r = client.post(f"{STORE}/{body['id']}/cancel", json={"reason": "Wrong delivery"}, headers=auth_header(keeper))
    assert r.status_code == 409 and f"Quality must decide lot {lot_no}" in r.json()["detail"]
    assert db.get(StorePrePoReceipt, body["id"]).status == "pending_po"
    assert _balance(db, item.id, body["store_location_id"]).quality_qty == 5
    # Quality rejects part: accepted comes back out of Free, rejected out of Blocked.
    from app.modules.quality.services import lots as lot_svc
    head = make_quality_user(db, "qhead.a6q@x.com", quality_role="head")
    lot = db.query(QualityInspectionLot).filter_by(lot_number=lot_no).one()
    lot.status = "results_recorded"
    lot_svc.decide(db, lot, decision="partial", user=head, accepted_qty=3, rejected_qty=2)
    db.commit()
    bal = _balance(db, item.id, body["store_location_id"])
    assert (bal.on_hand_qty, bal.quality_qty, bal.quarantine_qty) == (3, 0, 2)
    r = client.post(f"{STORE}/{body['id']}/cancel", json={"reason": "Wrong delivery"}, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    bal = _balance(db, item.id, body["store_location_id"])
    assert (bal.on_hand_qty, bal.quality_qty, bal.quarantine_qty) == (0, 0, 0)


def test_a6_cancel_needs_the_create_permission_and_the_store_data_scope(client, db, monkeypatch):
    keeper = _store_user(db, "bps.a6p@premnathrail.com")
    v, item = _vendor(db, "V-A6P"), master_item(db, "Pin A6P", code="BPS-A6P", uom="Nos")
    body = client.post(STORE, json=_body(v, item, 3), headers=auth_header(keeper)).json()
    viewer = _store_user(db, "bps.a6p.view@premnathrail.com", perms=("store:grn:view",))
    r = client.post(f"{STORE}/{body['id']}/cancel", json={"reason": "x"}, headers=auth_header(viewer))
    assert r.status_code == 403
    from app.core.config import settings
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")
    other = _store_user(db, "bps.a6p.other@premnathrail.com")
    r = client.post(f"{STORE}/{body['id']}/cancel", json={"reason": "x"}, headers=auth_header(other))
    assert r.status_code == 403
    assert db.get(StorePrePoReceipt, body["id"]).status == "pending_po"
    assert _balance(db, item.id, body["store_location_id"]).on_hand_qty == 3  # the refused cancel moved nothing


def test_a_receipt_whose_goods_a_grn_already_settled_cannot_be_cancelled(client, db):
    f = _flow(client, db, "SET", qty=4)
    assert _grn(client, f.buyer, f.po, f.loc, 4).status_code == 200
    rec = db.get(StorePrePoReceipt, f.rec["id"])
    rec.status = "pending_po"  # e.g. the PO was cancelled and reopened it while the GRN still stands
    db.commit()
    r = client.post(f"{STORE}/{rec.id}/cancel", json={"reason": "Wrong"}, headers=auth_header(f.keeper))
    assert r.status_code == 409 and "already received on a GRN" in r.json()["detail"]
    assert _balance(db, f.item.id, f.loc.id).on_hand_qty == 4


# ---------------------------------------------------------------- A7 old receipts

def test_a7_an_old_receipt_that_never_posted_stock_has_its_goods_posted_by_the_grn(client, db):
    f = _flow(client, db, "A7", qty=7)
    # Make it look like a receipt recorded before 2026-11-06: no stock, not posted.
    db.query(StoreStockTransaction).delete()
    db.query(StoreStockBalance).delete()
    rec = db.get(StorePrePoReceipt, f.rec["id"])
    rec.stock_posted = False
    for line in rec.items:
        line.receipt_posting = None
    db.commit()
    pend = client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(f.buyer)).json()
    assert next(p for p in pend if p["id"] == f.po["id"])["items"][0]["pre_po_unsettled_qty"] == 0
    g = _grn(client, f.buyer, f.po, f.loc, 7)
    assert g.status_code == 200, g.text
    gl = g.json()["items"][0]
    assert gl["pre_po_qty"] == 0 and gl["receipt_posting"] == "free"
    assert _balance(db, f.item.id, f.loc.id).on_hand_qty == 7  # posted by the GRN, as before
    assert db.get(StorePrePoReceipt, f.rec["id"]).status == "closed"


def test_cancelling_an_old_receipt_moves_no_stock(client, db):
    keeper = _store_user(db, "bps.a7c@premnathrail.com")
    v, item = _vendor(db, "V-A7C"), master_item(db, "Old A7C", code="BPS-A7C", uom="Nos")
    body = client.post(STORE, json=_body(v, item, 5), headers=auth_header(keeper)).json()
    rec = db.get(StorePrePoReceipt, body["id"])
    db.query(StoreStockTransaction).delete()
    db.query(StoreStockBalance).delete()
    rec.stock_posted = False
    db.commit()
    r = client.post(f"{STORE}/{body['id']}/cancel", json={"reason": "Old one"}, headers=auth_header(keeper))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert db.query(StoreStockTransaction).count() == 0


# ---------------------------------------------------------------- fix round 1

def test_a_grn_is_refused_while_the_receipts_quality_lot_has_no_decision(client, db):
    f = _flow(client, db, "UND", qty=7, flagged=True)
    lot_no = db.query(QualityInspectionLot).filter_by(source_type="pre_po_receipt", source_id=f.rec["id"]).one().lot_number
    pend = client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(f.buyer)).json()
    po = next(p for p in pend if p["id"] == f.po["id"])
    assert po["items"][0]["pre_po_unsettled_qty"] == 7 and po["pre_po_store_location_id"] == f.loc.id  # still shown
    r = _grn(client, f.buyer, f.po, f.loc, 7)
    assert r.status_code == 409, r.text
    assert (f"Lot {lot_no} of 'Item SUND' from Before-PO receipt {f.rec['receipt_number']} is still with Quality - "
            "ask Quality for the usage decision, then record the GRN.") == r.json()["detail"]
    assert db.query(P2PGoodsReceipt).count() == 0
    bal = _balance(db, f.item.id, f.loc.id)
    assert (bal.on_hand_qty, bal.quality_qty) == (0, 7)  # nothing doubled
    _decide_lots(db, "pre_po_receipt", f.rec["id"])
    g = _grn(client, f.buyer, f.po, f.loc, 7)
    assert g.status_code == 200 and g.json()["items"][0]["pre_po_qty"] == 7
    assert _balance(db, f.item.id, f.loc.id).on_hand_qty == 7


def _project_element(db):
    from app.modules.projects.models.project import PmProject
    from app.tests._so_project_helpers import order_with_project
    so = order_with_project(db, qty=1, price=1000000)
    db.expire_all()
    project = db.query(PmProject).filter(PmProject.sales_order_id == so["id"]).one()
    return project, sorted(project.elements, key=lambda e: e.element_no)[0]


def test_settled_stock_is_held_for_the_lines_project_and_a_reversal_releases_the_hold(client, db):
    from app.modules.store.models.stock_reservation import StoreStockReservation
    project, el = _project_element(db)
    f = _flow(client, db, "HLD", qty=7)
    db.query(P2PPurchaseOrderItem).filter_by(id=f.po["items"][0]["id"]).update(
        {"order_project_id": project.id, "order_project_element_id": el.id, "quantity": 10})
    db.commit()
    g = _grn(client, f.buyer, f.po, f.loc, 10)
    assert g.status_code == 200, g.text
    db.expire_all()
    holds = db.query(StoreStockReservation).filter_by(source_type="grn_item", source_reference=g.json()["grn_number"]).all()
    assert [(h.order_project_element_id, h.quantity, h.status) for h in holds] == [(el.id, 10, "active")]  # 7 settled + 3 posted
    assert _balance(db, f.item.id, f.loc.id).reserved_qty == 10
    admin = make_user(db, "bps.hld.admin@premnathrail.com", role="admin", assigned_apps=("purchase", "store"))
    r = client.post(f"{GRN}/{g.json()['id']}/reverse", json={"reason": "wrong PO"}, headers=auth_header(admin))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert all(h.status != "active" for h in db.query(StoreStockReservation).filter_by(source_type="grn_item").all())
    bal = _balance(db, f.item.id, f.loc.id)
    assert (bal.on_hand_qty, bal.reserved_qty) == (7, 0)  # the BPO's 7 stay, nothing left held


def test_a_fully_settled_project_line_is_held_too_and_released_on_reversal(client, db):
    from app.modules.store.models.stock_reservation import StoreStockReservation
    project, el = _project_element(db)
    f = _flow(client, db, "HLF", qty=4)
    db.query(P2PPurchaseOrderItem).filter_by(id=f.po["items"][0]["id"]).update({"order_project_id": project.id, "order_project_element_id": el.id})
    db.commit()
    g = _grn(client, f.buyer, f.po, f.loc, 4)
    assert g.status_code == 200, g.text
    assert _balance(db, f.item.id, f.loc.id).reserved_qty == 4
    admin = make_user(db, "bps.hlf.admin@premnathrail.com", role="admin", assigned_apps=("purchase", "store"))
    assert client.post(f"{GRN}/{g.json()['id']}/reverse", json={"reason": "wrong PO"}, headers=auth_header(admin)).status_code == 200
    db.expire_all()
    assert db.query(StoreStockReservation).filter_by(status="active").count() == 0
    assert _balance(db, f.item.id, f.loc.id).reserved_qty == 0


def test_a_settled_line_whose_stock_was_already_issued_is_refused_with_the_reason(client, db):
    project, el = _project_element(db)
    f = _flow(client, db, "HLI", qty=4)
    db.query(P2PPurchaseOrderItem).filter_by(id=f.po["items"][0]["id"]).update({"order_project_id": project.id, "order_project_element_id": el.id})
    db.commit()
    post_stock_transaction(db, item_id=f.item.id, location_id=f.loc.id, transaction_type="issue", quantity=3,
                           reference_type="material_issue", reference_number="MI-HLI")
    db.commit()
    r = _grn(client, f.buyer, f.po, f.loc, 4)
    assert r.status_code == 409 and "can't be held for the project" in r.json()["detail"] and "issued or reserved" in r.json()["detail"]
    assert db.query(P2PGoodsReceipt).count() == 0


def test_the_upload_is_refused_when_store_cancelled_the_receipt_in_the_meantime(client, db):
    admin = make_user(db, "bps.rc.admin@premnathrail.com", role="admin")
    approver = make_user(db, "bps.rc.approver@premnathrail.com")
    make_user(db, "bps.rc.partner@premnathrail.com", is_partner=True)
    set_po_workflow(db, [approver.id], admin, partner=True)
    keeper = _store_user(db, "bps.rc.keeper@premnathrail.com")
    v, item = _vendor(db, "V-RC"), master_item(db, "Item SRC", code="BS-RC", uom="Nos")
    rec = client.post(STORE, json=_body(v, item, 5), headers=auth_header(keeper)).json()
    buyer = _purchaser(db, "bps.rc.buyer@premnathrail.com")
    out = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=auth_header(buyer)).json()
    row = db.get(StorePrePoReceipt, rec["id"])
    pr_id = row.p2p_request_id
    row.status = "cancelled"  # Store's cancel landed between the buyer's page load and the upload
    db.commit()
    up = _upload_on(client, db, buyer, out["rfq"]["id"], pr_id, tally="TALLY-SRC", unit_price=9)
    assert up.status_code == 409 and "was cancelled by Store while this PO was being uploaded" in up.json()["detail"], up.text
    db.expire_all()
    assert db.get(StorePrePoReceipt, rec["id"]).purchase_order_id is None


def test_the_grn_form_list_is_limited_to_the_users_stores_and_names_the_receipt_store(client, db, monkeypatch):
    f = _flow(client, db, "SCP", qty=3)
    from app.modules.p2p.routes import goods_receipts as grn_routes
    other = _store(db, "SCP2")
    monkeypatch.setattr(grn_routes, "_grn_store_scope", lambda db_, u: {other.id})  # a store-only user of another plant
    assert all(p["id"] != f.po["id"] for p in client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(f.buyer)).json())
    monkeypatch.setattr(grn_routes, "_grn_store_scope", lambda db_, u: {f.loc.id})  # the receipt's own store
    po = next(p for p in client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(f.buyer)).json() if p["id"] == f.po["id"])
    assert po["pre_po_store_location_id"] == f.loc.id and po["pr_requested_by"]
    monkeypatch.setattr(grn_routes, "_grn_store_scope", lambda db_, u: None)  # Purchase team: every plant
    assert any(p["id"] == f.po["id"] for p in client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(f.buyer)).json())


def test_a_quality_receipt_is_dated_and_costed_as_a_before_po_receipt(client, db):
    db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))
    db.commit()
    keeper = _store_user(db, "bps.qd@premnathrail.com")
    v = _vendor(db, "V-QD")
    item = master_item(db, "Shaft QD", code="BPS-QD", uom="Nos", inspection_on_receipt=True)
    body = _body(v, item, 5)
    body["items"][0]["unit_rate"] = 8
    r = client.post(STORE, json=body, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    txn = db.query(StoreStockTransaction).filter_by(item_id=item.id, transaction_type="quality_in").one()
    assert (txn.cost_source, txn.unit_cost, txn.transaction_date.isoformat()) == ("pre_po_rate", 8.0, body["received_date"])
    lot = db.query(QualityInspectionLot).filter_by(source_type="pre_po_receipt").one()
    assert lot.lot_date.isoformat() == body["received_date"]


def test_a_zero_rate_is_refused_by_the_form_with_the_reason(client, db):
    keeper = _store_user(db, "bps.zr@premnathrail.com")
    v, item = _vendor(db, "V-ZR"), master_item(db, "Zero ZR", code="BPS-ZR", uom="Nos")
    body = _body(v, item)
    body["items"][0]["unit_rate"] = 0
    r = client.post(STORE, json=body, headers=auth_header(keeper))
    assert r.status_code == 422 and "more than 0" in str(r.json())
    assert db.query(StorePrePoReceipt).count() == 0


def test_a_po_with_a_live_grn_that_settled_a_receipt_cannot_be_cancelled(client, db):
    import pytest
    from fastapi import HTTPException
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    from app.modules.p2p.pre_po import reopen_receipt_for_cancelled_po
    f = _flow(client, db, "CNL", qty=3)
    assert _grn(client, f.buyer, f.po, f.loc, 3).status_code == 200
    rec = db.get(StorePrePoReceipt, f.rec["id"])
    rec.status = "po_created"
    db.commit()
    po = db.get(P2PPurchaseOrder, f.po["id"])
    with pytest.raises(HTTPException) as e:
        reopen_receipt_for_cancelled_po(db, po, f.buyer)
    assert e.value.status_code == 409 and "Reverse that GRN first" in e.value.detail
