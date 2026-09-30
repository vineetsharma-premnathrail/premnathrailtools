"""End-to-end tests for the Production module: BOM → work order → Store
issue → shop floor → Quality gate → finished-goods receipt → costing.

Quality's inspection-number generator takes a Postgres advisory lock that
SQLite can't run, so it's replaced with a plain counter here."""
from datetime import date
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import QualityInspection
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.services.stock_ledger import post_stock_transaction

API = "/api/v1/production"


@pytest.fixture(autouse=True)
def _sqlite_document_numbers(monkeypatch):
    """Quality's and Store's number generators take Postgres advisory locks."""
    seq = count(1)
    monkeypatch.setattr(
        "app.modules.production.routes.work_orders.generate_inspection_number",
        lambda db, code: f"INSP-{code}-TEST-{next(seq):04d}",
    )
    monkeypatch.setattr(
        "app.modules.production.service.generate_stock_reservation_number",
        lambda db: f"RES-TEST-{next(seq):04d}",
    )


def make_user(db, email, apps=("production", "quality")):
    user = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=list(apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def reserved(db, item_id, location_id):
    db.expire_all()
    bal = db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=location_id).first()
    return bal.reserved_qty if bal else 0.0


def on_hand(db, item_id, location_id):
    db.expire_all()
    bal = db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=location_id).first()
    return bal.on_hand_qty if bal else 0.0


@pytest.fixture
def setup(client, db):
    user = make_user(db, "planner@premnathrail.com")
    raw = StoreLocation(name="Raw Material Store", code="RM01")
    fg = StoreLocation(name="Finished Goods", code="FG01")
    product = StoreItem(item_code="FG-BRK-01", item_name="Brake assembly", item_type="finished_good", uom="NOS", status="active")
    plate = StoreItem(item_code="RM-PLT-01", item_name="Steel plate", item_type="raw_material", uom="KG", standard_cost=100.0, status="active")
    bolt = StoreItem(item_code="RM-BLT-01", item_name="M12 bolt", item_type="raw_material", uom="NOS", standard_cost=5.0, status="active")
    db.add_all([raw, fg, product, plate, bolt])
    db.commit()
    post_stock_transaction(db, item_id=plate.id, location_id=raw.id, transaction_type="receipt", quantity=100, reference_type="manual")
    post_stock_transaction(db, item_id=bolt.id, location_id=raw.id, transaction_type="receipt", quantity=10, reference_type="manual")
    db.commit()

    h = auth(user)
    ws = client.post(f"{API}/workstations", json={"code": "weld-01", "name": "Welding Bay", "hourly_rate": 500}, headers=h)
    assert ws.status_code == 200, ws.text
    assert ws.json()["code"] == "WELD-01"

    bom = client.post(f"{API}/boms", json={
        "product_item_id": product.id, "base_quantity": 1,
        "items": [
            {"component_item_id": plate.id, "quantity": 10, "scrap_percent": 10},
            {"component_item_id": bolt.id, "quantity": 4},
        ],
        "operations": [
            {"sequence": 10, "operation_name": "Welding", "workstation_id": ws.json()["id"], "setup_hours": 1, "run_hours_per_unit": 2},
            {"sequence": 20, "operation_name": "Final test", "workstation_id": ws.json()["id"], "run_hours_per_unit": 1, "requires_inspection": True},
        ],
    }, headers=h)
    assert bom.status_code == 200, bom.text
    return {"user": user, "h": h, "raw": raw, "fg": fg, "product": product, "plate": plate, "bolt": bolt,
            "ws": ws.json(), "bom": bom.json()}


def test_bom_rules(client, setup):
    h, bom, product = setup["h"], setup["bom"], setup["product"]
    assert bom["status"] == "draft" and bom["version"] == 1
    # 10 kg × 1.10 × ₹100 + 4 × ₹5 = 1120; (1 + 2) + 1 hours × ₹500 = 2000.
    assert bom["standard_material_cost"] == 1120.0
    assert bom["standard_labour_cost"] == 2000.0

    self_ref = client.patch(f"{API}/boms/{bom['id']}", json={"items": [{"component_item_id": product.id, "quantity": 1}]}, headers=h)
    assert self_ref.status_code == 400 and "own BOM" in self_ref.json()["detail"]

    assert client.post(f"{API}/work-orders", json={"bom_id": bom["id"], "quantity_planned": 1}, headers=h).status_code == 409

    active = client.post(f"{API}/boms/{bom['id']}/activate", headers=h).json()
    assert active["status"] == "active"
    locked = client.patch(f"{API}/boms/{bom['id']}", json={"remarks": "x"}, headers=h)
    assert locked.status_code == 409 and "New Version" in locked.json()["detail"]

    v2 = client.post(f"{API}/boms/{bom['id']}/new-version", headers=h).json()
    assert v2["version"] == 2 and v2["status"] == "draft" and len(v2["items"]) == 2
    client.post(f"{API}/boms/{v2['id']}/activate", headers=h)
    assert client.get(f"{API}/boms/{bom['id']}", headers=h).json()["status"] == "obsolete"


def test_work_order_full_lifecycle(client, db, setup):
    h, raw, fg = setup["h"], setup["raw"], setup["fg"]
    plate, bolt, product = setup["plate"], setup["bolt"], setup["product"]
    client.post(f"{API}/boms/{setup['bom']['id']}/activate", headers=h)

    wo = client.post(f"{API}/work-orders", json={"bom_id": setup["bom"]["id"], "quantity_planned": 2, "priority": "high"}, headers=h)
    assert wo.status_code == 200, wo.text
    wo = wo.json()
    assert wo["wo_number"].startswith("WO-") and wo["status"] == "draft"
    req = {m["item_id"]: m["required_qty"] for m in wo["materials"]}
    assert req == {plate.id: 22.0, bolt.id: 8.0}
    assert [o["planned_hours"] for o in wo["operations"]] == [5.0, 2.0]

    no_loc = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h)
    assert no_loc.status_code == 400 and "store location" in no_loc.json()["detail"]
    client.patch(f"{API}/work-orders/{wo['id']}", json={"source_location_id": raw.id, "target_location_id": fg.id}, headers=h)
    wo = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h).json()
    assert wo["status"] == "released"
    # Release holds each line's stock in Store: all 8 bolts reserved, 2 still free.
    bolt_line = next(m for m in wo["materials"] if m["item_id"] == bolt.id)
    assert bolt_line["reserved_qty"] == 8.0 and bolt_line["available_qty"] == 2.0
    assert reserved(db, bolt.id, raw.id) == 8.0

    # Not enough bolts: the whole issue is rejected and nothing moves.
    short = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [
        {"item_id": plate.id, "quantity": 22}, {"item_id": bolt.id, "quantity": 12},
    ]}, headers=h)
    assert short.status_code == 409 and "RM-BLT-01" in short.json()["detail"]
    assert on_hand(db, plate.id, raw.id) == 100

    wo = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [
        {"item_id": plate.id, "quantity": 22}, {"item_id": bolt.id, "quantity": 8},
    ]}, headers=h).json()
    assert wo["status"] == "in_progress"
    assert on_hand(db, plate.id, raw.id) == 78
    # Issuing drew the reservations down to nothing.
    assert reserved(db, plate.id, raw.id) == 0 and reserved(db, bolt.id, raw.id) == 0

    ret = client.post(f"{API}/work-orders/{wo['id']}/return-materials", json={"lines": [{"item_id": plate.id, "quantity": 2}]}, headers=h)
    assert ret.status_code == 200
    over = client.post(f"{API}/work-orders/{wo['id']}/return-materials", json={"lines": [{"item_id": plate.id, "quantity": 50}]}, headers=h)
    assert over.status_code == 400

    weld, test_op = wo["operations"]
    log = client.post(f"{API}/time-logs", json={
        "work_order_id": wo["id"], "operation_id": weld["id"], "log_date": str(date.today()), "hours": 4, "qty_good": 2, "qty_scrap": 0,
    }, headers=h)
    assert log.status_code == 200, log.text
    client.post(f"{API}/work-orders/{wo['id']}/operations/{weld['id']}/complete", json={}, headers=h)

    queue = client.get(f"{API}/shop-floor/queue", headers=h).json()
    assert [q["operation_name"] for q in queue] == ["Final test"]

    # Quality gate on the final operation.
    gated = client.post(f"{API}/work-orders/{wo['id']}/operations/{test_op['id']}/complete", json={}, headers=h)
    assert gated.status_code == 409 and "Request Inspection" in gated.json()["detail"]
    blocked_receipt = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 2}, headers=h)
    assert blocked_receipt.status_code == 409

    wo = client.post(f"{API}/work-orders/{wo['id']}/operations/{test_op['id']}/request-inspection", headers=h).json()
    op = wo["operations"][1]
    assert op["inspection_status"] == "pending"
    insp = db.get(QualityInspection, op["quality_inspection_id"])
    assert insp.inspection_type == "final" and insp.batch_number == wo["wo_number"]

    insp.status = "failed"
    db.commit()
    failed = client.post(f"{API}/work-orders/{wo['id']}/operations/{test_op['id']}/complete", json={}, headers=h)
    assert "Rework" in failed.json()["detail"]
    # Re-inspection after rework.
    wo = client.post(f"{API}/work-orders/{wo['id']}/operations/{test_op['id']}/request-inspection", headers=h).json()
    new_insp = db.get(QualityInspection, wo["operations"][1]["quality_inspection_id"])
    assert new_insp.id != insp.id
    new_insp.status = "passed"
    db.commit()

    client.post(f"{API}/time-logs", json={
        "work_order_id": wo["id"], "operation_id": test_op["id"], "log_date": str(date.today()), "hours": 2, "qty_good": 2,
    }, headers=h)
    assert client.post(f"{API}/work-orders/{wo['id']}/operations/{test_op['id']}/complete", json={}, headers=h).status_code == 200

    too_many = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 3}, headers=h)
    assert too_many.status_code == 400
    wo = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 2}, headers=h).json()
    assert wo["quantity_completed"] == 2 and wo["progress_percent"] == 100
    assert on_hand(db, product.id, fg.id) == 2

    movements = client.get(f"{API}/work-orders/{wo['id']}/stock-movements", headers=h).json()
    assert sorted(m["transaction_type"] for m in movements) == ["issue", "issue", "receipt", "return_in"]

    cost = client.get(f"{API}/work-orders/{wo['id']}/costing", headers=h).json()
    # Actual: 20 kg × 100 + 8 × 5 = 2040 material; 6 h × 500 = 3000 labour.
    assert cost["actual_material_cost"] == 2040.0
    assert cost["actual_labour_cost"] == 3000.0
    assert cost["cost_per_unit"] == 2520.0

    no_cancel = client.post(f"{API}/work-orders/{wo['id']}/cancel", json={"reason": "x"}, headers=h)
    assert no_cancel.status_code == 409
    wo = client.post(f"{API}/work-orders/{wo['id']}/complete", headers=h).json()
    assert wo["status"] == "completed"
    assert client.post(f"{API}/work-orders/{wo['id']}/close", headers=h).json()["status"] == "closed"

    dash = client.get(f"{API}/dashboard", headers=h).json()
    assert dash["kpis"]["output_30d"] == 2
    report = client.get(f"{API}/reports", headers=h).json()
    assert report["total_output"] == 2 and report["output"][0]["item_code"] == "FG-BRK-01"


def test_planning_shows_shortages(client, setup):
    h = setup["h"]
    client.post(f"{API}/boms/{setup['bom']['id']}/activate", headers=h)
    client.post(f"{API}/work-orders", json={"bom_id": setup["bom"]["id"], "quantity_planned": 5}, headers=h)
    plan = client.get(f"{API}/planning", headers=h).json()
    bolts = next(r for r in plan["requirements"] if r["item_code"] == "RM-BLT-01")
    assert bolts["outstanding_qty"] == 20 and bolts["available_qty"] == 10 and bolts["shortage_qty"] == 10
    plates = next(r for r in plan["requirements"] if r["item_code"] == "RM-PLT-01")
    assert plates["outstanding_qty"] == 55 and plates["shortage_qty"] == 0
    assert plan["requirements"][0]["item_code"] == "RM-BLT-01"  # biggest shortage first


def test_requires_production_app(client, db):
    outsider = make_user(db, "sales@premnathrail.com", apps=("crm",))
    resp = client.get(f"{API}/work-orders", headers=auth(outsider))
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Production-readiness: reservations, permissions, master data, integrations
# ---------------------------------------------------------------------------

def _released_wo(client, setup, qty=1):
    h = setup["h"]
    client.post(f"{API}/boms/{setup['bom']['id']}/activate", headers=h)
    wo = client.post(f"{API}/work-orders", json={
        "bom_id": setup["bom"]["id"], "quantity_planned": qty,
        "source_location_id": setup["raw"].id, "target_location_id": setup["fg"].id,
    }, headers=h).json()
    resp = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_competing_orders_share_stock_through_reservations(client, db, setup):
    from app.modules.store.models.stock_reservation import StoreStockReservation
    bolt, raw = setup["bolt"], setup["raw"]
    first = _released_wo(client, setup, qty=2)     # needs 8 of the 10 bolts
    res = db.query(StoreStockReservation).filter_by(production_order=first["wo_number"], item_id=bolt.id).one()
    assert res.status == "active" and res.quantity == 8

    second = _released_wo(client, setup, qty=1)    # needs 4, only 2 left free
    line = next(m for m in second["materials"] if m["item_id"] == bolt.id)
    assert line["reserved_qty"] == 2 and line["available_qty"] == 0 and second["shortage_count"] == 1

    plan = client.get(f"{API}/planning", headers=setup["h"]).json()
    bolts = next(r for r in plan["requirements"] if r["item_code"] == "RM-BLT-01")
    assert bolts["outstanding_qty"] == 12 and bolts["reserved_qty"] == 10 and bolts["shortage_qty"] == 2

    cancelled = client.post(f"{API}/work-orders/{first['id']}/cancel", json={"reason": "Customer postponed"}, headers=setup["h"])
    assert cancelled.status_code == 200
    db.expire_all()
    assert db.get(StoreStockReservation, res.id).status == "cancelled"
    assert reserved(db, bolt.id, raw.id) == 2

    topped = client.post(f"{API}/work-orders/{second['id']}/reserve-materials", headers=setup["h"]).json()
    assert next(m for m in topped["materials"] if m["item_id"] == bolt.id)["reserved_qty"] == 4


def test_permission_matrix_actions_are_enforced(client, db, setup):
    client.post(f"{API}/boms/{setup['bom']['id']}/activate", headers=setup["h"])
    viewer = make_user(db, "viewer@premnathrail.com")
    viewer.granular_permissions = ["production:work_orders:view"]
    db.commit()
    assert client.get(f"{API}/work-orders", headers=auth(viewer)).status_code == 200
    denied = client.post(f"{API}/work-orders", json={"bom_id": setup["bom"]["id"], "quantity_planned": 1}, headers=auth(viewer))
    assert denied.status_code == 403 and "'create' permission on Production › Work Orders" in denied.json()["detail"]
    # Users never configured in the matrix keep full access (opt-in).
    assert client.post(f"{API}/work-orders", json={"bom_id": setup["bom"]["id"], "quantity_planned": 1}, headers=setup["h"]).status_code == 200


def test_inactive_items_and_down_workstations_are_blocked(client, db, setup):
    h, plate = setup["h"], setup["plate"]
    plate.status = "discontinued"
    db.commit()
    blocked = client.post(f"{API}/boms/{setup['bom']['id']}/activate", headers=h)
    assert blocked.status_code == 409 and "RM-PLT-01" in blocked.json()["detail"]
    plate.status = "active"
    db.commit()

    wo = _released_wo(client, setup)
    client.patch(f"{API}/workstations/{setup['ws']['id']}", json={"status": "under_maintenance"}, headers=h)
    start = client.post(f"{API}/work-orders/{wo['id']}/operations/{wo['operations'][0]['id']}/start", headers=h)
    assert start.status_code == 409 and "under maintenance" in start.json()["detail"]


def test_serial_numbered_output_needs_whole_units_and_a_serial(client, db, setup):
    setup["product"].serial_controlled = True
    db.commit()
    wo = _released_wo(client, setup, qty=2)
    h = setup["h"]
    for op in wo["operations"]:
        if op["requires_inspection"]:
            wo = client.post(f"{API}/work-orders/{wo['id']}/operations/{op['id']}/request-inspection", headers=h).json()
    insp = db.get(QualityInspection, wo["operations"][1]["quality_inspection_id"])
    insp.status = "passed"
    db.commit()
    client.post(f"{API}/work-orders/{wo['id']}/operations/{wo['operations'][0]['id']}/start", headers=h)

    half = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1.5}, headers=h)
    assert half.status_code == 400 and "whole units" in half.json()["detail"]
    no_serial = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1}, headers=h)
    assert no_serial.status_code == 400 and "serial number" in no_serial.json()["detail"]
    ok = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1, "batch_number": "PRT-SN-0001"}, headers=h)
    assert ok.status_code == 200


def test_quality_result_notifies_the_work_order_supervisor(client, db, setup):
    from app.modules.main.models.notification import Notification
    supervisor = make_user(db, "supervisor@premnathrail.com")
    wo = _released_wo(client, setup)
    client.patch(f"{API}/work-orders/{wo['id']}", json={"supervisor_id": supervisor.id}, headers=setup["h"])
    gate = next(op for op in wo["operations"] if op["requires_inspection"])
    wo = client.post(f"{API}/work-orders/{wo['id']}/operations/{gate['id']}/request-inspection", headers=setup["h"]).json()
    inspection_id = next(op for op in wo["operations"] if op["requires_inspection"])["quality_inspection_id"]

    inspector = make_user(db, "inspector@premnathrail.com", apps=("quality",))
    resp = client.patch(f"/api/v1/quality/inspections/{inspection_id}", json={"status": "failed"}, headers=auth(inspector))
    assert resp.status_code == 200, resp.text
    note = db.query(Notification).filter_by(user_id=supervisor.id, notification_type="production_inspection_result").one()
    assert "Rework" in note.title and wo["wo_number"] in note.message


def test_erp_users_see_work_orders_for_their_machine_and_job_card_prints(client, db, setup):
    from app.modules.erp.models.project import Project
    machine = Project(serial_number="PRT-TRK-0042", model_name="Track Laying Machine", client_company="Northern Railway")
    db.add(machine)
    db.commit()
    client.post(f"{API}/boms/{setup['bom']['id']}/activate", headers=setup["h"])
    wo = client.post(f"{API}/work-orders", json={"bom_id": setup["bom"]["id"], "quantity_planned": 1, "erp_project_id": machine.id}, headers=setup["h"]).json()
    assert wo["project_label"] == "PRT-TRK-0042 — Track Laying Machine (Northern Railway)"

    service_engineer = make_user(db, "service@premnathrail.com", apps=("erp",))
    rows = client.get(f"{API}/integrations/projects/{machine.id}/work-orders", headers=auth(service_engineer)).json()
    assert [r["wo_number"] for r in rows] == [wo["wo_number"]]
    assert client.get(f"{API}/work-orders", headers=auth(service_engineer)).status_code == 403

    pdf = client.get(f"{API}/work-orders/{wo['id']}/job-card", headers=setup["h"])
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content[:4] == b"%PDF"
