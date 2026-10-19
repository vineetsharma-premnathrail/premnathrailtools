"""Item Master ERP fields: HSN / SAC + GST rate, preferred vendor from the
vendor master, purchase / sales ledger (item → category → Finance default),
stock-level sanity checks, vendor suggestions and the import columns."""
import io
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.settings import GSTRate
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_catalog_item import VendorCatalogItem
from app.modules.main.models.user import User
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.store.models.category import StoreItemCategory

API = "/api/v1/store/items"


@pytest.fixture
def setup(db):
    user = User(email="store.keeper@premnathrail.com", name="store.keeper", role="user", is_active=True, assigned_apps=["store"])
    purchases = GLAccount(code="5001", name="Purchases", account_type="expense")
    rm = GLAccount(code="5002", name="Purchase - Raw Material", account_type="expense")
    sales = GLAccount(code="4000", name="Sales", account_type="revenue")
    group = GLAccount(code="5000", name="Direct Expenses", account_type="expense", is_posting_account=False)
    bank = GLAccount(code="1200", name="Bank", account_type="asset")
    hyd = StoreItemCategory(name="Hydraulics", code="HYD", item_type="material")
    vendor = Vendor(code="V001", name="Bharat Hydraulics")
    blocked = Vendor(code="V002", name="Old Supplier", status="blocked")
    db.add_all([user, purchases, rm, sales, group, bank, hyd, vendor, blocked, GSTRate(rate=18), GSTRate(rate=5),
                GSTRate(rate=28, is_active=False)])
    db.commit()
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"h": {"Authorization": f"Bearer {token}"}, "purchases": purchases.id, "rm": rm.id, "sales": sales.id,
            "group": group.id, "bank": bank.id, "hyd": hyd.id, "vendor": vendor.id, "blocked": blocked.id}


def create(client, s, **body):
    return client.post(API, json={"item_name": "Hydraulic hose 1/2in", "uom": "NOS", "item_type": "material", **body}, headers=s["h"])


def test_full_item_saves_with_tax_vendor_and_ledgers(client, setup):
    s = setup
    r = create(client, s, category="Hydraulics", hsn_sac_code="4009 31 00", gst_rate=18, preferred_vendor_id=s["vendor"],
               purchase_gl_account_id=s["rm"], sales_gl_account_id=s["sales"], min_order_qty=10, standard_cost=250,
               minimum_stock=5, reorder_level=10, safety_stock=4, maximum_stock=50)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["hsn_sac_code"] == "40093100"
    assert body["gst_rate"] == 18
    assert body["preferred_vendor_name"] == "Bharat Hydraulics (V001)"
    assert body["effective_purchase_gl"] == "5002 — Purchase - Raw Material" and body["effective_purchase_gl_source"] == "item"
    assert body["effective_sales_gl_source"] == "item"


def test_ledger_falls_back_to_category_then_finance_default(client, setup):
    s = setup
    item = create(client, s, category="Hydraulics").json()
    assert item["effective_purchase_gl"] == "5001 — Purchases" and item["effective_purchase_gl_source"] == "default"

    cat = client.patch(f"/api/v1/store/categories/{s['hyd']}", json={"purchase_gl_account_id": s["rm"]}, headers=s["h"])
    assert cat.status_code == 200 and cat.json()["purchase_gl_account_name"] == "5002 — Purchase - Raw Material"
    item = client.get(f"{API}/{item['id']}", headers=s["h"]).json()
    assert item["effective_purchase_gl_source"] == "category" and item["effective_purchase_gl"].startswith("5002")


def test_wrong_ledgers_are_refused_with_reason(client, setup):
    s = setup
    r = create(client, s, purchase_gl_account_id=s["sales"])
    assert r.status_code == 400 and "must be Expense" in r.json()["detail"]
    r = create(client, s, purchase_gl_account_id=s["group"])
    assert r.status_code == 400 and "group / summary ledger" in r.json()["detail"]
    r = create(client, s, sales_gl_account_id=s["purchases"])
    assert r.status_code == 400 and "Income (sales)" in r.json()["detail"]
    # A bank ledger is an asset — allowed for capital purchases by type, so it passes the type check.
    assert create(client, s, purchase_gl_account_id=s["bank"]).status_code == 200


def test_hsn_sac_and_gst_rate_validation(client, setup):
    s = setup
    assert create(client, s, hsn_sac_code="73A8").status_code == 400
    bad_len = create(client, s, hsn_sac_code="73181")
    assert bad_len.status_code == 400 and "4, 6 or 8 digits" in bad_len.json()["detail"]
    svc = create(client, s, item_type="service", uom="JOB", hsn_sac_code="7318")
    assert svc.status_code == 400 and "SAC" in svc.json()["detail"]
    assert create(client, s, item_type="service", uom="JOB", hsn_sac_code="998719").status_code == 200
    withdrawn = create(client, s, gst_rate=28)
    assert withdrawn.status_code == 400 and "5%, 18%" in withdrawn.json()["detail"]


def test_blocked_vendor_cannot_be_preferred(client, setup):
    s = setup
    r = create(client, s, preferred_vendor_id=s["blocked"])
    assert r.status_code == 400 and "blocked" in r.json()["detail"]


def test_stock_levels_and_quality_flags_must_be_consistent(client, setup):
    s = setup
    assert "maximum must be the larger" in create(client, s, minimum_stock=50, maximum_stock=10).json()["detail"]
    assert "already full" in create(client, s, reorder_level=60, maximum_stock=50).json()["detail"]
    assert "safety buffer" in create(client, s, safety_stock=20, reorder_level=10).json()["detail"]
    assert "can't be negative" in create(client, s, min_order_qty=-1).json()["detail"]
    assert "Inspection on receipt" in create(client, s, test_certificate_required=True).json()["detail"]
    assert "shelf life" in create(client, s, expiry_controlled=True).json()["detail"]

    # An edit that doesn't touch the stock levels isn't blocked by them.
    item = create(client, s).json()
    assert client.patch(f"{API}/{item['id']}", json={"item_name": "Renamed hose"}, headers=s["h"]).status_code == 200


def test_meta_offers_rates_ledgers_and_active_vendors(client, setup):
    meta = client.get(f"{API}/meta", headers=setup["h"]).json()
    assert meta["gst_rates"] == [5, 18]
    assert [o["label"] for o in meta["purchase_ledgers"]] == ["1200 — Bank", "5001 — Purchases", "5002 — Purchase - Raw Material"]
    assert [o["label"] for o in meta["sales_ledgers"]] == ["4000 — Sales"]
    assert [o["label"] for o in meta["vendors"]] == ["Bharat Hydraulics (V001)"]


def test_vendor_suggestions_merge_preferred_catalog_and_po_history(client, setup, db):
    s = setup
    item = create(client, s, part_number="HH-12", preferred_vendor_id=s["vendor"]).json()
    other = Vendor(code="V003", name="Shree Hoses")
    db.add(other)
    db.flush()
    db.add(VendorCatalogItem(vendor_id=other.id, item_name="Hose half inch", part_code="hh-12", unit="NOS", unit_price=240, lead_time_days=7))
    for n, (d, price, vid, vname) in enumerate([(date(2026, 9, 1), 260, s["vendor"], "Bharat Hydraulics"),
                                                 (date(2026, 10, 1), 255, s["vendor"], "Bharat Hydraulics")]):
        po = P2PPurchaseOrder(po_number=f"PO-{n}", vendor_id=vid, vendor_name=vname, status="issued", po_date=d)
        po.items = [P2PPurchaseOrderItem(item_name="Hydraulic hose 1/2in", unit="NOS", quantity=20, unit_price=price)]
        db.add(po)
    db.add(P2PPurchaseOrder(po_number="PO-X", vendor_id=other.id, vendor_name="Shree Hoses", status="draft", po_date=date(2026, 10, 5),
                            items=[P2PPurchaseOrderItem(item_name="Hydraulic hose 1/2in", quantity=5, unit_price=1)]))
    db.commit()

    rows = client.get(f"{API}/{item['id']}/vendors", headers=s["h"]).json()
    assert [r["vendor_name"] for r in rows] == ["Bharat Hydraulics", "Shree Hoses"]
    first, second = rows
    assert first["preferred"] and first["last_po_rate"] == 255 and first["po_count"] == 2 and first["total_qty"] == 40
    assert second["catalog_price"] == 240 and second["catalog_lead_time_days"] == 7
    assert second["po_count"] == 0  # draft POs don't count


def test_import_reads_the_new_columns(client, setup):
    s = setup
    csv = ("item_type,category,item_name,uom,hsn_sac_code,gst_rate,preferred_vendor,standard_cost,min_order_qty,reorder_level\n"
           "Material,Hydraulics,Hose A,NOS,4009,18,V001,250,10,20\n"
           "Material,Hydraulics,Hose B,NOS,4009,28,,,,\n"
           "Material,Hydraulics,Hose C,NOS,4009,18,Nobody,,,\n")
    r = client.post(f"{API}/import", files={"file": ("items.csv", io.BytesIO(csv.encode()), "text/csv")}, headers=s["h"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert [c["item_name"] for c in body["created"]] == ["Hose A"]
    reasons = " | ".join(e["reason"] for e in body["errors"])
    assert "28%" in reasons and "not an active vendor" in reasons
    hose = client.get(API, params={"search": "Hose A"}, headers=s["h"]).json()[0]
    assert hose["gst_rate"] == 18 and hose["preferred_vendor_id"] == s["vendor"] and hose["min_order_qty"] == 10
