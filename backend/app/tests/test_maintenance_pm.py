"""
Tests for Maintenance Phase 2 — preventive maintenance: next-due maths
(fixed vs floating, month-end clamping), PM plan CRUD, idempotent work-order
generation (scheduler + "Generate now"), closing a PM job rolling the plan
forward, the cancelled-occurrence skip, overdue reminders and the calendar.
"""
from datetime import date, timedelta
from types import SimpleNamespace

from app.modules.main.models.notification import Notification
from app.modules.maintenance.models.pm_plan import MaintenancePmPlan
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder
from app.modules.maintenance.service import add_pm_interval, next_due_from, today_ist
from app.tasks.maintenance_pm_scheduler import generate_due_pm_work_orders, send_pm_overdue_reminders
from app.tests.test_maintenance import BASE, make_user, hdr, setup_plant, create_asset


def _plan_payload(asset_id, **extra):
    return {
        "asset_id": asset_id, "title": "Monthly lubrication", "frequency_unit": "month", "frequency_value": 1,
        "schedule_basis": "fixed", "lead_days": 3, "next_due_date": str(today_ist() + timedelta(days=2)),
        "tasks": [{"description": "Check oil level", "expected_value": "Between marks"}, {"description": "Grease slideways"}],
        **extra,
    }


def _setup(client, db, **plan_extra):
    branch, loc, item, ws = setup_plant(db)
    branch.default_warehouse_id = loc.id
    db.commit()
    planner = make_user(db, "planner@premnathrail.com")
    tech = make_user(db, "tech@premnathrail.com")
    asset = create_asset(client, hdr(planner), branch, workstation_id=ws.id)
    payload = _plan_payload(asset["id"], default_assignee_id=tech.id, spares=[{"store_item_id": item.id, "qty": 2}], **plan_extra)
    r = client.post(f"{BASE}/pm-plans", json=payload, headers=hdr(planner))
    assert r.status_code == 200, r.text
    return planner, tech, asset, r.json(), loc, item


def test_next_due_maths():
    assert add_pm_interval(date(2026, 1, 31), "month", 1) == date(2026, 2, 28)
    assert add_pm_interval(date(2028, 1, 31), "month", 1) == date(2028, 2, 29)  # leap year
    assert add_pm_interval(date(2026, 11, 30), "month", 3) == date(2027, 2, 28)
    assert add_pm_interval(date(2028, 2, 29), "year", 1) == date(2029, 2, 28)
    assert add_pm_interval(date(2026, 10, 6), "week", 2) == date(2026, 10, 20)
    assert add_pm_interval(date(2026, 10, 6), "day", 45) == date(2026, 11, 20)
    plan = SimpleNamespace(frequency_unit="month", frequency_value=6)
    assert next_due_from(plan, date(2026, 8, 31)) == date(2027, 2, 28)


def test_plan_crud_and_validation(client, db):
    planner, tech, asset, plan, _loc, item = _setup(client, db)
    h = hdr(planner)
    assert plan["plan_code"] == "PM-0001"
    assert plan["frequency_label"] == "Monthly" and plan["due_state"] == "due_soon"
    assert [t["sequence"] for t in plan["tasks"]] == [10, 20]
    assert plan["spares"][0]["item_code"] == "SP-BRG" and plan["default_assignee_name"] == "tech"

    r = client.post(f"{BASE}/pm-plans", json=_plan_payload(asset["id"], frequency_unit="fortnight"), headers=h)
    assert r.status_code == 400 and "fortnight" in r.json()["detail"]
    r = client.post(f"{BASE}/pm-plans", json=_plan_payload(asset["id"], wo_type="breakdown"), headers=h)
    assert r.status_code == 400 and "preventive" in r.json()["detail"]

    r = client.patch(f"{BASE}/pm-plans/{plan['id']}", json={"frequency_value": 3, "tasks": [{"description": "Only check"}]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["frequency_label"] == "Quarterly" and len(r.json()["tasks"]) == 1 and len(r.json()["spares"]) == 1

    assert len(client.get(f"{BASE}/pm-plans", params={"search": "lubric"}, headers=h).json()) == 1
    assert client.get(f"{BASE}/pm-plans", params={"is_active": False}, headers=h).json() == []


def test_generation_is_idempotent_and_copies_plan(client, db):
    planner, tech, asset, plan, loc, item = _setup(client, db, requires_shutdown=True)
    today = today_ist()

    counts = generate_due_pm_work_orders(db, today)
    assert counts["generated"] == 1
    counts = generate_due_pm_work_orders(db, today)  # second run, same day
    assert counts["generated"] == 0 and counts["open_exists"] == 1
    wos = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).all()
    assert len(wos) == 1
    wo = client.get(f"{BASE}/work-orders/{wos[0].id}", headers=hdr(planner)).json()
    assert wo["status"] == "assigned" and wo["assigned_to_id"] == tech.id and wo["wo_type"] == "preventive"
    assert wo["pm_plan_code"] == "PM-0001" and wo["pm_due_date"] == plan["next_due_date"]
    assert [t["description"] for t in wo["tasks"]] == ["Check oil level", "Grease slideways"]
    assert wo["spares"][0]["qty_planned"] == 2 and wo["spares"][0]["location_id"] == loc.id
    assert wo["machine_down"] is True
    assert wo["asset_status"] == "operational"  # planned shutdown only takes the machine down once started
    assert db.query(Notification).filter(Notification.user_id == tech.id, Notification.notification_type == "maintenance_wo_assigned").count() == 1

    # Generate-now refuses while that job is open, with the real reason.
    r = client.post(f"{BASE}/pm-plans/{plan['id']}/generate-now", headers=hdr(planner))
    assert r.status_code == 409 and wo["wo_number"] in r.json()["detail"]
    # Delete refuses too.
    r = client.delete(f"{BASE}/pm-plans/{plan['id']}", headers=hdr(planner))
    assert r.status_code == 409 and wo["wo_number"] in r.json()["detail"]


def test_not_due_until_lead_window(client, db):
    planner, _tech, _asset, plan, *_ = _setup(client, db)
    db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == plan["id"]).update({"next_due_date": today_ist() + timedelta(days=10)})
    db.commit()
    assert generate_due_pm_work_orders(db)["generated"] == 0
    # The button ignores the lead window.
    r = client.post(f"{BASE}/pm-plans/{plan['id']}/generate-now", headers=hdr(planner))
    assert r.status_code == 200, r.text
    assert r.json()["open_work_order_number"].startswith("MWO-")


def _run_job_to_closed(client, h, wo_id):
    assert client.post(f"{BASE}/work-orders/{wo_id}/start", headers=h).status_code == 200
    wo = client.get(f"{BASE}/work-orders/{wo_id}", headers=h).json()
    for t in wo["tasks"]:
        client.patch(f"{BASE}/work-orders/{wo_id}/tasks/{t['id']}", json={"result": "ok"}, headers=h)
    r = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={}, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"{BASE}/work-orders/{wo_id}/close", headers=h)
    assert r.status_code == 200, r.text


def test_close_advances_fixed_plan(client, db):
    planner, _tech, _asset, plan, *_ = _setup(client, db)
    h = hdr(planner)
    due = date.fromisoformat(plan["next_due_date"])
    generate_due_pm_work_orders(db)
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).one()
    _run_job_to_closed(client, h, wo.id)

    p = client.get(f"{BASE}/pm-plans/{plan['id']}", headers=h).json()
    assert p["next_due_date"] == str(add_pm_interval(due, "month", 1))  # fixed: from the due date
    assert p["last_done_date"] == str(today_ist()) and p["last_work_order_id"] == wo.id
    assert p["recent_work_orders"][0]["on_time"] is True


def test_close_advances_floating_plan(client, db):
    planner, _tech, _asset, plan, *_ = _setup(client, db, schedule_basis="floating", frequency_unit="week", frequency_value=2)
    h = hdr(planner)
    generate_due_pm_work_orders(db)
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).one()
    _run_job_to_closed(client, h, wo.id)
    p = client.get(f"{BASE}/pm-plans/{plan['id']}", headers=h).json()
    assert p["next_due_date"] == str(today_ist() + timedelta(weeks=2))  # floating: from completion


def test_cancelled_occurrence_is_skipped_not_regenerated(client, db):
    planner, _tech, _asset, plan, *_ = _setup(client, db)
    h = hdr(planner)
    due = date.fromisoformat(plan["next_due_date"])
    generate_due_pm_work_orders(db)
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).one()
    r = client.post(f"{BASE}/work-orders/{wo.id}/cancel", json={"reason": "Machine sold for overhaul"}, headers=h)
    assert r.status_code == 200, r.text

    counts = generate_due_pm_work_orders(db)
    assert counts["generated"] == 0  # next occurrence is a month out — outside the lead window
    p = db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == plan["id"]).one()
    db.refresh(p)
    assert p.next_due_date == add_pm_interval(due, "month", 1)
    assert p.last_done_date is None
    assert db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).count() == 1


def test_overdue_reminders_once_per_day(client, db):
    planner, tech, _asset, plan, *_ = _setup(client, db)
    db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == plan["id"]).update({"next_due_date": today_ist() - timedelta(days=2)})
    db.commit()
    generate_due_pm_work_orders(db)
    assert send_pm_overdue_reminders(db) >= 1
    assert db.query(Notification).filter(Notification.user_id == tech.id, Notification.notification_type == "maintenance_pm_overdue").count() == 1
    assert send_pm_overdue_reminders(db) == 0  # same day: deduplicated


def test_calendar_projects_and_shows_generated(client, db):
    planner, _tech, _asset, plan, *_ = _setup(client, db, frequency_unit="week", frequency_value=1)
    h = hdr(planner)
    generate_due_pm_work_orders(db)
    start = today_ist()
    r = client.get(f"{BASE}/pm-plans/calendar", params={"from": str(start), "to": str(start + timedelta(days=27))}, headers=h)
    assert r.status_code == 200, r.text
    entries = r.json()
    generated = [e for e in entries if e["kind"] == "work_order"]
    projected = [e for e in entries if e["kind"] == "projected"]
    assert len(generated) == 1 and generated[0]["wo_status"] == "assigned"
    # The generated due date isn't duplicated as a projection; weekly after that.
    assert generated[0]["date"] not in [e["date"] for e in projected]
    assert len(projected) >= 3
    r = client.get(f"{BASE}/pm-plans/calendar", params={"from": str(start), "to": str(start - timedelta(days=1))}, headers=h)
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# PM engine hardening — one job per occurrence, retired assets, fixed-basis
# catch-up, numbering past 9999.
# ---------------------------------------------------------------------------

def test_same_occurrence_generates_one_job(client, db, monkeypatch):
    from app.modules.maintenance.service import generate_pm_work_order
    planner, _tech, _asset, plan, *_ = _setup(client, db)
    p = db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == plan["id"]).one()
    first = generate_pm_work_order(db, p, p.next_due_date)
    second = generate_pm_work_order(db, p, p.next_due_date)  # second caller, same (plan, due date)
    db.commit()
    assert first.id == second.id
    assert db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).count() == 1

    # Lost race: the DB unique constraint fires on commit → a clear 409, not a 500.
    import app.modules.maintenance.routes.pm_plans as pm_routes
    first.status = "cancelled"
    db.commit()

    def racing_run(db_, plan_, **_kw):
        dup = MaintenanceWorkOrder(wo_number="MWO-RACE-1", asset_id=plan_.asset_id, pm_plan_id=plan_.id,
                                   pm_due_date=first.pm_due_date, title="dup", status="draft")
        db_.add(dup)
        return "generated", dup

    monkeypatch.setattr(pm_routes, "run_pm_plan", racing_run)
    r = client.post(f"{BASE}/pm-plans/{plan['id']}/generate-now", headers=hdr(planner))
    assert r.status_code == 409, r.text
    assert "Another user just generated the job for this due date" in r.json()["detail"]
    assert db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).count() == 1


def test_decommission_deactivates_plans_and_cancels_pm_jobs(client, db):
    planner, tech, asset, plan, *_ = _setup(client, db)
    h = hdr(planner)
    generate_due_pm_work_orders(db)
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).one()
    assert wo.status == "assigned"

    # A second (non-shutdown) PM job on the same machine, started then put On
    # Hold — On Hold doesn't take the machine down, so it must be swept too.
    r = client.post(f"{BASE}/pm-plans", json=_plan_payload(asset["id"], title="Weekly coolant check", default_assignee_id=tech.id), headers=h)
    assert r.status_code == 200, r.text
    plan2 = r.json()
    generate_due_pm_work_orders(db)
    held = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan2["id"]).one()
    assert client.post(f"{BASE}/work-orders/{held.id}/start", headers=h).status_code == 200
    r = client.post(f"{BASE}/work-orders/{held.id}/hold", json={"reason": "Waiting for coolant"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "on_hold"

    r = client.patch(f"{BASE}/assets/{asset['id']}", json={"status": "decommissioned"}, headers=h)
    assert r.status_code == 200, r.text
    db.expire_all()
    p = db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == plan["id"]).one()
    p2 = db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == plan2["id"]).one()
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.id == wo.id).one()
    held = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.id == held.id).one()
    assert p.is_active is False and p2.is_active is False
    assert wo.status == "cancelled" and wo.cancel_reason == "Asset decommissioned"
    assert held.status == "cancelled" and held.cancel_reason == "Asset decommissioned"
    # Nothing left open on the plan: it isn't shown with an open job.
    assert client.get(f"{BASE}/pm-plans/{plan2['id']}", headers=h).json().get("open_work_order_number") is None
    # No overdue reminders for it either.
    assert send_pm_overdue_reminders(db, today_ist() + timedelta(days=30)) == 0


def test_scheduler_skips_retired_asset(client, db):
    from app.modules.maintenance.models.asset import MaintenanceAsset
    _planner, _tech, asset, plan, *_ = _setup(client, db)
    # Plan left active by hand (e.g. data from before the decommission cleanup).
    db.query(MaintenanceAsset).filter(MaintenanceAsset.id == asset["id"]).update({"status": "decommissioned"})
    db.commit()
    counts = generate_due_pm_work_orders(db)
    assert counts["asset_inactive"] == 1
    assert counts["generated"] == 0 and counts["failed"] == 0
    assert db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).count() == 0


def test_fixed_plan_closed_late_catches_up(client, db):
    planner, _tech, _asset, plan, *_ = _setup(client, db)
    h = hdr(planner)
    late_due = today_ist() - timedelta(days=100)
    db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == plan["id"]).update({"next_due_date": late_due})
    db.commit()
    generate_due_pm_work_orders(db)
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan["id"]).one()
    _run_job_to_closed(client, h, wo.id)

    p = client.get(f"{BASE}/pm-plans/{plan['id']}", headers=h).json()
    next_due = date.fromisoformat(p["next_due_date"])
    assert next_due >= today_ist()
    # Still on the fixed calendar: a whole number of months after the old due date.
    d, steps = late_due, 0
    while d < next_due:
        d, steps = add_pm_interval(d, "month", 1), steps + 1
    assert d == next_due and steps >= 4
    db.expire_all()
    assert "missed PM occurrence(s)" in db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.id == wo.id).one().description


def test_work_order_number_past_9999(db):
    from app.modules.maintenance.models.asset import MaintenanceAsset
    from app.modules.maintenance.service import generate_work_order_number
    from app.tests.test_maintenance import setup_plant
    branch, *_ = setup_plant(db)
    asset = MaintenanceAsset(asset_code="EQ-0001", name="Press", branch_id=branch.id, status="operational")
    db.add(asset)
    db.commit()
    year = date.today().year
    for n in ("0042", "9999"):
        db.add(MaintenanceWorkOrder(wo_number=f"MWO-{year}-{n}", asset_id=asset.id, title="x", status="closed"))
    db.commit()
    nxt = generate_work_order_number(db)
    assert nxt == f"MWO-{year}-10000"
    db.add(MaintenanceWorkOrder(wo_number=nxt, asset_id=asset.id, title="x", status="closed"))
    db.commit()
    assert generate_work_order_number(db) == f"MWO-{year}-10001"
