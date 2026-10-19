"""Store job work / subcontracting (stock with vendor, job work receipt,
ITC-04, Rule 45 reminders) and batch management (heat no. + mill TC at the
GRN, stock by batch, FIFO batch pick at issue, traceability) — 2026-10-13."""
from datetime import date, timedelta

import pytest

from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.notification import Notification
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.store.models.batch import StoreBatch
from app.modules.store.models.item import StoreItem
from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.valuation import StoreItemValuation
from app.tests._stock_seed import seed_opening_stock
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_item_master_link import _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_and_raise_po, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header,
)
from app.tests.test_quality_phase1 import make_user, release_fai

GRN = "/api/v1/p2p/goods-receipts"
ISSUES = "/api/v1/store/material-issues"
JW = "/api/v1/store/job-work"
BATCHES = "/api/v1/store/batches"
LATER = (date.today() + timedelta(days=30)).isoformat()


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    import app.middleware.owasp as owasp
    monkeypatch.setitem(owasp.RATE_CONFIG["write"], "limit", 100000)


def _valuation_on(db):
    if not db.query(ModuleSetting).filter_by(module_key="store", key="valuation_enabled").first():
        db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))
        db.commit()


def _bal(db, item, loc):
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=item.id, location_id=loc.id).one()


def _keeper(db, email):
    return make_user(db, email, apps=("store", "quality"))


# ---------------------------------------------------------------------------
# Batch management
# ---------------------------------------------------------------------------

def _po_with_batch_item(client, db, tag, qty=100, inspection=False):
    item = master_item(db, f"Axle steel {tag}", code=f"RM-AX-{tag}", uom="KG")
    item.batch_controlled = True
    item.inspection_on_receipt = inspection
    db.commit()
    loc = _store(db, f"B{tag}")
    pr = _create_pr(client, _requester(db, f"req.b{tag.lower()}@premnathrail.com"),
                    items=[{"store_item_id": item.id, "quantity": qty, "project_inhouse": "Project"}])
    buyer = _purchaser(db, f"buyer.b{tag.lower()}@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    return item, loc, buyer, _po_for(client, buyer, pr["id"])


def _grn(client, buyer, po, loc, qty, batches):
    return client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id, "items": [
        {"po_item_id": po["items"][0]["id"], "received_quantity": qty, "batches": batches}]}, headers=auth_header(buyer))


def test_grn_requires_heats_that_add_up_and_refuses_batches_on_untracked_items(client, db):
    item, loc, buyer, po = _po_with_batch_item(client, db, "V1")
    r = _grn(client, buyer, po, loc, 100, [])
    assert r.status_code == 422 and "heat" in r.json()["detail"]
    r = _grn(client, buyer, po, loc, 100, [{"heat_number": "H-1", "quantity": 60}])
    assert r.status_code == 422 and "add up to 60" in r.json()["detail"]
    r = _grn(client, buyer, po, loc, 100, [{"heat_number": "H-1", "quantity": 60}, {"heat_number": "h-1", "quantity": 40}])
    assert r.status_code == 422 and "twice" in r.json()["detail"]


def test_untracked_item_refuses_batches(client, db):
    item, loc, buyer, po = _po_with_batch_item(client, db, "V9")
    item.batch_controlled = False
    db.commit()
    r = _grn(client, buyer, po, loc, 100, [{"heat_number": "H-9", "quantity": 100}])
    assert r.status_code == 422 and "isn't batch-tracked" in r.json()["detail"]


def test_two_heats_split_inspection_stock_by_batch_fifo_issue_and_trace(client, db):
    item, loc, buyer, po = _po_with_batch_item(client, db, "V2")
    r = _grn(client, buyer, po, loc, 100, [{"heat_number": "HT-501", "quantity": 60, "tc_number": "MTC-501"},
                                           {"heat_number": "HT-502", "quantity": 40, "tc_number": "MTC-502"}])
    assert r.status_code == 200, r.text
    grn = r.json()
    line = grn["items"][0]
    assert [b["heat_number"] for b in line["batches"]] == ["HT-501", "HT-502"]
    b1, b2 = line["batches"]

    # Partly accepted over two heats: say which heat passed.
    bad = client.post(f"{GRN}/{grn['id']}/inspect", json={"items": [
        {"item_id": line["id"], "accepted_quantity": 90, "rejected_quantity": 10, "quality_status": "partial"}]},
        headers=auth_header(buyer))
    assert bad.status_code == 422 and "per heat" in bad.json()["detail"]
    ok = client.post(f"{GRN}/{grn['id']}/inspect", json={"items": [
        {"item_id": line["id"], "accepted_quantity": 90, "rejected_quantity": 10, "quality_status": "partial",
         "batches": [{"batch_id": b1["id"], "accepted_quantity": 60}, {"batch_id": b2["id"], "accepted_quantity": 30}]}]},
        headers=auth_header(buyer))
    assert ok.status_code == 200, ok.text
    # GRN 101 puts each heat into Quality stock; the inspection releases the accepted part per heat.
    rows = db.query(StoreStockTransaction).filter_by(item_id=item.id, transaction_type="quality_release").order_by(StoreStockTransaction.id).all()
    assert [(t.batch_number, t.quantity) for t in rows] == [(b1["batch_number"], 60), (b2["batch_number"], 30)]

    keeper = _keeper(db, "keeper.v2@x.com")
    listed = client.get(BATCHES, params={"item_id": item.id}, headers=auth_header(keeper)).json()
    assert {b["heat_number"]: b["total"]["free"] for b in listed} == {"HT-501": 60, "HT-502": 30}

    avail = client.get(f"{BATCHES}/available", params={"item_id": item.id, "location_id": loc.id, "quantity": 70},
                       headers=auth_header(keeper)).json()
    assert avail["batch_managed"] and [b["heat_number"] for b in avail["batches"]] == ["HT-501", "HT-502"]
    assert avail["suggestion"] == [{"batch_number": b1["batch_number"], "quantity": 60}, {"batch_number": b2["batch_number"], "quantity": 10}]

    # Named batch over its stock → refused with the batch's figure.
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "items": [
        {"item_id": item.id, "quantity": 35, "batch_number": b2["batch_number"]}]}, headers=auth_header(keeper))
    assert r.status_code == 409 and "only 30" in r.json()["detail"]
    # No batch named → FIFO split, one issue line per heat.
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "project_or_work_order": "WO-77",
                                  "items": [{"item_id": item.id, "quantity": 70}]}, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    assert [(i["batch_number"], i["quantity"]) for i in r.json()["items"]] == [(b1["batch_number"], 60), (b2["batch_number"], 10)]

    trace = client.get(f"{BATCHES}/{b2['id']}", headers=auth_header(keeper)).json()
    assert trace["grn_number"] == grn["grn_number"] and trace["tc_number"] == "MTC-502"
    assert trace["total"]["free"] == 20
    assert [(i["work_order"], i["quantity"]) for i in trace["issues"]] == [("WO-77", 10)]

    # A blocked batch can't be issued.
    mgr = make_user(db, "mgr.v2@x.com", apps=("store",), is_store_manager=True)
    r = client.post(f"{BATCHES}/{b2['id']}/status", json={"status": "blocked"}, headers=auth_header(mgr))
    assert r.status_code == 422
    r = client.post(f"{BATCHES}/{b2['id']}/status", json={"status": "blocked", "reason": "TC carbon out of spec"}, headers=auth_header(mgr))
    assert r.status_code == 200, r.text
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "items": [
        {"item_id": item.id, "quantity": 5, "batch_number": b2["batch_number"]}]}, headers=auth_header(keeper))
    assert r.status_code == 409 and "blocked" in r.json()["detail"]


def test_inspected_item_gets_one_lot_per_heat_and_grn_completes_when_all_decided(client, db):
    item, loc, buyer, po = _po_with_batch_item(client, db, "V3", qty=50, inspection=True)
    release_fai(db, item, po["vendor_name"])
    r = _grn(client, buyer, po, loc, 50, [{"heat_number": "HQ-1", "quantity": 30, "tc_number": "TC-1"},
                                          {"heat_number": "HQ-2", "quantity": 20}])
    assert r.status_code == 200, r.text
    grn = r.json()
    lots = db.query(QualityInspectionLot).filter_by(grn_item_id=grn["items"][0]["id"]).order_by(QualityInspectionLot.id).all()
    assert [(l.quantity, l.test_certificate_reference) for l in lots] == [(30, "TC-1"), (20, None)]
    assert all(l.batch_number for l in lots)

    head = make_user(db, "head.v3@x.com", apps=("quality", "store"), quality_role="head")
    for l in lots:
        l.status = "results_recorded"
    db.commit()
    from app.tests.test_quality_phase1 import hdr
    r = client.post(f"/api/v1/quality/inspection-lots/{lots[0].id}/decision", json={"decision": "accept"}, headers=hdr(head))
    assert r.status_code == 200, r.text
    g = client.get(f"{GRN}/{grn['id']}", headers=auth_header(buyer)).json()
    assert g["status"] != "completed" and g["items"][0]["quality_status"] == "in_quality"
    r = client.post(f"/api/v1/quality/inspection-lots/{lots[1].id}/decision", json={"decision": "reject"}, headers=hdr(head))
    assert r.status_code == 200, r.text
    g = client.get(f"{GRN}/{grn['id']}", headers=auth_header(buyer)).json()
    assert g["status"] == "completed"
    assert (g["items"][0]["accepted_quantity"], g["items"][0]["rejected_quantity"], g["items"][0]["quality_status"]) == (30, 20, "partial")
    b = _bal(db, item, loc)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (30, 0, 20)


# ---------------------------------------------------------------------------
# Job work
# ---------------------------------------------------------------------------

def _jw_env(db, tag):
    _valuation_on(db)
    keeper = _keeper(db, f"keeper.{tag}@x.com")
    loc = _store(db, f"J{tag}")
    bar = StoreItem(item_code=f"RM-BAR-{tag}", item_name=f"EN8 bar {tag}", uom="NOS", item_type="material", hsn_sac_code="7214", gst_rate=18)
    shaft = StoreItem(item_code=f"SF-SH-{tag}", item_name=f"Machined shaft {tag}", uom="NOS", item_type="material")
    vendor = Vendor(code=f"V-{tag}", name=f"Precision Works {tag}", status="active", gstin="27ABCDE1234F1Z5")
    db.add_all([bar, shaft, vendor])
    db.commit()
    seed_opening_stock(db, bar.id, loc.id, 20, created_by_id=keeper.id, unit_cost=100)
    return keeper, loc, bar, shaft, vendor


def _challan(client, keeper, loc, item, vendor, qty, challan="DC-JW-1"):
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "job_work", "vendor_id": vendor.id, "process": "machining",
                                  "expected_return_date": LATER, "challan_number": challan,
                                  "items": [{"item_id": item.id, "quantity": qty}]}, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    return r.json()


def test_job_work_moves_stock_to_vendor_and_back_with_value_kept(client, db):
    keeper, loc, bar, shaft, vendor = _jw_env(db, "A")
    issue = _challan(client, keeper, loc, bar, vendor, 10)
    b = _bal(db, bar, loc)
    assert (b.on_hand_qty, b.vendor_qty) == (10, 10)
    # Still ours and valued: the company-wide valuation keeps all 20 at 100.
    val = db.get(StoreItemValuation, bar.id)
    assert (val.qty, val.value) == (20, 2000)

    stock = client.get(f"{JW}/vendor-stock", headers=auth_header(keeper)).json()
    assert [(s["vendor_name"], s["quantity"], s["value"]) for s in stock] == [(vendor.name, 10, 1000)]
    ch = client.get(f"{JW}/challans", headers=auth_header(keeper)).json()
    assert ch[0]["challan_number"] == "DC-JW-1" and ch[0]["lines"][0]["quantity_outstanding"] == 10
    assert ch[0]["lines"][0]["return_deadline"] == (date.fromisoformat(issue["issue_date"]) + timedelta(days=365)).isoformat()

    # 4 come back as-is (Return against the challan) → With vendor → Free.
    r = client.post("/api/v1/store/material-returns", json={
        "location_id": loc.id, "source_type": "issue", "source_issue_id": issue["id"],
        "items": [{"item_id": bar.id, "quantity": 4, "condition": "good"}]}, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    b = _bal(db, bar, loc)
    assert (b.on_hand_qty, b.vendor_qty) == (14, 6)
    assert db.query(StoreStockTransaction).filter_by(item_id=bar.id, transaction_type="jobwork_in").count() == 1

    # 5 bars machined into 5 shafts (+1 bar process scrap), job charge 50 each.
    line_id = issue["items"][0]["id"]
    too_much = client.post(f"{JW}/receipts", json={"issue_id": issue["id"], "output_item_id": shaft.id, "output_quantity": 5,
                                                   "job_charge_rate": 50, "components": [{"issue_item_id": line_id, "consumed_quantity": 7}]},
                           headers=auth_header(keeper))
    assert too_much.status_code == 409 and "Only 6" in too_much.json()["detail"]
    r = client.post(f"{JW}/receipts", json={"issue_id": issue["id"], "output_item_id": shaft.id, "output_quantity": 5,
                                            "job_charge_rate": 50, "vendor_challan_number": "PW/221",
                                            "components": [{"issue_item_id": line_id, "consumed_quantity": 5, "scrap_quantity": 1}]},
                    headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["component_value"] == 600 and rec["output_unit_cost"] == 170  # (600 + 5×50) / 5
    b = _bal(db, bar, loc)
    assert (b.on_hand_qty, b.vendor_qty) == (14, 0)
    assert _bal(db, shaft, loc).on_hand_qty == 5
    assert db.get(StoreItemValuation, shaft.id).value == 850

    # Nothing left at the vendor: the challan closes and a further return is refused.
    ch = client.get(f"{JW}/challans", params={"status": "all"}, headers=auth_header(keeper)).json()
    assert ch[0]["status"] == "closed"
    r = client.post("/api/v1/store/material-returns", json={
        "location_id": loc.id, "source_type": "issue", "source_issue_id": issue["id"],
        "items": [{"item_id": bar.id, "quantity": 1, "condition": "good"}]}, headers=auth_header(keeper))
    assert r.status_code == 422

    # ITC-04: table 4 (sent) and 5A (back as-is + consumed + scrap), plus the workbook.
    today = date.today().isoformat()
    rep = client.get(f"{JW}/itc04", params={"from": today, "to": today}, headers=auth_header(keeper)).json()
    assert [(s["challan_number"], s["quantity_sent"], s["hsn_code"], s["taxable_value"]) for s in rep["sent"]] == [("DC-JW-1", 10, "7214", 1000)]
    assert sorted(r_["quantity"] for r_ in rep["received"]) == [1, 4, 5]
    x = client.get(f"{JW}/itc04", params={"from": today, "to": today, "format": "xlsx"}, headers=auth_header(keeper))
    assert x.status_code == 200 and x.content[:2] == b"PK"


def test_job_work_issue_refused_beyond_free_stock_and_challan_document_builds(client, db):
    keeper, loc, bar, _, vendor = _jw_env(db, "B")
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "job_work", "vendor_id": vendor.id, "process": "plating",
                                  "expected_return_date": LATER, "challan_number": "DC-B1",
                                  "items": [{"item_id": bar.id, "quantity": 25}]}, headers=auth_header(keeper))
    assert r.status_code == 409 and "Free" in r.json()["detail"]
    issue = _challan(client, keeper, loc, bar, vendor, 3, challan="DC-B2")
    from app.modules.store.reports.job_work_challan import build_challan_docx, challan_context
    ctx = challan_context(db, db.get(StoreMaterialIssue, issue["id"]))
    assert ctx["challan_number"] == "DC-B2" and ctx["vendor_gstin"] == "27ABCDE1234F1Z5" and ctx["total_value"] == 300
    assert build_challan_docx(ctx)[:2] == b"PK"


def test_rule45_reminders_fire_once_per_step(client, db):
    keeper, loc, bar, _, vendor = _jw_env(db, "C")
    issue = _challan(client, keeper, loc, bar, vendor, 2, challan="DC-C1")
    row = db.get(StoreMaterialIssue, issue["id"])
    row.issue_date = date.today() - timedelta(days=331)
    db.commit()
    from app.tasks.store_jobwork_reminders import _send_jobwork_reminders, JOBWORK_DUE
    assert _send_jobwork_reminders(db) >= 1
    assert db.get(StoreMaterialIssue, issue["id"]).jobwork_reminded_days == 330
    n = db.query(Notification).filter_by(notification_type=JOBWORK_DUE, entity_id=issue["id"]).count()
    assert n >= 1
    assert _send_jobwork_reminders(db) == 0
    assert db.query(Notification).filter_by(notification_type=JOBWORK_DUE, entity_id=issue["id"]).count() == n
