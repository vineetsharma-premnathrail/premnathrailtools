"""Production ↔ PM projects of historic orders (production/order_project_links.py): the build of
a vehicle is tied to its unit, element status from the build, the 'production' 360 column, the
work-order element rule (required for an order with units, inherited from the build), and MRP
carrying the element onto planned orders. (Builds are no longer planned automatically when a
project is created — 2026-10-30 — so the tests plan them with _plan_builds below.)"""
from datetime import timedelta

import pytest

from app.modules.main.models.user import User
from app.modules.main.models.notification import Notification
from app.modules.production import order_project_links as links
from app.modules.production.models.mrp import ProductionPlannedOrder
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.projects import so_projects as ops
from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule
from app.modules.projects.models.project import PmProject
from app.tests.test_production_mrp import MRP, m  # noqa: F401 — fixture
from app.tests._so_project_helpers import TODAY, hdr, order_with_project
from app.tests.test_cov_production_execution import API, _sqlite_document_numbers  # noqa: F401 — autouse fixture
from app.tests.test_production_mrp import _sqlite_p2p_numbers  # noqa: F401 — autouse fixture


def test_registered_at_startup():
    import app.main  # noqa: F401
    assert links.element_status_hook in ops._status_hooks
    assert ops._department_providers.get("production") is links.production_cells


def _planner(db):
    u = User(email="planner@premnathrail.com", name="planner", role="user", is_active=True,
             assigned_apps=["production", "quality", "p2p"], is_production_manager=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _plan_builds(db, project):
    """A planned build per vehicle, tied to its unit and delivery row (what Production does by hand on RRV Builds)."""
    from app.modules.production.models.rrv_build import PRODUCTION_RRV_DEFAULT_REQUIRED_TESTS
    from app.modules.production.service import seed_rrv_stages
    order = db.get(SalesOrder, project.sales_order_id)
    rows = {r.id: r for r in order.schedules}
    for el in sorted((e for e in project.elements if e.kind == "vehicle"), key=lambda e: e.element_no):
        b = ProductionRrvBuild(
            build_number=el.element_no, rrv_model="RRV-10T", status="planned", priority="normal",
            target_handover_date=el.contractual_date, required_tests=list(PRODUCTION_RRV_DEFAULT_REQUIRED_TESTS),
            order_project_id=project.id, order_project_element_id=el.id, sales_order_id=order.id,
            sales_schedule_id=el.sales_schedule_id, sales_order_line_id=el.sales_order_line_id,
            customer_po_number=order.customer_po_number, order_reference=order.so_number,
        )
        seed_rrv_stages(b)
        db.add(b)
        db.flush()
        rows[el.sales_schedule_id].rrv_build_id = b.id
        rows[el.sales_schedule_id].status = "build_planned"
    db.commit()


def _setup(client, db, with_spares=True):
    planner = _planner(db)
    so = order_with_project(db, qty=2, price=1000000, spares_qty=5 if with_spares else 0)
    maker = db.get(User, db.get(SalesOrder, so["id"]).sales_owner_id)
    db.expire_all()
    project = db.query(PmProject).filter(PmProject.sales_order_id == so["id"]).one()
    _plan_builds(db, project)
    db.expire_all()
    project = db.get(PmProject, project.id)
    return maker, planner, so, project


def _dept(db, project):
    """The 360 cells of a project's units ({unit_id: {department: cell}}) from the core API."""
    db.expire_all()
    project = db.get(PmProject, project.id)
    so = db.get(SalesOrder, project.sales_order_id)
    return ops.department_cells(db, project, so, list(project.elements))


def _builds(db, so_id):
    db.expire_all()
    return db.query(ProductionRrvBuild).filter(ProductionRrvBuild.sales_order_id == so_id).order_by(ProductionRrvBuild.id).all()


def test_vehicle_builds_are_tied_to_their_units_and_show_in_the_360(client, db):
    maker, planner, so, project = _setup(client, db)
    vehicles = sorted((e for e in project.elements if e.kind == "vehicle"), key=lambda e: e.element_no)
    builds = _builds(db, so["id"])
    assert len(builds) == 2
    for b, el in zip(builds, vehicles):
        assert b.status == "planned" and b.order_project_id == project.id and b.order_project_element_id == el.id
        assert b.sales_schedule_id == el.sales_schedule_id and b.rrv_model == "RRV-10T"
        assert b.build_number == el.element_no and b.target_handover_date == el.contractual_date
        assert len(b.stages) == 12 and b.required_tests
        row = db.get(SalesOrderSchedule, el.sales_schedule_id)
        assert row.rrv_build_id == b.id

    # Re-syncing the project plans nothing new — builds are never created implicitly any more.
    order = db.get(SalesOrder, so["id"])
    ops.ensure_project_for_order(db, order, maker)
    db.commit()
    assert len(_builds(db, so["id"])) == 2

    # 360 page: production column per vehicle; the lot has no work yet.
    cells = {e.element_no: c["production"] for e, c in ((e, _dept(db, project)[e.id]) for e in project.elements)}
    v1 = cells[f"{project.project_code}/01"]
    assert v1["label"] == f"{builds[0].build_number} · Planned" and v1["tone"] == "neutral" and "0/12 stages" in v1["detail"]
    assert cells[f"{project.project_code}/03"] is None  # the spares lot


def test_build_progress_drives_element_status(client, db):
    maker, planner, so, project = _setup(client, db, with_spares=False)
    b1, _b2 = _builds(db, so["id"])
    r = client.post(f"{API}/rrv-builds/{b1.id}/stages/planning/start", headers=hdr(planner))
    assert r.status_code == 200, r.text
    db.expire_all()
    el = db.get(ProductionRrvBuild, b1.id)
    project = db.get(PmProject, project.id)
    el1 = next(e for e in project.elements if e.id == el.order_project_element_id)
    assert el1.status == "in_progress"
    cell = _dept(db, project)[el1.id]["production"]
    assert cell["status"] == "in_progress" and cell["tone"] == "info"

    build = db.get(ProductionRrvBuild, b1.id)
    build.status = "completed"
    links.sync_build_element(db, build)
    db.commit()
    db.expire_all()
    assert db.get(PmProject, project.id).elements[0].status == "ready"

    # Detail of the build carries the chip data.
    r = client.get(f"{API}/rrv-builds/{b1.id}", headers=hdr(planner))
    assert r.json()["order_project_number"] == project.project_code and r.json()["order_project_element_no"] == el1.element_no


def test_work_order_element_rules(client, db, m):  # noqa: F811
    maker, _planner_user, so, project = _setup(client, db)
    order = db.get(SalesOrder, so["id"])
    rrv_line = next(ln for ln in order.lines if ln.line_type == "rrv")
    spares_line = next(ln for ln in order.lines if ln.line_type == "spares")
    v1, v2 = sorted((e for e in project.elements if e.kind == "vehicle"), key=lambda e: e.element_no)
    lot = next(e for e in project.elements if e.kind == "lot")
    base = {"bom_id": m["m_bom"]["id"], "quantity_planned": 1}

    # RRV line with two vehicles and no element → 422 naming the project.
    r = client.post(f"{API}/work-orders", json={**base, "sales_order_id": so["id"], "sales_order_line_id": rrv_line.id}, headers=m["h"])
    assert r.status_code == 422 and project.project_code in r.json()["detail"] and "Project unit field" in r.json()["detail"]
    # Element picked → the sales order is filled in from it.
    r = client.post(f"{API}/work-orders", json={**base, "order_project_element_id": v2.id}, headers=m["h"])
    assert r.status_code == 200, r.text
    wo = r.json()
    assert wo["order_project_element_id"] == v2.id and wo["sales_order_id"] == so["id"] and wo["sales_order_line_id"] == rrv_line.id
    assert wo["order_project_number"] == project.project_code and wo["order_project_element_label"] == "Vehicle 2"
    # Element of another line than the one picked → 422.
    r = client.post(f"{API}/work-orders", json={**base, "order_project_element_id": v1.id, "sales_order_line_id": spares_line.id},
                    headers=m["h"])
    assert r.status_code == 422 and "different sales order line" in r.json()["detail"]
    # A spares line has exactly one lot element → filled in.
    r = client.post(f"{API}/work-orders", json={**base, "sales_order_id": so["id"], "sales_order_line_id": spares_line.id}, headers=m["h"])
    assert r.status_code == 200, r.text
    assert r.json()["order_project_element_id"] == lot.id
    # Clearing the element on an order-linked WO is refused; clearing the order clears it.
    r = client.patch(f"{API}/work-orders/{wo['id']}", json={"order_project_element_id": None}, headers=m["h"])
    assert r.status_code == 422
    r = client.patch(f"{API}/work-orders/{wo['id']}", json={"sales_order_id": None}, headers=m["h"])
    assert r.status_code == 200 and r.json()["order_project_element_id"] is None and r.json()["sales_order_id"] is None
    # Stock work without an order stays free.
    r = client.post(f"{API}/work-orders", json=base, headers=m["h"])
    assert r.status_code == 200 and r.json()["order_project_element_id"] is None

    # A WO raised on a build inherits the build's vehicle.
    b1 = _builds(db, so["id"])[0]
    r = client.post(f"{API}/work-orders", json={**base, "rrv_build_id": b1.id, "build_role": "main"}, headers=m["h"])
    assert r.status_code == 200, r.text
    assert r.json()["order_project_element_id"] == v1.id and r.json()["sales_order_id"] == so["id"]
    r = client.post(f"{API}/work-orders", json={**base, "rrv_build_id": b1.id, "order_project_element_id": v2.id}, headers=m["h"])
    assert r.status_code == 409 and v1.element_no in r.json()["detail"]

    # 360: the lot shows its work order.
    cell = _dept(db, project)[lot.id]["production"]
    assert cell["label"] == "1 WO · Draft"


def test_mrp_carries_the_element(client, db, m):  # noqa: F811
    _maker, _p, so, project = _setup(client, db)
    order = db.get(SalesOrder, so["id"])
    for ln in order.lines:
        ln.product_item_id = m["machine"].id if ln.line_type == "rrv" else m["plate"].id
    db.commit()
    r = client.post(f"{MRP}/run", json={}, headers=m["h"])
    assert r.status_code == 200, r.text
    vehicles = {e.id for e in project.elements if e.kind == "vehicle"}
    lot = next(e for e in project.elements if e.kind == "lot")
    db.expire_all()
    tops = db.query(ProductionPlannedOrder).filter_by(item_id=m["machine"].id, status="open").all()
    assert tops and {p.order_project_element_id for p in tops} == vehicles
    assert all(p.order_project_id == project.id for p in tops)
    subs = db.query(ProductionPlannedOrder).filter_by(item_id=m["sub"].id, status="open").all()
    assert subs and all(p.order_project_element_id in vehicles for p in subs)  # pegged down the BOM
    plates = db.query(ProductionPlannedOrder).filter_by(item_id=m["plate"].id, status="open").all()
    assert plates and all(p.order_project_element_id in vehicles | {lot.id} for p in plates)
    assert any(p.order_project_element_id == lot.id for p in plates)
    rows = client.get(f"{MRP}/planned-orders", headers=m["h"]).json()
    row = next(x for x in rows if x["id"] == tops[0].id)
    assert row["order_project_element_id"] == tops[0].order_project_element_id
    assert row["order_project_label"].startswith(project.project_code)


@pytest.mark.parametrize("bad", [999999])
def test_unknown_element_is_404(client, db, m, bad):  # noqa: F811
    r = client.post(f"{API}/work-orders", json={"bom_id": m["m_bom"]["id"], "quantity_planned": 1, "order_project_element_id": bad},
                    headers=m["h"])
    assert r.status_code == 404 and "project picker" in r.json()["detail"]


def test_mrp_requisition_is_charged_to_the_order_and_element(client, db, m):  # noqa: F811
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.tests.p2p_workflow_helpers import set_pr_workflow
    approver = User(email="pr.approver@premnathrail.com", name="appr", role="user", is_active=True, assigned_apps=["p2p"])
    admin = User(email="pr.admin@premnathrail.com", name="admin", role="admin", is_active=True)
    db.add_all([approver, admin])
    db.commit()
    set_pr_workflow(db, [approver.id], admin)
    _maker, _p, so, project = _setup(client, db)
    order = db.get(SalesOrder, so["id"])
    for ln in order.lines:
        ln.product_item_id = m["machine"].id if ln.line_type == "rrv" else m["plate"].id
    db.commit()
    assert client.post(f"{MRP}/run", json={}, headers=m["h"]).status_code == 200
    lot = next(e for e in project.elements if e.kind == "lot")
    db.expire_all()
    plate = next(p for p in db.query(ProductionPlannedOrder).filter_by(item_id=m["plate"].id, status="open").all()
                 if p.order_project_element_id == lot.id)
    r = client.post(f"{MRP}/planned-orders/convert-to-requisition", json={"planned_order_ids": [plate.id]}, headers=m["h"])
    assert r.status_code == 200, r.text
    [made] = r.json()["created"]
    assert made["order_project_element_id"] == lot.id
    db.expire_all()
    pr = db.get(P2PRequest, made["pr_id"])
    assert pr.account_assignment == "sales_order" and pr.sales_order_id == so["id"]
    assert [i.order_project_element_id for i in pr.items] == [lot.id]


def test_material_issue_uses_project_stock_of_its_element(client, db, m, monkeypatch):  # noqa: F811
    from itertools import count
    from app.modules.production.models.work_order import ProductionWorkOrder
    from app.modules.store.services import project_stock
    seq = count(1)
    monkeypatch.setattr("app.modules.store.service.generate_stock_reservation_number", lambda db: f"RES-OP-{next(seq):04d}")
    _maker, _p, so, project = _setup(client, db)
    v1, v2 = sorted((e for e in project.elements if e.kind == "vehicle"), key=lambda e: e.element_no)
    r = client.post(f"{API}/work-orders", json={"bom_id": m["m_bom"]["id"], "quantity_planned": 1, "order_project_element_id": v2.id,
                                                "source_location_id": m["store"].id, "target_location_id": m["store"].id}, headers=m["h"])
    assert r.status_code == 200, r.text
    wo_id = r.json()["id"]
    wo = db.get(ProductionWorkOrder, wo_id)
    wo.status = "released"
    # All 20 bolts held for vehicle 1 → vehicle 2's order can't take them.
    project_stock.reserve_for_element(db, item_id=m["bolt"].id, location_id=m["store"].id, qty=20, element_id=v1.id, user_id=None)
    db.commit()
    body = {"lines": [{"item_id": m["bolt"].id, "quantity": 4}]}
    r = client.post(f"{API}/work-orders/{wo_id}/issue-materials", json=body, headers=m["h"])
    assert r.status_code == 409 and "held for another project / vehicle" in r.json()["detail"], r.text
    # Held for its own vehicle → the hold is consumed by the issue.
    hold = project_stock.active_holds(db, m["bolt"].id, m["store"].id)[0]
    hold.order_project_element_id = v2.id
    db.commit()
    r = client.post(f"{API}/work-orders/{wo_id}/issue-materials", json=body, headers=m["h"])
    assert r.status_code == 200, r.text
    db.expire_all()
    [left] = project_stock.active_holds(db, m["bolt"].id, m["store"].id, lock=False)
    assert float(left.quantity) == 16
