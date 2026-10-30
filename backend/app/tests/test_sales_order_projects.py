"""Projects of HISTORIC Sales Orders (projects/so_projects.py): created by the Project
Manager (ensure_project_for_order(create=True), never on confirmation) for orders that
build RRVs — one element per vehicle (delivery row) and one lot per spares / other line;
idempotent; vehicles added / cancelled on the order are followed; delivery events drive
dispatched / delivered; units list / lookup permissions.

Sales Orders were retired on 2026-10-30, so the orders here are built from the models
(tests/_so_project_helpers.py); there is no order API to drive."""
from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.modules.projects import so_projects as op_core
from app.modules.projects.models.element import PmProjectElement
from app.modules.projects.models.project import PmProject
from app.modules.sales.models.delivery import SalesDeliveryEvent
from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule
from app.tests._so_project_helpers import (
    TODAY, create_project_for, hdr, make_confirmed_order, make_user, order_with_project,
)


def _project(db, so_id):
    db.expire_all()
    return db.query(PmProject).filter(PmProject.sales_order_id == so_id).first()


def test_pm_created_project_has_vehicle_and_lot_elements(db):
    so = order_with_project(db, qty=2, price=1000000, spares_qty=5)
    p = _project(db, so["id"])
    assert p is not None
    assert p.project_code == "PEW-1"  # one series with PM projects; no past projects in the test DB
    assert p.status == "active" and p.lifecycle_stage == "planned"
    assert p.client_name == "Central Railway" and "CR/PO/2026/771" in p.name
    els = sorted(p.elements, key=lambda e: e.element_no)
    assert [e.kind for e in els] == ["vehicle", "vehicle", "lot"]
    assert [e.element_no for e in els] == [f"{p.project_code}/01", f"{p.project_code}/02", f"{p.project_code}/03"]
    assert els[0].label == "Vehicle 1" and els[1].label == "Vehicle 2"
    assert els[0].sales_schedule_id and els[2].sales_schedule_id is None and float(els[2].quantity) == 5
    assert p.target_handover_date == max(e.contractual_date for e in els)

    # Idempotent.
    order = db.get(SalesOrder, so["id"])
    assert op_core.ensure_project_for_order(db, order, None).id == p.id
    db.commit()
    assert db.query(PmProject).count() == 1
    assert db.query(PmProjectElement).count() == 3

    # Helper API for later phases.
    assert op_core.element_for_schedule(db, els[0].sales_schedule_id).id == els[0].id
    assert len(op_core.elements_for_order(db, so["id"])) == 3
    proj, el = op_core.resolve_element(db, els[1].id)
    assert proj.id == p.id and op_core.element_display(proj, el) == f"{p.project_code} / 02 · Vehicle 2"


def test_spares_only_order_gets_no_project(db):
    order = make_confirmed_order(db, qty=0, spares_qty=10, order_type="accessories")
    assert op_core.needs_project(order) is False
    assert create_project_for(db, order.id) is None
    assert _project(db, order.id) is None


def test_vehicles_added_or_cancelled_on_the_order_are_followed(db):
    so = order_with_project(db, qty=2, price=1000000)
    order = db.get(SalesOrder, so["id"])
    line = order.lines[0]
    db.add(SalesOrderSchedule(so_id=order.id, so_line_id=line.id, sequence=3, quantity=1, status="open",
                              contract_delivery_date=TODAY + timedelta(days=400), current_delivery_date=TODAY + timedelta(days=400)))
    line.quantity = 3
    op_core.ensure_project_for_order(db, order, None)
    db.commit()
    p = _project(db, so["id"])
    live = [e for e in p.elements if e.status != "cancelled"]
    assert len(live) == 3 and all(e.kind == "vehicle" for e in live)
    assert sorted(e.element_no for e in p.elements)[-1] == f"{p.project_code}/03"
    assert p.target_handover_date == TODAY + timedelta(days=400)

    order = db.get(SalesOrder, so["id"])
    order.schedules[2].status = "cancelled"
    order.lines[0].quantity = 2
    op_core.ensure_project_for_order(db, order, None)
    db.commit()
    p = _project(db, so["id"])
    assert len(p.elements) == 3  # never deleted
    cancelled = [e for e in p.elements if e.status == "cancelled"]
    assert len(cancelled) == 1
    assert cancelled[0].id not in {e.id for e in op_core.elements_for_order(db, so["id"])}
    with pytest.raises(HTTPException) as e:
        op_core.resolve_element(db, cancelled[0].id)
    assert e.value.status_code == 422 and "cancelled" in e.value.detail


def test_delivery_events_drive_element_and_project_status(client, db):
    so = order_with_project(db, qty=1, price=1000000)
    order = db.get(SalesOrder, so["id"])
    row = order.schedules[0]
    db.add(SalesDeliveryEvent(so_id=order.id, schedule_id=row.id, so_line_id=row.so_line_id, event="dispatch", quantity=1,
                              event_date=TODAY, reference="DC-1", source="manual"))
    row.dispatched_on, row.qty_dispatched, row.status = TODAY, 1, "dispatched"
    db.commit()
    op_core.refresh_order_project(db, db.get(SalesOrder, so["id"]))
    db.commit()
    p = _project(db, so["id"])
    assert p.elements[0].status == "dispatched"

    order = db.get(SalesOrder, so["id"])
    row = order.schedules[0]
    db.add(SalesDeliveryEvent(so_id=order.id, schedule_id=row.id, so_line_id=row.so_line_id, event="delivery", quantity=1,
                              event_date=TODAY, reference="RN-1", source="manual"))
    row.delivered_on, row.qty_delivered, row.status = TODAY, 1, "delivered"
    db.commit()
    op_core.refresh_order_project(db, db.get(SalesOrder, so["id"]))
    db.commit()
    p = _project(db, so["id"])
    assert p.elements[0].status == "delivered"

    pm_user = make_user(db, "pmu2@premnathrail.com", apps=("projects",), granular_permissions=["projects:all_projects:view"])
    p.project_manager_id = pm_user.id
    db.commit()
    r = client.get(f"/api/v1/projects/{p.id}/units", headers=hdr(pm_user))
    assert r.status_code == 200, r.text
    el = r.json()["elements"][0]
    assert el["departments"]["delivery"]["status"] == "done" and el["departments"]["dispatch"]["label"] == "Dispatched"
    assert {"design", "purchase", "store", "production", "quality"} <= set(el["departments"])


def test_units_and_lookup_permissions_and_scope(client, db):
    so = order_with_project(db, qty=2, price=1000000, spares_qty=5)
    p = _project(db, so["id"])
    assert p.status == "active" and p.lifecycle_stage == "planned" and p.released_at is not None
    assert p.sales_order_ref == so["so_number"]

    pm_user = make_user(db, "pmu@premnathrail.com", apps=("projects",), granular_permissions=["projects:all_projects:view"])
    p.project_manager_id = pm_user.id
    db.commit()
    d = client.get(f"/api/v1/projects/{p.id}/units", headers=hdr(pm_user))
    assert d.status_code == 200, d.text
    body = d.json()
    assert body["so_number"] == so["so_number"] and len(body["elements"]) == 3
    assert body["vehicles_total"] == 2 and body["lots_total"] == 1
    assert set(body["elements"][0]["departments"]) == set(op_core.DEPARTMENTS)

    # Outside every Project Management scope: 403 with the reason; unknown id: 404.
    hr_user = make_user(db, "hr@premnathrail.com", apps=("hr",))
    assert client.get(f"/api/v1/projects/{p.id}/units", headers=hdr(hr_user)).status_code == 403
    assert client.get("/api/v1/projects/999999/units", headers=hdr(pm_user)).status_code == 404

    # Lookup: any department user; not for an outsider.
    designer = make_user(db, "designer@premnathrail.com", apps=("design",))
    r = client.get("/api/v1/projects/units/lookup", params={"q": p.project_code}, headers=hdr(designer))
    assert r.status_code == 200, r.text
    assert len(r.json()) == 3 and r.json()[0]["display"].startswith(f"{p.project_code} / 01 · Vehicle 1")
    assert len(client.get("/api/v1/projects/units/lookup", params={"kind": "lot"}, headers=hdr(designer)).json()) == 1
    r = client.get("/api/v1/projects/units/lookup", params={"include_projects": True}, headers=hdr(designer))
    assert len(r.json()) == 4 and r.json()[0]["element_id"] is None
    assert client.get("/api/v1/projects/units/lookup", headers=hdr(hr_user)).status_code == 403


def test_resolve_project_refuses_closed_with_real_message(db):
    so = order_with_project(db, qty=1, price=1000000)
    p = _project(db, so["id"])
    p.status = "closed"
    db.commit()
    with pytest.raises(HTTPException) as e:
        op_core.resolve_project(db, p.id)
    assert e.value.status_code == 422 and "Project Management" in e.value.detail
    assert op_core.resolve_project(db, p.id, allow_closed=True).id == p.id


def test_sync_without_create_never_makes_a_project(db):
    """Syncs only update an existing project; a project is never created implicitly (owner, 2026-10-28)."""
    order = make_confirmed_order(db, qty=2, price=1000000)
    assert _project(db, order.id) is None
    assert op_core.ensure_project_for_order(db, order, None) is None
    db.commit()
    assert _project(db, order.id) is None and op_core.awaiting_project(db, order)
