"""SAP MM wave 2 (2026-10-14):

- MM01 plant views: plant-level planning data, reorder per plant;
- landed cost: PO delivery costs loaded into the GRN rate, landed-cost voucher
  after receipt (GST never loaded);
- stock transport between plants: delivery challan vs tax invoice, e-way bill
  between states, in-transit stock;
- vendor MSME: Udyam validation, 45-day limit alerts, 43B(h) statement;
- PR account assignment FKs."""
from datetime import date, timedelta

import pytest

from app.modules.accounts.models.vendor import Vendor
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.cost_center import CostCenter
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.valuation import StoreItemValuation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_item_master_link import _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_and_raise_po, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header, make_user,
)
from app.tests.test_store_transfer_flow import _approve
from app.tests.test_store_plant_access import setup  # noqa: F401 — fixture
from app.tests.test_store_valuation import enable

GRN = "/api/v1/p2p/goods-receipts"
G_HR1, G_MH, G_HR2 = "06AAACP1234C1Z5", "27AAACP1234C1Z1", "06AAACP1234C2Z4"


def _admin(db, tag="mm2"):
    return make_user(db, f"admin.{tag}@premnathrail.com", role="admin")


# ── MM01 plant views ─────────────────────────────────────────────────────────

def test_plant_view_falls_back_to_item_master_and_put_validates(client, db):
    from app.modules.store.services.plant_data import plant_view, plant_views

    p1, p2 = Branch(name="Plant A", code="PA"), Branch(name="Plant B", code="PB")
    db.add_all([p1, p2])
    db.flush()
    sa = StoreLocation(name="A store", code="PA-S", branch_id=p1.id)
    sb = StoreLocation(name="B store", code="PB-S", branch_id=p2.id)
    item = StoreItem(item_code="PV-1", item_name="Seal kit", uom="NOS", reorder_level=5, safety_stock=2, lead_time_days=10, status="active")
    db.add_all([sa, sb, item])
    db.commit()
    h = auth_header(_admin(db))

    assert plant_view(db, item, p1.id)["source"] == "item"
    assert plant_view(db, item, p1.id)["lead_time_days"] == 10

    bad = client.put(f"/api/v1/store/items/{item.id}/plants", json={"plants": [
        {"branch_id": p1.id, "reorder_level": 3, "safety_stock": 4}]}, headers=h)
    assert bad.status_code == 422 and "below the safety stock" in bad.json()["detail"]
    wrong_store = client.put(f"/api/v1/store/items/{item.id}/plants", json={"plants": [
        {"branch_id": p1.id, "default_location_id": sb.id}]}, headers=h)
    assert wrong_store.status_code == 422 and "another plant" in wrong_store.json()["detail"]

    ok = client.put(f"/api/v1/store/items/{item.id}/plants", json={"plants": [
        {"branch_id": p1.id, "reorder_level": 8, "safety_stock": 3, "lead_time_days": 21, "procurement_type": "make",
         "inhouse_production_days": 6, "default_location_id": sa.id},
        {"branch_id": p2.id, "mrp_type": "mrp"}]}, headers=h)
    assert ok.status_code == 200, ok.text
    assert len(ok.json()["plants"]) == 2
    v = plant_views(db, [item.id], p1.id)[item.id]
    assert (v["source"], v["lead_time_days"], v["reorder_level"], v["procurement_type"], v["inhouse_production_days"]) == ("plant", 21, 8, "make", 6)
    # Plant B row has no lead time: falls back to the Item Master's.
    assert plant_view(db, item, p2.id)["lead_time_days"] == 10
    # Dropping a plant from the list removes its row.
    client.put(f"/api/v1/store/items/{item.id}/plants", json={"plants": [{"branch_id": p1.id, "reorder_level": 8}]}, headers=h)
    assert plant_view(db, item, p2.id)["source"] == "item"


def test_reorder_is_planned_per_plant_with_that_plants_stock(client, db):
    from app.modules.store.models.item_plant import StoreItemPlant
    from app.modules.store.services.reorder import reorder_rows

    p1, p2 = Branch(name="Plant RA", code="RA"), Branch(name="Plant RB", code="RB")
    db.add_all([p1, p2])
    db.flush()
    sa = StoreLocation(name="RA store", code="RA-S", branch_id=p1.id)
    sb = StoreLocation(name="RB store", code="RB-S", branch_id=p2.id)
    item = StoreItem(item_code="RO-1", item_name="Filter", uom="NOS", reorder_level=1, status="active")
    db.add_all([sa, sb, item])
    db.flush()
    post_stock_transaction(db, item_id=item.id, location_id=sa.id, transaction_type="receipt", quantity=2)
    post_stock_transaction(db, item_id=item.id, location_id=sb.id, transaction_type="receipt", quantity=50)
    db.add_all([StoreItemPlant(item_id=item.id, branch_id=p1.id, reorder_level=5, maximum_stock=20),
                StoreItemPlant(item_id=item.id, branch_id=p2.id, reorder_level=5)])
    db.commit()
    rows = [r for r in reorder_rows(db, due_only=False) if r["item_id"] == item.id]
    by_plant = {r["plant_name"]: r for r in rows}
    assert set(by_plant) == {"Plant RA", "Plant RB"}
    assert by_plant["Plant RA"]["due"] and by_plant["Plant RA"]["suggested_qty"] == 18  # top up to max 20
    assert not by_plant["Plant RB"]["due"]  # 50 at RB covers RB, not RA
    # Plant on MRP is left to Production MRP.
    db.query(StoreItemPlant).filter_by(branch_id=p1.id).one().mrp_type = "mrp"
    db.commit()
    assert [r["plant_name"] for r in reorder_rows(db, due_only=False) if r["item_id"] == item.id] == ["Plant RB"]
    r = client.get("/api/v1/store/reorder", params={"branch_id": p2.id, "due_only": False}, headers=auth_header(_admin(db, "ro")))
    assert r.status_code == 200 and [x["row_key"] for x in r.json() if x["item_id"] == item.id] == [f"{item.id}-{p2.id}"]


# ── Landed cost ──────────────────────────────────────────────────────────────

def _priced_po(client, db, tag):
    a = master_item(db, f"LC A {tag}", code=f"LCA-{tag}", uom="NOS")
    b = master_item(db, f"LC B {tag}", code=f"LCB-{tag}", uom="NOS")
    loc = _store(db, tag)
    pr = _create_pr(client, _requester(db, f"req.{tag.lower()}@premnathrail.com"), items=[
        {"store_item_id": a.id, "quantity": 10, "project_inhouse": "Project"},
        {"store_item_id": b.id, "quantity": 10, "project_inhouse": "Project"}])
    buyer = _purchaser(db, f"buyer.{tag.lower()}@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    po = _po_for(client, buyer, pr["id"])
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem
    for line in po["items"]:
        row = db.get(P2PPurchaseOrderItem, line["id"])
        row.unit_price = 100 if row.store_item_id == a.id else 300
    db.commit()
    return buyer, po, loc, a, b


def test_planned_delivery_costs_load_into_the_grn_rate(client, db):
    enable(db)
    buyer, po, loc, a, b = _priced_po(client, db, "LC1")
    h = auth_header(_admin(db, "lc1"))
    bad = client.post(f"/api/v1/p2p/purchase-orders/{po['id']}/charges", json={"charge_type": "freight", "amount": 0}, headers=h)
    assert bad.status_code == 422 and "before GST" in bad.json()["detail"]
    # Freight ₹400 by value (A 1000 : B 3000), packing ₹200 by quantity (10 : 10).
    assert client.post(f"/api/v1/p2p/purchase-orders/{po['id']}/charges",
                       json={"charge_type": "freight", "amount": 400, "gst_rate": 18}, headers=h).status_code == 201
    v = client.post(f"/api/v1/p2p/purchase-orders/{po['id']}/charges",
                    json={"charge_type": "packing", "amount": 200, "basis": "quantity"}, headers=h).json()
    rates = {l["po_item_id"]: l["landed_rate"] for l in v["lines"]}
    a_line = next(l for l in po["items"] if l["store_item_id"] == a.id)
    assert rates[a_line["id"]] == 100 + 10 + 10  # 100 freight + 100 packing over 10 units
    g = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                               "items": [{"po_item_id": a_line["id"], "received_quantity": 4}]}, headers=auth_header(buyer))
    assert g.status_code == 200, g.text
    row = db.query(StoreStockTransaction).filter_by(item_id=a.id, reference_number=g.json()["grn_number"]).first()
    assert (row.unit_cost, row.cost_source) == (120, "landed")
    # Charges are frozen once goods are received.
    late = client.post(f"/api/v1/p2p/purchase-orders/{po['id']}/charges", json={"charge_type": "insurance", "amount": 50}, headers=h)
    assert late.status_code == 409 and "landed-cost voucher" in late.json()["detail"]


def test_landed_cost_voucher_revalues_stock_on_hand_and_rest_is_consumption(client, db):
    enable(db)
    buyer, po, loc, a, b = _priced_po(client, db, "LC2")
    h = auth_header(_admin(db, "lc2"))
    a_line = next(l for l in po["items"] if l["store_item_id"] == a.id)
    early = client.post(f"/api/v1/p2p/purchase-orders/{po['id']}/landed-cost-vouchers",
                        json={"charge_type": "customs_duty", "amount": 500}, headers=h)
    assert early.status_code == 409 and "receive the goods first" in early.json()["detail"]
    g = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                               "items": [{"po_item_id": a_line["id"], "received_quantity": 10}]}, headers=auth_header(buyer)).json()
    client.post(f"{GRN}/{g['id']}/inspect", json={"items": [
        {"item_id": g["items"][0]["id"], "accepted_quantity": 10, "rejected_quantity": 0, "quality_status": "passed"}]},
        headers=auth_header(buyer))
    post_stock_transaction(db, item_id=a.id, location_id=loc.id, transaction_type="issue", quantity=6, reference_type="manual")
    db.commit()
    r = client.post(f"/api/v1/p2p/purchase-orders/{po['id']}/landed-cost-vouchers",
                    json={"charge_type": "customs_duty", "amount": 500, "bill_reference": "BOE 12345"}, headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["voucher_number"].startswith("LCV-")
    assert (body["value_to_stock"], body["value_to_consumption"]) == (200, 300)  # 4 of 10 still on hand
    db.expire_all()
    val = db.get(StoreItemValuation, a.id)
    assert val.qty == 4 and val.value == pytest.approx(400 + 200)
    assert val.avg_rate == pytest.approx(150)


def test_debit_note_rate_stays_vendor_price(client, db):
    from app.modules.p2p.landed_cost import apportion
    assert apportion(100, {1: 1, 2: 1, 3: 1}) == {1: 33.33, 2: 33.33, 3: 33.34}


# ── Stock transport between plants ───────────────────────────────────────────

def _gst_item(db, setup):
    item = setup["item"]
    item.gst_rate, item.hsn_sac_code, item.moving_average_cost = 18, "8481", 50
    db.commit()
    return item


def _raise_and_approve(client, setup, qty=4):
    t = client.post("/api/v1/store/stock-transfers", json={
        "from_location_id": setup["s1"].id, "to_location_id": setup["s2"].id, "reason": "Plant 2 need",
        "items": [{"item_id": setup["item"].id, "quantity": qty}]}, headers=setup["admin"])
    assert t.status_code == 200, t.text
    assert _approve(client, setup["keeper"], t.json()["id"]).status_code == 200
    return t.json()


def test_interstate_transfer_needs_eway_bill_and_goes_on_a_tax_invoice(client, db, setup):  # noqa: F811
    _gst_item(db, setup)
    setup["p1"].gstin, setup["p1"].state_code = G_HR1, "06"
    setup["p2"].state_code = "27"
    db.commit()
    t = _raise_and_approve(client, setup)
    d = client.post(f"/api/v1/store/stock-transfers/{t['id']}/dispatch", json={"eway_bill_number": "123456789012"}, headers=setup["keeper"])
    assert d.status_code == 409 and "has no GSTIN" in d.json()["detail"]
    setup["p2"].gstin = G_MH
    db.commit()
    d = client.post(f"/api/v1/store/stock-transfers/{t['id']}/dispatch", json={}, headers=setup["keeper"])
    assert d.status_code == 409 and "e-way bill" in d.json()["detail"]
    d = client.post(f"/api/v1/store/stock-transfers/{t['id']}/dispatch", json={"eway_bill_number": "1234"}, headers=setup["keeper"])
    assert d.status_code == 409 and "12-digit" in d.json()["detail"]
    line_id = t["items"][0]["id"]
    d = client.post(f"/api/v1/store/stock-transfers/{t['id']}/dispatch", json={
        "eway_bill_number": "123456789012", "lines": [{"line_id": line_id, "transfer_rate": 60}]}, headers=setup["keeper"])
    assert d.status_code == 200, d.text
    body = d.json()
    assert (body["document_type"], body["inter_state"], body["tax_invoice_number"]) == ("tax_invoice", True, "BT06/" + _fy() + "/0001")
    assert (body["taxable_value"], body["igst_amount"], body["cgst_amount"]) == (240, 43.2, 0)
    # In transit until received.
    it = client.get("/api/v1/store/in-transit-stock", headers=setup["admin"]).json()
    assert it["lines"] == 1 and it["rows"][0]["tax_invoice_number"] == body["tax_invoice_number"]
    from app.modules.store.models.stock_transfer import StoreStockTransfer
    from app.modules.store.routes.stock_transfers import _note_spec
    spec = _note_spec(db, db.get(StoreStockTransfer, t["id"]))
    assert spec["title"].startswith("TAX INVOICE") and "HSN" in spec["sections"][0]["columns"]
    assert client.post(f"/api/v1/store/stock-transfers/{t['id']}/receive", json={}, headers=setup["keeper2"]).status_code == 200
    assert client.get("/api/v1/store/in-transit-stock", headers=setup["admin"]).json()["lines"] == 0


def _fy():
    d = date.today()
    s = d.year if d.month >= 4 else d.year - 1
    return f"{s % 100:02d}{(s + 1) % 100:02d}"


def test_same_gstin_transfer_is_a_delivery_challan_and_two_gstins_same_state_is_cgst_sgst(client, db, setup):  # noqa: F811
    _gst_item(db, setup)
    setup["p1"].gstin = setup["p2"].gstin = G_HR1
    setup["p1"].state_code = setup["p2"].state_code = "06"
    db.commit()
    t = _raise_and_approve(client, setup, 2)
    d = client.post(f"/api/v1/store/stock-transfers/{t['id']}/dispatch", json={}, headers=setup["keeper"])
    assert d.status_code == 200, d.text
    assert (d.json()["document_type"], d.json()["tax_invoice_number"]) == ("delivery_challan", None)
    setup["p2"].gstin = G_HR2
    db.commit()
    t2 = _raise_and_approve(client, setup, 2)
    d2 = client.post(f"/api/v1/store/stock-transfers/{t2['id']}/dispatch", json={}, headers=setup["keeper"]).json()
    assert d2["document_type"] == "tax_invoice" and not d2["inter_state"]
    assert d2["cgst_amount"] == d2["sgst_amount"] == 9.0  # 2 x ₹50 average x 9 %


def test_plant_gstin_is_validated_and_must_match_its_state(client, db):
    h = auth_header(_admin(db, "brg"))
    r = client.post("/api/v1/organization/branches", json={"name": "X", "code": "XG", "gstin": "06AAACP1234C1Z9"}, headers=h)
    assert r.status_code == 422 and "check-digit" in r.text
    r = client.post("/api/v1/organization/branches", json={"name": "Y", "code": "YG", "gstin": G_HR1, "state_code": "27"}, headers=h)
    assert r.status_code == 422 and "own state" in r.text
    r = client.post("/api/v1/organization/branches", json={"name": "Z", "code": "ZG", "gstin": G_HR1}, headers=h)
    assert r.status_code in (200, 201), r.text
    assert r.json()["state_code"] == "06"


# ── Vendor MSME ──────────────────────────────────────────────────────────────

def test_vendor_msme_fields_are_validated(client, db):
    h = auth_header(_admin(db, "msme"))
    r = client.post("/api/v1/p2p/vendors", json={"name": "Small Works", "msme_category": "small"}, headers=h)
    assert r.status_code == 422 and "Udyam registration number" in r.json()["detail"]
    r = client.post("/api/v1/p2p/vendors", json={"name": "Small Works", "msme_category": "small", "udyam_number": "UDYAM-12"}, headers=h)
    assert r.status_code == 422 and "UDYAM-XX-00-0000000" in r.json()["detail"]
    r = client.post("/api/v1/p2p/vendors", json={"name": "Small Works", "msme_category": "small", "udyam_number": "udyam-hr-05-0012345",
                                                  "payment_days": 60}, headers=h)
    assert r.status_code == 422 and "45 days" in r.json()["detail"]
    r = client.post("/api/v1/p2p/vendors", json={"name": "Small Works", "msme_category": "small", "udyam_number": "udyam-hr-05-0012345",
                                                  "payment_days": 30, "msme_activity": "manufacturing"}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["udyam_number"] == "UDYAM-HR-05-0012345"


def _bill(db, vendor, number, bill_date, amount):
    from app.modules.accounts.models.vendor_invoice import VendorInvoice
    inv = VendorInvoice(invoice_type="direct", vendor_id=vendor.id, invoice_number=number, invoice_date=bill_date, due_date=bill_date,
                        invoice_amount=amount, invoice_total=amount, amount_due=amount, amount_paid=0, status="posted")
    db.add(inv)
    db.commit()
    return inv


def test_msme_45_day_alerts_and_43bh_statement(client, db):
    from app.modules.accounts.services import msme

    small = Vendor(code="V-MS1", name="Small Fab", msme_category="small", udyam_number="UDYAM-HR-05-0000001", payment_days=30,
                   msme_activity="manufacturing")
    trader = Vendor(code="V-MS2", name="Micro Trader", msme_category="micro", udyam_number="UDYAM-HR-05-0000002", msme_activity="trader")
    plain = Vendor(code="V-NM", name="Big Corp")
    db.add_all([small, trader, plain])
    db.commit()
    today = date.today()
    _bill(db, small, "S-1", today - timedelta(days=40), 1000)   # 30-day terms: breached
    _bill(db, small, "S-2", today - timedelta(days=25), 500)    # 5 days left: due soon
    _bill(db, trader, "T-1", today - timedelta(days=20), 700)   # no terms: 15-day limit, breached
    _bill(db, plain, "P-1", today - timedelta(days=90), 9000)   # not an MSME: not listed
    a = msme.open_bill_alerts(db)
    st = {r["invoice_number"]: r["status"] for r in a["rows"]}
    assert st == {"S-1": "breached", "S-2": "due_soon", "T-1": "breached"}
    assert a["breached_amount"] == 1700

    # 43B(h): a bill of the current FY still open; the year end is in the future, so use the service directly.
    fy = today.year if today.month >= 4 else today.year - 1
    rep = msme.report_43bh(db, fy_start_year=fy)
    nums = {r["invoice_number"] for r in rep["rows"]}
    assert "T-1" not in nums and {e["invoice_number"] for e in rep["excluded"]} >= {"T-1"}  # trader outside 43B(h)
    assert "S-1" in nums  # pay-by date before 31 March, unpaid
    h = auth_header(_admin(db, "43bh"))
    assert client.get("/api/v1/accounts/msme/alerts", headers=h).status_code == 200
    assert client.get("/api/v1/accounts/msme/43bh", params={"fy_start_year": 2020}, headers=h).status_code == 422


# ── PR account assignment ────────────────────────────────────────────────────

def test_pr_account_assignment_links_a_real_record(client, db):
    item = master_item(db, "AA item", code="AA-1", uom="NOS")
    cc = CostCenter(code="CC-MNT", name="Maintenance")
    closed = CostCenter(code="CC-OLD", name="Old shop", status="inactive")
    db.add_all([cc, closed])
    db.commit()
    req = _requester(db, "req.aa@premnathrail.com")
    line = [{"store_item_id": item.id, "quantity": 1, "project_inhouse": "Inhouse"}]
    r = client.post("/api/v1/p2p/requests", json={"category_code": "RAW", "project_type": "existing", "items": line,
                                                  "account_assignment": "cost_center"}, headers=auth_header(req))
    assert r.status_code == 422 and "Pick the cost centre" in r.json()["detail"]
    r = client.post("/api/v1/p2p/requests", json={"category_code": "RAW", "project_type": "existing", "items": line,
                                                  "account_assignment": "cost_center", "cost_center_id": closed.id}, headers=auth_header(req))
    assert r.status_code == 422 and "inactive" in r.json()["detail"]
    r = client.post("/api/v1/p2p/requests", json={"category_code": "RAW", "project_type": "existing", "items": line,
                                                  "account_assignment": "cost_center", "cost_center_id": cc.id, "internal_order_id": 5},
                    headers=auth_header(req))
    assert r.status_code == 422 and "keep one account assignment" in r.json()["detail"]
    pr = _create_pr(client, req, project_label=None, items=line, account_assignment="cost_center", cost_center_id=cc.id)
    assert pr["cost_center_id"] == cc.id and pr["account_assignment"] == "cost_center"
    assert pr["project_label"] == "CC-MNT — Maintenance"
    assert pr["account_assignment_label"] == "Cost centre: CC-MNT — Maintenance"


def test_account_assignment_options_list_open_records_only(client, db):
    db.add_all([CostCenter(code="CC-A1", name="Assembly"), CostCenter(code="CC-X1", name="Closed shop", status="inactive")])
    db.commit()
    req = _requester(db, "req.aaopt@premnathrail.com")
    r = client.get("/api/v1/p2p/account-assignment/options", params={"kind": "cost_center"}, headers=auth_header(req))
    assert r.status_code == 200, r.text
    assert [o["label"] for o in r.json()["options"]] == ["CC-A1 — Assembly"]
    bad = client.get("/api/v1/p2p/account-assignment/options", params={"kind": "project"}, headers=auth_header(req))
    assert bad.status_code == 422
