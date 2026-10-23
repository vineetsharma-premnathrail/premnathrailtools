"""Order Projects (sales/order_projects.py): created at SO confirmation for
orders that build RRVs — one element per vehicle (delivery row) and one lot per
spares / other line; idempotent; amendments add / cancel vehicles; delivery
events drive dispatched / delivered; list / detail / lookup permissions and the
admin backfill."""
from datetime import date, timedelta

from app.modules.sales import order_projects as ops
from app.modules.sales import service as svc
from app.modules.sales import delivery as dlv
from app.modules.sales.models.order import SalesOrder
from app.modules.sales.models.order_project import OrderProject, OrderProjectElement
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
    return db.query(OrderProject).filter(OrderProject.sales_order_id == so_id).first()


def test_confirm_creates_project_with_vehicle_and_lot_elements(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = confirm(client, db, _rrv_plus_spares(client, db, maker, inq), maker, head, director)

    p = _project(db, so["id"])
    assert p is not None
    assert p.op_number == f"PEW-{date.today().year}-0001"  # one series with PM projects
    assert p.status == "active" and p.project_manager_id is None
    assert p.customer_name == "Central Railway" and "CR/PO/2026/771" in p.title
    els = sorted(p.elements, key=lambda e: e.element_no)
    assert [e.kind for e in els] == ["vehicle", "vehicle", "lot"]
    assert [e.element_no for e in els] == [f"{p.op_number}/01", f"{p.op_number}/02", f"{p.op_number}/03"]
    assert els[0].label == "Vehicle 1" and els[1].label == "Vehicle 2"
    assert els[0].sales_schedule_id and els[2].sales_schedule_id is None and float(els[2].quantity) == 5
    assert p.planned_end == max(e.contractual_date for e in els)

    # SO detail carries the chip.
    r = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker))
    assert r.json()["order_project"]["op_number"] == p.op_number

    # Idempotent.
    order = db.get(SalesOrder, so["id"])
    assert ops.ensure_order_project(db, order, maker).id == p.id
    db.commit()
    assert db.query(OrderProject).count() == 1
    assert db.query(OrderProjectElement).count() == 3

    # Helper API for later phases.
    assert ops.element_for_schedule(db, els[0].sales_schedule_id).id == els[0].id
    assert len(ops.elements_for_order(db, so["id"])) == 3
    proj, el = ops.resolve_element(db, els[1].id)
    assert proj.id == p.id and ops.element_display(proj, el) == f"{p.op_number} / 02 · Vehicle 2"


def test_spares_only_order_gets_no_project(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    body = payload_from_prefill(client, hdr(maker), inq)
    body["lines"] = [_spares_line(no=1, qty=10)]
    body["schedule"] = [{"line_number": 1, "quantity": 10, "contract_delivery_date": str(TODAY + timedelta(days=30))}]
    body["order_type"] = "spares"
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
    assert sorted(e.element_no for e in p.elements)[-1] == f"{p.op_number}/03"
    assert p.planned_end == TODAY + timedelta(days=400)

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
    r = client.get(f"{BASE}/order-projects/lookup", headers=hdr(maker))
    assert cancelled.id not in {x["element_id"] for x in r.json()}
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        ops.resolve_element(db, cancelled.id)
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
    assert p.elements[0].status == "delivered" and p.status == "delivered"

    r = client.get(f"{BASE}/order-projects/{p.id}", headers=hdr(maker))
    assert r.status_code == 200, r.text
    el = r.json()["elements"][0]
    assert el["departments"]["delivery"]["status"] == "done" and el["departments"]["dispatch"]["label"] == "Dispatched"
    # Design / Production fill their own columns (a new model opens a design request, each vehicle gets a planned build).
    assert {"design", "purchase", "store", "production", "quality"} <= set(el["departments"])


def test_list_detail_patch_lookup_permissions(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = confirm(client, db, _rrv_plus_spares(client, db, maker, inq), maker, head, director)
    p = _project(db, so["id"])

    r = client.get(f"{BASE}/order-projects", headers=hdr(maker))
    assert r.status_code == 200 and [x["op_number"] for x in r.json()] == [p.op_number]
    assert r.json()[0]["vehicles_total"] == 2 and r.json()[0]["lots_total"] == 1
    assert client.get(f"{BASE}/order-projects", params={"q": "771"}, headers=hdr(maker)).json()[0]["id"] == p.id
    assert client.get(f"{BASE}/order-projects", params={"q": "nomatch"}, headers=hdr(maker)).json() == []

    d = client.get(f"{BASE}/order-projects/{p.id}", headers=hdr(maker)).json()
    assert d["so_number"] == so["so_number"] and len(d["elements"]) == 3
    assert set(d["elements"][0]["departments"]) == set(ops.DEPARTMENTS)

    # Sales user with only Sales Orders view: no Order Projects tab.
    viewer = make_user(db, "viewer@premnathrail.com", granular_permissions=["sales:orders:view"])
    assert client.get(f"{BASE}/order-projects", headers=hdr(viewer)).status_code == 403
    assert client.get(f"{BASE}/order-projects/{p.id}", headers=hdr(viewer)).status_code == 403
    # View-only on the tab: can read, can't edit.
    op_viewer = make_user(db, "opv@premnathrail.com", granular_permissions=["projects:order_projects:view"])
    assert client.get(f"{BASE}/order-projects", headers=hdr(op_viewer)).status_code == 200
    r = client.patch(f"{BASE}/order-projects/{p.id}", json={"status": "on_hold"}, headers=hdr(op_viewer))
    assert r.status_code == 403

    # Edit: project manager, hold, bad status, bad dates.
    r = client.patch(f"{BASE}/order-projects/{p.id}", json={"project_manager_id": head.id, "status": "on_hold"}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert r.json()["project_manager_name"] == head.name and r.json()["status"] == "on_hold"
    assert client.patch(f"{BASE}/order-projects/{p.id}", json={"status": "delivered"}, headers=hdr(maker)).status_code == 422
    r = client.patch(f"{BASE}/order-projects/{p.id}", json={"planned_start": str(TODAY), "planned_end": str(TODAY - timedelta(days=1))},
                     headers=hdr(maker))
    assert r.status_code == 422 and "before planned start" in r.json()["detail"]
    assert client.patch(f"{BASE}/order-projects/{p.id}", json={"status": "active"}, headers=hdr(maker)).json()["status"] == "active"

    # Lookup: any department user; not for an outsider.
    designer = make_user(db, "designer@premnathrail.com", apps=("design",))
    r = client.get(f"{BASE}/order-projects/lookup", params={"q": p.op_number}, headers=hdr(designer))
    assert r.status_code == 200, r.text
    assert len(r.json()) == 3 and r.json()[0]["display"].startswith(f"{p.op_number} / 01 · Vehicle 1")
    assert len(client.get(f"{BASE}/order-projects/lookup", params={"kind": "lot"}, headers=hdr(designer)).json()) == 1
    r = client.get(f"{BASE}/order-projects/lookup", params={"include_projects": True}, headers=hdr(designer))
    assert len(r.json()) == 4 and r.json()[0]["element_id"] is None
    hr_user = make_user(db, "hr@premnathrail.com", apps=("hr",))
    assert client.get(f"{BASE}/order-projects/lookup", headers=hdr(hr_user)).status_code == 403


def test_backfill_is_admin_only_and_idempotent(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    # Simulate an order confirmed before Order Projects existed.
    p = _project(db, so["id"])
    db.delete(p)
    db.commit()
    assert _project(db, so["id"]) is None

    assert client.post(f"{BASE}/order-projects/backfill", headers=hdr(maker)).status_code == 403
    admin = make_user(db, "adm@premnathrail.com", role="admin")
    r = client.post(f"{BASE}/order-projects/backfill", headers=hdr(admin))
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    p = _project(db, so["id"])
    assert p is not None and sum(1 for e in p.elements if e.kind == "vehicle") == 2
    assert client.post(f"{BASE}/order-projects/backfill", headers=hdr(admin)).json()["created"] == 0
