"""Projects of Sales Orders (projects/so_projects.py): created at SO confirmation for
orders that build RRVs — one element per vehicle (delivery row) and one lot per
spares / other line; idempotent; amendments add / cancel vehicles; delivery
events drive dispatched / delivered; list / detail / lookup permissions and the
admin backfill."""
from datetime import date, timedelta

from app.modules.projects import so_projects as op_core
from app.modules.sales import service as svc
from app.modules.sales import delivery as dlv
from app.modules.sales.models.order import SalesOrder
from app.modules.projects.models.element import PmProjectElement
from app.modules.projects.models.project import PmProject
from app.tests.test_sales import (
    BASE, TODAY, confirm, create_order, hdr, make_user, payload_from_prefill, setup_customer, setup_people,
)


def _spares_line(no=2, qty=5):
    return {"line_number": no, "line_type": "spares", "description": "Spare kit — hydraulic hoses", "uom": "NOS",
            "quantity": qty, "unit_price": 1000, "discount_percent": 0, "gst_rate": 18}


def _rrv_plus_spares(client, db, maker, inq):
    body = payload_from_prefill(client, hdr(maker), inq)
    body["lines"] = body["lines"] + [_spares_line()]
    body["schedule"] = body["schedule"] + [{"line_number": 2, "quantity": 5, "contract_delivery_date": str(TODAY + timedelta(days=60))}]
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    return r.json()


def _project(db, so_id):
    db.expire_all()
    return db.query(PmProject).filter(PmProject.sales_order_id == so_id).first()


def test_confirm_creates_project_with_vehicle_and_lot_elements(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = confirm(client, db, _rrv_plus_spares(client, db, maker, inq), maker, head, director)

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

    # SO detail carries the chip.
    r = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker))
    assert r.json()["pm_project_id"] == p.id and r.json()["pm_project_code"] == p.project_code
    assert r.json()["order_project"]["op_number"] == p.project_code

    # Idempotent.
    order = db.get(SalesOrder, so["id"])
    assert op_core.ensure_project_for_order(db, order, maker).id == p.id
    db.commit()
    assert db.query(PmProject).count() == 1
    assert db.query(PmProjectElement).count() == 3

    # Helper API for later phases.
    assert op_core.element_for_schedule(db, els[0].sales_schedule_id).id == els[0].id
    assert len(op_core.elements_for_order(db, so["id"])) == 3
    proj, el = op_core.resolve_element(db, els[1].id)
    assert proj.id == p.id and op_core.element_display(proj, el) == f"{p.project_code} / 02 · Vehicle 2"


def test_spares_only_order_gets_no_project(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    body = payload_from_prefill(client, hdr(maker), inq)
    body["lines"] = [_spares_line(no=1, qty=10)]
    body["schedule"] = [{"line_number": 1, "quantity": 10, "contract_delivery_date": str(TODAY + timedelta(days=30))}]
    body["order_type"] = "accessories"
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    so = confirm(client, db, r.json(), maker, head, director)
    assert _project(db, so["id"]) is None
    assert client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()["order_project"] is None


def test_amendment_adds_and_cancels_vehicles(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    order = db.get(SalesOrder, so["id"])

    proposed = svc.snapshot(order)
    proposed["lines"][0]["quantity"] = 3
    proposed["schedule"].append({"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY + timedelta(days=400))})
    svc.apply_amendment(db, order, proposed)
    db.commit()
    p = _project(db, so["id"])
    live = [e for e in p.elements if e.status != "cancelled"]
    assert len(live) == 3 and all(e.kind == "vehicle" for e in live)
    assert sorted(e.element_no for e in p.elements)[-1] == f"{p.project_code}/03"
    assert p.target_handover_date == TODAY + timedelta(days=400)

    order = db.get(SalesOrder, so["id"])
    proposed = svc.snapshot(order)
    proposed["lines"][0]["quantity"] = 2
    proposed["schedule"] = proposed["schedule"][:2]
    svc.apply_amendment(db, order, proposed)
    db.commit()
    p = _project(db, so["id"])
    assert len(p.elements) == 3  # never deleted
    assert sum(1 for e in p.elements if e.status == "cancelled") == 1
    cancelled = next(e for e in p.elements if e.status == "cancelled")
    assert cancelled.id not in {e.id for e in op_core.elements_for_order(db, so["id"])}
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        op_core.resolve_element(db, cancelled.id)
    assert e.value.status_code == 422 and "cancelled" in e.value.detail


def test_delivery_events_drive_element_and_project_status(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    order = db.get(SalesOrder, so["id"])
    row = order.schedules[0]
    dlv.record_event(db, order, row, "dispatch", on=TODAY, reference="DC-1", user=maker)
    db.commit()
    p = _project(db, so["id"])
    assert p.elements[0].status == "dispatched"
    order = db.get(SalesOrder, so["id"])
    dlv.record_event(db, order, order.schedules[0], "delivery", on=TODAY, reference="RN-1", user=maker)
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
    # Design / Production fill their own columns (a new model opens a design request, each vehicle gets a planned build).
    assert {"design", "purchase", "store", "production", "quality"} <= set(el["departments"])


def test_units_and_lookup_permissions_and_scope(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = confirm(client, db, _rrv_plus_spares(client, db, maker, inq), maker, head, director)
    p = _project(db, so["id"])
    assert p.status == "active" and p.lifecycle_stage == "planned" and p.released_at is not None
    assert p.sales_order_ref == so["so_number"]

    d = client.get(f"/api/v1/projects/{p.id}/units", headers=hdr(maker))
    assert d.status_code in (200, 403), d.text  # maker may lack the Project Management app
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


def test_resolve_project_refuses_closed_with_real_message(client, db):
    import pytest
    from fastapi import HTTPException
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    p = _project(db, so["id"])
    p.status = "closed"
    db.commit()
    with pytest.raises(HTTPException) as e:
        op_core.resolve_project(db, p.id)
    assert e.value.status_code == 422 and "Project Management" in e.value.detail
    assert op_core.resolve_project(db, p.id, allow_closed=True).id == p.id


def test_backfill_idempotent(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    p = _project(db, so["id"])
    db.delete(p)
    db.commit()
    assert _project(db, so["id"]) is None
    admin = make_user(db, "adm@premnathrail.com", role="admin")
    created = op_core.backfill(db, admin)
    db.commit()
    assert len(created) == 1
    p = _project(db, so["id"])
    assert p is not None and sum(1 for e in p.elements if e.kind == "vehicle") == 2
    assert op_core.backfill(db, admin) == []
