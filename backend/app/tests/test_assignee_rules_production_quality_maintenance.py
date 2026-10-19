"""Assign-to rules (core/assignee_rules.py) on the Maintenance and Quality
pickers: the technician of a maintenance work order (create + reassign),
labour logged for someone else, the PM plan's default technician, and the
CAPA owner / action owner. Production's pickers use the same
ensure_allowed call; the registry test below checks they're all declared."""
from app.core.assignee_rules import PICKERS
from app.modules.main.models.role import Role
from app.tests.test_maintenance import BASE, create_asset, hdr, make_user, setup_plant
from app.tests.test_maintenance_pm import _plan_payload


def _give_role(db, user, grants, rules):
    role = Role(name=f"Role {user.email}", permissions=grants, assignee_rules=rules)
    db.add(role)
    db.commit()
    user.roles = [role]
    db.commit()
    db.refresh(user)


def test_pickers_registered():
    for key in ("production:work_orders.supervisor", "production:shop_floor.run_operations",
                "production:rrv_builds.build_manager", "production:rrv_builds.stages", "production:rrv_builds.rework",
                "quality:inspection_lots.assign", "quality:capa.owner", "quality:capa.team", "quality:capa.actions",
                "quality:complaints.owner", "quality:supplier_quality.audits",
                "maintenance:work_orders.assign", "maintenance:work_orders.labour", "maintenance:schedule.default_assignee"):
        assert key in PICKERS, key


def test_work_order_technician_rule(client, db):
    branch, *_ = setup_plant(db)
    planner = make_user(db, "ar.planner@premnathrail.com")
    allowed = make_user(db, "ar.tech1@premnathrail.com")
    outsider = make_user(db, "ar.tech2@premnathrail.com")
    asset = create_asset(client, hdr(planner), branch)
    _give_role(db, planner, ["maintenance:*:*"], {
        "maintenance:work_orders.assign": {"mode": "custom", "users": [allowed.id]},
        "maintenance:work_orders.labour": {"mode": "custom", "users": [allowed.id]},
    })

    body = {"asset_id": asset["id"], "wo_type": "inspection", "title": "Monthly check"}
    r = client.post(f"{BASE}/work-orders", json={**body, "assigned_to_id": outsider.id}, headers=hdr(planner))
    assert r.status_code == 403 and "Assign technician" in r.json()["detail"]
    r = client.post(f"{BASE}/work-orders", json={**body, "assigned_to_id": allowed.id}, headers=hdr(planner))
    assert r.status_code == 200, r.text
    wo_id = r.json()["id"]

    r = client.post(f"{BASE}/work-orders/{wo_id}/assign", json={"assigned_to_id": outsider.id}, headers=hdr(planner))
    assert r.status_code == 403
    # Re-saving the current technician isn't a new pick.
    assert client.post(f"{BASE}/work-orders/{wo_id}/assign", json={"assigned_to_id": allowed.id}, headers=hdr(planner)).status_code == 200

    r = client.post(f"{BASE}/work-orders/{wo_id}/labour", json={"technician_id": outsider.id, "hours": 1}, headers=hdr(planner))
    assert r.status_code == 403 and "Log labour for technician" in r.json()["detail"]
    # Own time is always allowed.
    r = client.post(f"{BASE}/work-orders/{wo_id}/labour", json={"technician_id": planner.id, "hours": 1}, headers=hdr(planner))
    assert r.status_code == 200, r.text


def test_pm_plan_default_technician_rule(client, db):
    branch, *_ = setup_plant(db)
    planner = make_user(db, "ar.pmplanner@premnathrail.com")
    allowed = make_user(db, "ar.pmtech1@premnathrail.com")
    outsider = make_user(db, "ar.pmtech2@premnathrail.com")
    asset = create_asset(client, hdr(planner), branch)
    _give_role(db, planner, ["maintenance:*:*"],
               {"maintenance:schedule.default_assignee": {"mode": "custom", "users": [allowed.id]}})

    r = client.post(f"{BASE}/pm-plans", json=_plan_payload(asset["id"], default_assignee_id=outsider.id), headers=hdr(planner))
    assert r.status_code == 403 and "Set PM default technician" in r.json()["detail"]
    r = client.post(f"{BASE}/pm-plans", json=_plan_payload(asset["id"], default_assignee_id=allowed.id), headers=hdr(planner))
    assert r.status_code == 200, r.text
    plan_id = r.json()["id"]
    assert client.patch(f"{BASE}/pm-plans/{plan_id}", json={"default_assignee_id": outsider.id}, headers=hdr(planner)).status_code == 403
    # Editing other fields keeps the current technician without re-checking it.
    assert client.patch(f"{BASE}/pm-plans/{plan_id}", json={"default_assignee_id": allowed.id, "lead_days": 5}, headers=hdr(planner)).status_code == 200


def test_capa_owner_and_action_owner_rule(client, db):
    engineer = make_user(db, "ar.qe@premnathrail.com", apps=("quality",))
    allowed = make_user(db, "ar.qa1@premnathrail.com", apps=("quality",))
    outsider = make_user(db, "ar.qa2@premnathrail.com", apps=("quality",))
    _give_role(db, engineer, ["quality:*:*"], {
        "quality:capa.owner": {"mode": "custom", "users": [allowed.id]},
        "quality:capa.actions": {"mode": "self"},
    })

    r = client.post("/api/v1/quality/capa", json={"title": "Weld cracks", "responsible_user_id": outsider.id}, headers=hdr(engineer))
    assert r.status_code == 403 and "Set CAPA owner" in r.json()["detail"]
    r = client.post("/api/v1/quality/capa", json={"title": "Weld cracks", "responsible_user_id": allowed.id}, headers=hdr(engineer))
    assert r.status_code == 200, r.text
    capa_id = r.json()["id"]

    action = {"kind": "corrective", "description": "Re-train welders", "due_date": "2099-01-01"}
    r = client.post(f"/api/v1/quality/capa/{capa_id}/actions", json={**action, "owner_id": allowed.id}, headers=hdr(engineer))
    assert r.status_code == 403 and "Set CAPA action owner" in r.json()["detail"]
    r = client.post(f"/api/v1/quality/capa/{capa_id}/actions", json={**action, "owner_id": engineer.id}, headers=hdr(engineer))
    assert r.status_code == 200, r.text
