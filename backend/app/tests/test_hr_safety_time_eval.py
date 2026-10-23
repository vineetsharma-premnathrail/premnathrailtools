"""HR › Safety (EHS incident register, SAP CBIH) and time evaluation (SAP PT60):
worked / short / late / early / overtime from punches + shift (Factories Act
s.59 9 h/day or 48 h/week), OT approval through the central engine, ADP
export with approved OT only; incident report → investigation → CAPA →
statutory Form 18 → closure approval (plant head, then Partner for high)."""
import csv
import io
from datetime import date, datetime, time, timedelta

import pytest

from app.modules.hr.models.attendance import HrAttendance
from app.modules.hr.models.overtime import HrOvertime
from app.modules.hr.models.safety import HrSafetyIncident
from app.modules.hr.services import safety as safety_svc
from app.modules.hr.services.time_evaluation import TimeRules, evaluate_day, worked_minutes
from app.modules.organization.services import approval_engine as engine
from app.tests.test_cov_hr_support import *  # noqa: F401,F403
from app.tests.test_cov_hr_support import IST

TE = f"{HR}/time-evaluation"
S = f"{HR}/safety"

ME = ["hr:me:view", "hr:me:create", "hr:me:edit"]
HR_ATT = ["hr:attendance:view", "hr:attendance:edit", "hr:attendance:export", "hr:approvals:view",
          "hr:approvals:approve", "hr:approvals:reject"]
EHS = ["hr:safety:view", "hr:safety:create", "hr:safety:edit", "hr:safety:export", "hr:safety:print", "hr:safety:delete"]


@pytest.fixture(autouse=True)
def _freeze_more(monkeypatch):
    for target in ("app.modules.hr.routes.time_evaluation.today_ist", "app.modules.hr.services.time_evaluation.today_ist",
                   "app.modules.hr.routes.safety.today_ist"):
        monkeypatch.setattr(target, lambda: TODAY)
    monkeypatch.setattr("app.modules.hr.routes.safety.now_ist", lambda: NOW)


def _user(db, email, perms, **kw):
    u = make_user(db, email, apps=(), **kw)
    u.granular_permissions = list(perms)
    db.commit()
    return u


def _punch(db, user, d, ci, co, status="present"):
    row = HrAttendance(user_id=user.id, attendance_date=d, status=status, source="manual",
                       check_in=datetime.combine(d, ci).replace(tzinfo=IST),
                       check_out=datetime.combine(d, co).replace(tzinfo=IST) if co else None)
    db.add(row)
    db.commit()
    return row


@pytest.fixture
def org(db):
    plant = make_branch(db, "P1", "Mon-Sat")
    shift = make_shift(db, "GEN", time(9, 0), time(17, 30), grace=10)
    mgr = _user(db, "te.mgr@premnathrail.com", ME, branch_id=plant.id)
    hr = _user(db, "te.hr@premnathrail.com", ME + HR_ATT, branch_id=plant.id)
    emp = _user(db, "te.emp@premnathrail.com", ME, branch_id=plant.id, reporting_manager_id=mgr.id)
    make_profile(db, emp, shift_id=shift.id, branch_id=plant.id, employee_code="E200")
    return {"plant": plant, "shift": shift, "mgr": mgr, "hr": hr, "emp": emp}


# ─────────────────────────── pure rules ───────────────────────────

def test_worked_minutes_deducts_rest_interval_after_five_hours():
    r = TimeRules()
    d = date(2026, 10, 5)
    at = lambda h, m=0: datetime.combine(d, time(h, m)).replace(tzinfo=IST)  # noqa: E731
    assert worked_minutes(at(9), at(13), r) == 240          # 4 h: no rest deducted
    assert worked_minutes(at(9), at(17, 30), r) == 480      # 8.5 h span − 30 min rest
    assert worked_minutes(at(9), None, r) is None


def test_day_short_late_early_and_daily_ot(db, org):
    r = TimeRules()
    d = date(2026, 10, 5)
    late = HrAttendance(user_id=1, attendance_date=d, status="present",
                        check_in=datetime.combine(d, time(9, 40)).replace(tzinfo=IST),
                        check_out=datetime.combine(d, time(16, 50)).replace(tzinfo=IST))
    ev = evaluate_day(d, "present", "working", late, org["shift"], r, TODAY)
    assert ev.worked_minutes == 400 and ev.planned_minutes == 480 and ev.short_minutes == 80
    assert ev.late_minutes == 30 and ev.early_minutes == 30 and ev.ot_daily_minutes == 0
    long = HrAttendance(user_id=1, attendance_date=d, status="present",
                        check_in=datetime.combine(d, time(8, 0)).replace(tzinfo=IST),
                        check_out=datetime.combine(d, time(19, 0)).replace(tzinfo=IST))
    ev = evaluate_day(d, "present", "working", long, org["shift"], r, TODAY)
    assert ev.worked_minutes == 630 and ev.ot_daily_minutes == 90 and ev.short_minutes == 0


def test_night_shift_crosses_midnight(db):
    r = TimeRules()
    night = make_shift(db, "NGT", time(22, 0), time(6, 0), grace=10, is_night=True)
    d = date(2026, 10, 5)
    row = HrAttendance(user_id=1, attendance_date=d, status="present",
                       check_in=datetime.combine(d, time(22, 5)).replace(tzinfo=IST),
                       check_out=datetime.combine(d + timedelta(days=1), time(6, 0)).replace(tzinfo=IST))
    ev = evaluate_day(d, "present", "working", row, night, r, TODAY)
    assert ev.worked_minutes == 445 and ev.late_minutes == 0 and ev.early_minutes == 0 and ev.planned_minutes == 450


# ─────────────────────────── month evaluation & weekly OT ───────────────────────────

def test_weekly_48h_limit_spans_the_month_boundary(client, db, org):
    emp = org["emp"]
    # Mon 28-09 … Sat 03-10: 9 h span each (8.5 h worked) — no day over 9 h, week = 51 h.
    for i in range(6):
        _punch(db, emp, date(2026, 9, 28) + timedelta(days=i), time(9, 0), time(18, 0))
    r = client.get(f"{TE}/employee/{emp.id}", params={"year": 2026, "month": 10}, headers=hdr(org["hr"]))
    assert r.status_code == 200, r.text
    days = {d["date"]: d for d in r.json()["days"]}
    assert days["2026-10-03"]["ot_weekly_minutes"] == 180 and days["2026-10-03"]["ot_minutes"] == 180
    assert days["2026-10-02"]["ot_minutes"] == 0
    assert r.json()["totals"]["ot_minutes"] == 180


def test_self_evaluation_and_access_split(client, db, org):
    _punch(db, org["emp"], date(2026, 10, 5), time(9, 25), time(17, 30))
    r = client.get(f"{TE}/me", params={"year": 2026, "month": 10}, headers=hdr(org["emp"]))
    assert r.status_code == 200, r.text
    day = next(d for d in r.json()["days"] if d["date"] == "2026-10-05")
    assert day["late_minutes"] == 15 and day["worked_minutes"] == 455 and day["short_minutes"] == 25
    # HR screens need HR › Attendance.
    assert client.get(f"{TE}/month", headers=hdr(org["emp"])).status_code == 403


# ─────────────────────────── overtime approval ───────────────────────────

def test_ot_claim_approve_partial_and_export_only_approved(client, db, org):
    emp, mgr, hr = org["emp"], org["mgr"], org["hr"]
    d1, d2 = date(2026, 10, 5), date(2026, 10, 6)
    _punch(db, emp, d1, time(8, 0), time(20, 0))   # 690 worked → 150 OT
    _punch(db, emp, d2, time(9, 0), time(17, 30))  # no OT
    r = client.post(f"{TE}/overtime/me", json={"work_date": d2.isoformat(), "reason": "Stayed back"}, headers=hdr(emp))
    assert r.status_code == 400 and "not overtime" in r.json()["detail"]
    r = client.post(f"{TE}/overtime/me", json={"work_date": d1.isoformat(), "reason": "Dispatch of RRV", "claimed_minutes": 200},
                    headers=hdr(emp))
    assert r.status_code == 400 and "at most 150" in r.json()["detail"]
    r = client.post(f"{TE}/overtime/me", json={"work_date": d1.isoformat(), "reason": "Dispatch of RRV"}, headers=hdr(emp))
    assert r.status_code == 200, r.text
    ot = r.json()
    assert ot["claimed_minutes"] == 150 and ot["status"] == "pending" and ot["approver_id"] == mgr.id
    areq = engine.latest_request(db, "hr_overtime", ot["id"])
    assert areq is not None and areq.workflow_key == "hr.overtime"
    # Duplicate claim refused; own approval refused.
    assert client.post(f"{TE}/overtime/me", json={"work_date": d1.isoformat(), "reason": "again"}, headers=hdr(emp)).status_code == 409
    assert client.post(f"{TE}/overtime/{ot['id']}/approve", json={}, headers=hdr(emp)).status_code == 403
    # Manager inbox, partial approval needs a reason.
    pend = client.get(f"{TE}/overtime/pending-for-me", headers=hdr(mgr)).json()
    assert [p["id"] for p in pend] == [ot["id"]] and pend[0]["can_decide"]
    r = client.post(f"{TE}/overtime/{ot['id']}/approve", json={"approved_minutes": 120}, headers=hdr(mgr))
    assert r.status_code == 400
    r = client.post(f"{TE}/overtime/{ot['id']}/approve", json={"approved_minutes": 120, "remarks": "Capped at 2 h"}, headers=hdr(mgr))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["approved_minutes"] == 120

    r = client.get(f"{TE}/export", params={"year": 2026, "month": 10}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    rows = list(csv.DictReader(io.StringIO(r.text)))
    mine = next(x for x in rows if x["Email"] == emp.email)
    assert mine["OT hours computed"] == "2.50" and mine["OT hours approved (pay at 2x)"] == "2.00"
    assert mine["OT hours pending approval"] == "0.00"


def test_hr_generates_ot_requests_and_reject_needs_reason(client, db, org):
    emp, mgr, hr = org["emp"], org["mgr"], org["hr"]
    _punch(db, emp, date(2026, 10, 5), time(8, 0), time(19, 0))
    r = client.post(f"{TE}/overtime/generate", json={"year": 2026, "month": 10}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert r.json()["raised"] == 1 and not r.json()["errors"]
    again = client.post(f"{TE}/overtime/generate", json={"year": 2026, "month": 10}, headers=hdr(hr)).json()
    assert again["raised"] == 0 and again["skipped_existing"] == 1
    ot = db.query(HrOvertime).one()
    assert ot.source == "evaluation" and ot.claimed_minutes == 90
    assert client.post(f"{TE}/overtime/{ot.id}/reject", json={"remarks": " "}, headers=hdr(mgr)).status_code == 400
    r = client.post(f"{TE}/overtime/{ot.id}/reject", json={"remarks": "Not authorised in advance"}, headers=hdr(mgr))
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    # Employee can't use generate (no attendance:edit).
    assert client.post(f"{TE}/overtime/generate", json={"year": 2026, "month": 10}, headers=hdr(emp)).status_code == 403


def test_employee_cancels_own_pending_ot(client, db, org):
    emp = org["emp"]
    _punch(db, emp, date(2026, 10, 5), time(8, 0), time(19, 0))
    ot = client.post(f"{TE}/overtime/me", json={"work_date": "2026-10-05", "reason": "Urgent job"}, headers=hdr(emp)).json()
    r = client.post(f"{TE}/overtime/{ot['id']}/cancel", headers=hdr(emp))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert engine.latest_request(db, "hr_overtime", ot["id"]).status == "cancelled"


# ─────────────────────────── safety incidents ───────────────────────────

@pytest.fixture
def ehs(db):
    plant = make_branch(db, "P9", "Mon-Sat")
    head = _user(db, "ehs.head@premnathrail.com", ME, branch_id=plant.id)
    plant.head_user_id = head.id
    partner = _user(db, "ehs.partner@premnathrail.com", ME, is_partner=True)
    officer = _user(db, "ehs.officer@premnathrail.com", ME + EHS, branch_id=plant.id)
    lead = _user(db, "ehs.lead@premnathrail.com", ME, branch_id=plant.id)
    owner = _user(db, "ehs.owner@premnathrail.com", ME, branch_id=plant.id)
    welder = _user(db, "ehs.welder@premnathrail.com", ME, branch_id=plant.id)
    outsider = _user(db, "ehs.nobody@premnathrail.com", ["hr:dashboard:view"])
    db.commit()
    return {"plant": plant, "head": head, "partner": partner, "officer": officer, "lead": lead, "owner": owner,
            "welder": welder, "outsider": outsider}


def _report(client, user, plant, **extra):
    body = {
        "title": "Hand caught in press brake", "incident_type": "injury_lost_time", "severity": "high",
        "branch_id": plant.id, "location_text": "Fabrication bay 2",
        "occurred_at": datetime.combine(TODAY, time(8, 30)).replace(tzinfo=IST).isoformat(),
        "description": "Operator's left hand was caught while aligning a plate on the press brake.",
        "immediate_action": "First aid, taken to hospital, machine isolated.",
        "witnesses": [{"name": "Shift supervisor", "statement": "Guard was open."}],
        **extra,
    }
    return client.post(f"{S}/incidents", json=body, headers=hdr(user))


def test_incident_full_lifecycle_with_closure_approval(client, db, ehs):
    w = ehs
    r = _report(client, w["welder"], w["plant"], persons=[{
        "person_type": "employee", "user_id": w["welder"].id, "outcome": "lost_time", "lost_days": 3,
        "injury_nature": "Fracture", "body_part": "Left hand"}])
    assert r.status_code == 200, r.text
    inc = r.json()
    assert inc["incident_no"].startswith("INC-2026-27-") and inc["status"] == "reported"
    assert inc["reportable"] and inc["lti_count"] == 1 and inc["lost_days"] == 3
    iid = inc["id"]
    # Reporter sees their own incident; an unrelated user does not.
    assert client.get(f"{S}/incidents/{iid}", headers=hdr(w["welder"])).status_code == 200
    assert client.get(f"{S}/incidents/{iid}", headers=hdr(w["outsider"])).status_code == 403
    # Reporter can't run the investigation.
    assert client.post(f"{S}/incidents/{iid}/start-investigation", json={"investigation_lead_id": w["lead"].id},
                       headers=hdr(w["welder"])).status_code == 403

    r = client.post(f"{S}/incidents/{iid}/start-investigation", json={"investigation_lead_id": w["lead"].id}, headers=hdr(w["officer"]))
    assert r.status_code == 200 and r.json()["status"] == "under_investigation"
    # The lead records the investigation; completing needs a CAPA.
    body = {"root_cause": "Press-brake light curtain bypassed", "root_cause_category": "unsafe_condition", "complete": True}
    r = client.put(f"{S}/incidents/{iid}/investigation", json=body, headers=hdr(w["lead"]))
    assert r.status_code == 400 and "at least one" in r.json()["detail"]
    r = client.post(f"{S}/incidents/{iid}/actions", json={
        "action_type": "corrective", "description": "Restore light curtain interlock and lock the bypass key",
        "owner_id": w["owner"].id, "due_date": (TODAY + timedelta(days=7)).isoformat()}, headers=hdr(w["lead"]))
    assert r.status_code == 200, r.text
    action_id = r.json()["actions"][0]["id"]
    r = client.put(f"{S}/incidents/{iid}/investigation", json=body, headers=hdr(w["lead"]))
    assert r.status_code == 200 and r.json()["status"] == "actions_open"

    # Closure blocked: CAPA open, Form 18 not sent, no return-to-work date.
    r = client.post(f"{S}/incidents/{iid}/submit-closure", json={"remarks": "All done"}, headers=hdr(w["officer"]))
    assert r.status_code == 409 and "still open" in r.json()["detail"] and "Form 18" in r.json()["detail"]
    r = client.post(f"{S}/incidents/{iid}/actions/{action_id}/complete", json={"remarks": "Interlock restored, key with supervisor"},
                    headers=hdr(w["owner"]))
    assert r.status_code == 200, r.text
    r = client.put(f"{S}/incidents/{iid}/statutory", json={"form18_submitted_on": TODAY.isoformat(), "authority_ref": "DISH/2026/118"},
                   headers=hdr(w["officer"]))
    assert r.status_code == 200, r.text
    pid = r.json()["persons"][0]["id"]
    r = client.put(f"{S}/incidents/{iid}/persons/{pid}", json={
        "person_type": "employee", "user_id": w["welder"].id, "outcome": "lost_time", "lost_days": 3,
        "injury_nature": "Fracture", "body_part": "Left hand", "return_to_work_date": TODAY.isoformat()}, headers=hdr(w["officer"]))
    assert r.status_code == 200 and r.json()["closure_blockers"] == []

    r = client.post(f"{S}/incidents/{iid}/submit-closure", json={"remarks": "Interlock restored; toolbox talk held"}, headers=hdr(w["officer"]))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "closure_pending"
    areq = engine.latest_request(db, safety_svc.ENTITY, iid)
    stage1 = {s.approver_id for s in areq.steps if s.sequence == 1}
    stage2 = {s.approver_id for s in areq.steps if s.sequence == 2}
    assert w["head"].id in stage1 and stage2 == {w["partner"].id}
    # Locked while pending.
    assert client.patch(f"{S}/incidents/{iid}", json={"title": "Changed title"}, headers=hdr(w["officer"])).status_code == 409
    r = client.post(f"/api/v1/approvals/requests/{areq.id}/decide", json={"decision": "approve", "comment": "OK"}, headers=hdr(w["head"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(HrSafetyIncident, iid).status == "closure_pending"
    r = client.post(f"/api/v1/approvals/requests/{areq.id}/decide", json={"decision": "approve", "comment": "Closed"}, headers=hdr(w["partner"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    inc = db.get(HrSafetyIncident, iid)
    assert inc.status == "closed" and inc.closed_by_id == w["partner"].id

    # Register + stats.
    reg = client.get(f"{S}/register", params={"reportable_only": True}, headers=hdr(w["officer"])).json()
    assert [x["incident_no"] for x in reg["items"]] == [inc.incident_no]
    stats = client.get(f"{S}/stats", headers=hdr(w["officer"])).json()
    assert stats["lti"] == 1 and stats["lost_days"] == 3 and stats["total"] == 1
    csv_r = client.get(f"{S}/register/export", headers=hdr(w["officer"]))
    assert csv_r.status_code == 200 and inc.incident_no in csv_r.text


def test_closure_rejection_reopens_actions(client, db, ehs):
    w = ehs
    iid = _report(client, w["officer"], w["plant"], incident_type="near_miss", severity="low",
                  title="Sling slipped during lift").json()["id"]
    client.post(f"{S}/incidents/{iid}/start-investigation", json={"investigation_lead_id": w["lead"].id}, headers=hdr(w["officer"]))
    r = client.put(f"{S}/incidents/{iid}/investigation", json={
        "root_cause": "Worn sling", "root_cause_category": "material_handling", "no_action_reason": "Sling scrapped on the spot",
        "complete": True}, headers=hdr(w["lead"]))
    assert r.status_code == 200 and r.json()["closure_blockers"] == []
    r = client.post(f"{S}/incidents/{iid}/submit-closure", json={"remarks": "Near miss, sling scrapped"}, headers=hdr(w["lead"]))
    assert r.status_code == 200, r.text
    areq = engine.latest_request(db, safety_svc.ENTITY, iid)
    assert {s.sequence for s in areq.steps} == {1}  # low severity: no Partner stage
    r = client.post(f"/api/v1/approvals/requests/{areq.id}/decide", json={"decision": "reject", "comment": "Inspect all slings first"},
                    headers=hdr(w["head"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(HrSafetyIncident, iid).status == "actions_open"


def test_report_validation_and_delete_rules(client, db, ehs):
    w = ehs
    future = datetime.combine(TODAY + timedelta(days=1), time(8, 0)).replace(tzinfo=IST).isoformat()
    assert _report(client, w["welder"], w["plant"], occurred_at=future).status_code == 400
    r = _report(client, w["welder"], w["plant"], persons=[{"person_type": "contractor", "outcome": "first_aid"}])
    assert r.status_code == 400 and "name" in r.json()["detail"]
    r = _report(client, w["welder"], w["plant"], severity="medium",
                persons=[{"person_type": "visitor", "external_name": "Ravi", "outcome": "fatal"}])
    assert r.status_code == 400 and "Fatal" in r.json()["detail"]
    assert _report(client, w["outsider"], w["plant"]).status_code == 403
    inc = _report(client, w["officer"], w["plant"], incident_type="first_aid", severity="low").json()
    assert not inc["reportable"]
    assert client.delete(f"{S}/incidents/{inc['id']}", headers=hdr(w["officer"])).status_code == 200
    assert db.get(HrSafetyIncident, inc["id"]) is None


def test_form18_document_spec_and_docx(client, db, ehs):
    w = ehs
    inc_id = _report(client, w["welder"], w["plant"], incident_type="dangerous_occurrence", severity="high",
                     title="Hydraulic hose burst").json()["id"]
    inc = db.get(HrSafetyIncident, inc_id)
    spec = safety_svc.form18_spec(db, inc)
    facts = dict(spec["facts"])
    assert spec["title"].startswith("FORM 18") and "s.88A" in facts["Reportable because"]
    from app.modules.quality.reports.render import render_docx
    assert render_docx(spec)[:2] == b"PK"


def test_form18_word_document_needs_the_statutory_feature(client, db, ehs):
    """Security fix: the Form 18 Word document (shared managed-document
    routes) only checked 'party to the incident' — the PDF needs
    Safety › Statutory 'print'. The reporter can't open or create it now."""
    w = ehs
    inc_id = _report(client, w["welder"], w["plant"], incident_type="dangerous_occurrence", severity="high",
                     title="Hydraulic hose burst").json()["id"]
    url = f"/api/v1/managed-documents/{safety_svc.FORM18_ENTITY}/{inc_id}"
    r = client.get(url, headers=hdr(w["welder"]))
    assert r.status_code == 403 and "'Print' permission on HR & Administration › Safety (EHS incidents) › Statutory reporting (Form 18)" in r.json()["detail"]
    assert client.post(url, headers=hdr(w["welder"])).status_code == 403
    assert client.get(url, headers=hdr(w["officer"])).status_code == 200
