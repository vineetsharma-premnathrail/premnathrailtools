"""SAP PP/CO-PC gaps: eBOM -> mBOM transfer (Design BOM revision -> Production
BOM, with link + differences), goods receipt from a work order at actual
order cost (GR 101), and period-end WIP fed into Finance closing stock
(KKAX; periodic inventory: closing stock = Store + WIP)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.modules.design.models.bom import DesignBom, DesignBomLine, DesignBomRevision
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.production import costing
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.work_order import ProductionOrderCostPosting, ProductionWorkOrder
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.valuation import StoreItemValuation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_cov_production_execution import (  # noqa: F401 — fixtures
    API, TODAY, _sqlite_document_numbers, auth, make_user, new_wo, s,
)
from app.tests.test_accounts_finance import books  # noqa: F401 — fixture


def _released_ebom(db, product, lines, number="DBOM-2026-0001", label="B0", index=0, bom=None):
    """A Design BOM with one released revision (lines: (item, qty, make_buy))."""
    if bom is None:
        bom = DesignBom(bom_number=number, product_item_id=product.id, title=f"{product.item_name} assembly", status="active")
        db.add(bom)
        db.flush()
    rev = DesignBomRevision(bom_id=bom.id, revision_index=index, revision_label=label, status="released",
                            released_at=datetime.now(timezone.utc))
    db.add(rev)
    db.flush()
    for pos, (item, qty, make_buy) in enumerate(lines, start=1):
        db.add(DesignBomLine(revision_id=rev.id, position=pos * 10, store_item_id=item.id, quantity=qty, make_buy=make_buy))
    db.commit()
    db.refresh(bom)
    return bom, rev


def _supersede(db, rev):
    rev.status = "superseded"
    rev.superseded_at = datetime.now(timezone.utc)
    db.commit()


# ---------------------------------------------------------------------------
# eBOM -> mBOM transfer
# ---------------------------------------------------------------------------

def test_transfer_from_design_creates_linked_draft_and_blocks_manual_keying(client, db, s):
    h = s["h"]
    gearbox = StoreItem(item_code="FG-GBX-01", item_name="Gearbox", item_type="finished_good", uom="NOS", status="active")
    db.add(gearbox)
    db.commit()
    dbom, rev = _released_ebom(db, gearbox, [(s["frame"], 1, "make"), (s["rod"], 2, "buy"), (s["rod"], 1, "buy")])

    manual = client.post(f"{API}/boms", json={"product_item_id": gearbox.id, "items": [{"component_item_id": s["rod"].id, "quantity": 1}]}, headers=h)
    assert manual.status_code == 409 and "Transfer from Design" in manual.json()["detail"] and "DBOM-2026-0001 B0" in manual.json()["detail"]

    sources = client.get(f"{API}/boms/design-sources", headers=h).json()
    src = next(x for x in sources if x["design_bom_id"] == dbom.id)
    assert src["mbom_state"] == "none" and src["revision_label"] == "B0"

    resp = client.post(f"{API}/boms/from-design", json={"design_bom_revision_id": rev.id}, headers=h)
    assert resp.status_code == 200, resp.text
    mbom = resp.json()
    assert mbom["status"] == "draft" and mbom["design_bom_number"] == "DBOM-2026-0001" and mbom["design_revision_label"] == "B0"
    assert mbom["design_outdated"] is False and mbom["transferred_by_name"]
    qty = {i["component_item_id"]: (i["quantity"], i["make_buy"]) for i in mbom["items"]}
    assert qty == {s["frame"].id: (1, "make"), s["rod"].id: (3, "buy")}  # the two rod positions merged

    diff = client.get(f"{API}/boms/{mbom['id']}/design-diff", headers=h).json()
    assert diff["differences"] == 0 and diff["outdated"] is False

    # Production adds routing + a shop consumable, then activates.
    upd = client.patch(f"{API}/boms/{mbom['id']}", json={
        "items": [*({"component_item_id": i["component_item_id"], "quantity": i["quantity"], "make_buy": i["make_buy"]} for i in mbom["items"]),
                  {"component_item_id": s["paint"].id, "quantity": 0.5}],
        "operations": [{"sequence": 10, "operation_name": "Assembly", "workstation_id": s["asm"]["id"], "run_hours_per_unit": 2}],
    }, headers=h)
    assert upd.status_code == 200, upd.text
    assert {i["component_item_id"]: i["make_buy"] for i in upd.json()["items"]}[s["frame"].id] == "make"
    assert client.post(f"{API}/boms/{mbom['id']}/activate", headers=h).status_code == 200
    assert next(x for x in client.get(f"{API}/boms/design-sources", headers=h).json() if x["design_bom_id"] == dbom.id)["mbom_state"] == "current"

    # Design releases B1: rod qty changes, a new item is added.
    _supersede(db, rev)
    bolt = StoreItem(item_code="HW-BLT-01", item_name="Bolt", item_type="raw_material", uom="NOS", standard_cost=5, status="active")
    db.add(bolt)
    db.commit()
    _, rev1 = _released_ebom(db, gearbox, [(s["frame"], 1, "make"), (s["rod"], 4, "buy"), (bolt, 8, "buy")], label="B1", index=1, bom=dbom)

    active = client.get(f"{API}/boms/{mbom['id']}", headers=h).json()
    assert active["design_outdated"] is True and active["latest_design_revision_label"] == "B1"
    diff = client.get(f"{API}/boms/{mbom['id']}/design-diff", headers=h).json()
    changes = {r["item_code"]: r["change"] for r in diff["rows"]}
    assert diff["outdated"] is True and diff["compared_revision_label"] == "B1"
    assert changes == {"RM-FRM-01": "same", "RM-ROD-01": "qty_changed", "HW-BLT-01": "design_only", "CN-PNT-01": "production_only"}
    assert next(x for x in client.get(f"{API}/boms/design-sources", headers=h).json() if x["design_bom_id"] == dbom.id)["mbom_state"] == "outdated"

    # A plain copy of the old version can't be activated over the newer eBOM.
    copy = client.post(f"{API}/boms/{mbom['id']}/new-version", headers=h).json()
    blocked = client.post(f"{API}/boms/{copy['id']}/activate", headers=h)
    assert blocked.status_code == 409 and "Refresh from Design" in blocked.json()["detail"] and "B1" in blocked.json()["detail"]

    # Refresh the draft: Design's components replaced, routing + consumable kept.
    refreshed = client.post(f"{API}/boms/from-design", json={"design_bom_revision_id": rev1.id}, headers=h)
    assert refreshed.status_code == 200, refreshed.text
    r = refreshed.json()
    assert r["id"] == copy["id"] and r["design_revision_label"] == "B1"
    assert {i["component_item_id"]: i["quantity"] for i in r["items"]} == {s["frame"].id: 1, s["rod"].id: 4, bolt.id: 8, s["paint"].id: 0.5}
    assert [o["operation_name"] for o in r["operations"]] == ["Assembly"]
    assert client.post(f"{API}/boms/{copy['id']}/activate", headers=h).status_code == 200


def test_transfer_refuses_unreleased_or_superseded_revisions(client, db, s):
    h = s["h"]
    product = StoreItem(item_code="FG-AXL-01", item_name="Axle", item_type="finished_good", uom="NOS", status="active")
    db.add(product)
    db.commit()
    dbom, rev = _released_ebom(db, product, [(s["rod"], 2, "buy")], number="DBOM-2026-0002")
    rev.status = "in_review"
    db.commit()
    resp = client.post(f"{API}/boms/from-design", json={"design_bom_revision_id": rev.id}, headers=h)
    assert resp.status_code == 409 and "not released" in resp.json()["detail"]
    rev.status = "superseded"
    db.commit()
    resp = client.post(f"{API}/boms/from-design", json={"design_bom_revision_id": rev.id}, headers=h)
    assert resp.status_code == 409 and "superseded" in resp.json()["detail"]
    assert client.post(f"{API}/boms/from-design", json={"design_bom_revision_id": 98765}, headers=h).status_code == 404
    # A BOM keyed by hand has nothing to compare with.
    diff = client.get(f"{API}/boms/{s['bom']['id']}/design-diff", headers=h)
    assert diff.status_code == 409 and "wasn't transferred" in diff.json()["detail"]


# ---------------------------------------------------------------------------
# GR 101 at actual order cost + WIP
# ---------------------------------------------------------------------------

def _run_order(client, s, qty=2):
    """Issue the full kit (2 frames @1000 + 4 rods @100 = 2400) and book 3 h
    of cutting @400 = 1200 → 3600 actual cost on the order."""
    wo = new_wo(client, s, qty=qty)
    h = s["h"]
    resp = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [
        {"item_id": s["frame"].id, "quantity": 2}, {"item_id": s["rod"].id, "quantity": 4}]}, headers=h)
    assert resp.status_code == 200, resp.text
    resp = client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": wo["operations"][0]["id"], "log_date": TODAY, "hours": 3}, headers=h)
    assert resp.status_code in (200, 201), resp.text
    return wo


def test_receipt_is_valued_at_actual_order_cost_and_last_receipt_relieves_everything(client, db, s):
    h = s["h"]
    wo = _run_order(client, s)
    assert costing.order_cost(db, db.get(ProductionWorkOrder, wo["id"]))["open"] == 3600

    # The workstation rate changes after booking: the booked labour doesn't.
    client.patch(f"{API}/workstations/{s['cut']['id']}", json={"hourly_rate": 900}, headers=h)
    snap = costing.wip_snapshot(db, date.today())
    assert [(r["wo_number"], r["material_cost"], r["labour_cost"], r["wip_value"]) for r in snap] == [(wo["wo_number"], 2400, 1200, 3600)]
    assert costing.wip_snapshot(db, date.today() - timedelta(days=1)) == []

    resp = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1}, headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["cost_relieved"] == 1800
    costs = client.get(f"{API}/work-orders/{wo['id']}/costing", headers=h).json()
    assert costs["actual_total_cost"] == 3600 and costs["cost_relieved"] == 1800 and costs["open_cost"] == 1800
    report = client.get(f"{API}/reports/wip", headers=h).json()
    assert report["total_wip"] == 1800 and report["rows"][0]["cost_relieved"] == 1800

    movements = client.get(f"{API}/work-orders/{wo['id']}/stock-movements", headers=h).json()
    receipt = next(m for m in movements if m["transaction_type"] == "receipt")
    assert receipt["order_value"] == 1800 and receipt["order_unit_cost"] == 1800
    assert next(m for m in movements if m["transaction_type"] == "issue" and m["item_code"] == "RM-FRM-01")["order_value"] == 2000

    # Extra issue of primer before the last unit (3 @ 10), 1 returned at the issue rate.
    client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [{"item_id": s["paint"].id, "quantity": 3}]}, headers=h)
    s["paint"].standard_cost = 99  # a later price change doesn't touch the order
    db.commit()
    assert client.post(f"{API}/work-orders/{wo['id']}/return-materials", json={"lines": [{"item_id": s["paint"].id, "quantity": 1}]}, headers=h).status_code == 200
    resp = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1}, headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["cost_relieved"] == 3620  # 3600 + 30 − 10, all of it on the last unit
    assert costing.wip_snapshot(db, date.today()) == []


def test_receipt_carries_actual_cost_into_store_valuation(client, db, s):
    """With Store valuation on, the FG ledger row is priced at the order's
    actual cost (cost source production_actual), not the product's average."""
    h = s["h"]
    db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))
    db.commit()
    # Price the stock that's about to be issued (the fixture's receipts were unvalued).
    for item, qty, rate in ((s["frame"], 2, 1000), (s["rod"], 4, 100)):
        post_stock_transaction(db, item_id=item.id, location_id=s["alt"].id, transaction_type="receipt", quantity=qty,
                               reference_type="manual", unit_cost=rate, cost_source="po_rate")
    db.commit()
    wo = new_wo(client, s, qty=1, source_location_id=s["alt"].id)
    resp = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [
        {"item_id": s["frame"].id, "quantity": 1}, {"item_id": s["rod"].id, "quantity": 2}]}, headers=h)
    assert resp.status_code == 200, resp.text
    postings = db.query(ProductionOrderCostPosting).filter_by(work_order_id=wo["id"], posting_type="material_issue").all()
    assert all(p.cost_source == "ledger" for p in postings)
    material = sum(p.amount for p in postings)
    assert material > 0
    resp = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1}, headers=h)
    assert resp.status_code == 200, resp.text
    row = db.query(StoreStockTransaction).filter_by(item_id=s["product"].id, transaction_type="receipt").one()
    assert row.cost_source == "production_actual" and float(row.value) == pytest.approx(material)
    assert float(db.get(StoreItemValuation, s["product"].id).avg_rate) == pytest.approx(material)


# ---------------------------------------------------------------------------
# Finance closing stock = Store + WIP
# ---------------------------------------------------------------------------

def test_closing_stock_includes_wip_on_its_own_ledger_and_reverses_next_day(books):  # noqa: F811
    from app.modules.accounts.services import inventory
    from app.modules.accounts.services.balances import account_balance

    db, gl = books["db"], books["gl"]
    raw = StoreItem(item_code="RM-0001", item_name="Steel bar", uom="KG", moving_average_cost=80, category="Raw")
    machine = StoreItem(item_code="FG-RRV-01", item_name="Rail-road vehicle", uom="NOS", item_type="finished_good")
    loc = StoreLocation(name="Main", code="MAIN")
    db.add_all([raw, machine, loc])
    db.flush()
    post_stock_transaction(db, item_id=raw.id, location_id=loc.id, transaction_type="receipt", quantity=100,
                           reference_type="manual", transaction_date=date(2026, 9, 1))
    bom = ProductionBom(bom_number="BOM-2026-0001", product_item_id=machine.id, version=1, status="active")
    db.add(bom)
    db.flush()
    open_wo = ProductionWorkOrder(wo_number="WO-2026-0001", product_item_id=machine.id, bom_id=bom.id, quantity_planned=1,
                                  status="in_progress")
    delivered = ProductionWorkOrder(wo_number="WO-2026-0002", product_item_id=machine.id, bom_id=bom.id, quantity_planned=1,
                                    quantity_completed=1, status="completed", actual_end_at=datetime(2026, 9, 25, tzinfo=timezone.utc))
    db.add_all([open_wo, delivered])
    db.flush()
    for wo, ptype, d, amount in ((open_wo, "material_issue", date(2026, 9, 10), 5000), (open_wo, "material_return", date(2026, 9, 12), 500),
                                 (open_wo, "material_issue", date(2026, 10, 2), 7000),  # after the period end
                                 (delivered, "material_issue", date(2026, 9, 5), 3000), (delivered, "goods_receipt", date(2026, 9, 25), 3000)):
        db.add(ProductionOrderCostPosting(work_order_id=wo.id, posting_type=ptype, posting_date=d, item_id=raw.id, quantity=1,
                                          unit_cost=amount, amount=amount))
    db.commit()

    val = inventory.create_valuation(db, accounting_period="2026-09", created_by_id=books["maker"].id)
    wip = [l for l in val.lines if l.line_kind == "wip"]
    assert [(l.work_order_id, l.value, l.rate_source) for l in wip] == [(open_wo.id, 4500, "order_actual")]
    # Store's own figure is whatever Store values it at; WIP is added on top.
    store_part = round(sum(float(l.value) for l in val.lines if l.line_kind == "stock"), 2)
    assert store_part > 0 and val.total_value == pytest.approx(store_part + 4500)
    inventory.post_valuation(db, valuation_id=val.id, posted_by_id=books["checker"].id)
    assert account_balance(db, gl["1140"].id, date(2026, 9, 30)) == pytest.approx(store_part)
    assert account_balance(db, gl["1141"].id, date(2026, 9, 30)) == 4500
    assert account_balance(db, gl["1141"].id, date(2026, 10, 1)) == 0  # next period's opening WIP
