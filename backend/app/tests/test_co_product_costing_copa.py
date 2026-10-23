"""CO-PC / EC-PCA / CO-PA: CK11N multi-level cost estimate with cost-component
split, CK24 mark & release to the standard price (permission-gated, price
history, period validity), KKBC_ORD order plan vs actual, KE51/KE5Z profit
centre derivation + plant / business-line P&L, KE30 contribution margin
with quoted vs actual."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.journal_entry import JournalEntryLine
from app.modules.accounts.services import profit_centers as pcs
from app.modules.accounts.services import profitability
from app.modules.crm.models.organization import Organization
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.cost_center import CostCenter
from app.modules.organization.models.profit_center import ProfitCenter
from app.modules.production import cost_estimating as ce
from app.modules.production.models.bom import ProductionBom, ProductionBomItem, ProductionBomOperation
from app.modules.production.models.cost_estimate import StoreItemStandardPrice
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.production.models.work_order import (
    ProductionOrderCostPosting, ProductionTimeLog, ProductionWorkOrder,
)
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.sales.models.delivery import SalesInvoiceLink
from app.modules.sales.models.order import SalesOrder, SalesOrderLine
from app.modules.store.models.item import StoreItem
from app.modules.store.models.job_work import StoreJobWorkReceipt
from app.tests.test_accounts_finance import books, _jv, _capital  # noqa: F401  (fixture)

API = "/api/v1/accounts/product-costing"
D = date(2026, 7, 1)


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _user(db, email, grants):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True, granular_permissions=list(grants))
    db.add(u)
    db.commit()
    return u


@pytest.fixture
def pc(db):
    """Product P = 1 sub-assembly S + 2 rods (5% scrap), routed 1h setup + 2h/unit
    on WELD @ ₹500. S = 1 frame (₹1000) + 1 machined pin (job work), 1h/unit on WELD."""
    weld = ProductionWorkstation(code="WELD-01", name="Welding bay", hourly_rate=500)
    p = StoreItem(item_code="FG-P", item_name="Bogie", item_type="finished_good", uom="NOS", status="active")
    s = StoreItem(item_code="SA-S", item_name="Frame assembly", item_type="semi_finished", uom="NOS", status="active")
    frame = StoreItem(item_code="RM-FRM", item_name="Frame blank", uom="NOS", standard_cost=1000, status="active")
    rod = StoreItem(item_code="RM-ROD", item_name="Tie rod", uom="NOS", standard_cost=100, status="active")
    pin = StoreItem(item_code="CP-PIN", item_name="Machined pin", uom="NOS", status="active")
    db.add_all([weld, p, s, frame, rod, pin])
    db.flush()
    s_bom = ProductionBom(bom_number="BOM-S", product_item_id=s.id, version=1, base_quantity=1, status="active")
    p_bom = ProductionBom(bom_number="BOM-P", product_item_id=p.id, version=1, base_quantity=1, status="active")
    db.add_all([s_bom, p_bom])
    db.flush()
    db.add_all([
        ProductionBomItem(bom_id=s_bom.id, component_item_id=frame.id, quantity=1),
        ProductionBomItem(bom_id=s_bom.id, component_item_id=pin.id, quantity=1),
        ProductionBomOperation(bom_id=s_bom.id, sequence=10, operation_name="Weld frame", workstation_id=weld.id, run_hours_per_unit=1),
        ProductionBomItem(bom_id=p_bom.id, component_item_id=s.id, quantity=1),
        ProductionBomItem(bom_id=p_bom.id, component_item_id=rod.id, quantity=2, scrap_percent=5),
        ProductionBomOperation(bom_id=p_bom.id, sequence=10, operation_name="Final assembly", workstation_id=weld.id,
                               setup_hours=1, run_hours_per_unit=2),
    ])
    # Pin comes back from job work: ₹40 of material + ₹60 job charge per unit.
    db.add(StoreJobWorkReceipt(receipt_number="JWR-1", issue_id=1, location_id=1, receipt_date=date(2026, 6, 1),
                               output_item_id=pin.id, output_quantity=10, component_value=400, job_charge_rate=60))
    db.commit()
    return dict(db=db, weld=weld, p=p, s=s, frame=frame, rod=rod, pin=pin, p_bom=p_bom, s_bom=s_bom)


# ── CK11N ───────────────────────────────────────────────────────────────

def test_multi_level_rollup_with_cost_component_split(pc):
    db = pc["db"]
    est = ce.run_estimate(db, user_id=None, item_id=pc["p"].id, costing_date=D, material_overhead_pct=10, labour_overhead_pct=20)
    db.commit()
    # S rolled up: frame 1000 + pin (40 mat + 60 JW) + 1h × 500 = 1600.
    # P: S 1600 + rods 2 × 1.05 × 100 = 210 + (1 + 2) h × 500 = 1500.
    assert est.material_cost == pytest.approx(1000 + 40 + 210)
    assert est.job_work_cost == pytest.approx(60)
    assert est.labour_cost == pytest.approx(500 + 1500)
    # Overhead on own material (1250) and own labour (2000).
    assert est.overhead_cost == pytest.approx(125 + 400)
    assert est.total_cost == pytest.approx(1250 + 60 + 2000 + 525) and est.unit_cost == est.total_cost
    sub = next(l for l in est.lines if l.item_id == pc["s"].id)
    assert sub.cost_source == "sub_rollup" and sub.level == 1 and sub.amount == pytest.approx(1600)
    children = [l for l in est.lines if l.parent_line_id == sub.id]
    assert {l.item_id for l in children if l.item_id} == {pc["frame"].id, pc["pin"].id}
    assert next(l for l in children if l.item_id == pc["pin"].id).cost_source == "job_work"
    assert all(l.level == 2 for l in children)
    assert est.version == 1 and est.status == "draft" and est.estimate_number == "CE-FG-P-001"


def test_sub_assembly_uses_its_released_estimate(pc):
    db = pc["db"]
    s_est = ce.run_estimate(db, user_id=None, item_id=pc["s"].id, costing_date=D, material_overhead_pct=0, labour_overhead_pct=0)
    ce.mark(db, s_est, None)
    ce.release(db, s_est, None, valid_from=D)
    db.commit()
    assert pc["s"].standard_cost == pytest.approx(1600)
    est = ce.run_estimate(db, user_id=None, item_id=pc["p"].id, costing_date=D + timedelta(days=1),
                          material_overhead_pct=0, labour_overhead_pct=0)
    sub = next(l for l in est.lines if l.item_id == pc["s"].id)
    assert sub.cost_source == "sub_estimate" and sub.sub_estimate_id == s_est.id
    assert sub.job_work_amount == pytest.approx(60) and sub.labour_amount == pytest.approx(500)
    assert not [l for l in est.lines if l.parent_line_id == sub.id]
    assert est.version == 1


def test_missing_cost_and_loop_are_reported(pc):
    db = pc["db"]
    pc["rod"].standard_cost = None
    db.commit()
    data = ce.preview(db, item_id=pc["p"].id, costing_date=D, material_overhead_pct=0, labour_overhead_pct=0)
    assert any("RM-ROD" in w and "standard cost" in w for w in data["warnings"])
    db.add(ProductionBomItem(bom_id=pc["s_bom"].id, component_item_id=pc["p"].id, quantity=1))
    db.commit()
    db.refresh(pc["s_bom"])
    with pytest.raises(ValueError, match="BOM loop"):
        ce.preview(db, item_id=pc["p"].id, costing_date=D)
    with pytest.raises(ValueError, match="no active production BOM"):
        ce.preview(db, item_id=pc["rod"].id)


# ── CK24 ────────────────────────────────────────────────────────────────

def test_mark_and_release_need_permissions_and_keep_price_history(client, pc):
    db = pc["db"]
    planner = _user(db, "costing@premnathrail.com", ["accounts:product_costing:view", "accounts:product_costing:create",
                                                    "accounts:product_costing:edit"])
    controller = _user(db, "controller@premnathrail.com", ["accounts:product_costing:view", "accounts:product_costing:approve"])
    outsider = _user(db, "nobody@premnathrail.com", [])
    assert client.get(f"{API}/estimates", headers=_h(outsider)).status_code == 403
    body = {"item_id": pc["s"].id, "costing_date": str(D), "material_overhead_pct": 0, "labour_overhead_pct": 0}
    r = client.post(f"{API}/estimates", json=body, headers=_h(planner))
    assert r.status_code == 200, r.text
    est = r.json()
    assert est["total_cost"] == pytest.approx(1600) and len(est["lines"]) == 3
    # Release before marking, and release without the approve grant.
    assert "mark it first" in client.post(f"{API}/estimates/{est['id']}/release", json={}, headers=_h(controller)).json()["detail"]
    assert client.post(f"{API}/estimates/{est['id']}/mark", headers=_h(planner)).status_code == 200
    denied = client.post(f"{API}/estimates/{est['id']}/release", json={"valid_from": str(D)}, headers=_h(planner))
    assert denied.status_code == 403 and "'Approve' permission on Finance & Accounting › Product Costing" in denied.json()["detail"]
    ok = client.post(f"{API}/estimates/{est['id']}/release", json={"valid_from": str(D)}, headers=_h(controller))
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "released" and ok.json()["valid_from"] == str(D)
    db.expire_all()
    assert db.get(StoreItem, pc["s"].id).standard_cost == pytest.approx(1600)

    # Second estimate after a cost change; a back-dated release is refused.
    pc["frame"].standard_cost = 1200
    db.commit()
    est2 = client.post(f"{API}/estimates", json=body, headers=_h(planner)).json()
    assert est2["version"] == 2 and est2["total_cost"] == pytest.approx(1800)
    client.post(f"{API}/estimates/{est2['id']}/mark", headers=_h(planner))
    back = client.post(f"{API}/estimates/{est2['id']}/release", json={"valid_from": str(D)}, headers=_h(controller))
    assert back.status_code == 400 and "must start after" in back.json()["detail"]
    later = D + timedelta(days=31)
    assert client.post(f"{API}/estimates/{est2['id']}/release", json={"valid_from": str(later)}, headers=_h(controller)).status_code == 200
    hist = client.get(f"{API}/price-history", params={"item_id": pc["s"].id}, headers=_h(planner)).json()
    assert [(h["standard_cost"], h["valid_to"]) for h in hist] == [(1800, None), (1600, str(later - timedelta(days=1)))]
    assert hist[0]["previous_cost"] == pytest.approx(1600) and hist[0]["source"] == "estimate"
    first = client.get(f"{API}/estimates/{est['id']}", headers=_h(planner)).json()
    assert first["status"] == "superseded" and first["valid_to"] == str(later - timedelta(days=1))
    assert ce.standard_price_on(db, pc["s"].id, D + timedelta(days=5)) == pytest.approx(1600)
    assert ce.standard_price_on(db, pc["s"].id, later) == pytest.approx(1800)
    # A released estimate can't be cancelled.
    assert client.post(f"{API}/estimates/{est2['id']}/cancel", json={"reason": "x"},
                       headers=_h(_user(db, "del@premnathrail.com", ["accounts:product_costing:delete"]))).status_code == 400


# ── KKBC_ORD ────────────────────────────────────────────────────────────

def test_order_plan_vs_actual_variances(pc):
    db = pc["db"]
    est = ce.run_estimate(db, user_id=None, item_id=pc["s"].id, costing_date=D, material_overhead_pct=0, labour_overhead_pct=0)
    ce.mark(db, est, None)
    ce.release(db, est, None, valid_from=D)
    wo = ProductionWorkOrder(wo_number="WO-1", product_item_id=pc["s"].id, bom_id=pc["s_bom"].id, quantity_planned=2,
                             quantity_completed=2, status="completed", planned_start_date=D)
    db.add(wo)
    db.flush()
    # Frames: 3 issued at ₹1100 (plan 2 at ₹1000); pins 2 at ₹100 (as planned); 3 h logged at ₹600 (plan 2 h at ₹500).
    db.add_all([
        ProductionOrderCostPosting(work_order_id=wo.id, posting_type="material_issue", posting_date=D, item_id=pc["frame"].id,
                                   quantity=3, unit_cost=1100, amount=3300),
        ProductionOrderCostPosting(work_order_id=wo.id, posting_type="material_issue", posting_date=D, item_id=pc["pin"].id,
                                   quantity=2, unit_cost=100, amount=200),
        ProductionTimeLog(work_order_id=wo.id, workstation_id=pc["weld"].id, log_date=D, hours=3, activity_rate=600),
    ])
    db.commit()
    r = ce.order_plan_actual(db, wo)
    assert r["plan_source"] == "released_estimate" and r["estimate_number"] == est.estimate_number
    assert r["target_total"] == pytest.approx(3200) and r["actual_total"] == pytest.approx(3300 + 200 + 1800)
    frame = next(m for m in r["materials"] if m["item_id"] == pc["frame"].id)
    assert frame["quantity_variance"] == pytest.approx(1000) and frame["price_variance"] == pytest.approx(300)
    lab = r["labour"][0]
    assert lab["usage_variance"] == pytest.approx(500) and lab["rate_variance"] == pytest.approx(300)
    comps = {c["component"]: c for c in r["components"]}
    assert comps["job_work"]["target"] == pytest.approx(120) and comps["job_work"]["actual"] == pytest.approx(120)
    assert r["total_variance"] == pytest.approx(5300 - 3200)


# ── KE51 / KE5Z ─────────────────────────────────────────────────────────

@pytest.fixture
def pca(books):
    db = books["db"]
    plant = Branch(name="Plant 1", code="P1")
    db.add(plant)
    db.flush()
    mac = ProfitCenter(code="PC-P1-MAC", name="Plant 1 machines", segment="machines", branch_id=plant.id)
    svc = ProfitCenter(code="PC-SVC", name="Service", segment="service")
    corp = ProfitCenter(code="PC-CORP", name="Corporate", segment="corporate", is_default=True)
    old = ProfitCenter(code="PC-OLD", name="Old", segment="spares", status="inactive")
    db.add_all([mac, svc, corp, old])
    db.flush()
    cc = CostCenter(code="CC-WELD", name="Welding", status="active", branch_id=plant.id, profit_center_id=mac.id)
    db.add(cc)
    db.commit()
    _capital(books)
    return {**books, "plant": plant, "mac": mac, "svc": svc, "corp": corp, "old": old, "cc": cc}


def _line(db, entry, n=1):
    return db.query(JournalEntryLine).filter_by(journal_entry_id=entry.id, line_number=n).one()


def test_profit_centre_derivation_and_plant_pl(pca):
    db = pca["db"]
    e1 = _jv(pca, D, "5230", "1121", 1000, dr={"cost_center_id": pca["cc"].id})
    assert _line(db, e1).profit_center_id == pca["mac"].id      # from the cost centre
    assert _line(db, e1, 2).profit_center_id == pca["corp"].id  # bank line → company default
    e2 = _jv(pca, D, "5230", "1121", 300, dr={"profit_center_id": pca["svc"].id})
    assert _line(db, e2).profit_center_id == pca["svc"].id      # explicit wins
    with pytest.raises(ValueError, match="PC-OLD.*inactive"):
        _jv(pca, D, "5230", "1121", 10, dr={"profit_center_id": pca["old"].id})
    # Reversal keeps the original profit centre.
    from app.modules.accounts import service
    rev = service.reverse_journal_entry(db, journal_entry_id=e2.id, reason="test", reversed_by_id=pca["checker"].id, reversal_date=D)
    assert _line(db, rev).profit_center_id == pca["svc"].id

    rep = pcs.profit_center_pl(db, from_date=D, to_date=D, group_by="profit_center")
    exp = next(r for r in rep["rows"] if not r["income"])
    assert exp["amounts"][str(pca["mac"].id)] == pytest.approx(1000)
    assert str(pca["svc"].id) not in exp["amounts"] or exp["amounts"][str(pca["svc"].id)] == pytest.approx(0)
    plant = pcs.profit_center_pl(db, from_date=D, to_date=D, group_by="plant")
    assert plant["profit"][f"b{pca['plant'].id}"] == pytest.approx(-1000)
    seg = pcs.profit_center_pl(db, from_date=D, to_date=D, group_by="segment")
    assert seg["total_expenses"]["machines"] == pytest.approx(1000)


def test_sales_invoice_derives_business_line_and_rederive_fills_blanks(pca):
    db = pca["db"]
    cust = pca["c_local"]
    so = SalesOrder(so_number="SO-1", customer_id=cust.id, order_type="service", branch_id=pca["plant"].id, status="confirmed")
    db.add(so)
    db.flush()
    ar = ARTransaction(invoice_number="SI-T1", customer_id=cust.id, invoice_date=D, due_date=D, invoice_amount=500,
                       total_amount=500, reference_type="sales_order", reference_id=so.id, status="posted")
    db.add(ar)
    db.commit()
    from app.modules.accounts import service
    gl = pca["gl"]
    e = service.post_journal_entry(db, posting_date=D, posting_type="transfer", reference_document_type="ar_transaction",
                                   reference_document_id=ar.id, lines=[
                                       {"gl_account_id": gl["1121"].id, "debit_amount": 500},
                                       {"gl_account_id": gl["4000"].id if "4000" in gl else gl["5230"].id, "credit_amount": 500}])
    assert {l.profit_center_id for l in e.lines} == {pca["svc"].id}
    # Blank lines from before the master existed get filled, never overwritten.
    line = _line(db, e)
    line.profit_center_id = None
    db.commit()
    assert pcs.rederive(db)["lines_updated"] >= 1
    db.refresh(line)
    assert line.profit_center_id == pca["svc"].id


# ── KE30 ────────────────────────────────────────────────────────────────

def test_contribution_margin_per_order_with_quoted_vs_actual(pc):
    db = pc["db"]
    cust = Organization(name="Central Railway")
    db.add(cust)
    db.flush()
    pc["p"].standard_cost = 5000
    so = SalesOrder(so_number="SO-9", customer_id=cust.id, order_type="rrv_supply", status="confirmed", taxable_total=10000)
    db.add(so)
    db.flush()
    sol = SalesOrderLine(so_id=so.id, line_number=1, description="Bogie", product_item_id=pc["p"].id, quantity=1,
                         unit_price=10000, taxable_amount=10000)
    db.add(sol)
    build = ProductionRrvBuild(build_number="RRV-1", rrv_model="Bogie", sales_order_id=so.id, sales_order_line_id=None,
                               customer_id=cust.id)
    db.add(build)
    db.flush()
    build.sales_order_line_id = sol.id
    main = ProductionWorkOrder(wo_number="WO-M", product_item_id=pc["p"].id, bom_id=pc["p_bom"].id, quantity_planned=1,
                               status="completed", rrv_build_id=build.id, build_role="main")
    sub = ProductionWorkOrder(wo_number="WO-S", product_item_id=pc["s"].id, bom_id=pc["s_bom"].id, quantity_planned=1,
                              status="completed", rrv_build_id=build.id, build_role="sub_assembly")
    db.add_all([main, sub])
    db.flush()
    db.add_all([
        # Sub-assembly: 1500 material, received to stock at 1500, then issued to the main order.
        ProductionOrderCostPosting(work_order_id=sub.id, posting_type="material_issue", posting_date=D, quantity=1, amount=1500),
        ProductionOrderCostPosting(work_order_id=sub.id, posting_type="goods_receipt", posting_date=D, quantity=1, amount=1500),
        ProductionOrderCostPosting(work_order_id=main.id, posting_type="material_issue", posting_date=D, quantity=1, amount=1500),
        ProductionOrderCostPosting(work_order_id=main.id, posting_type="material_issue", posting_date=D, quantity=2, amount=2500),
        ProductionTimeLog(work_order_id=main.id, log_date=D, hours=2, activity_rate=500),
    ])
    ar = ARTransaction(invoice_number="SI-9", customer_id=cust.id, invoice_date=D, due_date=D, invoice_amount=9000,
                       total_amount=10620, status="posted", reference_type="sales_order", reference_id=so.id)
    db.add(ar)
    db.flush()
    db.add(SalesInvoiceLink(ar_transaction_id=ar.id, so_id=so.id, so_line_id=sol.id, billing_plan_line_id=1,
                            quantity=1, taxable_amount=9000))
    db.commit()

    rep = profitability.order_profitability(db, group_by="sales_order")
    row = next(r for r in rep["rows"] if r["key"] == so.id)
    assert row["revenue"] == pytest.approx(9000)
    assert row["production_cost"] == pytest.approx(4000 + 1000)  # sub-assembly counted once, via its issue to the main order
    assert row["contribution_margin"] == pytest.approx(9000 - 5000)
    assert row["quoted_revenue"] == pytest.approx(10000) and row["planned_cost"] == pytest.approx(5000)
    assert row["quoted_margin_pct"] == pytest.approx(50.0)
    assert row["margin_pct_deviation"] == pytest.approx(round(4000 / 9000 * 100, 2) - 50.0, abs=0.01)
    by_cust = profitability.order_profitability(db, group_by="customer")
    assert next(r for r in by_cust["rows"] if r["key"] == cust.id)["label"] == "Central Railway"
    by_prod = profitability.order_profitability(db, group_by="product")
    assert next(r for r in by_prod["rows"] if r["key"] == f"i{pc['p'].id}")["revenue"] == pytest.approx(9000)
    items = profitability.profitability_line_items(db, group_by="sales_order", key=str(so.id))["items"]
    assert {i["ref"] for i in items} == {"SI-9", "WO-M"}  # WO-S nets to 0 (its output went into WO-M)
    # Period view: nothing in a range before the postings.
    empty = profitability.order_profitability(db, group_by="sales_order", from_date=date(2026, 4, 1), to_date=date(2026, 4, 30))
    assert empty["rows"] == []


def test_estimate_uses_co_activity_rate_and_costing_sheet(pc):
    """Labour = routing hours × the CO activity price valid on the costing date
    (else the work centre's flat rate); overhead % from the CO costing sheet."""
    from app.modules.accounts.models.co_activity import CoActivityRate
    from app.modules.accounts.models.co_overhead import CoCostingSheetRate
    db = pc["db"]
    db.add_all([
        CoActivityRate(activity_type="LAB", workstation_id=pc["weld"].id, financial_year="2026-27",
                       valid_from=date(2026, 4, 1), fixed_rate=200, variable_rate=400),
        CoCostingSheetRate(valid_from=date(2026, 4, 1), material_overhead_pct=10, labour_overhead_pct=50),
    ])
    db.commit()
    rate = next(l for l in ce.preview(db, item_id=pc["s"].id, costing_date=D)["lines"] if l["line_type"] == "activity")
    assert rate["cost_source"] == "activity_rate" and rate["unit_cost"] == pytest.approx(600)
    data = ce.preview(db, item_id=pc["s"].id, costing_date=D)
    assert data["labour_cost"] == pytest.approx(600)
    assert (data["material_overhead_pct"], data["labour_overhead_pct"]) == (10, 50)
    assert data["overhead_cost"] == pytest.approx(1040 * 0.10 + 600 * 0.50)
    # Before the rate's validity: flat work-centre rate, no costing sheet.
    old = ce.preview(db, item_id=pc["s"].id, costing_date=date(2026, 3, 1))
    assert old["labour_cost"] == pytest.approx(500) and old["overhead_cost"] == 0
