"""EAM wave 2: measuring points / documents (IK01-IK17), counter-based PM
(IP42), permit-to-work (WCM), PR from a maintenance WO (IW32), service
visits (IW41) and the SR SLA clock."""
from datetime import date, datetime, timedelta, timezone

from app.modules.main.models.notification import Notification
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.counters import MaintenanceMeasurementDoc
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp import sla
from app.tasks.erp_sla_reminders import check_sla
from app.tasks.maintenance_pm_scheduler import generate_due_pm_work_orders
from app.tests.test_maintenance import BASE, make_user, hdr, setup_plant, create_asset
from app.tests.test_erp_service_sap_gaps import SR, mk_user as erp_user, mk_machine, mk_sr

NOW = datetime.now(timezone.utc)


def _metered(client, db, h, branch, reading=100.0):
    a = create_asset(client, h, branch, meter_unit="hours", current_meter_reading=reading)
    return a


# ── measuring documents ─────────────────────────────────────────────────────

def test_counter_history_no_backwards_and_admin_override(client, db):
    branch, *_ = setup_plant(db)
    u = make_user(db, "eam1@premnathrail.com")
    h = hdr(u)
    a = _metered(client, db, h, branch)
    r = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 150}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["previous_reading"] == 100 and r.json()["difference"] == 50
    r = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 120}, headers=h)
    assert r.status_code == 409 and "can't go backwards" in r.json()["detail"]
    admin = make_user(db, "eam1a@premnathrail.com", role="admin")
    r = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 5}, headers=hdr(admin))
    assert r.status_code == 422 and "reason" in r.json()["detail"]
    r = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 5, "override_reason": "Hour meter replaced"}, headers=hdr(admin))
    assert r.status_code == 201, r.text
    hist = client.get(f"{BASE}/assets/{a['id']}/readings", headers=h).json()
    assert [x["reading"] for x in hist] == [5, 150]
    assert db.get(MaintenanceAsset, a["id"]).current_meter_reading == 5
    # Asset form edit goes through the same rule.
    r = client.patch(f"{BASE}/assets/{a['id']}", json={"current_meter_reading": 2}, headers=h)
    assert r.status_code == 409


def test_condition_point_limit_breach_raises_one_abnormality(client, db):
    branch, *_ = setup_plant(db)
    u = make_user(db, "eam2@premnathrail.com")
    other = make_user(db, "eam2b@premnathrail.com")
    h = hdr(u)
    a = create_asset(client, h, branch)
    r = client.post(f"{BASE}/assets/{a['id']}/measuring-points",
                    json={"name": "Hydraulic oil temp", "unit": "°C", "lower_limit": 10, "upper_limit": 70}, headers=h)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert client.post(f"{BASE}/assets/{a['id']}/measuring-points", json={"name": "x", "unit": "C", "lower_limit": 5, "upper_limit": 1},
                       headers=h).status_code == 400
    ok = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 40, "measuring_point_id": pid}, headers=h).json()
    assert ok["limit_breach"] is None
    hot = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 85, "measuring_point_id": pid}, headers=h).json()
    assert hot["limit_breach"] == "high" and hot["request_number"].startswith("MRQ-")
    req = db.query(MaintenanceRequest).one()
    assert req.request_type == "abnormality"
    # Condition points may go down; a second breach reuses the open request.
    again = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 5, "measuring_point_id": pid}, headers=h).json()
    assert again["limit_breach"] == "low" and again["request_id"] == req.id
    assert db.query(MaintenanceRequest).count() == 1
    assert db.query(Notification).filter(Notification.user_id == other.id,
                                         Notification.notification_type == "maintenance_reading_limit_breach").count() == 1


# ── counter-based PM ────────────────────────────────────────────────────────

def _run_to_closed(client, h, wo_id, reading):
    assert client.post(f"{BASE}/work-orders/{wo_id}/start", headers=h).status_code == 200
    wo = client.get(f"{BASE}/work-orders/{wo_id}", headers=h).json()
    for t in wo["tasks"]:
        client.patch(f"{BASE}/work-orders/{wo_id}/tasks/{t['id']}", json={"result": "ok"}, headers=h)
    r = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={}, headers=h)
    assert r.status_code == 400 and "reading" in r.json()["detail"]
    r = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={"meter_reading": reading}, headers=h)
    assert r.status_code == 200, r.text
    assert client.post(f"{BASE}/work-orders/{wo_id}/close", headers=h).status_code == 200


def test_meter_plan_triggers_on_reading_and_rolls_forward(client, db):
    branch, *_ = setup_plant(db)
    planner = make_user(db, "eam3@premnathrail.com")
    tech = make_user(db, "eam3t@premnathrail.com")
    h = hdr(planner)
    a = _metered(client, db, h, branch, reading=100)
    plain = create_asset(client, h, branch, name="No meter")
    base = {"title": "500 h service", "trigger_type": "meter", "meter_interval": 500, "lead_meter": 50,
            "default_assignee_id": tech.id, "tasks": [{"description": "Change oil"}]}
    r = client.post(f"{BASE}/pm-plans", json={**base, "asset_id": plain["id"]}, headers=h)
    assert r.status_code == 400 and "meter unit" in r.json()["detail"]
    r = client.post(f"{BASE}/pm-plans", json={**base, "asset_id": a["id"], "meter_interval": 0}, headers=h)
    assert r.status_code == 400
    r = client.post(f"{BASE}/pm-plans", json={**base, "asset_id": a["id"]}, headers=h)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["next_due_meter"] == 600 and plan["frequency_label"] == "Every 500 hours" and plan["due_state"] == "scheduled"
    assert generate_due_pm_work_orders(db)["generated"] == 0  # daily scheduler: counter not reached
    r = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 520}, headers=h)
    assert r.json()["generated_work_orders"] == []
    r = client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 560}, headers=h)  # inside the 50 h lead
    gen = r.json()["generated_work_orders"]
    assert len(gen) == 1
    wo = db.get(MaintenanceWorkOrder, gen[0]["id"])
    assert wo.pm_trigger == "meter" and wo.pm_plan_id == plan["id"]
    # a later reading doesn't raise a second job while one is open
    assert client.post(f"{BASE}/assets/{a['id']}/readings", json={"reading": 590}, headers=h).json()["generated_work_orders"] == []
    _run_to_closed(client, h, wo.id, 610)
    p = client.get(f"{BASE}/pm-plans/{plan['id']}", headers=h).json()
    assert p["last_done_meter"] == 610 and p["next_due_meter"] == 1110
    docs = db.query(MaintenanceMeasurementDoc).filter(MaintenanceMeasurementDoc.source == "wo_completion").all()
    assert len(docs) == 1 and docs[0].work_order_id == wo.id


def test_calendar_or_meter_whichever_first(client, db):
    from app.modules.maintenance.service import today_ist
    branch, *_ = setup_plant(db)
    planner = make_user(db, "eam4@premnathrail.com")
    h = hdr(planner)
    a = _metered(client, db, h, branch, reading=0)
    r = client.post(f"{BASE}/pm-plans", json={"asset_id": a["id"], "title": "Quarterly or 250 h", "trigger_type": "calendar_or_meter",
                                             "frequency_unit": "month", "frequency_value": 3, "meter_interval": 250,
                                             "next_due_date": str(today_ist() + timedelta(days=80))}, headers=h)
    assert r.status_code == 200, r.text
    assert generate_due_pm_work_orders(db)["generated"] == 0
    db.get(MaintenanceAsset, a["id"]).current_meter_reading = 260
    db.commit()
    assert generate_due_pm_work_orders(db)["generated"] == 1  # the counter came first
    wo = db.query(MaintenanceWorkOrder).one()
    assert wo.pm_due_date == today_ist() and wo.pm_trigger == "meter"


# ── permits ─────────────────────────────────────────────────────────────────

def test_permit_gates_start_and_complete(client, db):
    branch, *_ = setup_plant(db)
    planner = make_user(db, "eam5@premnathrail.com")
    tech = make_user(db, "eam5t@premnathrail.com")
    hp, ht = hdr(planner), hdr(tech)
    a = create_asset(client, hp, branch)
    wo = client.post(f"{BASE}/work-orders", json={"asset_id": a["id"], "title": "Weld guard", "assigned_to_id": tech.id, "wo_type": "improvement",
                                                  "permit_required": True}, headers=hp).json()
    assert wo["permit_required"] is True
    r = client.post(f"{BASE}/work-orders/{wo['id']}/start", headers=ht)
    assert r.status_code == 409 and "permit" in r.json()["detail"].lower()
    valid_to = (NOW + timedelta(hours=8)).isoformat()
    r = client.post(f"{BASE}/work-orders/{wo['id']}/permits", json={"permit_type": "electrical_isolation", "hazards": "Live panel",
                                                                   "valid_to": valid_to}, headers=hp)
    assert r.status_code == 400 and "isolation points" in r.json()["detail"]
    r = client.post(f"{BASE}/work-orders/{wo['id']}/permits", json={"permit_type": "hot_work", "hazards": "Sparks, fire",
                                                                   "valid_to": valid_to}, headers=hp)
    assert r.status_code == 201, r.text
    permit = r.json()
    assert permit["permit_number"].startswith("PTW-") and permit["status"] == "issued"
    r = client.post(f"{BASE}/work-orders/{wo['id']}/start", headers=ht)
    assert r.status_code == 409 and "not accepted" in r.json()["detail"], r.text
    r = client.post(f"{BASE}/permits/{permit['id']}/activate", headers=hp)
    assert r.status_code == 409 and "two-person" in r.json()["detail"]
    assert client.post(f"{BASE}/permits/{permit['id']}/activate", headers=ht).json()["status"] == "active"
    assert client.post(f"{BASE}/work-orders/{wo['id']}/start", headers=ht).status_code == 200
    r = client.post(f"{BASE}/work-orders/{wo['id']}/complete", json={}, headers=ht)
    assert r.status_code == 409 and permit["permit_number"] in r.json()["detail"]
    r = client.post(f"{BASE}/permits/{permit['id']}/close", json={}, headers=ht)
    assert r.status_code == 400
    assert client.post(f"{BASE}/permits/{permit['id']}/close", json={"isolation_removed": True}, headers=ht).json()["status"] == "closed"
    assert client.post(f"{BASE}/work-orders/{wo['id']}/complete", json={}, headers=ht).status_code == 200
    from app.modules.maintenance.routes.permits import permit_spec
    from app.modules.maintenance.models.permit import MaintenanceWorkPermit
    spec = permit_spec(db, db.get(MaintenanceWorkPermit, permit["id"]))
    assert spec["title"] == "PERMIT TO WORK" and spec["statement"]


# ── PR from a work order ────────────────────────────────────────────────────

def test_raise_pr_from_work_order_and_service_cost_flows_back(client, db):
    from app.modules.store.models.item import StoreItem
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
    from app.modules.maintenance import procurement
    branch, loc, item, ws = setup_plant(db)
    item.status = "active"
    svc_item = StoreItem(item_code="SV-RW", item_name="Motor rewinding", uom="JOB", item_type="service", status="active")
    db.add(svc_item)
    db.commit()
    u = make_user(db, "eam6@premnathrail.com", role="admin")
    make_user(db, "eam6pr@premnathrail.com", apps=("p2p",))  # someone to approve the PR (engine stage)
    h = hdr(u)
    a = create_asset(client, h, branch)
    wo = client.post(f"{BASE}/work-orders", json={"asset_id": a["id"], "title": "Motor burnt"}, headers=h).json()
    r = client.post(f"{BASE}/work-orders/{wo['id']}/raise-pr", json={"purpose": "external_service",
                                                                    "items": [{"store_item_id": item.id, "quantity": 1}]}, headers=h)
    assert r.status_code == 400 and "not a service" in r.json()["detail"]
    r = client.post(f"{BASE}/work-orders/{wo['id']}/raise-pr", json={"purpose": "external_service", "reason": "Outside rewinding",
                                                                    "items": [{"store_item_id": svc_item.id, "quantity": 1}]}, headers=h)
    assert r.status_code == 201, r.text
    pr = db.get(P2PRequest, r.json()["id"])
    assert pr.project_label.startswith(f"Maintenance {wo['wo_number']}") and pr.items[0].store_item_id == svc_item.id
    po = P2PPurchaseOrder(po_number="PO-T-1", p2p_request_id=pr.id, status="issued", po_date=date.today(), vendor_name="Rewinders")
    db.add(po)
    db.flush()
    line = P2PPurchaseOrderItem(purchase_order_id=po.id, store_item_id=svc_item.id, item_name="Motor rewinding", quantity=1,
                                unit_price=4500, line_total=4500, item_category="service")
    db.add(line)
    db.commit()
    body = client.get(f"{BASE}/work-orders/{wo['id']}/purchase-requests", headers=h).json()
    assert body["service_committed"] == 4500 and body["service_invoiced"] == 0 and body["procured_cost"] == 0
    assert body["purchase_requests"][0]["purchase_orders"][0]["po_number"] == "PO-T-1"
    # Posting the vendor bill flows the taxable value to the job.
    import app.modules.maintenance.procurement as proc_mod
    orig = proc_mod.procured_amounts
    proc_mod.procured_amounts = lambda db_, wo_id: (4500.0, 4500.0)
    try:
        got = client.get(f"{BASE}/work-orders/{wo['id']}", headers=h).json()
    finally:
        proc_mod.procured_amounts = orig
    assert got["procured_cost"] == 4500 and got["total_cost"] == 4500
    assert procurement.links_for(db, wo["id"])[0].purpose == "external_service"


# ── service visits + SLA ────────────────────────────────────────────────────

def test_visits_roll_up_into_billing_and_first_response(client, db):
    admin = erp_user(db, "v_admin@premnathrail.com")
    eng = erp_user(db, "v_eng@premnathrail.com", role="user", apps=("erp",))
    m = mk_machine(db, "VIS-1")
    sr = mk_sr(client, admin, m, service_type="paid_service").json()
    from app.tests.test_erp_service_sap_gaps import hdr as ehdr
    h = ehdr(admin)
    r = client.post(f"{SR}/{sr['id']}/visits", json={"work_done": "x", "work_hours": 2}, headers=h)
    assert r.status_code == 409 and "Assigned" in r.json()["detail"]  # SR still open
    assert client.patch(f"{SR}/{sr['id']}", json={"status": "assigned", "assigned_service_person_id": eng.id}, headers=h).status_code == 200
    arrive = NOW - timedelta(hours=5)
    r = client.post(f"{SR}/{sr['id']}/visits", json={
        "engineer_id": eng.id, "visit_date": str(date.today()), "arrive_at": arrive.isoformat(),
        "depart_at": (arrive + timedelta(hours=3)).isoformat(), "travel_hours": 1.5, "travel_cost": 800, "stay_cost": 1200,
        "work_done": "Replaced seal kit", "customer_sign_name": "R. Kumar"}, headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["visits"][0]["work_hours"] == 3 and body["visits"][0]["customer_signed_at"]
    assert body["transport_cost"] == 800 and body["accommodation_cost"] == 1200
    assert client.post(f"{SR}/{sr['id']}/visits", json={"engineer_id": eng.id, "work_done": "Check", "work_hours": 30},
                       headers=h).status_code == 400
    r = client.post(f"{SR}/{sr['id']}/visits", json={"engineer_id": admin.id, "work_done": "Test run", "work_hours": 2,
                                                     "misc_cost": 100}, headers=h)
    assert r.json()["totals"]["visit_count"] == 2 and r.json()["totals"]["engineer_count"] == 2
    got = db.get(ServiceRequest, sr["id"])
    assert got.actual_service_duration_hours == 5 and got.miscellaneous_cost == 100
    # Hand entry of rolled-up costs is refused once visits exist.
    r = client.patch(f"{SR}/{sr['id']}", json={"transport_cost": 99}, headers=h)
    assert r.status_code == 409 and "visit" in r.json()["detail"]
    # Another user can't log someone else's visit without SR edit.
    other = erp_user(db, "v_other@premnathrail.com", role="user", apps=("erp",))
    from app.tests.test_erp_service_sap_gaps import hdr as eh
    r = client.post(f"{SR}/{sr['id']}/visits", json={"engineer_id": eng.id, "work_done": "x", "work_hours": 1}, headers=eh(other))
    assert r.status_code in (403,)
    from app.modules.erp.routes.service_visits import visit_report_spec
    from app.modules.erp.models.service_visit import ServiceVisit
    spec = visit_report_spec(db, db.query(ServiceVisit).first())
    assert spec["title"] == "FIELD SERVICE REPORT"


def test_sla_profile_clock_and_escalation(client, db):
    admin = erp_user(db, "sla_admin@premnathrail.com")
    m = mk_machine(db, "SLA-1")
    from app.tests.test_erp_service_sap_gaps import hdr as ehdr
    h = ehdr(admin)
    sr = mk_sr(client, admin, m, priority="urgent").json()
    assert sr["sla_profile"] == "urgent" and sr["sla_response_hours"] == 4 and sr["sla_resolution_hours"] == 48
    assert sr["sla_response_state"] == "running"
    row = db.get(ServiceRequest, sr["id"])
    # age the SR: response window over → breach flagged + escalation
    row.opened_at = NOW - timedelta(hours=10)
    sla.apply_profile(row, force=True)
    db.commit()
    assert db.get(ServiceRequest, sr["id"]).sla_response_state == "breached"
    counts = check_sla(db)
    assert counts["breached"] >= 1 and db.get(ServiceRequest, sr["id"]).sla_response_met is False
    assert check_sla(db)["breached"] == 0  # once per SR / clock
    assert db.query(Notification).filter(Notification.notification_type == "erp_sla_response_breach").count() >= 1
    listed = client.get(SR, params={"sla": "breached"}, headers=h).json()
    assert [x["id"] for x in listed] == [sr["id"]]
    # standard SR answered in time: response met at the first status move
    sr2 = mk_sr(client, admin, m).json()
    assert sr2["sla_profile"] == "standard"
    r = client.patch(f"{SR}/{sr2['id']}", json={"status": "acknowledged"}, headers=h).json()
    assert r["first_response_at"] and r["sla_response_met"] is True and r["sla_response_state"] == "met"
    r = client.patch(f"{SR}/{sr2['id']}", json={"status": "work_completed"}, headers=h).json()
    assert r["resolution_at"] and r["sla_resolution_met"] is True
    r = client.patch(f"{SR}/{sr2['id']}", json={"status": "in_progress"}, headers=h).json()
    assert r["resolution_at"] is None and r["sla_resolution_state"] == "running"


def test_contract_sla_hours_win_over_profile(db):
    from app.modules.erp.models.service_contract import ServiceContract
    from app.modules.crm.models.organization import Organization
    org = Organization(name="Contract Co")
    db.add(org)
    db.flush()
    c = ServiceContract(contract_number="AMC-T-1", contract_type="amc", customer_id=org.id, status="active",
                        start_date=date.today(), end_date=date.today() + timedelta(days=365), sla_response_hours=2, sla_resolution_hours=12)
    db.add(c)
    m = mk_machine(db, "SLA-C")
    sr = ServiceRequest(request_number="SR-T-1", project_id=m.id, issue_title="x", priority="standard",
                        opened_at=NOW, service_contract_id=c.id)
    db.add(sr)
    db.flush()
    sla.apply_profile(sr)
    assert (sr.sla_profile, sr.sla_response_hours, sr.sla_resolution_hours) == ("contract", 2, 12)
