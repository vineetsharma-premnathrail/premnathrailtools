"""AC-61b — one project = one machine: Production, Store, Quality, Dispatch, Procurement and Design link
their work to the PROJECT itself when the project has no live units (every project made in Project
Management), with no "pick a unit" error. A historic sales-order project (live units) keeps its unit rule.

Built from models only (no Sales module routes): a project made in Project Management with its machine, and a
historic project with one vehicle unit."""
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.organization import Organization
from app.modules.design.models.request import DesignRequest
from app.modules.erp.models.project import Project as Machine
from app.modules.main.models.user import User
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.projects import so_projects as op_core
from app.modules.projects.models.element import PmProjectElement
from app.modules.projects.models.project import PmProject
from app.modules.sales.models.order import SalesOrder, SalesOrderLine
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.services import project_stock
from app.tests._stock_seed import seed_opening_stock

API = "/api/v1"
RES = f"{API}/store/stock-reservations"
ISS = f"{API}/store/material-issues"
BUILDS = f"{API}/production/rrv-builds"


def make_user(db, email, apps, **flags):
    flags.setdefault("is_active", True)
    user = User(email=email, name=email.split("@")[0], role="user", assigned_apps=list(apps), **flags)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def env(client, db):
    partner = make_user(db, "pl.partner@x.com", ("projects",), is_partner=True)
    keeper = make_user(db, "pl.keeper@x.com", ("store",))
    manager = make_user(db, "pl.storemgr@x.com", ("store",), is_store_manager=True)
    planner = make_user(db, "pl.planner@x.com", ("production",))
    designer = make_user(db, "pl.designer@x.com", ("design",))
    outsider = make_user(db, "pl.hr@x.com", ("hr",))

    # A project made in Project Management: one machine, no units.
    new_p = PmProject(project_code="PEW-901", name="Tamper for Northern Railway", client_name="Northern Railway",
                      status="active", lifecycle_stage="planned", project_manager_id=partner.id, created_by_id=partner.id)
    db.add(new_p)
    db.flush()
    machine = Machine(serial_number="PEW-901-M1", created_by_id=partner.id, pm_project_id=new_p.id)
    db.add(machine)

    # A historic sales-order project: one vehicle unit.
    org = Organization(name="Central Railway")
    db.add(org)
    db.flush()
    so = SalesOrder(customer_id=org.id, status="confirmed", so_number="SO-OLD-1", customer_name="Central Railway")
    db.add(so)
    db.flush()
    line = SalesOrderLine(so_id=so.id, line_number=1, line_type="rrv", description="RRV 10T")
    db.add(line)
    db.flush()
    old_p = PmProject(project_code="PEW-902", name="RRV for Central Railway", client_name="Central Railway", status="active",
                      lifecycle_stage="planned", project_manager_id=partner.id, created_by_id=partner.id, sales_order_id=so.id)
    db.add(old_p)
    db.flush()
    unit = PmProjectElement(project_id=old_p.id, element_no="PEW-902/01", kind="vehicle", label="Vehicle 1",
                            sales_order_line_id=line.id, status="planned")
    db.add(unit)

    loc = StoreLocation(name="PL Store", code="PLS")
    item = StoreItem(item_code="MT-PL-0001", item_name="Hydraulic pump", uom="NOS", item_type="material")
    db.add_all([loc, item])
    db.commit()
    seed_opening_stock(db, item.id, loc.id, 10, created_by_id=manager.id)
    return {"partner": partner, "keeper": keeper, "manager": manager, "planner": planner, "designer": designer,
            "outsider": outsider, "p": new_p, "old": old_p, "unit": unit, "machine": machine, "loc": loc, "item": item, "so": so}


def _balance(db, env):
    db.expire_all()
    return db.query(StoreStockBalance).filter(StoreStockBalance.item_id == env["item"].id,
                                              StoreStockBalance.location_id == env["loc"].id).one()


# ---------------------------------------------------------------- the hub rule

def test_resolve_link_project_level_and_unit_rules(db, env):
    p, old, unit = env["p"], env["old"], env["unit"]
    assert op_core.project_has_units(db, p.id) is False
    assert op_core.project_has_units(db, old.id) is True
    # Project without units: links to the project itself, no unit to pick.
    project, element = op_core.resolve_link(db, p.id, None, what="work order")
    assert project.id == p.id and element is None
    # Nothing picked: nothing linked.
    assert op_core.resolve_link(db, None, None, what="work order") == (None, None)
    # Historic project: the unit is required, with the reason and the fix.
    with pytest.raises(HTTPException) as e:
        op_core.resolve_link(db, old.id, None, what="work order")
    assert e.value.status_code == 422
    assert "Pick the vehicle / lot of PEW-902 this work order is for" in e.value.detail
    # A unit picked: fine; a unit of another project: refused.
    project, element = op_core.resolve_link(db, old.id, unit.id, what="work order")
    assert element.id == unit.id
    with pytest.raises(HTTPException) as e:
        op_core.resolve_link(db, p.id, unit.id, what="work order")
    assert e.value.status_code == 422 and "belongs to PEW-902" in e.value.detail
    with pytest.raises(HTTPException) as e:
        op_core.resolve_link(db, 999999, None, what="work order")
    assert e.value.status_code == 404
    p.status = "closed"
    db.commit()
    with pytest.raises(HTTPException) as e:
        op_core.resolve_link(db, p.id, None, what="work order")
    assert e.value.status_code == 422 and "Closed" in e.value.detail


# ---------------------------------------------------------------- pickers

def test_units_lookup_always_offers_the_project_without_units(client, db, env):
    designer = env["designer"]
    r = client.get(f"{API}/projects/units/lookup", params={"q": "PEW-901"}, headers=auth(designer))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["project_id"] == env["p"].id and row["element_id"] is None and row["project_level"] is True
    assert row["display"] == "PEW-901 · Northern Railway · machine PEW-901-M1"
    assert row["machine_id"] == env["machine"].id and row["machine_serial"] == "PEW-901-M1"
    # Also with a kind filter (a picker that requires an element still gets the project row).
    rows = client.get(f"{API}/projects/units/lookup", params={"q": "PEW-901", "kind": "vehicle"}, headers=auth(designer)).json()
    assert [(x["project_id"], x["element_id"]) for x in rows] == [(env["p"].id, None)]
    # Search by the machine serial.
    rows = client.get(f"{API}/projects/units/lookup", params={"q": "901-M1"}, headers=auth(designer)).json()
    assert [x["project_id"] for x in rows] == [env["p"].id]
    # Historic project: its unit row only; the whole-project row comes with include_projects.
    rows = client.get(f"{API}/projects/units/lookup", params={"q": "PEW-902"}, headers=auth(designer)).json()
    assert [(x["element_id"], x["project_level"]) for x in rows] == [(env["unit"].id, False)]
    rows = client.get(f"{API}/projects/units/lookup", params={"q": "PEW-902", "include_projects": True}, headers=auth(designer)).json()
    assert [x["element_id"] for x in rows] == [None, env["unit"].id] and rows[0]["project_level"] is False
    # Not for an outsider.
    assert client.get(f"{API}/projects/units/lookup", headers=auth(env["outsider"])).status_code == 403


def test_from_sales_order_create_path_is_gone(client, db, env):
    r = client.post(f"{API}/projects/units/from-sales-order", json={"sales_order_id": env["so"].id, "project_manager_id": env["partner"].id},
                    headers=auth(env["partner"]))
    assert r.status_code in (404, 405, 422), r.text
    r = client.get(f"{API}/projects/units/awaiting-sales-orders", headers=auth(env["partner"]))
    assert r.status_code in (404, 405, 422), r.text


# ---------------------------------------------------------------- Store

def test_store_reserves_and_issues_to_the_project_itself(client, db, env):
    p, old, item, loc = env["p"], env["old"], env["item"], env["loc"]
    # Project without units: reserved for the project as a whole.
    r = client.post(RES, json={"item_id": item.id, "location_id": loc.id, "quantity": 6, "order_project_id": p.id},
                    headers=auth(env["keeper"]))
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["order_project_id"] == p.id and res["order_project_element_id"] is None and res["op_number"] == "PEW-901"
    assert _balance(db, env).reserved_qty == 6
    # Historic project: the unit is still required.
    r = client.post(RES, json={"item_id": item.id, "location_id": loc.id, "quantity": 1, "order_project_id": old.id},
                    headers=auth(env["keeper"]))
    assert r.status_code == 422 and "Pick the vehicle / lot of PEW-902" in r.json()["detail"]
    # The list finds project holds.
    rows = client.get(RES, params={"project_stock": True, "order_project_id": p.id}, headers=auth(env["keeper"])).json()
    assert [x["id"] for x in rows] == [res["id"]]

    # A non-project issue can't take what is held for the project.
    r = client.post(ISS, json={"location_id": loc.id, "issue_type": "production", "project_or_work_order": "Shop stock",
                               "items": [{"item_id": item.id, "quantity": 6}]}, headers=auth(env["keeper"]))
    assert r.status_code == 409, r.text
    assert "PEW-901 (whole project)" in r.json()["detail"] and res["reservation_number"] in r.json()["detail"]

    # An issue booked to the project (no unit) is accepted: no "pick a unit" error.
    r = client.post(ISS, json={"location_id": loc.id, "issue_type": "production", "order_project_id": p.id,
                               "items": [{"item_id": item.id, "quantity": 2}]}, headers=auth(env["keeper"]))
    assert r.status_code == 200, r.text
    issue = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.id == r.json()["id"]).one()
    assert issue.order_project_id == p.id and issue.order_project_element_id is None
    # Historic project, no unit: refused with the reason.
    r = client.post(ISS, json={"location_id": loc.id, "issue_type": "production", "order_project_id": old.id,
                               "items": [{"item_id": item.id, "quantity": 1}]}, headers=auth(env["keeper"]))
    assert r.status_code == 422 and "Pick the vehicle / lot of PEW-902" in r.json()["detail"]
    # Unknown project: 404.
    r = client.post(ISS, json={"location_id": loc.id, "issue_type": "production", "order_project_id": 999999,
                               "items": [{"item_id": item.id, "quantity": 1}]}, headers=auth(env["keeper"]))
    assert r.status_code == 404
    # No Store access: denied.
    assert client.post(RES, json={"item_id": item.id, "location_id": loc.id, "quantity": 1, "order_project_id": p.id},
                       headers=auth(env["outsider"])).status_code == 403


def test_project_hold_is_consumed_by_the_project_and_guarded_from_others(db, env):
    p, item, loc, manager, keeper = env["p"], env["item"], env["loc"], env["manager"], env["keeper"]
    hold = project_stock.reserve_for_element(db, item_id=item.id, location_id=loc.id, qty=8, element_id=None, project_id=p.id,
                                             user_id=keeper.id, source_type="manual")
    db.commit()
    assert hold.order_project_id == p.id and hold.order_project_element_id is None
    # Another (non-project) issue: refused, names the holder; a Store Manager needs a reason.
    with pytest.raises(HTTPException) as e:
        project_stock.secure_issue_qty(db, item_id=item.id, location_id=loc.id, qty=5, element_id=None, user=keeper)
    assert e.value.status_code == 409 and "PEW-901 (whole project)" in e.value.detail
    with pytest.raises(HTTPException) as e:
        project_stock.secure_issue_qty(db, item_id=item.id, location_id=loc.id, qty=5, element_id=None, user=manager)
    assert e.value.status_code == 422 and "Reason for using project stock" in e.value.detail
    db.rollback()
    # The project's own issue consumes its hold first.
    got = project_stock.secure_issue_qty(db, item_id=item.id, location_id=loc.id, qty=5, element_id=None, project_id=p.id, user=keeper)
    assert got["consumed"] == 5 and got["overridden"] == []
    db.flush()
    assert db.get(StoreStockReservation, hold.id).quantity == 3 and db.get(StoreStockReservation, hold.id).status == "active"
    got = project_stock.secure_issue_qty(db, item_id=item.id, location_id=loc.id, qty=3, element_id=None, project_id=p.id, user=keeper)
    assert got["consumed"] == 3
    assert db.get(StoreStockReservation, hold.id).status == "fulfilled"


def test_dispatch_takes_the_project_from_the_machine(db, env):
    p = env["p"]
    payload = SimpleNamespace(items=[], erp_project_id=env["machine"].id, order_project_id=None, order_project_element_id=None,
                              sales_order_id=None, project_or_work_order=None)
    link = project_stock.resolve_issue_project(db, "dispatch", payload)
    assert link["project_id"] == p.id and link["element_id"] is None
    # The picked project must be the machine's own project.
    other = PmProject(project_code="PEW-903", name="Another machine", status="active", lifecycle_stage="planned")
    db.add(other)
    db.commit()
    payload.order_project_id = other.id
    with pytest.raises(HTTPException) as e:
        project_stock.resolve_issue_project(db, "dispatch", payload)
    assert e.value.status_code == 422 and "isn't the project of machine PEW-901" in e.value.detail
    # A non-project issue type is never a project issue.
    payload.order_project_id = p.id
    assert project_stock.resolve_issue_project(db, "maintenance", payload)["project_id"] is None


def test_grn_stock_of_a_project_without_units_is_held_for_the_project(db, env):
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceiptItem
    p, old = env["p"], env["old"]
    assert project_stock._grn_line_project(db, SimpleNamespace(order_project_element_id=None, order_project_id=p.id, po_item=None)) == p.id
    # A historic project's elementless line stays free stock (nobody could draw it without a unit).
    assert project_stock._grn_line_project(db, SimpleNamespace(order_project_element_id=None, order_project_id=old.id, po_item=None)) is None
    assert project_stock._grn_line_project(db, SimpleNamespace(order_project_element_id=env["unit"].id, order_project_id=old.id, po_item=None)) is None
    assert P2PGoodsReceiptItem is not None


# ---------------------------------------------------------------- Production

def test_rrv_build_links_to_the_project_one_project_one_machine(client, db, env):
    body = {"rrv_model": "RRV-10T", "priority": "standard", "order_project_id": env["p"].id}
    r = client.post(BUILDS, json=body, headers=auth(env["planner"]))
    assert r.status_code == 201, r.text
    build = r.json()
    assert build["order_project_id"] == env["p"].id and build["order_project_element_id"] is None
    assert build["order_project_number"] == "PEW-901"
    # One live build per project.
    r = client.post(BUILDS, json=body, headers=auth(env["planner"]))
    assert r.status_code == 409 and build["build_number"] in r.json()["detail"] and "one project is one machine" in r.json()["detail"]
    # Historic project: follows its units, not the whole project.
    r = client.post(BUILDS, json={**body, "order_project_id": env["old"].id}, headers=auth(env["planner"]))
    assert r.status_code == 422 and "has units" in r.json()["detail"]
    # Unknown project: 404; no Production access: 403.
    assert client.post(BUILDS, json={**body, "order_project_id": 999999}, headers=auth(env["planner"])).status_code == 404
    assert client.post(BUILDS, json=body, headers=auth(env["outsider"])).status_code == 403
    # The list shows the project link.
    rows = client.get(BUILDS, headers=auth(env["planner"])).json()
    mine = [x for x in rows if x["id"] == build["id"]]
    assert mine and mine[0]["order_project_id"] == env["p"].id and mine[0]["order_project_number"] == "PEW-901"
    # The build keeps its project-level link when its work-order link is resolved.
    from app.modules.production import order_project_links as links
    row = db.get(ProductionRrvBuild, build["id"])
    assert links.resolve_build_element(db, row, persist=True) is None
    assert row.order_project_id == env["p"].id


def test_work_order_project_level_link(db, env):
    from app.modules.production.order_project_links import apply_wo_element, inherit_element
    data = {"order_project_id": env["p"].id}
    apply_wo_element(db, data, 1)
    assert data["order_project_id"] == env["p"].id and data["order_project_element_id"] is None
    # Historic project: needs its unit.
    with pytest.raises(HTTPException) as e:
        apply_wo_element(db, {"order_project_id": env["old"].id}, 1)
    assert e.value.status_code == 422 and "Pick the vehicle / lot of PEW-902" in e.value.detail
    # A parent / build with a project-level link passes the project on.
    target: dict = {}
    inherit_element(target, SimpleNamespace(order_project_id=env["p"].id, order_project_element_id=None))
    assert target == {"order_project_id": env["p"].id}


# ---------------------------------------------------------------- Procurement

def test_pr_lines_of_a_project_without_units_are_tied_to_the_project(db, env):
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem
    from app.modules.p2p.order_project_links import link_pr_lines
    p = env["p"]
    master = SimpleNamespace(item_code="MT-PL-0001", item_name="Hydraulic pump")
    line = SimpleNamespace(order_project_element_id=None, project_inhouse="Project")
    inhouse = SimpleNamespace(order_project_element_id=None, project_inhouse="Inhouse")
    pr = P2PRequest(account_assignment="order_project", order_project_id=p.id)
    rows = [P2PRequestItem(), P2PRequestItem()]
    link_pr_lines(db, pr, [(1, line, master, rows[0]), (2, inhouse, master, rows[1])], draft=False)
    assert (rows[0].order_project_id, rows[0].order_project_element_id) == (p.id, None)
    assert (rows[1].order_project_id, rows[1].order_project_element_id) == (None, None)  # Inhouse is never a project item
    # A line naming a unit of ANOTHER project is still refused, with the line named.
    pr2 = P2PRequest(account_assignment="order_project", order_project_id=p.id)
    bad = SimpleNamespace(order_project_element_id=env["unit"].id, project_inhouse="Project")
    with pytest.raises(HTTPException) as e:
        link_pr_lines(db, pr2, [(1, bad, master, P2PRequestItem())], draft=False)
    assert e.value.status_code == 422 and e.value.detail.startswith("Line 1 (MT-PL-0001 Hydraulic pump):")


# ---------------------------------------------------------------- Quality

def test_quality_call_for_a_project_without_a_sales_order(db, env):
    from app.modules.quality.services import order_project_inspection as opi
    project, element = opi.resolve_link(db, env["p"].id, None)
    assert project.id == env["p"].id and element is None
    assert opi.so_requirement(db, None, project) is None  # no sales order, so no agency rule
    data = {"agency": "rites"}
    req = opi.apply_to_call(db, data, project, element)
    assert req["so_number"] is None and data["agency"] == "rites"
    assert data["order_reference"] == "PEW-901" and data["customer_name"] == "Northern Railway"


# ---------------------------------------------------------------- the 360 "Whole project" row

def test_units_360_shows_one_whole_project_row_with_every_department(client, db, env):
    p, old, partner = env["p"], env["old"], env["partner"]
    r = client.get(f"{API}/projects/{p.id}/units", headers=auth(partner))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_units"] is False and body["elements"] == []
    whole = body["whole_project"]
    assert whole["label"] == "Whole project · PEW-901-M1" and whole["machine_serial"] == "PEW-901-M1"
    assert set(whole["departments"]) == set(op_core.DEPARTMENTS)
    assert all(v is None for v in whole["departments"].values())  # nothing linked yet

    # Production: a build linked to the project.
    r = client.post(BUILDS, json={"rrv_model": "RRV-10T", "priority": "standard", "order_project_id": p.id}, headers=auth(env["planner"]))
    assert r.status_code == 201, r.text
    # Store: a hold for the project, and a dispatch issue booked to it.
    project_stock.reserve_for_element(db, item_id=env["item"].id, location_id=env["loc"].id, qty=2, element_id=None,
                                      project_id=p.id, user_id=env["keeper"].id, source_type="manual")
    db.add(StoreMaterialIssue(issue_number="MI-PL-0001", location_id=env["loc"].id, issue_type="dispatch", challan_number="DC-9",
                              order_project_id=p.id, issue_date=date.today(), issued_by_id=env["keeper"].id))
    # Design: a request linked to the project.
    db.add(DesignRequest(request_number="DRQ-PL-0001", title="Tamper design", source="project", requirement="Design the tamper",
                         requirement_revision=0, reviewed_revision=-1, priority="standard", status="open", waiting_on="design",
                         requested_by_id=partner.id, order_project_id=p.id))
    db.commit()
    body = client.get(f"{API}/projects/{p.id}/units", headers=auth(partner)).json()
    cells = body["whole_project"]["departments"]
    assert cells["production"]["status"] == "planned" and cells["production"]["label"].endswith("Planned")
    assert cells["store"]["status"] == "held" and cells["store"]["label"] == "1 item(s) held"
    assert cells["dispatch"]["status"] == "done" and "MI-PL-0001" in cells["dispatch"]["detail"]
    assert cells["design"] is not None and cells["design"]["status"] == "open"
    assert cells["delivery"] is None

    # A dispatch moves the lifecycle stage to Dispatched, once.
    assert op_core.refresh_project_lifecycle(db, p) is True
    db.commit()
    db.refresh(p)
    assert p.lifecycle_stage == "dispatched"
    assert op_core.refresh_project_lifecycle(db, p) is False

    # The historic project keeps its unit table and has no whole-project row.
    body = client.get(f"{API}/projects/{old.id}/units", headers=auth(partner)).json()
    assert body["has_units"] is True and body["whole_project"] is None
    assert [e["element_no"] for e in body["elements"]] == ["PEW-902/01"]
    assert body["so_number"] == "SO-OLD-1"


def test_units_360_is_scoped_and_returns_real_errors(client, db, env):
    r = client.get(f"{API}/projects/{env['p'].id}/units", headers=auth(env["outsider"]))
    assert r.status_code == 403
    r = client.get(f"{API}/projects/999999/units", headers=auth(env["partner"]))
    assert r.status_code == 404 and "All Projects" in r.json()["detail"]
