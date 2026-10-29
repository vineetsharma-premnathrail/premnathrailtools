"""Quality against Order Projects: inspection calls / lots linked to a vehicle
element, the Sales Order as the single source of the inspection requirement,
the SO 'inspection' billing milestone on acceptance, the dispatch check per
element and the 'quality' column of the Order Project 360."""
from datetime import date

import pytest

from app.modules.quality.services import order_project_inspection as opi
from app.modules.projects import so_projects as ops
from app.modules.sales.models.order import SalesOrder
from app.modules.projects.models.project import PmProject
from app.tests.test_quality_phase1 import (  # noqa: F401  (fixture)
    Q, make_user as q_user, hdr as q_hdr, setup_item, _sqlite_number_series,
)
from app.tests._so_project_helpers import confirm_with_project
from app.tests.test_sales import BASE, create_order, hdr, setup_customer, setup_people


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    import app.middleware.owasp as owasp
    monkeypatch.setitem(owasp.RATE_CONFIG["write"], "limit", 100000)


PLAN = [{"milestone_type": "advance", "percent": 20}, {"milestone_type": "inspection", "percent": 30},
        {"milestone_type": "delivery", "percent": 50}]


def _order(client, db, agency="rites", required=True):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = create_order(client, db, maker, inq, inspection_agency=agency, third_party_inspection_required=required,
                      billing_plan=PLAN)
    so = confirm_with_project(client, db, so, maker, head, director)
    db.expire_all()
    project = db.query(PmProject).filter(PmProject.sales_order_id == so["id"]).first()
    els = sorted(project.elements, key=lambda e: e.element_no)
    return so, project, els


def _team(db):
    eng = q_user(db, "eng-op@x.com", apps=("quality", "store", "sales"), quality_role="engineer")
    head = q_user(db, "head-op@x.com", apps=("quality", "store", "sales"), quality_role="head")
    return eng, head


def _cells(db, project):
    so = db.get(SalesOrder, project.sales_order_id)
    return {eid: c["quality"] for eid, c in ops.department_cells(db, project, so, list(project.elements)).items()}


def test_provider_registered_at_startup():
    import app.main  # noqa: F401
    assert "quality" in ops._department_providers


def test_call_for_element_takes_agency_from_sales_order_and_bills_inspection(client, db):
    so, project, (v1, v2) = _order(client, db)
    eng, _head = _team(db)
    item, _loc = setup_item(db, "RRV-10T vehicle", flagged=False)

    cells = _cells(db, project)
    assert cells[v1.id]["status"] == "not_called" and cells[v1.id]["tone"] == "warning"
    assert cells[v1.id]["label"] == "RITES required — not called"

    body = {"order_project_id": project.id, "order_project_element_id": v1.id, "item_id": item.id, "quantity": 1}
    r = client.post(f"{Q}/inspection-calls", json={**body, "agency": "rdso"}, headers=q_hdr(eng))
    assert r.status_code == 422 and f"Sales Order {so['so_number']}" in r.json()["detail"] and "RITES" in r.json()["detail"]
    # Element of another project → refused.
    r = client.post(f"{Q}/inspection-calls", json={**body, "order_project_id": project.id + 99}, headers=q_hdr(eng))
    assert r.status_code == 422

    r = client.post(f"{Q}/inspection-calls", json=body, headers=q_hdr(eng))
    assert r.status_code == 200, r.text
    call = r.json()
    assert call["agency"] == "rites" and call["order_reference"] == "CR/PO/2026/771"
    assert call["op_number"] == project.project_code and call["element_no"] == v1.element_no
    assert call["so_number"] == so["so_number"] and call["so_third_party_inspection_required"] is True

    req = client.get(f"{Q}/inspection-calls/order-project-requirement", params={"element_id": v1.id}, headers=q_hdr(eng)).json()
    assert req["required"] is True and req["agency"] == "rites" and req["cleared"] is False and len(req["calls"]) == 1
    listed = client.get(f"{Q}/inspection-calls", params={"order_project_element_id": v1.id}, headers=q_hdr(eng)).json()
    assert [c["id"] for c in listed] == [call["id"]]
    assert client.get(f"{Q}/inspection-calls", params={"order_project_element_id": v2.id}, headers=q_hdr(eng)).json() == []

    db.expire_all()
    assert _cells(db, project)[v1.id]["status"] == "called"

    r = client.post(f"{Q}/inspection-calls/{call['id']}/result",
                    json={"result": "accepted", "certificate_number": "RITES/IC/9", "result_date": str(date.today())},
                    headers=q_hdr(eng))
    assert r.status_code == 200, r.text

    db.expire_all()
    order = db.get(SalesOrder, so["id"])
    insp = next(b for b in order.billing_lines if b.milestone_type == "inspection")
    assert insp.triggered_at is not None
    cells = _cells(db, project)
    assert cells[v1.id]["status"] == "accepted" and cells[v1.id]["tone"] == "success"
    assert cells[v2.id]["status"] == "not_called"

    assert opi.inspection_required_for_element(db, v1) == (True, "rites", True)
    assert opi.inspection_required_for_element(db, v2) == (True, "rites", False)

    # Dispatch check by element (rule 8 from the SO).
    chk = lambda el: client.post(f"{Q}/inspection-calls/dispatch-check", json={  # noqa: E731
        "item_id": item.id, "quantity": 1, "order_project_element_id": el.id}, headers=q_hdr(eng)).json()
    assert chk(v1)["allowed"] is True
    bad = chk(v2)
    assert bad["allowed"] is False and "Sales Order" in bad["problems"][0] and "RITES" in bad["problems"][0]


def test_rejected_call_shows_danger(client, db):
    _so, project, (v1, _v2) = _order(client, db)
    eng, _head = _team(db)
    item, _loc = setup_item(db, "RRV vehicle", flagged=False)
    call = client.post(f"{Q}/inspection-calls", json={"order_project_element_id": v1.id, "item_id": item.id, "quantity": 1,
                                                     "call_date": str(date.today())}, headers=q_hdr(eng)).json()
    r = client.post(f"{Q}/inspection-calls/{call['id']}/result", json={"result": "rejected", "remarks": "Brake test failed"},
                    headers=q_hdr(eng))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert _cells(db, project)[v1.id]["tone"] == "danger"


def test_order_without_agency_needs_no_call(client, db):
    so, project, (v1, _v2) = _order(client, db, agency=None, required=False)
    eng, _head = _team(db)
    item, _loc = setup_item(db, "RRV vehicle", flagged=False)
    assert _cells(db, project)[v1.id]["status"] == "not_required"
    r = client.post(f"{Q}/inspection-calls", json={"order_project_element_id": v1.id, "item_id": item.id, "quantity": 1,
                                                  "agency": "rites"}, headers=q_hdr(eng))
    assert r.status_code == 422 and "no inspecting agency" in r.json()["detail"] and so["so_number"] in r.json()["detail"]
    assert opi.inspection_required_for_element(db, v1) == (False, None, True)


def test_manual_lot_links_to_element(client, db):
    _so, project, (v1, _v2) = _order(client, db)
    eng, _head = _team(db)
    item, _loc = setup_item(db, "RRV vehicle", flagged=False)
    r = client.post(f"{Q}/inspection-lots", json={"inspection_type": "final", "item_id": item.id, "quantity": 1,
                                                 "order_project_id": project.id, "order_project_element_id": v1.id},
                    headers=q_hdr(eng))
    assert r.status_code == 200, r.text
    lot = r.json()
    assert lot["order_project_element_id"] == v1.id and lot["op_number"] == project.project_code
    assert lot["element_no"] == v1.element_no
    listed = client.get(f"{Q}/inspection-lots", params={"order_project_id": project.id}, headers=q_hdr(eng)).json()
    assert [x["id"] for x in listed] == [lot["id"]]
    r = client.post(f"{Q}/inspection-lots", json={"inspection_type": "final", "item_id": item.id, "quantity": 1,
                                                 "order_project_element_id": 999999}, headers=q_hdr(eng))
    assert r.status_code == 404 and "project picker" in r.json()["detail"]
    # The 360 detail line mentions the open final inspection.
    db.expire_all()
    assert lot["lot_number"] in (_cells(db, project)[v1.id]["detail"] or "")
