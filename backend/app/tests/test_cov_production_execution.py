"""Coverage tests for Production execution: work order release / material
reservation / issue / return / finished-goods receipt, shop-floor time logs
(good / scrap qty), planning net requirements, workstation capacity and
master data, Permission Matrix on the floor tabs, and the real error
messages returned on invalid transitions."""
from app.core.permission_words import place
from datetime import date, timedelta
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.services.stock_ledger import post_stock_transaction

API = "/api/v1/production"
TODAY = str(date.today())


@pytest.fixture(autouse=True)
def _sqlite_document_numbers(monkeypatch):
    """Store's reservation number generator takes a Postgres advisory lock."""
    seq = count(1)
    monkeypatch.setattr(
        "app.modules.production.service.generate_stock_reservation_number",
        lambda db: f"RES-COV-{next(seq):04d}",
    )


def make_user(db, email, apps=("production", "quality"), grants=None, active=True):
    user = User(email=email, name=email.split("@")[0], role="user", is_active=active, assigned_apps=list(apps))
    if grants is not None:
        user.granular_permissions = list(grants)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def balance(db, item_id, location_id):
    db.expire_all()
    bal = db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=location_id).first()
    return (bal.on_hand_qty, bal.reserved_qty) if bal else (0.0, 0.0)


def decide_gate(db, lot_id, decision):
    lot = db.get(QualityInspectionLot, lot_id)
    lot.status, lot.decision = "decision_made", decision
    lot.accepted_qty = 0 if decision == "reject" else lot.quantity
    db.commit()


@pytest.fixture
def s(client, db):
    """Product = 1 frame + 2 rods per unit; plate-cutting (setup 1h, 2h/unit)
    on CUT-01 @ ₹400, then assembly (1h/unit) on ASM-01 @ ₹200."""
    user = make_user(db, "wo.planner@premnathrail.com")
    raw = StoreLocation(name="Raw Store", code="RS01")
    alt = StoreLocation(name="Satellite Store", code="RS02")
    fg = StoreLocation(name="FG Store", code="FG02")
    product = StoreItem(item_code="FG-FRM-01", item_name="Bogie frame", item_type="finished_good", uom="NOS", status="active")
    frame = StoreItem(item_code="RM-FRM-01", item_name="Frame blank", item_type="raw_material", uom="NOS", standard_cost=1000.0, status="active")
    rod = StoreItem(item_code="RM-ROD-01", item_name="Tie rod", item_type="raw_material", uom="NOS", standard_cost=100.0, status="active")
    paint = StoreItem(item_code="CN-PNT-01", item_name="Primer", item_type="consumable", uom="LTR", standard_cost=10.0, status="active")
    db.add_all([raw, alt, fg, product, frame, rod, paint])
    db.commit()
    for item, loc, qty in ((frame, raw, 5), (rod, raw, 6), (paint, raw, 20), (rod, alt, 10)):
        post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=qty, reference_type="manual")
    db.commit()

    h = auth(user)
    cut = client.post(f"{API}/workstations", json={"code": "CUT-01", "name": "Plasma cutter", "hourly_rate": 400, "capacity_hours_per_day": 8}, headers=h).json()
    asm = client.post(f"{API}/workstations", json={"code": "ASM-01", "name": "Assembly bay", "workstation_type": "assembly_bay", "hourly_rate": 200, "capacity_hours_per_day": 4}, headers=h).json()
    bom = client.post(f"{API}/boms", json={
        "product_item_id": product.id,
        "items": [{"component_item_id": frame.id, "quantity": 1}, {"component_item_id": rod.id, "quantity": 2}],
        "operations": [
            {"sequence": 10, "operation_name": "Cutting", "workstation_id": cut["id"], "setup_hours": 1, "run_hours_per_unit": 2},
            {"sequence": 20, "operation_name": "Assembly", "workstation_id": asm["id"], "run_hours_per_unit": 1},
        ],
    }, headers=h).json()
    assert client.post(f"{API}/boms/{bom['id']}/activate", headers=h).status_code == 200
    return dict(user=user, h=h, raw=raw, alt=alt, fg=fg, product=product, frame=frame, rod=rod, paint=paint,
                cut=cut, asm=asm, bom=bom)


def new_wo(client, s, qty=2, release=True, **extra):
    body = {"bom_id": s["bom"]["id"], "quantity_planned": qty, "source_location_id": s["raw"].id, "target_location_id": s["fg"].id}
    body.update(extra)
    resp = client.post(f"{API}/work-orders", json=body, headers=s["h"])
    assert resp.status_code == 200, resp.text
    wo = resp.json()
    if release:
        resp = client.post(f"{API}/work-orders/{wo['id']}/release", headers=s["h"])
        assert resp.status_code == 200, resp.text
        wo = resp.json()
    return wo


def line(wo, item):
    return next(m for m in wo["materials"] if m["item_id"] == item.id)


# ---------------------------------------------------------------------------
# Work order create / edit / delete
# ---------------------------------------------------------------------------

def test_create_validates_priority_dates_and_refs(client, s):
    h, bom = s["h"], s["bom"]["id"]
    bad_priority = client.post(f"{API}/work-orders", json={"bom_id": bom, "quantity_planned": 1, "priority": "asap"}, headers=h)
    assert bad_priority.status_code == 400 and "Invalid priority 'asap'" in bad_priority.json()["detail"]

    dates = client.post(f"{API}/work-orders", json={
        "bom_id": bom, "quantity_planned": 1, "planned_start_date": "2026-10-10", "planned_end_date": "2026-10-01",
    }, headers=h)
    assert dates.status_code == 400 and "before the planned start date" in dates.json()["detail"]

    loc = client.post(f"{API}/work-orders", json={"bom_id": bom, "quantity_planned": 1, "source_location_id": 9999}, headers=h)
    assert loc.status_code == 404 and "Issue-from store location #9999" in loc.json()["detail"]

    sup = client.post(f"{API}/work-orders", json={"bom_id": bom, "quantity_planned": 1, "supervisor_id": 9999}, headers=h)
    assert sup.status_code == 404 and "Supervisor" in sup.json()["detail"]

    no_bom = client.post(f"{API}/work-orders", json={"bom_id": 4040, "quantity_planned": 1}, headers=h)
    assert no_bom.status_code == 404

    assert client.post(f"{API}/work-orders", json={"bom_id": bom, "quantity_planned": 0}, headers=h).status_code == 422


def test_create_blocked_when_component_was_discontinued_after_activation(client, db, s):
    s["rod"].status = "discontinued"
    db.commit()
    resp = client.post(f"{API}/work-orders", json={"bom_id": s["bom"]["id"], "quantity_planned": 1}, headers=s["h"])
    assert resp.status_code == 409 and "RM-ROD-01" in resp.json()["detail"] and "new BOM version" in resp.json()["detail"]


def test_explosion_scales_by_base_quantity(client, db, s):
    h = s["h"]
    v2 = client.post(f"{API}/boms/{s['bom']['id']}/new-version", headers=h).json()
    client.patch(f"{API}/boms/{v2['id']}", json={"base_quantity": 2}, headers=h)
    client.post(f"{API}/boms/{v2['id']}/activate", headers=h)
    wo = client.post(f"{API}/work-orders", json={"bom_id": v2["id"], "quantity_planned": 3}, headers=h).json()
    # Components are per 2 units → factor 1.5; routing hours are per unit.
    assert line(wo, s["frame"])["required_qty"] == 1.5 and line(wo, s["rod"])["required_qty"] == 3.0
    assert [o["planned_hours"] for o in wo["operations"]] == [7.0, 3.0]


def test_draft_quantity_change_re_explodes_and_released_quantity_is_locked(client, s):
    h = s["h"]
    wo = new_wo(client, s, qty=1, release=False)
    wo = client.patch(f"{API}/work-orders/{wo['id']}", json={"quantity_planned": 3}, headers=h).json()
    assert line(wo, s["rod"])["required_qty"] == 6.0 and wo["operations"][0]["planned_hours"] == 7.0

    client.post(f"{API}/work-orders/{wo['id']}/release", headers=h)
    locked = client.patch(f"{API}/work-orders/{wo['id']}", json={"quantity_planned": 4}, headers=h)
    assert locked.status_code == 409 and "locked once it's released" in locked.json()["detail"]
    # Same quantity is a no-op, other fields still editable while released.
    ok = client.patch(f"{API}/work-orders/{wo['id']}", json={"quantity_planned": 3, "priority": "urgent", "remarks": "rush"}, headers=h)
    assert ok.status_code == 200 and ok.json()["priority"] == "urgent"


def test_only_drafts_can_be_deleted(client, s):
    h = s["h"]
    draft = new_wo(client, s, release=False)
    assert client.delete(f"{API}/work-orders/{draft['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/work-orders/{draft['id']}", headers=h).status_code == 404

    released = new_wo(client, s)
    resp = client.delete(f"{API}/work-orders/{released['id']}", headers=h)
    assert resp.status_code == 409 and "Only a draft work order can be deleted" in resp.json()["detail"] and "Cancel it instead" in resp.json()["detail"]


def test_list_filters(client, s):
    h = s["h"]
    draft = new_wo(client, s, release=False, priority="low", planned_end_date=str(date.today() - timedelta(days=3)))
    released = new_wo(client, s, priority="high")
    ids = lambda params: {w["id"] for w in client.get(f"{API}/work-orders", params=params, headers=h).json()}  # noqa: E731
    assert ids({"status": "draft"}) == {draft["id"]}
    assert ids({"status": "draft,released"}) == {draft["id"], released["id"]}
    assert ids({"priority": "high"}) == {released["id"]}
    assert ids({"overdue": True}) == {draft["id"]}
    assert ids({"search": "bogie"}) == {draft["id"], released["id"]}
    bad = client.get(f"{API}/work-orders", params={"status": "draft,finished"}, headers=h)
    assert bad.status_code == 400 and "finished" in bad.json()["detail"]
    detail = client.get(f"{API}/work-orders/{draft['id']}", headers=h).json()
    assert detail["is_overdue"] is True


# ---------------------------------------------------------------------------
# Release + reservations
# ---------------------------------------------------------------------------

def test_release_transitions_and_messages(client, s):
    h = s["h"]
    wo = new_wo(client, s, release=False, target_location_id=None)
    missing = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h)
    assert missing.status_code == 400 and "Receive output into" in missing.json()["detail"]
    client.patch(f"{API}/work-orders/{wo['id']}", json={"target_location_id": s["fg"].id}, headers=h)
    assert client.post(f"{API}/work-orders/{wo['id']}/release", headers=h).status_code == 200
    twice = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h)
    assert twice.status_code == 409
    assert "is released, so you can't release it" in twice.json()["detail"] and "only allowed while it is draft" in twice.json()["detail"]


def test_release_without_routing_is_rejected(client, db, s):
    h = s["h"]
    v2 = client.post(f"{API}/boms/{s['bom']['id']}/new-version", headers=h).json()
    client.patch(f"{API}/boms/{v2['id']}", json={"operations": []}, headers=h)
    client.post(f"{API}/boms/{v2['id']}/activate", headers=h)
    wo = client.post(f"{API}/work-orders", json={
        "bom_id": v2["id"], "quantity_planned": 1, "source_location_id": s["raw"].id, "target_location_id": s["fg"].id,
    }, headers=h).json()
    resp = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h)
    assert resp.status_code == 400 and "no routing operations" in resp.json()["detail"]


def test_release_reserves_what_is_free_and_flags_shortage(client, db, s):
    wo = new_wo(client, s, qty=4)  # 4 frames (5 on hand), 8 rods (6 on hand)
    assert line(wo, s["frame"])["reserved_qty"] == 4.0
    assert line(wo, s["rod"])["reserved_qty"] == 6.0 and line(wo, s["rod"])["available_qty"] == 0.0
    assert wo["shortage_count"] == 1
    assert balance(db, s["rod"].id, s["raw"].id) == (6.0, 6.0)
    res = db.query(StoreStockReservation).filter_by(production_order=wo["wo_number"]).all()
    assert {r.item_id: r.quantity for r in res} == {s["frame"].id: 4.0, s["rod"].id: 6.0}
    assert all(r.status == "active" and "Held for Production" in r.remarks for r in res)

    # A GRN brings 2 more rods: Reserve Materials tops up the same reservation.
    post_stock_transaction(db, item_id=s["rod"].id, location_id=s["raw"].id, transaction_type="receipt", quantity=2, reference_type="manual")
    db.commit()
    wo = client.post(f"{API}/work-orders/{wo['id']}/reserve-materials", headers=s["h"]).json()
    assert line(wo, s["rod"])["reserved_qty"] == 8.0 and wo["shortage_count"] == 0
    assert db.query(StoreStockReservation).filter_by(production_order=wo["wo_number"]).count() == 2


def test_reserve_materials_only_while_executing(client, s):
    wo = new_wo(client, s, release=False)
    resp = client.post(f"{API}/work-orders/{wo['id']}/reserve-materials", headers=s["h"])
    assert resp.status_code == 409 and "reserve material" in resp.json()["detail"]


def test_changing_source_location_moves_reservations(client, db, s):
    wo = new_wo(client, s, qty=1)
    assert balance(db, s["rod"].id, s["raw"].id)[1] == 2.0
    wo = client.patch(f"{API}/work-orders/{wo['id']}", json={"source_location_id": s["alt"].id}, headers=s["h"]).json()
    assert balance(db, s["rod"].id, s["raw"].id)[1] == 0.0
    assert balance(db, s["rod"].id, s["alt"].id)[1] == 2.0
    # No frames at the satellite store, so that line is now short.
    assert line(wo, s["frame"])["reserved_qty"] == 0.0 and wo["shortage_count"] == 1
    statuses = sorted(r.status for r in db.query(StoreStockReservation).filter_by(production_order=wo["wo_number"]).all())
    assert statuses == ["active", "cancelled", "cancelled"]


# ---------------------------------------------------------------------------
# Issue / return / receipt
# ---------------------------------------------------------------------------

def test_issue_blocked_on_draft(client, s):
    wo = new_wo(client, s, release=False)
    resp = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [{"item_id": s["frame"].id, "quantity": 1}]}, headers=s["h"])
    assert resp.status_code == 409 and "is draft, so you can't issue material to it" in resp.json()["detail"]


def test_partial_issue_keeps_remaining_reservation(client, db, s):
    wo = new_wo(client, s, qty=2)
    wo = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [{"item_id": s["rod"].id, "quantity": 1}]}, headers=s["h"]).json()
    assert wo["status"] == "in_progress" and wo["actual_start_at"] is not None
    rod = line(wo, s["rod"])
    assert rod["issued_qty"] == 1.0 and rod["outstanding_qty"] == 3.0 and rod["reserved_qty"] == 3.0
    assert balance(db, s["rod"].id, s["raw"].id) == (5.0, 3.0)


def test_extra_issue_of_item_not_on_bom_adds_a_line_and_cost(client, db, s):
    wo = new_wo(client, s, qty=1)
    wo = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [{"item_id": s["paint"].id, "quantity": 3}]}, headers=s["h"]).json()
    extra = line(wo, s["paint"])
    assert extra["required_qty"] == 0.0 and extra["issued_qty"] == 3.0 and extra["remarks"] == "Extra issue (not on BOM)"
    cost = client.get(f"{API}/work-orders/{wo['id']}/costing", headers=s["h"]).json()
    assert cost["actual_material_cost"] == 30.0 and cost["estimated_material_cost"] == 1200.0

    unknown = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [{"item_id": 31337, "quantity": 1}]}, headers=s["h"])
    assert unknown.status_code == 404 and "#31337" in unknown.json()["detail"]


def test_issue_from_a_location_without_stock_explains_which_item(client, db, s):
    wo = new_wo(client, s, qty=1)
    resp = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={
        "location_id": s["alt"].id, "lines": [{"item_id": s["frame"].id, "quantity": 1}],
    }, headers=s["h"])
    assert resp.status_code == 409 and "Can't issue RM-FRM-01 (Frame blank)" in resp.json()["detail"]
    assert balance(db, s["frame"].id, s["raw"].id) == (5.0, 1.0)  # nothing moved, reservation intact


def test_return_more_than_issued_or_never_issued(client, s):
    wo = new_wo(client, s, qty=1)
    h = s["h"]
    never = client.post(f"{API}/work-orders/{wo['id']}/return-materials", json={"lines": [{"item_id": s["paint"].id, "quantity": 1}]}, headers=h)
    assert never.status_code == 400 and "only 0 is currently issued" in never.json()["detail"]
    client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [{"item_id": s["rod"].id, "quantity": 2}]}, headers=h)
    over = client.post(f"{API}/work-orders/{wo['id']}/return-materials", json={"lines": [{"item_id": s["rod"].id, "quantity": 2.5}]}, headers=h)
    assert over.status_code == 400 and "Can't return 2.5 of RM-ROD-01" in over.json()["detail"]


def test_receive_output_rules(client, s):
    h = s["h"]
    wo = new_wo(client, s, qty=2)
    not_started = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1}, headers=h)
    assert not_started.status_code == 409 and "is released, so you can't receive finished goods" in not_started.json()["detail"]

    client.post(f"{API}/work-orders/{wo['id']}/operations/{wo['operations'][0]['id']}/start", headers=h)
    first = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1.5}, headers=h)
    assert first.status_code == 200 and first.json()["progress_percent"] == 75.0
    too_many = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1}, headers=h)
    assert too_many.status_code == 400 and "Only 0.5 unit(s)" in too_many.json()["detail"]
    bad_loc = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 0.5, "location_id": 8888}, headers=h)
    assert bad_loc.status_code == 400 and "receive finished goods into" in bad_loc.json()["detail"]


def test_completion_and_close_transitions(client, db, s):
    h = s["h"]
    wo = new_wo(client, s, qty=1)
    released = client.post(f"{API}/work-orders/{wo['id']}/complete", headers=h)
    assert released.status_code == 409 and "only allowed while it is in progress" in released.json()["detail"]
    early_close = client.post(f"{API}/work-orders/{wo['id']}/close", headers=h)
    assert early_close.status_code == 409 and "close it" in early_close.json()["detail"]

    cut, asm = wo["operations"]
    client.post(f"{API}/work-orders/{wo['id']}/operations/{cut['id']}/start", headers=h)
    pending = client.post(f"{API}/work-orders/{wo['id']}/complete", headers=h)
    assert pending.status_code == 409 and "10 Cutting, 20 Assembly" in pending.json()["detail"]

    for op in (cut, asm):
        assert client.post(f"{API}/work-orders/{wo['id']}/operations/{op['id']}/complete", json={}, headers=h).status_code == 200
    no_output = client.post(f"{API}/work-orders/{wo['id']}/complete", headers=h)
    assert no_output.status_code == 409 and "Receive Output" in no_output.json()["detail"]

    client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1}, headers=h)
    done = client.post(f"{API}/work-orders/{wo['id']}/complete", headers=h).json()
    assert done["status"] == "completed" and done["actual_end_at"] is not None
    # Completing hands back whatever was still reserved (nothing was issued).
    assert balance(db, s["rod"].id, s["raw"].id) == (6.0, 0.0)
    assert {r.status for r in db.query(StoreStockReservation).filter_by(production_order=wo["wo_number"]).all()} == {"cancelled"}

    # Leftover material can still come back after completion.
    edit_done = client.patch(f"{API}/work-orders/{wo['id']}", json={"remarks": "x"}, headers=h)
    assert edit_done.status_code == 409
    closed = client.post(f"{API}/work-orders/{wo['id']}/close", headers=h).json()
    assert closed["status"] == "closed" and closed["closed_at"] is not None
    no_cancel = client.post(f"{API}/work-orders/{wo['id']}/cancel", json={"reason": "x"}, headers=h)
    assert no_cancel.status_code == 409 and "is closed" in no_cancel.json()["detail"]


def test_cancel_rules(client, db, s):
    h = s["h"]
    wo = new_wo(client, s, qty=1)
    assert client.post(f"{API}/work-orders/{wo['id']}/cancel", json={"reason": ""}, headers=h).status_code == 422
    client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [{"item_id": s["rod"].id, "quantity": 2}]}, headers=h)
    issued = client.post(f"{API}/work-orders/{wo['id']}/cancel", json={"reason": "No longer needed"}, headers=h)
    assert issued.status_code == 409 and "RM-ROD-01 (Tie rod) × 2" in issued.json()["detail"] and "Return it to Store" in issued.json()["detail"]

    client.post(f"{API}/work-orders/{wo['id']}/return-materials", json={"lines": [{"item_id": s["rod"].id, "quantity": 2}]}, headers=h)
    cancelled = client.post(f"{API}/work-orders/{wo['id']}/cancel", json={"reason": "  No longer needed  "}, headers=h).json()
    assert cancelled["status"] == "cancelled" and cancelled["cancel_reason"] == "No longer needed"
    assert balance(db, s["frame"].id, s["raw"].id) == (5.0, 0.0)
    assert balance(db, s["rod"].id, s["raw"].id) == (6.0, 0.0)


def test_cancel_blocked_once_output_received(client, s):
    h = s["h"]
    wo = new_wo(client, s, qty=2)
    client.post(f"{API}/work-orders/{wo['id']}/operations/{wo['operations'][0]['id']}/start", headers=h)
    client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1}, headers=h)
    resp = client.post(f"{API}/work-orders/{wo['id']}/cancel", json={"reason": "stop"}, headers=h)
    assert resp.status_code == 409 and "Complete the order instead" in resp.json()["detail"]


def test_costing_estimate_and_variance(client, s):
    h = s["h"]
    wo = new_wo(client, s, qty=1)
    cost = client.get(f"{API}/work-orders/{wo['id']}/costing", headers=h).json()
    # Material 1000 + 2 × 100 = 1200; labour (1 + 2) × 400 + 1 × 200 = 1400.
    assert cost["estimated_material_cost"] == 1200.0 and cost["estimated_labour_cost"] == 1400.0
    assert cost["estimated_total_cost"] == 2600.0 and cost["planned_hours"] == 4.0
    assert cost["actual_total_cost"] == 0.0 and cost["variance_percent"] == -100.0 and cost["cost_per_unit"] is None

    client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": wo["operations"][0]["id"], "log_date": TODAY, "hours": 3.25}, headers=h)
    cost = client.get(f"{API}/work-orders/{wo['id']}/costing", headers=h).json()
    assert cost["actual_hours"] == 3.25 and cost["actual_labour_cost"] == 1300.0


# ---------------------------------------------------------------------------
# Shop floor: operations + time logs
# ---------------------------------------------------------------------------

def test_operation_start_complete_errors(client, s):
    h = s["h"]
    draft = new_wo(client, s, release=False)
    resp = client.post(f"{API}/work-orders/{draft['id']}/operations/{draft['operations'][0]['id']}/start", headers=h)
    assert resp.status_code == 409 and "start its operations" in resp.json()["detail"]

    wo = new_wo(client, s)
    cut = wo["operations"][0]
    wo2 = client.post(f"{API}/work-orders/{wo['id']}/operations/{cut['id']}/start", headers=h).json()
    assert wo2["status"] == "in_progress" and wo2["operations"][0]["status"] == "in_progress"
    again = client.post(f"{API}/work-orders/{wo['id']}/operations/{cut['id']}/start", headers=h)
    assert again.status_code == 409 and "already in progress" in again.json()["detail"]

    foreign = client.post(f"{API}/work-orders/{wo['id']}/operations/{draft['operations'][0]['id']}/start", headers=h)
    assert foreign.status_code == 404 and "is not part of work order" in foreign.json()["detail"]

    done = client.post(f"{API}/work-orders/{wo['id']}/operations/{cut['id']}/complete", json={"remarks": "clean cut"}, headers=h).json()
    assert done["operations"][0]["status"] == "completed" and done["operations"][0]["remarks"] == "clean cut"
    twice = client.post(f"{API}/work-orders/{wo['id']}/operations/{cut['id']}/complete", json={}, headers=h)
    assert twice.status_code == 409 and "already completed" in twice.json()["detail"]
    insp = client.post(f"{API}/work-orders/{wo['id']}/operations/{cut['id']}/request-inspection", headers=h)
    assert insp.status_code == 409


def test_time_log_accumulates_good_and_scrap_and_starts_the_order(client, s):
    h = s["h"]
    wo = new_wo(client, s, qty=3)
    cut = wo["operations"][0]
    first = client.post(f"{API}/time-logs", json={
        "work_order_id": wo["id"], "operation_id": cut["id"], "log_date": TODAY, "hours": 4, "qty_good": 2, "qty_scrap": 1, "remarks": "shift A",
    }, headers=h)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["operator_id"] == s["user"].id and body["workstation_id"] == s["cut"]["id"]
    assert body["wo_number"] == wo["wo_number"] and body["operation_label"] == "10 Cutting" and body["workstation_name"] == "CUT-01 — Plasma cutter"
    second = client.post(f"{API}/time-logs", json={
        "work_order_id": wo["id"], "operation_id": cut["id"], "log_date": TODAY, "hours": 2.5, "qty_good": 0.5, "qty_scrap": 0.25,
    }, headers=h).json()

    wo = client.get(f"{API}/work-orders/{wo['id']}", headers=h).json()
    op = wo["operations"][0]
    assert wo["status"] == "in_progress" and op["status"] == "in_progress"
    assert op["qty_good"] == 2.5 and op["qty_scrap"] == 1.25 and op["actual_hours"] == 6.5

    # Confirmed yield can't pass the order quantity (3): 0.5 more is the limit.
    over = client.post(f"{API}/time-logs", json={
        "work_order_id": wo["id"], "operation_id": cut["id"], "log_date": TODAY, "hours": 1, "qty_good": 1,
    }, headers=h)
    assert over.status_code == 400 and "at most 0.5 more good" in over.json()["detail"]
    assert wo["quantity_scrapped"] == 1.25

    # Deleting a log takes its quantities back off.
    assert client.delete(f"{API}/time-logs/{second['id']}", headers=h).status_code == 200
    wo = client.get(f"{API}/work-orders/{wo['id']}", headers=h).json()
    assert wo["operations"][0]["qty_good"] == 2.0 and wo["operations"][0]["qty_scrap"] == 1.0 and wo["quantity_scrapped"] == 1.0
    assert client.delete(f"{API}/time-logs/{second['id']}", headers=h).status_code == 404

    logs = client.get(f"{API}/time-logs", params={"work_order_id": wo["id"]}, headers=h).json()
    assert [entry["hours"] for entry in logs] == [4.0]
    assert client.get(f"{API}/time-logs", params={"workstation_id": s["asm"]["id"]}, headers=h).json() == []


def test_time_log_validation_messages(client, db, s):
    h = s["h"]
    draft = new_wo(client, s, release=False)
    on_draft = client.post(f"{API}/time-logs", json={"work_order_id": draft["id"], "operation_id": draft["operations"][0]["id"], "log_date": TODAY, "hours": 1}, headers=h)
    assert on_draft.status_code == 409 and "is draft" in on_draft.json()["detail"] and "released or in progress" in on_draft.json()["detail"]

    wo = new_wo(client, s)
    cut = wo["operations"][0]
    base = {"work_order_id": wo["id"], "operation_id": cut["id"], "log_date": TODAY, "hours": 1}

    future = client.post(f"{API}/time-logs", json={**base, "log_date": str(date.today() + timedelta(days=1))}, headers=h)
    assert future.status_code == 400 and "future date" in future.json()["detail"]
    for bad in ({"hours": 0}, {"hours": 25}, {"qty_good": -1}, {"qty_scrap": -0.5}):
        assert client.post(f"{API}/time-logs", json={**base, **bad}, headers=h).status_code == 422

    gone = make_user(db, "left.company@premnathrail.com", active=False)
    inactive_op = client.post(f"{API}/time-logs", json={**base, "operator_id": gone.id}, headers=h)
    assert inactive_op.status_code == 404 and "not found or inactive" in inactive_op.json()["detail"]

    foreign = client.post(f"{API}/time-logs", json={**base, "operation_id": draft["operations"][0]["id"]}, headers=h)
    assert foreign.status_code == 404
    assert client.post(f"{API}/time-logs", json={**base, "work_order_id": 5555}, headers=h).status_code == 404

    client.patch(f"{API}/workstations/{s['cut']['id']}", json={"status": "under_maintenance"}, headers=h)
    down = client.post(f"{API}/time-logs", json=base, headers=h)
    assert down.status_code == 409 and "CUT-01 is under maintenance" in down.json()["detail"]
    client.patch(f"{API}/workstations/{s['cut']['id']}", json={"status": "active"}, headers=h)

    log = client.post(f"{API}/time-logs", json=base, headers=h).json()
    client.post(f"{API}/work-orders/{wo['id']}/operations/{cut['id']}/complete", json={}, headers=h)
    closed_op = client.post(f"{API}/time-logs", json=base, headers=h)
    assert closed_op.status_code == 409 and "already completed" in closed_op.json()["detail"]
    locked = client.delete(f"{API}/time-logs/{log['id']}", headers=h)
    assert locked.status_code == 409 and "time logs are locked" in locked.json()["detail"]


def test_operator_can_be_someone_else(client, db, s):
    welder = make_user(db, "welder@premnathrail.com", apps=("production",))
    wo = new_wo(client, s)
    log = client.post(f"{API}/time-logs", json={
        "work_order_id": wo["id"], "operation_id": wo["operations"][0]["id"], "log_date": TODAY, "hours": 2, "operator_id": welder.id,
    }, headers=s["h"]).json()
    assert log["operator_id"] == welder.id and log["operator_name"] == "welder"
    assert len(client.get(f"{API}/time-logs", params={"operator_id": welder.id}, headers=s["h"]).json()) == 1


def test_queue_orders_in_progress_first_and_filters(client, s):
    h = s["h"]
    low = new_wo(client, s, qty=1, priority="low")
    urgent = new_wo(client, s, qty=1, priority="urgent")
    new_wo(client, s, qty=1, release=False, priority="urgent")  # drafts never reach the floor
    client.post(f"{API}/work-orders/{low['id']}/operations/{low['operations'][0]['id']}/start", headers=h)

    queue = client.get(f"{API}/shop-floor/queue", headers=h).json()
    assert len(queue) == 4
    assert (queue[0]["wo_number"], queue[0]["status"]) == (low["wo_number"], "in_progress")
    assert [q["wo_number"] for q in queue[1:3]] == [urgent["wo_number"]] * 2

    only_running = client.get(f"{API}/shop-floor/queue", params={"include_pending": False}, headers=h).json()
    assert [q["operation_id"] for q in only_running] == [low["operations"][0]["id"]]
    asm_only = client.get(f"{API}/shop-floor/queue", params={"workstation_id": s["asm"]["id"]}, headers=h).json()
    assert {q["operation_name"] for q in asm_only} == {"Assembly"}


@pytest.fixture
def gated(client, s):
    """A BOM whose *first* operation is a quality gate, released."""
    h = s["h"]
    v2 = client.post(f"{API}/boms/{s['bom']['id']}/new-version", headers=h).json()
    client.patch(f"{API}/boms/{v2['id']}", json={"operations": [
        {"sequence": 10, "operation_name": "Cutting", "workstation_id": s["cut"]["id"], "run_hours_per_unit": 1, "requires_inspection": True},
        {"sequence": 20, "operation_name": "Assembly", "workstation_id": s["asm"]["id"], "run_hours_per_unit": 1},
    ]}, headers=h)
    client.post(f"{API}/boms/{v2['id']}/activate", headers=h)
    wo = client.post(f"{API}/work-orders", json={
        "bom_id": v2["id"], "quantity_planned": 1, "source_location_id": s["raw"].id, "target_location_id": s["fg"].id,
    }, headers=h).json()
    wo = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h).json()
    gate, nxt = wo["operations"]
    wo = client.post(f"{API}/work-orders/{wo['id']}/operations/{gate['id']}/request-inspection", headers=h).json()
    return {"wo": wo, "gate": wo["operations"][0], "next": nxt}


def test_next_operation_is_held_while_gate_is_undecided(client, db, s, gated):
    h, wo, nxt = s["h"], gated["wo"], gated["next"]
    held = client.post(f"{API}/work-orders/{wo['id']}/operations/{nxt['id']}/start", headers=h)
    assert held.status_code == 409 and "on hold" in held.json()["detail"] and "no usage decision yet" in held.json()["detail"]
    decide_gate(db, gated["gate"]["quality_lot_id"], "reject")
    rejected = client.post(f"{API}/work-orders/{wo['id']}/operations/{nxt['id']}/start", headers=h)
    assert rejected.status_code == 409 and "was rejected" in rejected.json()["detail"]


def test_time_log_cannot_bypass_the_gate_hold(client, s, gated):
    resp = client.post(f"{API}/time-logs", json={
        "work_order_id": gated["wo"]["id"], "operation_id": gated["next"]["id"], "log_date": TODAY, "hours": 1,
    }, headers=s["h"])
    assert resp.status_code == 409


def test_complete_cannot_bypass_the_gate_hold(client, s, gated):
    resp = client.post(f"{API}/work-orders/{gated['wo']['id']}/operations/{gated['next']['id']}/complete", json={}, headers=s["h"])
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Planning: net requirements + workstation capacity
# ---------------------------------------------------------------------------

def test_planning_nets_issued_reserved_and_free_stock(client, db, s):
    h = s["h"]
    released = new_wo(client, s, qty=2)               # 2 frames, 4 rods → reserved
    client.post(f"{API}/work-orders/{released['id']}/issue-materials", json={"lines": [{"item_id": s["rod"].id, "quantity": 1}]}, headers=h)
    new_wo(client, s, qty=3, release=False)           # draft: 3 frames, 6 rods
    plan = client.get(f"{API}/planning", headers=h).json()
    rods = next(r for r in plan["requirements"] if r["item_code"] == "RM-ROD-01")
    # Outstanding 3 + 6 = 9; 3 held for the released order; free = 5 on hand − 3 reserved at RS01 + 10 at RS02 = 12.
    assert rods["outstanding_qty"] == 9.0 and rods["reserved_qty"] == 3.0 and rods["available_qty"] == 12.0
    assert rods["shortage_qty"] == 0.0 and len(rods["orders"]) == 2
    frames = next(r for r in plan["requirements"] if r["item_code"] == "RM-FRM-01")
    # 5 needed, 2 held, 3 free → no shortage.
    assert frames["outstanding_qty"] == 5.0 and frames["shortage_qty"] == 0.0

    only_released = client.get(f"{API}/planning", params={"include_draft": False}, headers=h).json()
    rods = next(r for r in only_released["requirements"] if r["item_code"] == "RM-ROD-01")
    assert rods["outstanding_qty"] == 3.0 and len(rods["orders"]) == 1

    assert [e["status"] for e in plan["schedule"]].count("draft") == 1


def test_planning_shortage_and_make_bom_for_subassembly(client, db, s):
    h = s["h"]
    # The frame blank is itself made in-house: give it an active BOM.
    sub = client.post(f"{API}/boms", json={"product_item_id": s["frame"].id, "items": [{"component_item_id": s["paint"].id, "quantity": 1}]}, headers=h).json()
    client.post(f"{API}/boms/{sub['id']}/activate", headers=h)
    new_wo(client, s, qty=8, release=False)
    plan = client.get(f"{API}/planning", headers=h).json()
    frames = next(r for r in plan["requirements"] if r["item_code"] == "RM-FRM-01")
    assert frames["shortage_qty"] == 3.0 and frames["make_bom_id"] == sub["id"]
    rods = next(r for r in plan["requirements"] if r["item_code"] == "RM-ROD-01")
    assert rods["make_bom_id"] is None


def test_completed_orders_drop_out_of_requirements(client, s):
    h = s["h"]
    wo = new_wo(client, s, qty=1)
    client.post(f"{API}/work-orders/{wo['id']}/cancel", json={"reason": "dup"}, headers=h)
    assert client.get(f"{API}/planning", headers=h).json()["requirements"] == []


def test_workstation_load_uses_remaining_hours_and_capacity(client, db, s):
    h = s["h"]
    wo = new_wo(client, s, qty=2)  # Cutting 1 + 2×2 = 5h on CUT-01; Assembly 2h on ASM-01
    client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": wo["operations"][0]["id"], "log_date": TODAY, "hours": 1}, headers=h)
    idle = client.post(f"{API}/workstations", json={"code": "IDLE-01", "name": "Spare bay", "capacity_hours_per_day": 0}, headers=h).json()

    load = {e["workstation_id"]: e for e in client.get(f"{API}/planning", headers=h).json()["workstation_load"]}
    assert load[s["cut"]["id"]]["remaining_hours"] == 4.0 and load[s["cut"]["id"]]["load_days"] == 0.5
    assert load[s["asm"]["id"]]["remaining_hours"] == 2.0 and load[s["asm"]["id"]]["load_days"] == 0.5
    assert load[s["cut"]["id"]]["open_operations"] == 1
    assert load[idle["id"]]["load_days"] is None and load[idle["id"]]["remaining_hours"] == 0.0
    # Biggest backlog first.
    assert next(iter(load)) == s["cut"]["id"]

    # Over-logging never makes remaining hours negative; completed ops drop out.
    client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": wo["operations"][1]["id"], "log_date": TODAY, "hours": 9}, headers=h)
    client.post(f"{API}/work-orders/{wo['id']}/operations/{wo['operations'][0]['id']}/complete", json={}, headers=h)
    load = {e["workstation_id"]: e for e in client.get(f"{API}/planning", headers=h).json()["workstation_load"]}
    assert load[s["asm"]["id"]]["remaining_hours"] == 0.0
    assert load[s["cut"]["id"]]["open_operations"] == 0


# ---------------------------------------------------------------------------
# Workstations master
# ---------------------------------------------------------------------------

def test_workstation_validation_messages(client, s):
    h = s["h"]
    bad_type = client.post(f"{API}/workstations", json={"code": "X1", "name": "X", "workstation_type": "robot"}, headers=h)
    assert bad_type.status_code == 400 and "Invalid workstation type 'robot'" in bad_type.json()["detail"]
    bad_status = client.post(f"{API}/workstations", json={"code": "X1", "name": "X", "status": "broken"}, headers=h)
    assert bad_status.status_code == 400 and "under_maintenance" in bad_status.json()["detail"]
    dup = client.post(f"{API}/workstations", json={"code": " cut-01 ", "name": "Dup"}, headers=h)
    assert dup.status_code == 409 and "'CUT-01' is already used" in dup.json()["detail"]
    branch = client.post(f"{API}/workstations", json={"code": "X1", "name": "X", "branch_id": 999}, headers=h)
    assert branch.status_code == 404 and "Plant #999" in branch.json()["detail"]
    assert client.post(f"{API}/workstations", json={"code": "X1", "name": "X", "capacity_hours_per_day": 25}, headers=h).status_code == 422
    rename = client.patch(f"{API}/workstations/{s['asm']['id']}", json={"code": "Cut-01"}, headers=h)
    assert rename.status_code == 409
    # Keeping its own code is not a clash.
    assert client.patch(f"{API}/workstations/{s['asm']['id']}", json={"code": "asm-01"}, headers=h).status_code == 200


def test_workstation_delete_blocked_by_open_operations(client, s):
    h = s["h"]
    wo = new_wo(client, s, qty=1)
    assert client.get(f"{API}/workstations/{s['cut']['id']}", headers=h).json()["open_operations"] == 1
    blocked = client.delete(f"{API}/workstations/{s['cut']['id']}", headers=h)
    assert blocked.status_code == 409 and "1 open operation(s)" in blocked.json()["detail"] and "inactive" in blocked.json()["detail"]
    client.post(f"{API}/work-orders/{wo['id']}/cancel", json={"reason": "freeing the cutter"}, headers=h)
    assert client.delete(f"{API}/workstations/{s['cut']['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/workstations/{s['cut']['id']}", headers=h).status_code == 404
    listed = {w["code"] for w in client.get(f"{API}/workstations", headers=h).json()}
    assert listed == {"ASM-01"}


def test_workstation_list_filters(client, s):
    h = s["h"]
    client.patch(f"{API}/workstations/{s['asm']['id']}", json={"status": "inactive"}, headers=h)
    codes = lambda params: [w["code"] for w in client.get(f"{API}/workstations", params=params, headers=h).json()]  # noqa: E731
    assert codes({}) == ["ASM-01", "CUT-01"]
    assert codes({"status": "inactive"}) == ["ASM-01"]
    assert codes({"workstation_type": "machine"}) == ["CUT-01"]
    assert codes({"search": "plasma"}) == ["CUT-01"]


def test_inactive_workstation_blocks_operation_start(client, s):
    h = s["h"]
    wo = new_wo(client, s, qty=1)
    client.patch(f"{API}/workstations/{s['asm']['id']}", json={"status": "inactive"}, headers=h)
    resp = client.post(f"{API}/work-orders/{wo['id']}/operations/{wo['operations'][1]['id']}/start", headers=h)
    assert resp.status_code == 409 and "ASM-01 is inactive" in resp.json()["detail"] and "back to active" in resp.json()["detail"]


def test_code_of_a_deleted_workstation_gets_a_clear_409(client, s):
    # production_workstations.code is unique across every row (deleted too) and
    # changing that needs a migration, so reuse is refused with a clear reason
    # instead of the old IntegrityError 500.
    h = s["h"]
    old = client.post(f"{API}/workstations", json={"code": "TMP-01", "name": "Temp"}, headers=h).json()
    client.delete(f"{API}/workstations/{old['id']}", headers=h)
    resp = client.post(f"{API}/workstations", json={"code": "TMP-01", "name": "Temp again"}, headers=h)
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert "deleted workstation 'Temp'" in detail and "Pick a different code" in detail


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "/work-orders", "/boms", "/workstations", "/planning", "/shop-floor/queue", "/time-logs", "/dashboard", "/reports",
])
def test_every_production_area_needs_the_production_app(client, db, path):
    outsider = make_user(db, f"crm{abs(hash(path)) % 10000}@premnathrail.com", apps=("crm", "store"))
    resp = client.get(f"{API}{path}", headers=auth(outsider))
    assert resp.status_code == 403 and "You can't open the Production" in resp.json()["detail"]


def test_unauthenticated_requests_are_rejected(client):
    assert client.get(f"{API}/work-orders").status_code in (401, 403)


@pytest.mark.parametrize("path,tab", [
    ("/planning", "planning"), ("/shop-floor/queue", "shop_floor"), ("/workstations", "workstations"),
])
def test_tab_restriction_on_list_views(client, db, s, path, tab):
    wo_only = make_user(db, f"only.wo.{tab}@premnathrail.com", grants=["production:work_orders:view"])
    resp = client.get(f"{API}{path}", headers=auth(wo_only))
    assert resp.status_code == 403 and place(f"production:{tab}:view") in resp.json()["detail"]
    allowed = make_user(db, f"has.{tab}@premnathrail.com", grants=[f"production:{tab}:view"])
    assert client.get(f"{API}{path}", headers=auth(allowed)).status_code == 200


def test_shop_floor_actions_need_shop_floor_edit(client, db, s):
    wo = new_wo(client, s, qty=1)
    viewer = make_user(db, "floor.viewer@premnathrail.com", grants=["production:shop_floor:view", "production:work_orders:view"])
    hv = auth(viewer)
    log = client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": wo["operations"][0]["id"], "log_date": TODAY, "hours": 1}, headers=hv)
    assert log.status_code == 403 and "'Edit' permission on Production › Shop Floor" in log.json()["detail"]
    start = client.post(f"{API}/work-orders/{wo['id']}/operations/{wo['operations'][0]['id']}/start", headers=hv)
    assert start.status_code == 403

    operator = make_user(db, "floor.operator@premnathrail.com", grants=["production:shop_floor:view", "production:shop_floor:edit"])
    ho = auth(operator)
    ok = client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": wo["operations"][0]["id"], "log_date": TODAY, "hours": 1}, headers=ho)
    assert ok.status_code == 200
    # Shop-floor edit does not grant Store movements on the work order.
    issue = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": [{"item_id": s["rod"].id, "quantity": 1}]}, headers=ho)
    assert issue.status_code == 403 and "Work Orders" in issue.json()["detail"]
    delete = client.delete(f"{API}/time-logs/{ok.json()['id']}", headers=ho)
    assert delete.status_code == 403 and "'Delete' permission" in delete.json()["detail"]


def test_work_order_approve_action_gates_release_cancel_complete(client, db, s):
    wo = new_wo(client, s, qty=1, release=False)
    editor = make_user(db, "wo.editor@premnathrail.com", grants=["production:work_orders:view", "production:work_orders:edit"])
    he = auth(editor)
    assert client.patch(f"{API}/work-orders/{wo['id']}", json={"remarks": "ok"}, headers=he).status_code == 200
    for action, body in (("cancel", {"reason": "x"}), ("complete", None), ("close", None)):
        resp = client.post(f"{API}/work-orders/{wo['id']}/{action}", json=body, headers=he)
        # Feature gate (core/features/production.py): Work Orders › Complete, close & cancel.
        assert resp.status_code == 403 and place("production:work_orders.lifecycle:view") in resp.json()["detail"], action
    # Release goes through the central approval engine: without Approve the
    # editor submits it, the order stays a draft until an approver decides.
    resp = client.post(f"{API}/work-orders/{wo['id']}/release", headers=he)
    assert resp.status_code == 200 and resp.json()["status"] == "draft"
    assert client.patch(f"{API}/work-orders/{wo['id']}", json={"remarks": "late"}, headers=he).status_code == 409
    assert client.delete(f"{API}/work-orders/{wo['id']}", headers=he).status_code == 403


def test_admin_bypasses_the_matrix(client, db, s):
    admin = User(email="boss@premnathrail.com", name="boss", role="admin", is_active=True, granular_permissions=["production:dashboard:view"])
    db.add(admin)
    db.commit()
    wo = new_wo(client, s, qty=1, release=False)
    assert client.post(f"{API}/work-orders/{wo['id']}/release", headers=auth(admin)).status_code == 200


def test_work_orders_follow_the_production_data_scope(client, db, s):
    """Central data scope: an 'own records' Production user lists and opens
    only their own / supervised work orders (detail 403 says why)."""
    wo = new_wo(client, s, qty=1, release=False)
    grants = ["production:work_orders:view", "production:work_orders:create", "production:shop_floor:view"]
    narrow = make_user(db, "wo.narrow@premnathrail.com", grants=grants)
    narrow.data_access_scopes = {"production": "own"}
    db.commit()
    h = auth(narrow)
    assert client.get(f"{API}/work-orders", headers=h).json() == []
    denied = client.get(f"{API}/work-orders/{wo['id']}", headers=h)
    assert denied.status_code == 403 and "outside your data access" in denied.json()["detail"]
    assert client.get(f"{API}/time-logs", headers=h).json() == []
    # Named supervisor → "assigned" scope sees it.
    narrow.data_access_scopes = {"production": "assigned"}
    db.commit()
    client.patch(f"{API}/work-orders/{wo['id']}", json={"supervisor_id": narrow.id}, headers=s["h"])
    assert [w["id"] for w in client.get(f"{API}/work-orders", headers=h).json()] == [wo["id"]]
    assert client.get(f"{API}/work-orders/{wo['id']}", headers=h).status_code == 200
