"""HR lifecycle: joining -> probation -> confirmation, transfer / promotion
snapshots, and exit completion (account deactivated, sessions revoked,
approvals reassigned, own requests cancelled, unreturned assets block)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.modules.hr.models.asset import HrAsset
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.expense import HrExpenseClaim
from app.modules.hr.models.leave import HrLeaveRequest
from app.modules.hr.models.lifecycle import HrChecklistTemplate, HrLifecycleEvent
from app.modules.hr.models.masters import HrDesignation, HrGrade
from app.modules.hr.services.exit_guard import get_exit_info
from app.modules.main.models.user import User
from app.modules.main.models.user_session import UserSession
from app.modules.organization.models.department import Department
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

LC = f"{HR}/lifecycle"


def create_event(client, actor, **payload):
    r = client.post(f"{LC}/events", json=payload, headers=hdr(actor))
    assert r.status_code == 200, r.text
    return r.json()


def complete(client, actor, event_id, **payload):
    return client.post(f"{LC}/events/{event_id}/complete", json=payload, headers=hdr(actor))


def profile(db, user):
    db.expire_all()
    return db.query(HrEmployeeProfile).filter_by(user_id=user.id).first()


@pytest.fixture
def masters(db):
    p1 = make_branch(db, "P1")
    p2 = make_branch(db, "P2")
    eng = make_dept(db, "ENG", "Engineering")
    qa = make_dept(db, "QA", "Quality")
    g1 = HrGrade(code="E1", name="Engineer 1", level=1)
    g2 = HrGrade(code="E2", name="Engineer 2", level=2)
    db.add_all([g1, g2])
    db.commit()
    d1 = HrDesignation(name="Engineer", code="ENGR", grade_id=g1.id)
    d2 = HrDesignation(name="Senior Engineer", code="SENGR", grade_id=g2.id)
    db.add_all([d1, d2])
    db.commit()
    hr = make_user(db, "hr.lifecycle@premnathrail.com")
    m1 = make_user(db, "first.manager@premnathrail.com", branch_id=p1.id)
    m2 = make_user(db, "second.manager@premnathrail.com", branch_id=p2.id)
    return dict(p1=p1, p2=p2, eng=eng, qa=qa, g1=g1, g2=g2, d1=d1, d2=d2, hr=hr, m1=m1, m2=m2)


# ─────────────────────────── joining -> probation -> confirmation ───────────────────────────

def test_joining_on_probation_then_confirmation(client, db, masters):
    m = masters
    joiner = make_user(db, "new.joiner@premnathrail.com")
    ev = create_event(client, m["hr"], event_type="joining", user_id=joiner.id, effective_date="2026-10-01",
                      to_department_id=m["eng"].id, to_branch_id=m["p1"].id, to_designation_id=m["d1"].id,
                      to_grade_id=m["g1"].id, to_manager_id=m["m1"].id)
    assert ev["status"] == "in_progress" and ev["event_no"].startswith("LC-")

    r = complete(client, m["hr"], ev["id"], employment_type="permanent", employee_code="E0001",
                 probation_end_date="2027-04-01")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    assert r.json()["completion_summary"]["probation_status"] == "on_probation"

    p = profile(db, joiner)
    assert (p.employment_status, p.probation_status, p.employment_type, p.employee_code) == ("active", "on_probation", "permanent", "E0001")
    assert p.probation_end_date == date(2027, 4, 1)
    u = db.get(User, joiner.id)
    assert u.date_of_joining == date(2026, 10, 1)
    assert u.reporting_manager_id == m["m1"].id
    assert (u.department, u.designation, u.branch_id) == ("Engineering", "Engineer", m["p1"].id)

    # Joining again is refused -- they are already an employee.
    r = client.post(f"{LC}/events", json={"event_type": "joining", "user_id": joiner.id}, headers=hdr(m["hr"]))
    assert r.status_code == 409

    conf = create_event(client, m["hr"], event_type="confirmation", user_id=joiner.id, effective_date="2027-04-01")
    r = complete(client, m["hr"], conf["id"])
    assert r.status_code == 200, r.text
    # PA40: a future-dated confirmation is scheduled, then applied by the daily job on its date.
    assert r.json()["status"] == "scheduled"
    assert profile(db, joiner).probation_status == "on_probation"
    from app.tasks.hr_lifecycle_apply import run_once
    assert run_once(db, date(2027, 4, 1))["applied"] == [conf["event_no"]]
    db.expire_all()
    p = profile(db, joiner)
    assert (p.employment_status, p.probation_status, p.employment_type) == ("active", "confirmed", "permanent")
    assert p.confirmation_date == date(2027, 4, 1)
    from app.modules.hr.models.lifecycle import HrLifecycleEvent
    assert "Probation: on probation → confirmed" in db.get(HrLifecycleEvent, conf["id"]).completion_summary["changes"]


def test_permanent_joining_goes_straight_to_active(client, db, masters):
    joiner = make_user(db, "direct.hire@premnathrail.com")
    ev = create_event(client, masters["hr"], event_type="joining", user_id=joiner.id)
    assert complete(client, masters["hr"], ev["id"]).status_code == 200
    assert profile(db, joiner).employment_status == "active"


def test_confirmation_of_active_employee_refused(client, db, masters):
    emp = make_user(db, "already.active@premnathrail.com")
    make_profile(db, emp, employment_status="active")
    ev = create_event(client, masters["hr"], event_type="confirmation", user_id=emp.id)
    r = complete(client, masters["hr"], ev["id"])
    assert r.status_code == 409 and "not on probation" in r.json()["detail"]


def test_candidate_joining_must_be_linked_before_completion(client, db, masters):
    hr = masters["hr"]
    ev = create_event(client, hr, event_type="joining", candidate_name="Asha Rao", candidate_email="asha.rao@premnathrail.com")
    r = complete(client, hr, ev["id"])
    assert r.status_code == 400 and "Link user" in r.json()["detail"]
    r = client.post(f"{LC}/events/{ev['id']}/link-user", json={}, headers=hdr(hr))
    assert r.status_code == 404 and "Sync Azure Users" in r.json()["detail"]
    u = make_user(db, "asha.rao@premnathrail.com")
    r = client.post(f"{LC}/events/{ev['id']}/link-user", json={}, headers=hdr(hr))
    assert r.status_code == 200 and r.json()["user_id"] == u.id
    assert complete(client, hr, ev["id"]).status_code == 200


def test_duplicate_code_and_self_events_refused(client, db, masters):
    hr = masters["hr"]
    a = make_user(db, "code.owner@premnathrail.com")
    make_profile(db, a, employee_code="E0042")
    b = make_user(db, "code.clash@premnathrail.com")
    ev = create_event(client, hr, event_type="joining", user_id=b.id)
    r = complete(client, hr, ev["id"], employee_code="e0042")
    assert r.status_code == 409 and "already used" in r.json()["detail"]
    r = client.post(f"{LC}/events", json={"event_type": "transfer", "user_id": hr.id}, headers=hdr(hr))
    assert r.status_code == 403


# ─────────────────────────── transfer / promotion snapshots ───────────────────────────

def test_transfer_snapshots_from_fields_and_applies_to(client, db, masters):
    m = masters
    emp = make_user(db, "mover.one@premnathrail.com", department="Engineering", branch_id=m["p1"].id,
                    reporting_manager_id=m["m1"].id)
    make_profile(db, emp, department_id=m["eng"].id, branch_id=m["p1"].id, designation_id=m["d1"].id, grade_id=m["g1"].id)
    ev = create_event(client, m["hr"], event_type="transfer", user_id=emp.id, effective_date="2026-10-01",  # past: applies at once (future = scheduled, PA40)
                      to_department_id=m["qa"].id, to_branch_id=m["p2"].id, to_manager_id=m["m2"].id)
    assert (ev["from_department_id"], ev["from_branch_id"], ev["from_manager_id"]) == (m["eng"].id, m["p1"].id, m["m1"].id)
    assert (ev["from_designation_id"], ev["from_grade_id"]) == (m["d1"].id, m["g1"].id)

    dup = client.post(f"{LC}/events", json={"event_type": "transfer", "user_id": emp.id}, headers=hdr(m["hr"]))
    assert dup.status_code == 409 and "already has an open transfer" in dup.json()["detail"]

    r = complete(client, m["hr"], ev["id"])
    assert r.status_code == 200, r.text
    changes = r.json()["completion_summary"]["changes"]
    assert "Department: Engineering → Quality" in changes
    assert any(c.startswith("Reporting manager:") for c in changes)

    p = profile(db, emp)
    assert (p.department_id, p.branch_id, p.designation_id, p.grade_id) == (m["qa"].id, m["p2"].id, m["d1"].id, m["g1"].id)
    u = db.get(User, emp.id)
    assert (u.department, u.branch_id, u.reporting_manager_id) == ("Quality", m["p2"].id, m["m2"].id)
    # The snapshot stays as it was when the event was raised.
    e = db.get(HrLifecycleEvent, ev["id"])
    assert (e.from_department_id, e.from_branch_id, e.from_manager_id) == (m["eng"].id, m["p1"].id, m["m1"].id)


def test_snapshot_falls_back_to_user_free_text_fields(client, db, masters):
    m = masters
    emp = make_user(db, "legacy.user@premnathrail.com", department="engineering", designation="Engineer",
                    branch_id=m["p1"].id)
    ev = create_event(client, m["hr"], event_type="promotion", user_id=emp.id, to_designation_id=m["d2"].id)
    assert ev["from_department_id"] == m["eng"].id
    assert ev["from_designation_id"] == m["d1"].id
    assert ev["from_branch_id"] == m["p1"].id and ev["from_grade_id"] is None


def test_promotion_applies_grade_and_designation(client, db, masters):
    m = masters
    emp = make_user(db, "promo.one@premnathrail.com", designation="Engineer")
    make_profile(db, emp, designation_id=m["d1"].id, grade_id=m["g1"].id)
    ev = create_event(client, m["hr"], event_type="promotion", user_id=emp.id,
                      to_designation_id=m["d2"].id, to_grade_id=m["g2"].id)
    r = complete(client, m["hr"], ev["id"])
    assert r.status_code == 200, r.text
    changes = r.json()["completion_summary"]["changes"]
    assert "Grade: E1 → E2" in changes and "Designation: Engineer → Senior Engineer" in changes
    p = profile(db, emp)
    assert (p.designation_id, p.grade_id) == (m["d2"].id, m["g2"].id)
    assert db.get(User, emp.id).designation == "Senior Engineer"


def test_move_with_nothing_to_apply_refused(client, db, masters):
    emp = make_user(db, "idle.mover@premnathrail.com")
    ev = create_event(client, masters["hr"], event_type="transfer", user_id=emp.id)
    r = complete(client, masters["hr"], ev["id"])
    assert r.status_code == 400 and "Nothing to apply" in r.json()["detail"]


def test_inactive_grade_refused(client, db, masters):
    masters["g2"].is_active = False
    db.commit()
    emp = make_user(db, "grade.check@premnathrail.com")
    r = client.post(f"{LC}/events", json={"event_type": "promotion", "user_id": emp.id, "to_grade_id": masters["g2"].id},
                    headers=hdr(masters["hr"]))
    assert r.status_code == 400 and "inactive" in r.json()["detail"]


# ─────────────────────────── exit ───────────────────────────

@pytest.fixture
def leaver_world(db, masters):
    m = masters
    leaver = make_user(db, "leaving.lead@premnathrail.com", branch_id=m["p1"].id, is_department_head=True)
    make_profile(db, leaver, employment_status="active", department_id=m["eng"].id)
    successor = make_user(db, "successor.lead@premnathrail.com", branch_id=m["p1"].id)
    reportee = make_user(db, "team.member@premnathrail.com", reporting_manager_id=leaver.id)
    dept = db.get(Department, m["eng"].id)
    dept.head_user_id = leaver.id
    lt = make_leave_type(db, "CL", "Casual Leave", 12)
    waiting = HrLeaveRequest(request_no="LV-2026-0100", user_id=reportee.id, leave_type_id=lt.id,
                             from_date=date(2026, 11, 2), to_date=date(2026, 11, 2), days=Decimal("1"),
                             status="pending", approver_id=leaver.id)
    own = HrLeaveRequest(request_no="LV-2026-0101", user_id=leaver.id, leave_type_id=lt.id,
                         from_date=date(2026, 11, 3), to_date=date(2026, 11, 3), days=Decimal("1"), status="pending")
    own_claim = HrExpenseClaim(claim_no="EXP-2026-0100", user_id=leaver.id, title="Taxi", claim_date=date(2026, 10, 1),
                               status="draft")
    now = datetime.now(timezone.utc)
    sessions = [
        UserSession(user_id=leaver.id, token_hash="a" * 64, expires_at=now + timedelta(days=7)),
        UserSession(user_id=leaver.id, token_hash="b" * 64, expires_at=now + timedelta(days=7)),
        UserSession(user_id=leaver.id, token_hash="c" * 64, expires_at=now + timedelta(days=7), revoked_at=now),
        UserSession(user_id=successor.id, token_hash="d" * 64, expires_at=now + timedelta(days=7)),
    ]
    db.add_all([waiting, own, own_claim, *sessions])
    db.commit()
    return dict(m, leaver=leaver, successor=successor, reportee=reportee, waiting=waiting, own=own, own_claim=own_claim)


def raise_exit(client, w):
    return create_event(client, w["hr"], event_type="exit", user_id=w["leaver"].id, resignation_date="2026-09-01",
                        last_working_day="2026-10-31", exit_type="resignation", exit_reason="Higher studies")


def test_exit_completion_full_handover(client, db, leaver_world):
    w = leaver_world
    ev = raise_exit(client, w)
    assert profile(db, w["leaver"]).employment_status == "notice"

    impact = client.get(f"{LC}/events/{ev['id']}/exit-impact", headers=hdr(w["hr"])).json()
    assert impact["needs_handover"] is True
    assert [r["id"] for r in impact["direct_reportees"]] == [w["reportee"].id]
    assert [a["ref"] for a in impact["pending_hr_approvals"]] == ["LV-2026-0100"]
    assert impact["blockers"] == {"pending_checklist_items": 0, "unreturned_assets": 0}

    r = complete(client, w["hr"], ev["id"])
    assert r.status_code == 400 and "Pick a handover person" in r.json()["detail"]
    assert db.get(User, w["leaver"].id).is_active is True  # nothing applied on refusal

    r = complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id)
    assert r.status_code == 200, r.text
    summary = r.json()["completion_summary"]
    assert summary["sessions_revoked"] == 2
    assert "Department Head" in summary["role_flags_cleared"]

    db.expire_all()
    leaver = db.get(User, w["leaver"].id)
    assert leaver.is_active is False and leaver.is_department_head is False
    live = db.query(UserSession).filter(UserSession.user_id == leaver.id, UserSession.revoked_at.is_(None)).count()
    assert live == 0
    assert db.query(UserSession).filter_by(user_id=w["successor"].id).one().revoked_at is None
    assert db.get(User, w["reportee"].id).reporting_manager_id == w["successor"].id
    assert db.get(HrLeaveRequest, w["waiting"].id).approver_id == w["successor"].id
    assert db.get(HrLeaveRequest, w["waiting"].id).status == "pending"
    assert db.get(HrLeaveRequest, w["own"].id).status == "cancelled"
    assert db.get(HrExpenseClaim, w["own_claim"].id).status == "cancelled"
    assert db.get(Department, w["eng"].id).head_user_id == w["successor"].id
    p = profile(db, leaver)
    assert p.employment_status == "exited" and p.date_of_exit == date(2026, 10, 31) and p.exit_reason == "Higher studies"
    assert get_exit_info(db, leaver.id) == (True, date(2026, 10, 31))

    # The leaver's still-valid JWT stops working.
    assert client.get(f"{HR}/leave/requests/me", headers=hdr(leaver)).status_code == 401
    # And no further move events can be raised for them.
    r = client.post(f"{LC}/events", json={"event_type": "transfer", "user_id": leaver.id}, headers=hdr(w["hr"]))
    assert r.status_code == 409 and "already exited" in r.json()["detail"]


def test_exit_handover_to_requester_goes_to_hr_queue(client, db, leaver_world):
    w = leaver_world
    ev = raise_exit(client, w)
    r = complete(client, w["hr"], ev["id"], handover_to_id=w["reportee"].id)
    assert r.status_code == 200, r.text
    db.expire_all()
    # reportee raised LV-2026-0100, so it can't become its own approver
    assert db.get(HrLeaveRequest, w["waiting"].id).approver_id is None
    assert db.get(User, w["reportee"].id).reporting_manager_id is None


def test_unreturned_asset_blocks_exit_until_returned_or_forced(client, db, leaver_world):
    w = leaver_world
    laptop = HrAsset(asset_code="AST-0007", name="ThinkPad T14", category="laptop", status="issued",
                     current_holder_id=w["leaver"].id)
    db.add(laptop)
    db.commit()
    ev = raise_exit(client, w)
    impact = client.get(f"{LC}/events/{ev['id']}/impact", headers=hdr(w["hr"])).json()
    assert impact["blockers"]["unreturned_assets"] == 1

    r = complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id)
    assert r.status_code == 409
    assert "AST-0007" in r.json()["detail"] and "not returned" in r.json()["detail"]
    db.expire_all()
    assert db.get(User, w["leaver"].id).is_active is True
    assert db.query(UserSession).filter(UserSession.user_id == w["leaver"].id, UserSession.revoked_at.is_(None)).count() == 2

    r = complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id, force=True)
    assert r.status_code == 400 and "reason" in r.json()["detail"]

    r = complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id, force=True,
                 force_reason="Laptop stolen, police report filed")
    assert r.status_code == 200, r.text
    s = r.json()["completion_summary"]
    assert s["forced"] is True and s["outstanding_assets"] == ["AST-0007 ThinkPad T14"]


def test_returned_asset_no_longer_blocks_exit(client, db, leaver_world):
    w = leaver_world
    db.add(HrAsset(asset_code="AST-0008", name="SIM", category="sim", status="in_stock", current_holder_id=None))
    db.commit()
    ev = raise_exit(client, w)
    assert complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id).status_code == 200


def test_pending_checklist_item_blocks_exit(client, db, leaver_world):
    w = leaver_world
    db.add(HrChecklistTemplate(event_type="exit", category="it", title="Disable VPN"))
    db.commit()
    ev = raise_exit(client, w)
    assert [i["title"] for i in ev["items"]] == ["Disable VPN"]
    r = complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id)
    assert r.status_code == 409 and "checklist item" in r.json()["detail"]
    item_id = ev["items"][0]["id"]
    r = client.patch(f"{HR}/lifecycle/items/{item_id}", json={"status": "done"}, headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    assert complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id).status_code == 200


def test_exit_requires_last_working_day_and_cannot_be_completed_twice(client, db, leaver_world):
    w = leaver_world
    r = client.post(f"{LC}/events", json={"event_type": "exit", "user_id": w["leaver"].id}, headers=hdr(w["hr"]))
    assert r.status_code == 400 and "last working day" in r.json()["detail"]
    ev = raise_exit(client, w)
    assert complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id).status_code == 200
    r = complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id)
    assert r.status_code == 409 and "already completed" in r.json()["detail"]


def test_rehire_reactivates_exited_employee(client, db, leaver_world):
    w = leaver_world
    ev = raise_exit(client, w)
    complete(client, w["hr"], ev["id"], handover_to_id=w["successor"].id)
    j = create_event(client, w["hr"], event_type="joining", user_id=w["leaver"].id, effective_date="2027-01-04")
    r = complete(client, w["hr"], j["id"])
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(User, w["leaver"].id).is_active is True
    p = profile(db, w["leaver"])
    assert p.employment_status == "active" and p.date_of_exit is None


def test_lifecycle_screens_need_hr_app(client, db, masters):
    outsider = make_user(db, "design.eng@premnathrail.com", apps=("design",))
    emp = make_user(db, "someone.else@premnathrail.com")
    assert client.get(f"{LC}/events", headers=hdr(outsider)).status_code == 403
    r = client.post(f"{LC}/events", json={"event_type": "transfer", "user_id": emp.id}, headers=hdr(outsider))
    assert r.status_code == 403


@pytest.mark.xfail(
    reason=(
        "BUG: self-service gated by full-HR check — require_hr_module (app/main.py include_router dependencies) "
        "blocks a checklist-task owner without the 'hr' app (e.g. IT disabling the leaver's VPN) from "
        "/hr/lifecycle/my-tasks and PATCH /hr/lifecycle/items/{id}, which are owner self-service"
    ),
    strict=True,
)
def test_checklist_owner_without_hr_app_can_close_own_task(client, db, leaver_world):
    w = leaver_world
    it_admin = make_user(db, "it.admin@premnathrail.com", apps=("erp",))
    db.add(HrChecklistTemplate(event_type="exit", category="it", title="Disable VPN", default_owner_user_id=it_admin.id))
    db.commit()
    ev = raise_exit(client, w)
    tasks = client.get(f"{LC}/my-tasks", headers=hdr(it_admin))
    assert tasks.status_code == 200, tasks.text
    r = client.patch(f"{LC}/items/{ev['items'][0]['id']}", json={"status": "done"}, headers=hdr(it_admin))
    assert r.status_code == 200, r.text
