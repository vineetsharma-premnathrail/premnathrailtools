"""HCM wave 2 (docs/erp-review/sap-gap-analysis.json "hcm"):

PA30 time-sliced org assignment · PA40 effective-dated actions (scheduled +
daily apply) · PT01 shift roster (patterns, weekly offs, upload; time
evaluation uses it) · biometric punch import → attendance with exceptions ·
attendance period lock before ADP export · statutory registers (Form 12 /
Form 25 / Form 14) · PR05 expense claim posting to Finance."""
import io
from datetime import date, datetime, time, timedelta
from decimal import Decimal

import pytest

from app.modules.hr.models.assignment import HrEmployeeAssignment
from app.modules.hr.models.attendance import HrAttendance
from app.modules.hr.models.expense import HrExpenseClaim, HrExpenseClaimItem
from app.modules.hr.models.lifecycle import HrLifecycleEvent
from app.modules.hr.models.roster import HrShiftRoster
from app.modules.hr.services import assignments as asg
from app.modules.hr.services.calendar import CalendarCache
from app.modules.organization.models.cost_center import CostCenter
from app.tests.test_cov_hr_support import *  # noqa: F401,F403
from app.tests.test_cov_hr_support import IST
from app.tests.test_accounts_finance import books  # noqa: F401 — fixture

ME = ["hr:me:view", "hr:me:create", "hr:me:edit"]
HR_ALL = ME + [
    "hr:employees:view", "hr:employees:create", "hr:employees:edit",
    "hr:attendance:view", "hr:attendance:create", "hr:attendance:edit", "hr:attendance:import", "hr:attendance:export",
    "hr:lifecycle:view", "hr:lifecycle:create", "hr:lifecycle:edit", "hr:lifecycle:approve",
    "hr:masters:view", "hr:masters:create", "hr:masters:edit",
    "hr:reports:view", "hr:reports:export", "hr:reports:print",
    "hr:approvals:view", "hr:approvals:approve",
]


@pytest.fixture(autouse=True)
def _freeze(monkeypatch):
    for t in ("app.modules.hr.services.assignments.today_ist", "app.modules.hr.routes.org_assignments.today_ist",
              "app.modules.hr.routes.attendance_periods.today_ist", "app.modules.hr.routes.registers.today_ist",
              "app.modules.hr.services.registers.today_ist", "app.modules.hr.services.time_evaluation.today_ist",
              "app.modules.hr.routes.time_evaluation.today_ist", "app.modules.hr.services.lifecycle._today",
              "app.tasks.hr_lifecycle_apply.today_ist", "app.modules.hr.services.expense_posting.today_ist"):
        monkeypatch.setattr(t, lambda: TODAY)
    yield


def _user(db, email, perms=ME, **kw):
    u = make_user(db, email, apps=(), **kw)
    u.granular_permissions = list(perms)
    db.commit()
    return u


@pytest.fixture
def org(db):
    p1 = make_branch(db, "P1", "Mon-Sat")
    p2 = make_branch(db, "P2", "Mon-Sat")
    eng = make_dept(db, "ENG", "Engineering", branch_id=p1.id)
    qa = make_dept(db, "QA", "Quality", branch_id=p1.id)
    gen = make_shift(db, "GEN", time(9, 0), time(17, 30))
    night = make_shift(db, "C", time(22, 0), time(6, 0), is_night=True)
    hr = _user(db, "w2.hr@premnathrail.com", HR_ALL, branch_id=p1.id)
    mgr = _user(db, "w2.mgr@premnathrail.com", branch_id=p1.id)
    emp = _user(db, "w2.emp@premnathrail.com", branch_id=p1.id, reporting_manager_id=mgr.id, date_of_joining=date(2025, 1, 6))
    make_profile(db, emp, shift_id=gen.id, branch_id=p1.id, department_id=eng.id, employee_code="E900", employment_type="permanent")
    partner = _user(db, "w2.partner@premnathrail.com", HR_ALL, is_partner=True)
    return {"p1": p1, "p2": p2, "eng": eng, "qa": qa, "gen": gen, "night": night, "hr": hr, "mgr": mgr, "emp": emp, "partner": partner}


# ─────────────────────────── PA30 time slices ───────────────────────────

def test_profile_edit_opens_new_slice_and_as_of_headcount(client, db, org):
    emp, hr = org["emp"], org["hr"]
    r = client.patch(f"{HR}/employees/{emp.id}", json={"department_id": org["qa"].id}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    hist = client.get(f"{HR}/org-assignments/{emp.id}", headers=hdr(hr)).json()["items"]
    assert len(hist) == 2
    new, old = hist
    assert new["department_id"] == org["qa"].id and new["valid_from"] == TODAY.isoformat() and new["valid_to"] is None
    assert old["department_id"] == org["eng"].id and old["valid_from"] == "2025-01-06"
    assert old["valid_to"] == (TODAY - timedelta(days=1)).isoformat()
    yday = client.get(f"{HR}/org-assignments/as-of", params={"date": (TODAY - timedelta(days=1)).isoformat(),
                                                           "department_id": org["eng"].id}, headers=hdr(hr)).json()
    assert [i["user_id"] for i in yday["items"]] == [emp.id]
    now = client.get(f"{HR}/org-assignments/as-of", params={"date": TODAY.isoformat(), "department_id": org["eng"].id},
                     headers=hdr(hr)).json()
    assert now["total"] == 0


def test_cost_center_must_belong_to_employee_plant(client, db, org):
    cc = CostCenter(code="CC-P2", name="P2 shop", branch_id=org["p2"].id, status="active")
    db.add(cc)
    db.commit()
    r = client.patch(f"{HR}/employees/{org['emp'].id}", json={"cost_center_id": cc.id}, headers=hdr(org["hr"]))
    assert r.status_code == 400 and "belongs to Plant P2" in r.json()["detail"]


def test_future_dated_change_is_pending_then_applied_by_daily_job(client, db, org):
    emp, hr = org["emp"], org["hr"]
    eff = TODAY + timedelta(days=10)
    r = client.post(f"{HR}/org-assignments/{emp.id}", json={"valid_from": eff.isoformat(), "branch_id": org["p2"].id,
                                                           "reason": "Plant 2 ramp-up"}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert r.json()["scheduled"] is True and r.json()["slice"]["pending"] is True
    db.expire_all()
    from app.modules.hr.models.employee_profile import HrEmployeeProfile
    prof = db.query(HrEmployeeProfile).filter_by(user_id=emp.id).one()
    assert prof.branch_id == org["p1"].id  # not yet
    done = asg.apply_due(db, eff)
    db.commit()
    db.refresh(prof)
    assert len(done) == 1 and prof.branch_id == org["p2"].id


# ─────────────────────────── PA40 scheduled transfer ───────────────────────────

def test_future_transfer_is_scheduled_and_applied_on_effective_date(client, db, org):
    emp, hr = org["emp"], org["hr"]
    eff = TODAY + timedelta(days=5)
    r = client.post(f"{HR}/lifecycle/events", json={"event_type": "transfer", "user_id": emp.id, "effective_date": eff.isoformat(),
                                                    "to_department_id": org["qa"].id}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    ev_id = r.json()["id"]
    r = client.post(f"{HR}/lifecycle/events/{ev_id}/complete", json={}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "scheduled"
    from app.modules.hr.models.employee_profile import HrEmployeeProfile
    assert db.query(HrEmployeeProfile).filter_by(user_id=emp.id).one().department_id == org["eng"].id
    # Completing again is refused with a real reason.
    again = client.post(f"{HR}/lifecycle/events/{ev_id}/complete", json={}, headers=hdr(hr))
    assert again.status_code == 409 and "Apply now" in again.json()["detail"]
    sched = client.get(f"{HR}/lifecycle/scheduled", headers=hdr(hr)).json()
    assert [e["id"] for e in sched["events"]] == [ev_id]

    from app.tasks.hr_lifecycle_apply import run_once
    assert run_once(db, TODAY)["applied"] == []          # not due yet
    out = run_once(db, eff)
    assert out["applied"] and not out["failed"]
    db.expire_all()
    ev = db.get(HrLifecycleEvent, ev_id)
    assert ev.status == "completed"
    assert db.query(HrEmployeeProfile).filter_by(user_id=emp.id).one().department_id == org["qa"].id
    s = db.query(HrEmployeeAssignment).filter_by(user_id=emp.id, valid_from=eff).one()
    assert s.department_id == org["qa"].id and s.source_event_id == ev_id


def test_apply_now_needs_reason_and_applies(client, db, org):
    emp, hr = org["emp"], org["hr"]
    eff = TODAY + timedelta(days=20)
    ev = client.post(f"{HR}/lifecycle/events", json={"event_type": "promotion", "user_id": emp.id, "effective_date": eff.isoformat(),
                                                     "to_department_id": org["qa"].id}, headers=hdr(hr)).json()
    client.post(f"{HR}/lifecycle/events/{ev['id']}/complete", json={}, headers=hdr(hr))
    assert client.post(f"{HR}/lifecycle/events/{ev['id']}/apply-now", json={"reason": ""}, headers=hdr(hr)).status_code == 422
    r = client.post(f"{HR}/lifecycle/events/{ev['id']}/apply-now", json={"reason": "Project start moved up"}, headers=hdr(hr))
    assert r.status_code == 200, r.text and r.json()["status"] == "completed"


# ─────────────────────────── PT01 roster ───────────────────────────

def test_roster_pattern_generate_weekly_off_and_time_evaluation(client, db, org):
    emp, hr = org["emp"], org["hr"]
    r = client.post(f"{HR}/roster/patterns", json={"code": "ROT", "name": "C shift, Wed off", "pattern": ["C", "C", "off"]},
                    headers=hdr(hr))
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    bad = client.post(f"{HR}/roster/patterns", json={"code": "BAD", "name": "x", "pattern": ["ZZ"]}, headers=hdr(hr))
    assert bad.status_code == 400 and "ZZ" in bad.json()["detail"]
    start = date(2026, 10, 5)  # Monday
    g = client.post(f"{HR}/roster/generate", json={"pattern_id": pid, "user_ids": [emp.id], "from_date": start.isoformat(),
                                                 "to_date": (start + timedelta(days=5)).isoformat()}, headers=hdr(hr))
    assert g.status_code == 200, g.text and g.json()["created"] == 6
    grid = client.get(f"{HR}/roster", params={"from": start.isoformat(), "to": (start + timedelta(days=5)).isoformat()},
                      headers=hdr(hr)).json()
    row = next(i for i in grid["items"] if i["user_id"] == emp.id)
    assert [d["shift_code"] for d in row["days"][:3]] == ["C", "C", None] and row["days"][2]["is_weekly_off"]
    cache = CalendarCache(db)
    ctx = cache.context(emp)
    assert cache.day_kind(ctx, start + timedelta(days=2))[0] == "weekly_off"   # Wednesday off by roster
    assert cache.shift_on(ctx, start).code == "C"
    # Time evaluation uses the rostered night shift: 22:05 → 06:00 is on time, not late vs GEN 09:00.
    db.add(HrAttendance(user_id=emp.id, attendance_date=start, status="present", source="manual",
                        check_in=datetime.combine(start, time(22, 5)).replace(tzinfo=IST),
                        check_out=datetime.combine(start + timedelta(days=1), time(6, 0)).replace(tzinfo=IST)))
    db.commit()
    te = client.get(f"{HR}/time-evaluation/employee/{emp.id}", params={"year": 2026, "month": 10}, headers=hdr(hr)).json()
    day = next(d for d in te["days"] if d["date"] == start.isoformat())
    assert day["shift_code"] == "C" and day["late_minutes"] == 0


def test_roster_csv_upload_and_self_block(client, db, org):
    hr, emp = org["hr"], org["emp"]
    csv_text = f"employee_code,email,date,shift,weekly_off\nE900,,12-10-2026,GEN,\nE900,,13-10-2026,,yes\n,{hr.email},14-10-2026,GEN,\n"
    r = client.post(f"{HR}/roster/import", files={"file": ("r.csv", csv_text, "text/csv")}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["saved"] == 2 and len(body["errors"]) == 1
    assert db.query(HrShiftRoster).filter_by(user_id=emp.id, roster_date=date(2026, 10, 13)).one().is_weekly_off


# ─────────────────────────── Punches ───────────────────────────

def test_punch_import_first_in_last_out_and_exceptions(client, db, org):
    emp, hr = org["emp"], org["hr"]
    db.add(HrAttendance(user_id=emp.id, attendance_date=date(2026, 10, 3), status="on_duty", source="manual"))
    db.commit()
    csv_text = ("employee_code,timestamp,direction,device_id\n"
                "E900,2026-10-01 08:58,in,G1\nE900,2026-10-01 08:59,in,G1\nE900,2026-10-01 13:00,out,G1\n"
                "E900,2026-10-01 13:30,in,G1\nE900,2026-10-01 17:45,out,G1\n"
                "E900,2026-10-02 09:02,in,G1\n"
                "E900,2026-10-03 09:00,in,G1\nE900,2026-10-03 18:00,out,G1\n"
                "E999,2026-10-01 09:00,in,G1\n")
    r = client.post(f"{HR}/punches/import", files={"file": ("p.csv", csv_text, "text/csv")}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["inserted"] == 8 and len(b["errors"]) == 1 and "E999" in b["errors"][0]["message"]
    d1 = db.query(HrAttendance).filter_by(user_id=emp.id, attendance_date=date(2026, 10, 1)).one()
    assert d1.status == "present" and d1.source == "import"
    assert d1.check_in.strftime("%H:%M") == "08:58" and d1.check_out.strftime("%H:%M") == "17:45"
    ex = {e["date"]: e["exceptions"] for e in b["exceptions"]}
    assert any("Duplicate" in x for x in ex["2026-10-01"])
    assert any("Missing OUT" in x for x in ex["2026-10-02"])
    assert any("doesn't overwrite" in x or "don't overwrite" in x for x in ex["2026-10-03"])
    assert db.query(HrAttendance).filter_by(user_id=emp.id, attendance_date=date(2026, 10, 3)).one().status == "on_duty"
    # Re-importing the same log = duplicates only.
    again = client.post(f"{HR}/punches/import", files={"file": ("p.csv", csv_text, "text/csv")}, headers=hdr(hr)).json()
    assert again["inserted"] == 0 and again["duplicates"] == 8


# ─────────────────────────── Period lock ───────────────────────────

def test_period_lock_blocks_writes_partner_unlock_and_adp_export(client, db, org):
    emp, hr, partner = org["emp"], org["hr"], org["partner"]
    ex = client.get(f"{HR}/attendance-periods/adp-export", params={"year": 2026, "month": 9}, headers=hdr(hr))
    assert ex.status_code == 409 and "Lock September 2026" in ex.json()["detail"]
    r = client.post(f"{HR}/attendance-periods/lock", json={"year": 2026, "month": 9}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    m = client.put(f"{HR}/attendance/entries", json={"user_id": emp.id, "attendance_date": "2026-09-10", "status": "absent"},
                   headers=hdr(hr))
    assert m.status_code == 409 and "September 2026 attendance for every plant is locked" in m.json()["detail"]
    imp = client.post(f"{HR}/attendance/import", files={"file": ("a.csv", "employee_code,date,status\nE900,2026-09-11,present\n", "text/csv")},
                      headers=hdr(hr)).json()
    assert imp["created"] == 0 and "locked for payroll" in imp["errors"][0]["message"]
    assert client.get(f"{HR}/attendance-periods/adp-export", params={"year": 2026, "month": 9}, headers=hdr(hr)).status_code == 200
    # October stays open.
    ok = client.put(f"{HR}/attendance/entries", json={"user_id": emp.id, "attendance_date": "2026-10-05", "status": "absent"},
                    headers=hdr(hr))
    assert ok.status_code == 200, ok.text
    no = client.post(f"{HR}/attendance-periods/{pid}/unlock", json={"reason": "late leave"}, headers=hdr(hr))
    assert no.status_code == 403 and "Partner" in no.json()["detail"]
    yes = client.post(f"{HR}/attendance-periods/{pid}/unlock", json={"reason": "Late leave approval"}, headers=hdr(partner))
    assert yes.status_code == 200 and yes.json()["status"] == "open" and len(yes.json()["history"]) == 2
    m2 = client.put(f"{HR}/attendance/entries", json={"user_id": emp.id, "attendance_date": "2026-09-10", "status": "absent"},
                    headers=hdr(hr))
    assert m2.status_code == 200, m2.text


def test_plant_lock_only_blocks_that_plant_and_roster(client, db, org):
    hr, emp = org["hr"], org["emp"]
    other = _user(db, "w2.p2@premnathrail.com", branch_id=org["p2"].id)
    make_profile(db, other, branch_id=org["p2"].id, employee_code="E901")
    client.post(f"{HR}/attendance-periods/lock", json={"year": 2026, "month": 10, "branch_id": org["p1"].id}, headers=hdr(hr))
    a = client.put(f"{HR}/roster/cells", json={"cells": [{"user_id": emp.id, "date": "2026-10-06", "shift_id": org["gen"].id}]},
                   headers=hdr(hr))
    assert a.status_code == 409 and "Plant P1" in a.json()["detail"]
    b = client.put(f"{HR}/roster/cells", json={"cells": [{"user_id": other.id, "date": "2026-10-06", "shift_id": org["gen"].id}]},
                   headers=hdr(hr))
    assert b.status_code == 200 and b.json()["saved"] == 1


# ─────────────────────────── Registers ───────────────────────────

def test_statutory_registers_generate_preview_and_xlsx(client, db, org):
    hr, emp = org["hr"], org["emp"]
    db.add(HrAttendance(user_id=emp.id, attendance_date=date(2026, 10, 1), status="present", source="manual"))
    db.add(HrAttendance(user_id=emp.id, attendance_date=date(2026, 10, 2), status="absent", source="manual"))
    db.commit()
    r = client.post(f"{HR}/registers", json={"register_type": "form25", "branch_id": org["p1"].id, "year": 2026, "month": 10},
                    headers=hdr(hr))
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    spec = client.get(f"{HR}/registers/{rid}/preview", headers=hdr(hr)).json()["spec"]
    assert spec["title"].startswith("FORM 25")
    first_half = spec["sections"][0]
    row = next(x for x in first_half["rows"] if "E900" in x[0])
    assert row[1] == "P" and row[2] == "A" and row[4] == "WO"   # 4-Oct-2026 is a Sunday
    x = client.get(f"{HR}/registers/{rid}/xlsx", headers=hdr(hr))
    assert x.status_code == 200 and x.content[:2] == b"PK"
    again = client.post(f"{HR}/registers", json={"register_type": "form25", "branch_id": org["p1"].id, "year": 2026, "month": 10},
                        headers=hdr(hr)).json()
    assert again["id"] == rid and again["revision"] == 1
    f12 = client.post(f"{HR}/registers", json={"register_type": "form12", "branch_id": org["p1"].id, "year": 2026},
                      headers=hdr(hr)).json()
    s12 = client.get(f"{HR}/registers/{f12['id']}/preview", headers=hdr(hr)).json()["spec"]
    assert any("E900" in r[2] for r in s12["sections"][0]["rows"])
    lr = client.post(f"{HR}/registers", json={"register_type": "leave_register", "branch_id": org["p1"].id, "year": 2026},
                     headers=hdr(hr))
    assert lr.status_code == 200
    # Registers need the Reports tab.
    nope = _user(db, "w2.nope@premnathrail.com", ["hr:attendance:view"])
    assert client.get(f"{HR}/registers", headers=hdr(nope)).status_code == 403


# ─────────────────────────── PR05 expense posting ───────────────────────────

def test_expense_claim_posts_on_approval_and_pays_by_voucher(books, client):
    from app.modules.accounts.models.account_group import AccountGroup
    from app.modules.accounts.models.gl_account import GLAccount
    from app.modules.accounts.models.settings import AccountDetermination
    from app.modules.accounts.services.balances import account_balance
    from app.modules.hr.services import expense_posting
    from app.tests.test_accounts_finance import _capital, _load_migration

    db = books["db"]
    mig = _load_migration("85d34135438d_hcm_assignments_roster_punches_period_lock")
    groups = {g.code: g for g in db.query(AccountGroup).all()}
    for code, name, gcode, role in mig.NEW_LEDGERS:
        db.add(GLAccount(code=code, name=name, account_type=groups[gcode].nature, group_id=groups[gcode].id,
                         is_posting_account=True, is_control_account=False, status="active"))
        db.add(AccountDetermination(role=role))
    db.commit()
    _capital(books)
    db.commit()
    emp = make_user(db, "w2.claimer@premnathrail.com", apps=("hr",))
    claim = HrExpenseClaim(claim_no="EXP-2026-0001", user_id=emp.id, title="Site visit", claim_date=date(2026, 10, 1),
                           total_amount=Decimal("1500"), status="approved")
    claim.items = [HrExpenseClaimItem(expense_date=date(2026, 10, 1), category="travel", amount=Decimal("1000")),
                   HrExpenseClaimItem(expense_date=date(2026, 10, 1), category="food", amount=Decimal("500"))]
    db.add(claim)
    db.commit()
    checker = books["checker"]
    expense_posting.post_on_approval(db, claim, checker)
    db.commit()
    assert claim.posted_je_id and claim.posting_error is None
    gl = {a.code: a for a in db.query(GLAccount).all()}
    assert account_balance(db, gl["5250"].id, date(2026, 10, 31)) == pytest.approx(1000)
    assert account_balance(db, gl["2085"].id, date(2026, 10, 31)) == pytest.approx(-1500)
    # Legacy "mark paid" is refused once posted — the payable must be cleared by a voucher.
    checker.granular_permissions = ["accounts:payments:view", "accounts:payments:create"]
    db.commit()
    pay = client.post(f"/api/v1/accounts/hr-claims/{claim.id}/pay",
                      json={"bank_account_id": books["bank"].id, "payment_mode": "neft", "paid_on": "2026-10-07"}, headers=hdr(checker))
    assert pay.status_code == 200, pay.text
    out = pay.json()
    assert out["status"] == "paid" and out["payment_voucher_number"].startswith("PV/")
    assert account_balance(db, gl["2085"].id, date(2026, 10, 31)) == pytest.approx(0)


def test_expense_posting_failure_keeps_claim_approved_with_reason(db):
    from app.modules.hr.services import expense_posting

    emp = make_user(db, "w2.c2@premnathrail.com")
    actor = make_user(db, "w2.a2@premnathrail.com")
    claim = HrExpenseClaim(claim_no="EXP-2026-0002", user_id=emp.id, title="x", claim_date=date(2026, 10, 1),
                           total_amount=Decimal("100"), status="approved")
    claim.items = [HrExpenseClaimItem(expense_date=date(2026, 10, 1), category="phone", amount=Decimal("100"))]
    db.add(claim)
    db.commit()
    expense_posting.post_on_approval(db, claim, actor)
    assert claim.status == "approved" and claim.posted_je_id is None
    assert "Ledger Settings" in (claim.posting_error or "")
