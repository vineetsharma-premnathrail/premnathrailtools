"""HR Permission Matrix scoping of the "acts as HR" checks inside self-service
and detail endpoints (is_hr_for), cross-tab readers (Employees profile,
Masters › Checklist Templates), approval-reminder recipients, joining-cancel
profile retention, rehire access message and visitor ID-proof validation."""
from datetime import date, datetime, timezone

import pytest

from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.leave import HrLeaveRequest
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.tasks.hr_reminders import APPROVAL_PENDING, run_hr_reminders
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

LC = f"{HR}/lifecycle"


def _leave(db, lt, requester, approver, no="LV-2026-0700", status="pending", created=None):
    req = HrLeaveRequest(request_no=no, user_id=requester.id, leave_type_id=lt.id, from_date=date(2026, 11, 2),
                         to_date=date(2026, 11, 2), days=Decimal("1"), status=status,
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
    hr = make_user(db, "hr.scope@premnathrail.com")
    emp = make_user(db, "scope.employee@premnathrail.com")
    make_profile(db, emp, employment_status="active")
    me_only = make_user(db, "me.only@premnathrail.com", granular_permissions=["hr:me:view"])
    make_profile(db, me_only, employment_status="active")
    lt = make_leave_type(db)
    return dict(hr=hr, emp=emp, me_only=me_only, lt=lt)


# ── self-service user (hr app + only My HR) can't act as HR ─────────────

def test_me_only_user_cannot_view_or_cancel_someone_elses_leave(client, db, world):
    w = world
    req = _leave(db, w["lt"], w["emp"], None)
    me = hdr(w["me_only"])
    assert client.get(f"{HR}/leave/requests/{req.id}", headers=me).status_code == 403
    r = client.post(f"{HR}/leave/requests/{req.id}/cancel", json={}, headers=me)
    assert r.status_code == 403 and "Leave" in r.json()["detail"]
    r = client.post(f"{HR}/leave/requests", data={"user_id": w["emp"].id, "leave_type_id": w["lt"].id,
                                                  "from_date": "2026-11-03", "to_date": "2026-11-03", "reason": "x"},
                    headers=me)
    assert r.status_code == 403 and "on behalf" in r.json()["detail"]
    # Real HR still can.
    assert client.get(f"{HR}/leave/requests/{req.id}", headers=hdr(w["hr"])).status_code == 200
    assert client.get(f"{HR}/leave/requests/{req.id}", headers=hdr(w["hr"])).json()["can_cancel"] is True


def test_me_only_user_cannot_edit_or_cancel_someone_elses_visitor(client, db, world):
    w = world
    r = client.post(f"{HR}/visitors", json={"visitor_name": "Anil Mehta", "purpose": "Meeting"}, headers=hdr(w["emp"]))
    assert r.status_code == 201, r.text
    vid = r.json()["id"]
    me = hdr(w["me_only"])
    assert client.patch(f"{HR}/visitors/{vid}", json={"purpose": "Changed"}, headers=me).status_code == 403
    assert client.post(f"{HR}/visitors/{vid}/cancel", json={}, headers=me).status_code == 403
    # Can't register for another host either (non-reception rule applies).
    r = client.post(f"{HR}/visitors", json={"visitor_name": "B", "host_user_id": w["emp"].id}, headers=me)
    assert r.status_code == 403
    assert client.patch(f"{HR}/visitors/{vid}", json={"purpose": "Changed"}, headers=hdr(w["hr"])).status_code == 200


def test_me_only_user_cannot_view_another_employees_attendance_month(client, db, world):
    w = world
    r = client.get(f"{HR}/attendance/month", params={"user_id": w["emp"].id}, headers=hdr(w["me_only"]))
    assert r.status_code == 403
    assert client.get(f"{HR}/attendance/month", params={"user_id": w["me_only"].id},
                      headers=hdr(w["me_only"])).status_code == 200


# ── Employees-only user reads the profile sub-tabs ──────────────────────

def test_employees_only_user_reads_profile_subtabs_but_cannot_manage(client, db, world):
    w = world
    staff = make_user(db, "employees.only@premnathrail.com", granular_permissions=["hr:employees:view"])
    h = hdr(staff)
    req = _leave(db, w["lt"], w["emp"], None)
    uid = w["emp"].id
    assert client.get(f"{HR}/leave/balances", params={"user_id": uid}, headers=h).status_code == 200
    rows = client.get(f"{HR}/leave/requests", params={"user_id": uid}, headers=h)
    assert rows.status_code == 200 and rows.json()[0]["can_cancel"] is False
    assert client.get(f"{HR}/assets/by-user/{uid}", headers=h).status_code == 200
    assert client.get(f"{LC}/users/{uid}/events", headers=h).status_code == 200
    assert client.get(f"{HR}/masters/designations", headers=h).status_code == 200
    assert client.get(f"{HR}/attendance/month", params={"user_id": uid}, headers=h).status_code == 200
    # ... but not manage leave or masters.
    assert client.post(f"{HR}/leave/requests/{req.id}/cancel", json={}, headers=h).status_code == 403
    assert client.post(f"{HR}/leave/balances/adjust", json={}, headers=h).status_code in (403, 422)
    assert client.get(f"{HR}/masters/grades", headers=h).status_code == 403


# ── Masters › Checklist Templates ───────────────────────────────────────

def test_masters_only_user_manages_checklist_templates(client, db, world):
    # RBAC: managing templates needs Masters create/edit/delete, not just view.
    masters = make_user(db, "masters.only@premnathrail.com", granular_permissions=[
        "hr:masters:view", "hr:masters:create", "hr:masters:edit", "hr:masters:delete"])
    h = hdr(masters)
    assert client.get(f"{LC}/meta", headers=h).status_code == 200
    assert client.get(f"{LC}/templates", headers=h).status_code == 200
    r = client.post(f"{LC}/templates", json={"event_type": "joining", "category": "it", "title": "Laptop"}, headers=h)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    assert client.patch(f"{LC}/templates/{tid}", json={"title": "Laptop + mouse"}, headers=h).status_code == 200
    assert client.delete(f"{LC}/templates/{tid}", headers=h).status_code == 200
    # Lifecycle-only users can read templates but not change them.
    lc = make_user(db, "lifecycle.only@premnathrail.com", granular_permissions=["hr:lifecycle:view"])
    assert client.get(f"{LC}/templates", headers=hdr(lc)).status_code == 200
    r = client.post(f"{LC}/templates", json={"event_type": "joining", "category": "it", "title": "X"}, headers=hdr(lc))
    assert r.status_code == 403
    # The masters-only user still cannot use the Lifecycle board.
    assert client.get(f"{LC}/events", headers=h).status_code == 403


# ── approval reminders go only to HR users who can decide ───────────────

def test_orphan_approval_reminder_skips_me_only_hr_app_holders(db, world):
    w = world
    old = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    orphan = _leave(db, w["lt"], w["emp"], None, no="LV-2026-0800", created=old)
    approvals = make_user(db, "approvals.only@premnathrail.com", granular_permissions=["hr:approvals:view", "hr:approvals:approve"])  # reminders go to people who can decide
    run_hr_reminders(db, today=TODAY)

    def got(uid):
        return db.query(Notification).filter_by(user_id=uid, notification_type=APPROVAL_PENDING, entity_id=orphan.id).count()

    assert got(w["hr"].id) == 1
    assert got(approvals.id) == 1
    assert got(w["me_only"].id) == 0
    assert got(w["emp"].id) == 0  # requester never reminded about their own request


# ── joining cancel keeps a profile HR started filling ───────────────────

def test_cancelled_joining_keeps_profile_with_hr_data(client, db, world):
    w = world
    joiner = make_user(db, "half.filled@premnathrail.com")
    r = client.post(f"{LC}/events", json={"event_type": "joining", "user_id": joiner.id}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    p = _profile(db, joiner)
    p.work_location = "Bay 3"
    db.commit()
    r = client.post(f"{LC}/events/{r.json()['id']}/cancel", json={"reason": "Offer declined"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    assert _profile(db, joiner) is not None
    assert "kept" in (r.json()["remarks"] or "")


# ── rehire of someone who exited before exits stripped access ───────────

def test_rehire_with_leftover_access_lists_it(client, db, world):
    w = world
    old = make_user(db, "old.leaver@premnathrail.com", apps=("hr", "crm"), granular_permissions=["crm:leads:view"])
    old.is_active = False
    db.commit()
    make_profile(db, old, employment_status="exited", date_of_exit=date(2025, 3, 31))
    r = client.post(f"{LC}/events", json={"event_type": "joining", "user_id": old.id}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{LC}/events/{r.json()['id']}/complete", json={"employment_type": "permanent"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    changes = r.json()["completion_summary"]["changes"]
    assert not any("with no modules" in c for c in changes)
    assert any("WITH its access from before the exit: apps hr, crm; 1 permission grant(s)" in c for c in changes)
    db.expire_all()
    assert db.get(User, old.id).is_active is True


# ── visitor ID-proof type validated everywhere ──────────────────────────

def test_id_proof_type_validated_on_create_and_check_in(client, db, world):
    w = world
    r = client.post(f"{HR}/visitors", json={"visitor_name": "C", "id_proof_type": "Ration card"}, headers=hdr(w["hr"]))
    assert r.status_code == 400 and "ID proof type" in r.json()["detail"]
    r = client.post(f"{HR}/visitors", json={"visitor_name": "C", "id_proof_type": "PAN"}, headers=hdr(w["hr"]))
    assert r.status_code == 201, r.text
    vid = r.json()["id"]
    r = client.post(f"{HR}/visitors/{vid}/check-in", json={"id_proof_type": "Ration card"}, headers=hdr(w["hr"]))
    assert r.status_code == 400 and "ID proof type" in r.json()["detail"]
    r = client.post(f"{HR}/visitors/{vid}/check-in", json={"id_proof_type": "Passport"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
