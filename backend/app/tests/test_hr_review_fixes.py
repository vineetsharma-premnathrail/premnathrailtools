"""HR review fixes: exit strips module access, HR Permission Matrix enforced
on HR-team endpoints and HR approvals, pending requests follow a manager
change, 'onboarding' profile on joining, exit cancel keeps probation,
visitor edit notifies the new host, pending-approval reminders."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.leave import HrLeaveRequest
from app.modules.hr.models.visitor import HrVisitor
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.tasks.hr_reminders import APPROVAL_PENDING, run_hr_reminders
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

LC = f"{HR}/lifecycle"


def _leave(db, lt, requester, approver, no="LV-2026-0500", created=None):
    req = HrLeaveRequest(request_no=no, user_id=requester.id, leave_type_id=lt.id, from_date=date(2026, 11, 2),
                         to_date=date(2026, 11, 2), days=Decimal("1"), status="pending",
                         approver_id=approver.id if approver else None)
    if created:
        req.created_at = created
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def _profile(db, user):
    db.expire_all()
    return db.query(HrEmployeeProfile).filter_by(user_id=user.id).first()


@pytest.fixture
def world(db):
    hr = make_user(db, "hr.review@premnathrail.com")
    hr2 = make_user(db, "hr.second@premnathrail.com")
    m1 = make_user(db, "old.manager@premnathrail.com")
    m2 = make_user(db, "new.manager@premnathrail.com")
    emp = make_user(db, "team.member@premnathrail.com", reporting_manager_id=m1.id)
    make_profile(db, emp, employment_status="active")
    lt = make_leave_type(db)
    return dict(hr=hr, hr2=hr2, m1=m1, m2=m2, emp=emp, lt=lt)


# ── exit strips module access ───────────────────────────────────────────

def test_exit_strips_apps_grants_and_admin_role(client, db, world):
    w = world
    leaver = make_user(db, "leaving.admin@premnathrail.com", apps=("hr", "crm"), role="admin",
                       granular_permissions=["crm:leads:view"], erp_permissions=["project_edit"])
    make_profile(db, leaver, employment_status="active")
    r = client.post(f"{LC}/events", json={"event_type": "exit", "user_id": leaver.id, "last_working_day": "2026-10-31",
                                          "exit_type": "resignation"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    ev = r.json()
    impact = client.get(f"{LC}/events/{ev['id']}/exit-impact", headers=hdr(w["hr"])).json()
    assert impact["apps"] == ["hr", "crm"] and impact["permission_grants_count"] == 2 and impact["is_admin"] is True

    r = client.post(f"{LC}/events/{ev['id']}/complete", json={}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    summary = r.json()["completion_summary"]
    assert summary["access_removed"]["assigned_apps"] == ["hr", "crm"]
    assert summary["access_removed"]["role"] == "admin"
    assert any(c.startswith("Module access removed: hr, crm; 2 permission grant(s) cleared") for c in summary["changes"])
    db.expire_all()
    u = db.get(User, leaver.id)
    assert (u.assigned_apps, u.granular_permissions, u.erp_permissions, u.role, u.is_active) == ([], [], [], "user", False)

    # Rehire re-activates the account with no modules.
    r = client.post(f"{LC}/events", json={"event_type": "joining", "user_id": leaver.id}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{LC}/events/{r.json()['id']}/complete", json={"employment_type": "permanent"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    assert any("re-activated with no modules" in c for c in r.json()["completion_summary"]["changes"])
    db.expire_all()
    u = db.get(User, leaver.id)
    assert u.is_active is True and u.assigned_apps == []


# ── HR Permission Matrix on the backend ─────────────────────────────────

def test_reception_only_matrix_user_is_limited_to_visitors(client, db, world):
    w = world
    reception = make_user(db, "reception.only@premnathrail.com", granular_permissions=["hr:visitors:view"])
    r = client.get(f"{HR}/employees/{w['emp'].id}", headers=hdr(reception))
    assert r.status_code == 403 and "HR & Administration › Employees" in r.json()["detail"]
    assert "Permission Matrix" in r.json()["detail"]
    assert client.get(f"{HR}/masters/lookups", headers=hdr(reception)).status_code == 200  # form dropdowns stay open
    assert client.get(f"{HR}/masters/grades", headers=hdr(reception)).status_code == 403
    r = client.post(f"{HR}/masters/grades", json={"code": "X1", "name": "X", "level": 1}, headers=hdr(reception))
    assert r.status_code == 403
    assert client.get(f"{HR}/visitors/board", headers=hdr(reception)).status_code == 200
    # Unconfigured HR user keeps full access (matrix is opt-in).
    assert client.get(f"{HR}/employees/{w['emp'].id}", headers=hdr(w["hr"])).status_code == 200


def test_hr_override_on_approvals_needs_the_approvals_tab(client, db, world):
    w = world
    req = _leave(db, w["lt"], w["emp"], w["m1"])
    reception = make_user(db, "reception.approve@premnathrail.com", granular_permissions=["hr:visitors:view"])
    r = client.post(f"{HR}/leave/requests/{req.id}/approve", json={}, headers=hdr(reception))
    assert r.status_code == 403
    unassigned = _leave(db, w["lt"], w["emp"], None, no="LV-2026-0501")
    ids = [x["id"] for x in client.get(f"{HR}/leave/requests/pending-for-me", headers=hdr(reception)).json()]
    assert unassigned.id not in ids
    ids = [x["id"] for x in client.get(f"{HR}/leave/requests/pending-for-me", headers=hdr(w["hr"])).json()]
    assert unassigned.id in ids


# ── pending requests follow a manager change ────────────────────────────

def test_profile_manager_change_reroutes_pending_requests(client, db, world):
    w = world
    req = _leave(db, w["lt"], w["emp"], w["m1"])
    r = client.patch(f"{HR}/employees/{w['emp'].id}", json={"reporting_manager_id": w["m2"].id}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(HrLeaveRequest, req.id).approver_id == w["m2"].id
    note = db.query(Notification).filter_by(user_id=w["m2"].id, notification_type="hr_approval_rerouted").one()
    assert "LV-2026-0500" in note.message


def test_transfer_with_new_manager_reroutes_pending_requests(client, db, world):
    w = world
    req = _leave(db, w["lt"], w["emp"], w["m1"])
    r = client.post(f"{LC}/events", json={"event_type": "transfer", "user_id": w["emp"].id, "to_manager_id": w["m2"].id},
                    headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{LC}/events/{r.json()['id']}/complete", json={}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    assert any("moved to the new manager" in c for c in r.json()["completion_summary"]["changes"])
    db.expire_all()
    assert db.get(HrLeaveRequest, req.id).approver_id == w["m2"].id


# ── onboarding profile + cancel paths ───────────────────────────────────

def test_joining_creates_onboarding_profile_and_cancel_removes_it(client, db, world):
    w = world
    joiner = make_user(db, "fresh.joiner@premnathrail.com")
    r = client.post(f"{LC}/events", json={"event_type": "joining", "user_id": joiner.id}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    p = _profile(db, joiner)
    assert p.employment_status == "onboarding" and p.org_fields_locked is False
    r = client.post(f"{LC}/events/{r.json()['id']}/cancel", json={"reason": "Offer declined"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    assert _profile(db, joiner) is None


def test_link_user_creates_onboarding_profile_and_completion_locks_it(client, db, world):
    w = world
    r = client.post(f"{LC}/events", json={"event_type": "joining", "candidate_name": "Late Joiner",
                                          "candidate_email": "late.joiner@premnathrail.com"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    ev = r.json()
    joiner = make_user(db, "late.joiner@premnathrail.com")
    r = client.post(f"{LC}/events/{ev['id']}/link-user", json={}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    assert _profile(db, joiner).employment_status == "onboarding"
    r = client.post(f"{LC}/events/{ev['id']}/complete", json={"employment_type": "permanent"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    p = _profile(db, joiner)
    assert p.employment_status == "active" and p.org_fields_locked is True


def test_cancelled_exit_puts_probationer_back_on_probation(client, db, world):
    w = world
    prob = make_user(db, "on.probation@premnathrail.com")
    make_profile(db, prob, employment_status="active", probation_status="on_probation", probation_end_date=date(2027, 1, 1))
    r = client.post(f"{LC}/events", json={"event_type": "exit", "user_id": prob.id, "last_working_day": "2026-10-31"},
                    headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    assert _profile(db, prob).employment_status == "notice"
    r = client.post(f"{LC}/events/{r.json()['id']}/cancel", json={"reason": "Withdrawn"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    p = _profile(db, prob)
    assert (p.employment_status, p.probation_status) == ("active", "on_probation")


# ── visitor edit ────────────────────────────────────────────────────────

def test_visitor_host_change_notifies_new_host_and_checks_id_proof(client, db, world):
    w = world
    r = client.post(f"{HR}/visitors", json={"visitor_name": "Ravi Kumar", "purpose": "Audit"}, headers=hdr(w["m1"]))
    assert r.status_code == 201, r.text
    vid = r.json()["id"]
    r = client.patch(f"{HR}/visitors/{vid}", json={"id_proof_type": "Ration card"}, headers=hdr(w["hr"]))
    assert r.status_code == 400 and "ID proof type" in r.json()["detail"]
    r = client.patch(f"{HR}/visitors/{vid}", json={"host_user_id": w["m2"].id}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(HrVisitor, vid).host_user_id == w["m2"].id
    assert db.query(Notification).filter_by(user_id=w["m2"].id, entity_type="hr_visitor", entity_id=vid).count() == 1


# ── pending-approval reminders ──────────────────────────────────────────

def test_pending_approval_reminders(db, world):
    w = world
    old = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    stale = _leave(db, w["lt"], w["emp"], w["m1"], no="LV-2026-0600", created=old)
    fresh = _leave(db, w["lt"], w["emp"], w["m1"], no="LV-2026-0601", created=datetime(2026, 10, 6, 9, 0, tzinfo=timezone.utc))
    gone = make_user(db, "gone.manager@premnathrail.com")
    gone.is_active = False
    db.commit()
    orphan = _leave(db, w["lt"], w["emp"], gone, no="LV-2026-0602", created=old)

    result = run_hr_reminders(db, today=TODAY)
    assert result["approvals"] >= 3

    def got(uid, req):
        return db.query(Notification).filter_by(user_id=uid, notification_type=APPROVAL_PENDING, entity_id=req.id).count()

    assert got(w["m1"].id, stale) == 1
    assert got(w["m1"].id, fresh) == 0
    assert got(w["hr"].id, orphan) == 1 and got(w["hr2"].id, orphan) == 1
    assert got(w["hr"].id, stale) == 0
    # Same day again: deduplicated.
    assert run_hr_reminders(db, today=TODAY)["approvals"] == 0
    # Next day: reminded again. The reminders above were stamped with the real
    # clock; pin them to the simulated TODAY so the dedup window is realistic.
    db.query(Notification).filter_by(notification_type=APPROVAL_PENDING).update(
        {Notification.created_at: datetime.combine(TODAY, datetime.min.time(), tzinfo=timezone.utc)}, synchronize_session=False)
    db.commit()
    assert run_hr_reminders(db, today=TODAY + timedelta(days=1))["approvals"] >= 3
