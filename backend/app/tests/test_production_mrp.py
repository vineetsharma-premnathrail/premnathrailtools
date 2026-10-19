"""PP-MRP: MD01N run (sales-order driven, multi-level), MD11-MD13 planned
orders (firm / change / delete / convert to WO or PR), MD04 stock /
requirements list, MD05/MD06 run list and exception messages."""
from datetime import date, timedelta

import pytest

from app.modules.production import mrp as engine
from app.modules.production.models.mrp import ProductionPlannedOrder
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.sales.models.order import SalesOrder, SalesOrderLine, SalesOrderSchedule
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_cov_production_execution import API, _sqlite_document_numbers, auth, make_user  # noqa: F401

MRP = f"{API}/mrp"


def _today() -> date:
    return date.today()  # per call, not at import — the suite may cross midnight


@pytest.fixture(autouse=True)
def _sqlite_p2p_numbers(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


@pytest.fixture
def m(client, db):
    """Machine M (make) = 1 sub-assembly SA (make) + 4 bolts (buy, stock 20);
    SA = 2 plates (buy, lead 10 days, MOQ 5, no stock). SA routing 16 h."""
    planner = make_user(db, "mrp.planner@premnathrail.com", apps=("production", "quality", "p2p"))
    h = auth(planner)
    store = StoreLocation(name="Main Store", code="MS01")
    machine = StoreItem(item_code="FG-M-01", item_name="Machine", item_type="finished_good", uom="NOS", status="active")
    sub = StoreItem(item_code="SA-01", item_name="Sub-assembly", item_type="semi_finished", uom="NOS", status="active")
    plate = StoreItem(item_code="RM-PL-01", item_name="Plate", item_type="raw_material", uom="NOS", lead_time_days=10,
                      min_order_qty=5, status="active")
    bolt = StoreItem(item_code="HW-BL-01", item_name="Bolt", item_type="consumable", uom="NOS", lead_time_days=3, status="active")
    db.add_all([store, machine, sub, plate, bolt])
    db.commit()
    post_stock_transaction(db, item_id=bolt.id, location_id=store.id, transaction_type="receipt", quantity=20, reference_type="manual")
    db.commit()
    ws = client.post(f"{API}/workstations", json={"code": "ASM-9", "name": "Bay", "hourly_rate": 100, "capacity_hours_per_day": 8}, headers=h).json()
    sa_bom = client.post(f"{API}/boms", json={"product_item_id": sub.id, "items": [{"component_item_id": plate.id, "quantity": 2}],
                                             "operations": [{"sequence": 10, "operation_name": "Weld", "workstation_id": ws["id"], "setup_hours": 8, "run_hours_per_unit": 0}]},
                         headers=h).json()
    m_bom = client.post(f"{API}/boms", json={"product_item_id": machine.id, "items": [
        {"component_item_id": sub.id, "quantity": 1}, {"component_item_id": bolt.id, "quantity": 4}]}, headers=h).json()
    for b in (sa_bom, m_bom):
        assert client.post(f"{API}/boms/{b['id']}/activate", headers=h).status_code == 200, b
    return dict(user=planner, h=h, store=store, machine=machine, sub=sub, plate=plate, bolt=bolt, sa_bom=sa_bom, m_bom=m_bom)


def _sales_order(db, product, qty=3, due=None, status="confirmed"):
    so = SalesOrder(so_number="SO-2026-0042", status=status, customer_id=1, customer_name="Indian Railways")
    db.add(so)
    db.flush()
    line = SalesOrderLine(so_id=so.id, line_number=1, line_type="rrv", product_item_id=product.id if product else None,
                          description="Machine", quantity=qty)
    db.add(line)
    db.flush()
    sched = SalesOrderSchedule(so_id=so.id, so_line_id=line.id, sequence=1, quantity=qty,
                               current_delivery_date=due or _today() + timedelta(days=60), status="open")
    db.add(sched)
    db.commit()
    return so, line, sched


def _orders(db, item):
    db.expire_all()
    return db.query(ProductionPlannedOrder).filter_by(item_id=item.id, status="open").order_by(ProductionPlannedOrder.id).all()


# ---------------------------------------------------------------------------
# Netting (pure)
# ---------------------------------------------------------------------------

def _el(d, qty, receipt, kind="po", ref="X", fixed=True):
    return engine.Element(item_id=1, date=d, qty=qty, receipt=receipt, kind=kind, ref=ref, fixed=fixed)


def test_net_item_reschedule_in_out_cancel_and_lot_size():
    p = {**engine.MRP_PARAMETERS, "reschedule_in_days": 30, "reschedule_out_tolerance_days": 5}
    d = _today() + timedelta(days=20)
    # A PO 10 days after the requirement is pulled in, not re-ordered.
    r = engine.net_item(stock=0, safety=0, reqs=[_el(d, 5, False, "so_schedule")], receipts=[_el(d + timedelta(days=10), 5, True, ref="PO-1")],
                        today=_today(), params=p, lot_size=lambda q: q)
    assert r.shortages == [] and [x["code"] for x in r.messages] == ["reschedule_in"] and r.messages[0]["suggested"] == d
    # A PO 20 days earlier than its first need → postpone; an unneeded one → cancel.
    r = engine.net_item(stock=0, safety=0, reqs=[_el(d, 5, False, "so_schedule")],
                        receipts=[_el(d - timedelta(days=15), 5, True, ref="PO-2"), _el(d + timedelta(days=200), 3, True, ref="PO-3")],
                        today=_today(), params=p, lot_size=lambda q: q)
    assert {x["code"] for x in r.messages} == {"reschedule_out", "cancel"}
    # Lot size surplus covers the next requirement; safety stock is a requirement today.
    r = engine.net_item(stock=1, safety=2, reqs=[_el(d, 3, False), _el(d + timedelta(days=1), 2, False)], receipts=[],
                        today=_today(), params=p, lot_size=lambda q: max(5.0, q))
    assert [(x[1], x[2]) for x in r.shortages] == [(1, 5), (1, 5)]  # surplus 4 of the first lot covers 3 of the next
    assert any(x["code"] == "below_safety_stock" for x in r.messages)


# ---------------------------------------------------------------------------
# MD01N
# ---------------------------------------------------------------------------

def test_run_multi_level_from_sales_order_with_lead_times_and_pegging(client, db, m):
    so, _line, sched = _sales_order(db, m["machine"], qty=3)
    resp = client.post(f"{MRP}/run", json={}, headers=m["h"])
    assert resp.status_code == 200, resp.text
    run = resp.json()
    assert run["status"] == "completed" and run["make_orders"] == 2 and run["buy_orders"] == 1, run
    assert run["run_number"].startswith("MRP-") and run["log"]

    due = sched.current_delivery_date
    [top] = _orders(db, m["machine"])
    assert top.procurement == "make" and top.quantity == 3 and top.finish_date == due
    assert top.sales_order_id == so.id and top.sales_schedule_id == sched.id and "SO-2026-0042" in top.demand_label
    [sa] = _orders(db, m["sub"])
    assert sa.quantity == 3 and sa.finish_date == top.start_date and sa.parent_planned_order_id == top.id
    assert (sa.finish_date - sa.start_date).days == 1  # 8 h routing / 8 h a day
    assert sa.sales_order_id == so.id  # pegged to the top-level demand
    [pl] = _orders(db, m["plate"])
    assert pl.procurement == "buy" and pl.quantity == 10  # 6 needed, MOQ 5 → 10
    assert pl.finish_date == sa.start_date and (pl.finish_date - pl.start_date).days == 10
    assert _orders(db, m["bolt"]) == []  # 12 bolts needed, 20 in stock
    # MD05: per-item results of the run.
    detail = client.get(f"{MRP}/runs/{run['id']}", headers=m["h"]).json()
    rows = {r["item_code"]: r for r in detail["item_results"]}
    assert rows["FG-M-01"]["low_level_code"] == 0 and rows["SA-01"]["low_level_code"] == 1 and rows["RM-PL-01"]["low_level_code"] == 2
    assert rows["HW-BL-01"]["planned_orders"] == 0 and rows["HW-BL-01"]["ending_available"] == 8


def test_rerun_replaces_open_orders_keeps_firmed_and_counts_them_as_supply(client, db, m):
    _sales_order(db, m["machine"], qty=2)
    assert client.post(f"{MRP}/run", json={}, headers=m["h"]).status_code == 200
    [top] = _orders(db, m["machine"])
    # MD12: changing a date firms the order.
    r = client.patch(f"{MRP}/planned-orders/{top.id}", json={"start_date": str(top.start_date - timedelta(days=2)), "finish_date": str(top.finish_date - timedelta(days=2))}, headers=m["h"])
    assert r.status_code == 200 and r.json()["firmed"] is True
    late = client.patch(f"{MRP}/planned-orders/{top.id}", json={"start_date": str(top.finish_date + timedelta(days=30))}, headers=m["h"])
    assert late.status_code == 400 and "after the finish date" in late.json()["detail"]
    db.expire_all()
    top = db.get(ProductionPlannedOrder, top.id)
    [plate_before] = _orders(db, m["plate"])

    rerun = client.post(f"{MRP}/run", json={}, headers=m["h"]).json()
    assert rerun["planned_orders_deleted"] >= 2  # SA + plate of run 1
    machine_orders = _orders(db, m["machine"])
    assert [o.id for o in machine_orders] == [top.id]  # firmed survived, no duplicate
    [sa] = _orders(db, m["sub"])
    assert sa.parent_planned_order_id == top.id and sa.finish_date == top.start_date
    assert db.get(ProductionPlannedOrder, plate_before.id).status == "deleted"  # replaced by the new run's order
    [plate_now] = _orders(db, m["plate"])
    assert plate_now.order_number != plate_before.order_number  # PLO numbers are never reused


def test_rrv_build_without_work_order_is_demand_and_with_one_is_not(client, db, m):
    so, line, sched = _sales_order(db, m["machine"], qty=1)
    build = ProductionRrvBuild(build_number="RRV-2026-0001", rrv_model="Machine", status="planned", sales_order_id=so.id,
                               sales_order_line_id=line.id, sales_schedule_id=sched.id, target_completion_date=_today() + timedelta(days=30))
    db.add(build)
    db.flush()
    sched.rrv_build_id = build.id
    db.commit()
    assert client.post(f"{MRP}/run", json={}, headers=m["h"]).status_code == 200
    [top] = _orders(db, m["machine"])
    assert top.rrv_build_id == build.id and top.demand_type == "rrv_build" and top.finish_date == build.target_completion_date

    # MD13: convert to a work order — it becomes the build's main WO.
    wo = client.post(f"{MRP}/planned-orders/{top.id}/convert-to-work-order", json={}, headers=m["h"])
    assert wo.status_code == 200, wo.text
    body = wo.json()
    assert body["status"] == "converted" and body["converted_type"] == "work_order" and body["converted_number"].startswith("WO-")
    db.expire_all()
    created = db.get(ProductionWorkOrder, body["converted_ref_id"])
    assert created.rrv_build_id == build.id and created.build_role == "main" and created.quantity_planned == 1
    assert created.planned_end_date == top.finish_date and created.status == "draft"

    # Next run: the build has a WO, so its demand is the WO's materials (SA), not the machine.
    assert client.post(f"{MRP}/run", json={}, headers=m["h"]).status_code == 200
    assert _orders(db, m["machine"]) == []
    [sa] = _orders(db, m["sub"])
    assert sa.work_order_id == created.id and sa.rrv_build_id == build.id


def test_convert_buy_orders_to_purchase_requisition_with_item_master_lines(client, db, m):
    from app.modules.main.models.user import User
    from app.tests.p2p_workflow_helpers import set_pr_workflow

    approver = make_user(db, "mrp.approver@premnathrail.com", apps=("p2p",))
    admin = User(email="mrp.admin@premnathrail.com", name="admin", role="admin", is_active=True)
    db.add(admin)
    db.commit()
    set_pr_workflow(db, [approver.id], admin)
    _sales_order(db, m["machine"], qty=3)
    assert client.post(f"{MRP}/run", json={}, headers=m["h"]).status_code == 200
    [pl] = _orders(db, m["plate"])
    [sa] = _orders(db, m["sub"])

    wrong = client.post(f"{MRP}/planned-orders/convert-to-requisition", json={"planned_order_ids": [sa.id]}, headers=m["h"])
    assert wrong.status_code == 409 and "work order instead" in wrong.json()["detail"]

    r = client.post(f"{MRP}/planned-orders/convert-to-requisition", json={"planned_order_ids": [pl.id]}, headers=m["h"])
    assert r.status_code == 200, r.text
    [made] = r.json()["created"]
    assert made["category_code"] == "RAW" and "SO-2026-0042" in made["project_label"]
    db.expire_all()
    pr = db.get(P2PRequest, made["pr_id"])
    assert pr.status == "submitted"
    assert [(i.store_item_id, i.quantity, i.project_inhouse) for i in pr.items] == [(m["plate"].id, 10, "Project")]
    pl = db.get(ProductionPlannedOrder, pl.id)
    assert pl.status == "converted" and pl.converted_number == pr.p2p_number

    # MD04: the PR is now a receipt; nothing is left uncovered for the plate.
    md04 = client.get(f"{MRP}/stock-requirements/{m['plate'].id}", headers=m["h"]).json()
    kinds = [row["element"] for row in md04["rows"]]
    assert "pr" in kinds and "dependent" in kinds
    assert not any(e["code"] == "shortage" for e in md04["exceptions"])


def test_md04_running_available_and_shortage_and_md06(client, db, m):
    _sales_order(db, m["machine"], qty=6, due=_today() + timedelta(days=5))
    bolts = client.get(f"{MRP}/stock-requirements/{m['bolt'].id}", headers=m["h"]).json()
    assert bolts["stock"] == 20 and bolts["rows"][0]["available"] == 20
    machine = client.get(f"{MRP}/stock-requirements/{m['machine'].id}", headers=m["h"]).json()
    so_row = next(r for r in machine["rows"] if r["element"] == "so_schedule")
    assert so_row["quantity"] == -6 and so_row["available"] == -6 and "shortage" in so_row["exceptions"]

    run = client.post(f"{MRP}/run", json={}, headers=m["h"]).json()
    bolts = client.get(f"{MRP}/stock-requirements/{m['bolt'].id}", headers=m["h"]).json()
    assert bolts["rows"][-1]["available"] == pytest.approx(0)  # 24 needed: 20 stock + planned 4
    exc = client.get(f"{MRP}/exceptions", headers=m["h"]).json()
    assert "start_in_past" in {e["code"] for e in exc}  # plate lead 10 days, needed in under 5
    assert all(e["run_id"] == run["id"] for e in exc)
    assert client.get(f"{MRP}/exceptions?code=nonsense", headers=m["h"]).status_code == 400


def test_manual_planned_order_delete_and_permissions(client, db, m):
    r = client.post(f"{MRP}/planned-orders", json={"item_id": m["plate"].id, "quantity": 4, "finish_date": str(_today() + timedelta(days=40))}, headers=m["h"])
    assert r.status_code == 200, r.text
    po = r.json()
    assert po["firmed"] and po["procurement"] == "buy" and po["start_date"] == str(_today() + timedelta(days=30))
    bad = client.post(f"{MRP}/planned-orders", json={"item_id": m["plate"].id, "quantity": 1, "finish_date": str(_today()), "procurement": "make"}, headers=m["h"])
    assert bad.status_code == 409 and "no active Production BOM" in bad.json()["detail"]

    viewer = make_user(db, "mrp.viewer@premnathrail.com", apps=(), grants=["production:planning:view"])
    vh = auth(viewer)
    assert client.get(f"{MRP}/planned-orders", headers=vh).status_code == 200
    denied = client.post(f"{MRP}/run", json={}, headers=vh)
    assert denied.status_code == 403 and "planning" in denied.json()["detail"].lower()
    assert client.delete(f"{MRP}/planned-orders/{po['id']}", headers=vh).status_code == 403
    outsider = make_user(db, "mrp.outsider@premnathrail.com", apps=(), grants=["store:stock:view"])
    assert client.get(f"{MRP}/planned-orders", headers=auth(outsider)).status_code == 403

    assert client.delete(f"{MRP}/planned-orders/{po['id']}", headers=m["h"]).status_code == 200
    assert client.patch(f"{MRP}/planned-orders/{po['id']}", json={"quantity": 2}, headers=m["h"]).status_code == 404


def test_sales_line_without_product_item_is_an_exception(client, db, m):
    _sales_order(db, None, qty=1)
    run = client.post(f"{MRP}/run", json={}, headers=m["h"]).json()
    exc = client.get(f"{MRP}/exceptions?run_id={run['id']}&code=no_product_item", headers=m["h"]).json()
    assert exc and "set the product item" in exc[0]["message"]


def test_plant_run_uses_plant_lead_time_safety_stock_and_mrp_type(client, db, m):
    """A plant run plans with the plant's data (Store › Item Master › Plant
    data); a company-wide run keeps the Item Master values."""
    from app.modules.organization.models.branch import Branch
    from app.modules.production.models.mrp import ProductionMrpException
    from app.modules.store.models.item_plant import StoreItemPlant

    plant = Branch(name="Plant MRP", code="PMRP")
    db.add(plant)
    db.flush()
    db.add_all([
        # Plate: MRP-planned at this plant, 4-day lead time (Item Master 10), safety stock 2.
        StoreItemPlant(item_id=m["plate"].id, branch_id=plant.id, mrp_type="mrp", procurement_type="buy",
                       lead_time_days=4, safety_stock=2),
        # Bolt: reorder point at this plant — Store reorder plans it, MRP must not.
        StoreItemPlant(item_id=m["bolt"].id, branch_id=plant.id, mrp_type="reorder_point", procurement_type="buy"),
    ])
    db.commit()
    _sales_order(db, m["machine"], qty=3)

    run = engine.run_mrp(db, branch_id=plant.id, include_unassigned=True, user_id=m["user"].id)
    db.commit()
    plates = _orders(db, m["plate"])
    assert plates and all((p.finish_date - p.start_date).days == 4 for p in plates)
    assert any(p.demand_type == "safety_stock" or p.finish_date == _today() for p in plates)  # plant safety stock is a requirement
    assert sum(p.quantity for p in plates) == 10  # 6 + safety 2 = 8 → MOQ 5 lots
    rows = {r["item_code"]: r for r in run.item_results}
    assert rows["RM-PL-01"]["safety_stock"] == 2 and rows["RM-PL-01"]["lead_time_days"] == 4
    assert rows["RM-PL-01"]["planning_source"] == "plant" and rows["FG-M-01"]["planning_source"] == "item"
    assert rows["HW-BL-01"]["planned_orders"] == 0 and rows["HW-BL-01"]["mrp_type"] == "reorder_point"
    codes = {e.code for e in db.query(ProductionMrpException).filter_by(run_id=run.id, item_id=m["bolt"].id)}
    assert "not_mrp_planned" in codes

    md04 = engine.stock_requirements(db, m["plate"], engine.Scope(plant.id))
    assert md04["safety_stock"] == 2 and md04["lead_time_days"] == 4 and md04["planning_source"] == "plant"
    assert engine.stock_requirements(db, m["plate"], engine.Scope(None))["lead_time_days"] == 10

    # Company-wide run: Item Master lead time (10 days), no safety stock.
    engine.run_mrp(db, branch_id=None, include_unassigned=True, user_id=m["user"].id)
    db.commit()
    company = [p for p in _orders(db, m["plate"]) if p.branch_id is None]
    assert company and all((p.finish_date - p.start_date).days == 10 for p in company)
    assert sum(p.quantity for p in company) == 10  # 6 needed → MOQ 5 → 10
