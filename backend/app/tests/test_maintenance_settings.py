"""
Maintenance › Settings on the shared settings framework: every default equals
the value that used to be hard-coded (behaviour unchanged), changing a value
changes behaviour, and who may read / edit.
"""
from datetime import date, timedelta
from types import SimpleNamespace

from app.core import settings_framework as sf
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.notification import Notification
from app.modules.maintenance import settings as ms
from app.modules.maintenance.contracts import REMINDER_DAYS_AFTER, REMINDER_DAYS_BEFORE, reminder_due
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.reporting import DEFAULT_HOURS_PER_DAY, available_hours
from app.modules.maintenance.service import default_priority, today_ist
from app.modules.organization.models.branch import Branch
from app.tasks.maintenance_amc_reminders import _send_maintenance_amc_reminders, AMC_EXPIRING
from app.tests.test_maintenance import BASE, make_user, hdr, setup_plant, create_asset
from app.tests.test_maintenance_spares import _setup as spares_setup

URL = f"{BASE}/settings"


def _grant(db, user, *perms):
    user.granular_permissions = list(perms)
    db.commit()
    return user


def _admin(db):
    return make_user(db, "admin@premnathrail.com", role="admin")


def _put(client, user, values):
    return client.put(URL, json={"values": values}, headers=hdr(user))


# ---------------------------------------------------------------- defaults

def test_defaults_match_previous_hard_coded_values(client, db):
    assert ms.default_pm_lead_days(db) == 3
    assert ms.dashboard_pm_window_days(db) == 7
    assert ms.requester_confirmation_required(db) is True
    assert ms.contract_reminder_days(db) == (REMINDER_DAYS_BEFORE, REMINDER_DAYS_AFTER) == ((30, 15, 7, 1), 1)
    assert ms.default_hours_per_day(db) == DEFAULT_HOURS_PER_DAY == 8.0
    assert ms.critical_spare_alert_enabled(db) is True
    # Priority matrix from settings == the old code matrix for every cell.
    for crit in ("A", "B", "C"):
        for down in (True, False):
            assert default_priority(crit, down, db) == default_priority(crit, down)
    # Reminder days unchanged.
    t = date(2026, 10, 6)
    before, after = ms.contract_reminder_days(db)
    assert [d for d in range(-3, 40) if reminder_due(t + timedelta(days=d), t, before, after)] == [-1, 1, 7, 15, 30]

    body = client.get(URL, headers=hdr(make_user(db, "m@premnathrail.com"))).json()
    assert all(body["is_default"].values()) and body["can_edit"] is False
    assert {g["key"] for g in body["groups"]} == {"pm", "breakdown", "contracts", "reliability", "spares", "safety"}
    assert all(s["help"] for s in body["specs"])
    assert db.query(ModuleSetting).count() == 0


# ---------------------------------------------------------------- behaviour

def test_priority_matrix_drives_new_requests(client, db):
    branch, *_ = setup_plant(db)
    admin, maint = _admin(db), make_user(db, "m1@premnathrail.com")
    asset = create_asset(client, hdr(maint), branch, criticality="C")
    raise_ = lambda: client.post(f"{BASE}/requests", json={  # noqa: E731
        "asset_id": asset["id"], "machine_down": True, "problem_description": "Hydraulic leak"}, headers=hdr(maint)).json()
    assert raise_()["priority"] == "normal"
    assert _put(client, admin, {"priority_c_down": "urgent"}).status_code == 200
    assert raise_()["priority"] == "urgent"


def test_pm_lead_days_default_used_when_blank(client, db):
    branch, *_ = setup_plant(db)
    admin, planner = _admin(db), make_user(db, "pl@premnathrail.com")
    asset = create_asset(client, hdr(planner), branch)
    payload = {"asset_id": asset["id"], "title": "Monthly lubrication", "frequency_unit": "month", "frequency_value": 1,
               "next_due_date": str(today_ist() + timedelta(days=20))}
    r = client.post(f"{BASE}/pm-plans", json=payload, headers=hdr(planner))
    assert r.status_code == 200, r.text
    assert r.json()["lead_days"] == 3
    _put(client, admin, {"default_pm_lead_days": 10})
    assert client.post(f"{BASE}/pm-plans", json=payload, headers=hdr(planner)).json()["lead_days"] == 10
    # An explicit value on the plan still wins.
    assert client.post(f"{BASE}/pm-plans", json={**payload, "lead_days": 1}, headers=hdr(planner)).json()["lead_days"] == 1


def test_dashboard_pm_window(client, db):
    branch, *_ = setup_plant(db)
    admin, planner = _admin(db), make_user(db, "pl2@premnathrail.com")
    asset = create_asset(client, hdr(planner), branch)
    r = client.post(f"{BASE}/pm-plans", json={
        "asset_id": asset["id"], "title": "Quarterly check", "frequency_unit": "month", "frequency_value": 3,
        "lead_days": 0, "next_due_date": str(today_ist() + timedelta(days=10))}, headers=hdr(planner))
    assert r.status_code == 200, r.text
    dash = client.get(f"{BASE}/dashboard", headers=hdr(planner)).json()["pm_due_this_week"]
    assert dash["count"] == 0 and dash["window_days"] == 7
    _put(client, admin, {"dashboard_pm_window_days": 14})
    dash = client.get(f"{BASE}/dashboard", headers=hdr(planner)).json()["pm_due_this_week"]
    assert dash["count"] == 1 and dash["window_days"] == 14


def test_requester_confirmation_can_be_switched_off(client, db):
    branch, *_ = setup_plant(db)
    admin = _admin(db)
    maint, prod = make_user(db, "m2@premnathrail.com"), make_user(db, "p2@premnathrail.com", apps=("production",))
    hm, hp = hdr(maint), hdr(prod)
    asset = create_asset(client, hm, branch, criticality="C")
    req = client.post(f"{BASE}/requests", json={"asset_id": asset["id"], "machine_down": True, "problem_description": "Leak"}, headers=hp).json()
    wo_id = client.post(f"{BASE}/requests/{req['id']}/convert", json={"assigned_to_id": maint.id}, headers=hm).json()["work_order"]["id"]
    client.post(f"{BASE}/work-orders/{wo_id}/start", headers=hm)
    done = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={
        "failure_category": "hydraulic", "root_cause": "Seal", "action_taken": "Seal changed"}, headers=hm).json()
    assert done["awaiting_confirmation"] is True
    assert client.post(f"{BASE}/work-orders/{wo_id}/close", headers=hm).status_code == 409  # default: wait for requester

    _put(client, admin, {"require_requester_confirmation": False})
    assert client.get(f"{BASE}/work-orders/{wo_id}", headers=hm).json()["awaiting_confirmation"] is False
    r = client.post(f"{BASE}/work-orders/{wo_id}/close", headers=hm)
    assert r.status_code == 200 and r.json()["status"] == "closed"


def test_contract_reminder_days_change_the_trigger(db):
    branch = Branch(name="Faridabad Plant", code="FBD")
    db.add(branch)
    db.commit()
    make_user(db, "m3@premnathrail.com")
    admin = _admin(db)
    today = today_ist()
    db.add_all([
        MaintenanceAsset(asset_code="CNC-10", name="Lathe", branch_id=branch.id, amc_expiry=today + timedelta(days=10)),
        MaintenanceAsset(asset_code="CNC-30", name="Mill", branch_id=branch.id, amc_expiry=today + timedelta(days=30)),
        MaintenanceAsset(asset_code="CNC-X1", name="Drill", branch_id=branch.id, warranty_expiry=today - timedelta(days=1)),
    ])
    db.commit()

    def reminded():
        rows = db.query(Notification).filter(Notification.notification_type == AMC_EXPIRING).all()
        codes = {a.id: a.asset_code for a in db.query(MaintenanceAsset).all()}
        return {codes[n.entity_id] for n in rows}

    _send_maintenance_amc_reminders(db, today)
    assert reminded() == {"CNC-30", "CNC-X1"}  # defaults: 30/15/7/1 before + 1 after

    db.query(Notification).delete()
    db.commit()
    sf.save(db, "maintenance", {"contract_reminder_days_before": [10], "contract_reminder_days_after": 0}, admin)
    _send_maintenance_amc_reminders(db, today)
    assert reminded() == {"CNC-10"}


def test_default_hours_per_day_feeds_available_hours(db):
    branch = Branch(name="Plant without hours", code="PWH")
    db.add(branch)
    db.commit()
    asset = MaintenanceAsset(asset_code="EQ-1", name="Press", branch_id=branch.id)
    db.add(asset)
    db.commit()
    monday = date(2026, 10, 5)  # Mon–Sat default working days → 1 day
    hours, basis = available_hours(db, [asset], monday, monday)
    assert hours[asset.id] == 8.0 and basis["assets_default_hours"] == 1 and "assume 8 h/day" in basis["description"]
    sf.save(db, "maintenance", {"default_hours_per_day": 10}, _admin(db))
    hours, basis = available_hours(db, [asset], monday, monday)
    assert hours[asset.id] == 10.0 and "assume 10 h/day" in basis["description"]


def test_critical_spare_alert_switch(client, db):
    branch, loc, brg, *_ = spares_setup(db)
    admin, planner = _admin(db), make_user(db, "sp9@premnathrail.com")
    h = hdr(planner)
    asset = create_asset(client, h, branch)
    client.put(f"{BASE}/assets/{asset['id']}/spares", json={"lines": [
        {"store_item_id": brg.id, "qty_per_replacement": 2, "is_critical": True}]}, headers=h)
    wo_id = client.post(f"{BASE}/work-orders", json={
        "asset_id": asset["id"], "title": "Replace bearing", "wo_type": "corrective", "assigned_to_id": planner.id}, headers=h).json()["id"]
    client.post(f"{BASE}/work-orders/{wo_id}/start", headers=h)
    _put(client, admin, {"critical_spare_alert": False})
    # 6 → 4: below minimum 5, but the alert is off.
    r = client.post(f"{BASE}/work-orders/{wo_id}/spares/issue", json={"store_item_id": brg.id, "location_id": loc.id, "quantity": 2}, headers=h)
    assert r.status_code == 200, r.text
    assert db.query(Notification).filter(Notification.notification_type == "maintenance_spare_below_min").count() == 0


# ---------------------------------------------------------------- access

def test_permissions_validation_reset_and_audit(client, db):
    plain = make_user(db, "plain@premnathrail.com")
    planner = _grant(db, make_user(db, "planner@premnathrail.com"), "maintenance:work_orders:approve")
    editor = _grant(db, make_user(db, "editor@premnathrail.com"), "maintenance:settings:edit")
    outsider = make_user(db, "crm@premnathrail.com", apps=("crm",))
    admin = _admin(db)

    assert client.get(URL, headers=hdr(outsider)).status_code == 403
    assert client.get(URL, headers=hdr(plain)).json()["can_edit"] is False
    r = _put(client, plain, {"default_pm_lead_days": 5})
    assert r.status_code == 403 and "Settings → Edit" in r.json()["detail"]
    assert client.post(f"{URL}/reset/default_pm_lead_days", headers=hdr(plain)).status_code == 403

    # Work Orders › Approve no longer implies settings editing (roles era).
    assert ms.can_edit_maintenance_settings(planner) is False
    for u, v in ((editor, 6), (admin, 7)):
        assert client.get(URL, headers=hdr(u)).json()["can_edit"] is True
        r = _put(client, u, {"default_pm_lead_days": v})
        assert r.status_code == 200, r.text
        assert r.json()["values"]["default_pm_lead_days"] == v

    # One bad value saves nothing; errors name the field and the fix.
    r = _put(client, admin, {"default_pm_lead_days": 9, "default_hours_per_day": 30})
    assert r.status_code == 422 and "Default available hours per day" in r.json()["detail"]
    r = _put(client, admin, {"contract_reminder_days_before": [30, 0]})
    assert r.status_code == 422 and "1–365" in r.json()["detail"]
    r = _put(client, admin, {"priority_a_down": "critical"})
    assert r.status_code == 422 and "Urgent" in r.json()["detail"]
    assert ms.default_pm_lead_days(db) == 7

    r = client.post(f"{URL}/reset/default_pm_lead_days", headers=hdr(editor))
    assert r.status_code == 200 and r.json()["is_default"]["default_pm_lead_days"] is True
    assert ms.default_pm_lead_days(db) == 3
    audits = db.query(AuditLog).filter(AuditLog.entity_type == "module_setting", AuditLog.module_key == "maintenance").all()
    assert len(audits) == 3 and audits[-1].action == "reset"


def test_explicit_grant_only_not_matrix_fallthrough():
    """A user with no grants at all is not an editor (the matrix's opt-in
    fallthrough must not apply to settings)."""
    nobody = SimpleNamespace(role="user", granular_permissions=[])
    other = SimpleNamespace(role="user", granular_permissions=["maintenance:work_orders:view"])
    assert not ms.can_edit_maintenance_settings(nobody)
    assert not ms.can_edit_maintenance_settings(other)
    assert not ms.can_edit_maintenance_settings(None)
