"""HR / Organization / auth review fixes (2026-10-13):

- lifecycle events can only be raised for (and joinings linked to) employees
  inside the HR user's data access;
- exit completion cancels approved leave that starts after the last working
  day and gives the balance back;
- a half-day-leave day can only be regularized as 'Half day';
- non-admin role managers can't hand out wider data access than they hold,
  nor change their own / an admin's role membership;
- purpose tokens (document share) are refused as sign-in tokens with a 401.
"""
from datetime import date

from app.auth.jwt_handler import create_document_share_token
from app.modules.hr.models.attendance import HrAttendance
from app.modules.hr.models.leave import HrLeaveBalance, HrLeaveRequest
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.tests.test_cov_hr_lifecycle import complete, create_event, leaver_world, masters  # noqa: F401
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

LC = f"{HR}/lifecycle"


# ── lifecycle data access ───────────────────────────────────────────────

def test_scoped_hr_cannot_raise_exit_for_employee_outside_scope(client, db):
    narrow = make_user(db, "hr.narrow@premnathrail.com", data_access_scopes={"hr": "own"})
    other = make_user(db, "far.employee@premnathrail.com")
    make_profile(db, other, employment_status="active")
    r = client.post(f"{LC}/events", headers=hdr(narrow), json={
        "event_type": "exit", "user_id": other.id, "last_working_day": "2026-10-31", "exit_type": "resignation",
    })
    assert r.status_code == 403 and "outside your HR data access" in r.json()["detail"]
    db.expire_all()
    from app.modules.hr.models.employee_profile import HrEmployeeProfile
    from app.modules.hr.models.lifecycle import HrLifecycleEvent
    assert db.query(HrLifecycleEvent).count() == 0
    assert db.query(HrEmployeeProfile).filter_by(user_id=other.id).one().employment_status == "active"


# ── exit: approved leave after the last working day ─────────────────────

def test_exit_cancels_approved_leave_after_last_working_day_and_restores_balance(client, db, leaver_world):
    w = leaver_world
    lt_id = w["own"].leave_type_id
    from app.modules.hr.models.leave import HrLeaveType
    lt = db.get(HrLeaveType, lt_id)
    make_balance(db, w["leaver"], lt, allotted=10, used=2)
    after = HrLeaveRequest(request_no="LV-2026-0102", user_id=w["leaver"].id, leave_type_id=lt_id,
                           from_date=date(2026, 11, 9), to_date=date(2026, 11, 10), days=Decimal("2"), status="approved")
    before = HrLeaveRequest(request_no="LV-2026-0103", user_id=w["leaver"].id, leave_type_id=lt_id,
                            from_date=date(2026, 10, 20), to_date=date(2026, 10, 20), days=Decimal("1"), status="approved")
    db.add_all([after, before])
    db.add(HrAttendance(user_id=w["leaver"].id, attendance_date=date(2026, 11, 9), status="on_leave", source="leave",
                        remarks="CL leave LV-2026-0102"))
    db.commit()
    ev = create_event(client, w["hr"], event_type="exit", user_id=w["leaver"].id, resignation_date="2026-09-01",
                      last_working_day="2026-10-31", exit_type="resignation", exit_reason="Higher studies")
    r = complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(HrLeaveRequest, after.id).status == "cancelled"
    assert db.get(HrLeaveRequest, before.id).status == "approved"  # inside employment: untouched
    bal = db.query(HrLeaveBalance).filter_by(user_id=w["leaver"].id, leave_type_id=lt_id, year=2026).one()
    assert bal.used == Decimal("0")
    assert db.query(HrAttendance).filter_by(user_id=w["leaver"].id, attendance_date=date(2026, 11, 9)).first() is None
    assert any("LV-2026-0102" in c for c in r.json()["completion_summary"]["cancelled_requests"])


# ── regularization on a half-day-leave day ──────────────────────────────

def test_half_day_leave_day_can_only_be_regularized_as_half_day(client, db):
    emp = make_user(db, "half.day@premnathrail.com", granular_permissions=["hr:me:view", "hr:me:create", "hr:me:edit"])
    make_profile(db, emp, employment_status="active")
    d = date(2026, 10, 5)
    db.add(HrAttendance(user_id=emp.id, attendance_date=d, status="half_day", source="leave",
                        remarks="CL leave LV-2026-0500 (half day)"))
    db.commit()
    r = client.post(f"{HR}/attendance/regularizations", headers=hdr(emp), json={
        "attendance_date": d.isoformat(), "requested_status": "present", "check_in": "09:00", "check_out": "17:30",
        "reason": "Worked full day",
    })
    assert r.status_code == 400 and "only be regularized as 'Half day'" in r.json()["detail"]


# ── role managers: data access escalation ───────────────────────────────

def _mgr(db):
    # The suite's default scope is 'organization' (conftest); this manager
    # only sees their department in HR.
    return make_user(db, "role.mgr@premnathrail.com", apps=(), data_access_scopes={"hr": "department"}, granular_permissions=[
        "organization:roles:view", "organization:roles:create", "organization:roles:edit", "hr:*:view",
    ])


def test_non_admin_cannot_create_role_with_wider_data_access(client, db):
    mgr = _mgr(db)
    r = client.post("/api/v1/roles", headers=hdr(mgr), json={
        "name": "HR Org Viewer", "permissions": ["hr:*:view"], "data_scopes": {"hr": "organization"},
    })
    assert r.status_code == 403 and "wider access than you hold" in r.json()["detail"]
    ok = client.post("/api/v1/roles", headers=hdr(mgr), json={
        "name": "HR Own Viewer", "permissions": ["hr:*:view"], "data_scopes": {"hr": "own"},
    })
    assert ok.status_code == 200, ok.text


def test_non_admin_cannot_widen_a_users_personal_data_access(client, db):
    mgr = _mgr(db)
    target = make_user(db, "scope.target@premnathrail.com")
    r = client.put(f"/api/v1/users/{target.id}/data-scopes", headers=hdr(mgr), json={"overrides": {"hr": "organization"}})
    assert r.status_code == 403
    admin = make_user(db, "real.admin@premnathrail.com", role="admin")
    assert client.put(f"/api/v1/users/{target.id}/data-scopes", headers=hdr(admin),
                      json={"overrides": {"hr": "organization"}}).status_code == 200


def test_non_admin_cannot_add_self_or_change_admin_role_membership(client, db):
    mgr = _mgr(db)
    role = Role(name="HR Readers", permissions=["hr:*:view"])
    db.add(role)
    db.commit()
    r = client.put(f"/api/v1/roles/{role.id}/users", headers=hdr(mgr), json={"user_ids": [mgr.id]})
    assert r.status_code == 403 and "yourself" in r.json()["detail"]
    admin = make_user(db, "other.admin@premnathrail.com", role="admin")
    r = client.put(f"/api/v1/roles/{role.id}/users", headers=hdr(mgr), json={"user_ids": [admin.id]})
    assert r.status_code == 403 and "admin" in r.json()["detail"]
    plain = make_user(db, "plain.user@premnathrail.com")
    assert client.put(f"/api/v1/roles/{role.id}/users", headers=hdr(mgr), json={"user_ids": [plain.id]}).status_code == 200


# ── auth: purpose tokens are not sign-in tokens ─────────────────────────

def test_document_share_token_is_rejected_as_bearer(client, db):
    token = create_document_share_token("rnd_tor", 1)
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
