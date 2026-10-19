"""HR attendance & calendar: plant holidays, weekly offs from
Branch.working_days, self check-in/out, late marking against shift grace,
HR register rules, regularisation, monthly summary + CSV export, CSV
import, and the self-service vs HR-team access split."""
import csv
import io
import time as _time
from datetime import date, datetime, time

import pytest

from app.modules.hr.models.attendance import HrAttendance, HrAttendanceRegularization
from app.modules.hr.models.holiday import HrHoliday
from app.modules.hr.services.attendance import DayView, late_minutes, resolve_check_times, summarize
from app.modules.hr.services.calendar import IST, CalendarCache, parse_working_days
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

A = f"{HR}/attendance"
H = f"{HR}/holidays"

SELF_SERVICE_BUG = (
    "BUG: self-service gated by full-HR check — require_hr_module is applied router-wide in "
    "app/main.py (include_router(..., dependencies=[Depends(require_hr_module)])) so an employee "
    "without the 'hr' app gets 403 on My HR attendance/holiday endpoints that use get_current_user"
)

# SQLite drops tzinfo, so a stored IST check-in comes back naive and is
# re-read in the machine's local zone. Exact clock assertions through the
# API therefore only hold on an IST machine (Postgres keeps the offset).
LOCAL_IS_IST = _time.timezone == -19800
needs_ist = pytest.mark.skipif(not LOCAL_IS_IST, reason="SQLite naive datetimes are read back in local time")


@pytest.fixture
def org(db):
    plant = make_branch(db, "P1", "Mon-Sat")
    shift = make_shift(db, "GEN", time(9, 0), time(17, 30), grace=10)
    hr = make_user(db, "hr.desk@premnathrail.com", branch_id=plant.id)
    mgr = make_user(db, "shop.manager@premnathrail.com", branch_id=plant.id)
    emp = make_user(db, "fitter.one@premnathrail.com", branch_id=plant.id, reporting_manager_id=mgr.id)
    make_profile(db, emp, shift_id=shift.id, branch_id=plant.id, employee_code="E100")
    return {"plant": plant, "shift": shift, "hr": hr, "mgr": mgr, "emp": emp}


# ─────────────────────────── weekly offs / working days ───────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("Mon-Sat", {0, 1, 2, 3, 4, 5}),
    ("Mon–Fri", {0, 1, 2, 3, 4}),
    ("Monday to Saturday", {0, 1, 2, 3, 4, 5}),
    ("Mon, Tue, Wed, Thu, Fri, Sat", {0, 1, 2, 3, 4, 5}),
    ("Sat - Mon", {5, 6, 0}),             # wrap-around range
    ("Mon-Fri, Sat", {0, 1, 2, 3, 4, 5}),
    ("", {0, 1, 2, 3, 4, 5}),             # blank -> only Sunday off
    (None, {0, 1, 2, 3, 4, 5}),
    ("round the clock", {0, 1, 2, 3, 4, 5}),  # unparseable -> default
])
def test_parse_working_days(text, expected):
    assert parse_working_days(text) == frozenset(expected)


def test_weekly_off_comes_from_employee_plant(client, db, org):
    five = make_branch(db, "P5", "Mon-Fri")
    office = make_user(db, "office.staff@premnathrail.com", branch_id=five.id)
    # profile branch overrides User.branch_id
    moved = make_user(db, "moved.staff@premnathrail.com", branch_id=org["plant"].id)
    make_profile(db, moved, branch_id=five.id)
    cache = CalendarCache(db)
    sat = date(2026, 10, 10)
    assert cache.day_kind(cache.context(org["emp"]), sat) == ("working", None)
    assert cache.day_kind(cache.context(office), sat) == ("weekly_off", None)
    assert cache.day_kind(cache.context(moved), sat) == ("weekly_off", None)
    assert cache.day_kind(cache.context(org["emp"]), date(2026, 10, 11)) == ("weekly_off", None)


def test_month_view_marks_weekly_offs_and_holidays(client, db, org):
    db.add(HrHoliday(holiday_date=date(2026, 10, 2), name="Gandhi Jayanti", holiday_type="national", year=2026))
    db.commit()
    r = client.get(f"{A}/me/month", params={"year": 2026, "month": 10}, headers=hdr(org["emp"]))
    assert r.status_code == 200, r.text
    days = {d["date"]: d for d in r.json()["days"]}
    assert days["2026-10-02"]["status"] == "holiday" and days["2026-10-02"]["holiday_name"] == "Gandhi Jayanti"
    assert days["2026-10-04"]["status"] == "weekly_off" and days["2026-10-04"]["computed"] is True
    assert days["2026-10-03"]["status"] == "unmarked"      # past working Saturday, nothing recorded
    assert days["2026-10-20"]["status"] is None             # future working day
    assert r.json()["counts"]["weekly_off"] == 4


# ─────────────────────────── holidays per plant ───────────────────────────

def test_holidays_per_plant_listing_and_blocking(client, db, org):
    hr, plant = org["hr"], org["plant"]
    other = make_branch(db, "P2", "Mon-Sat")
    r = client.post(H, json={"holiday_date": "2026-10-20", "name": "Diwali", "holiday_type": "festival"}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert r.json()["year"] == 2026
    r = client.post(H, json={"holiday_date": "2026-10-21", "name": "P1 Foundation Day", "branch_id": plant.id}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    r = client.post(H, json={"holiday_date": "2026-10-22", "name": "P2 Local Fair", "branch_id": other.id}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    r = client.post(H, json={"holiday_date": "2026-10-23", "name": "Karva Chauth", "holiday_type": "restricted"}, headers=hdr(hr))
    assert r.status_code == 200, r.text

    # duplicate refused with a real reason
    r = client.post(H, json={"holiday_date": "2026-10-20", "name": "Diwali", "holiday_type": "festival"}, headers=hdr(hr))
    assert r.status_code == 409 and "already in the calendar" in r.json()["detail"]
    # unknown plant refused
    r = client.post(H, json={"holiday_date": "2026-10-24", "name": "Ghost", "branch_id": 9999}, headers=hdr(hr))
    assert r.status_code in (400, 404)

    names = lambda resp: sorted(h["name"] for h in resp.json())  # noqa: E731
    r = client.get(H, params={"year": 2026, "branch_id": plant.id}, headers=hdr(hr))
    assert names(r) == ["Diwali", "Karva Chauth", "P1 Foundation Day"]
    r = client.get(H, params={"year": 2026, "mine": True}, headers=hdr(org["emp"]))
    assert names(r) == ["Diwali", "Karva Chauth", "P1 Foundation Day"]
    r = client.get(H, params={"year": 2026, "only_all_plants": True}, headers=hdr(hr))
    assert names(r) == ["Diwali", "Karva Chauth"]

    cache = CalendarCache(db)
    ctx = cache.context(org["emp"])
    assert cache.day_kind(ctx, date(2026, 10, 20)) == ("holiday", "Diwali")
    assert cache.day_kind(ctx, date(2026, 10, 21)) == ("holiday", "P1 Foundation Day")
    assert cache.day_kind(ctx, date(2026, 10, 22)) == ("working", None)   # other plant's holiday
    assert cache.day_kind(ctx, date(2026, 10, 23)) == ("working", None)   # restricted = taken as leave


def test_inactive_holiday_does_not_block(client, db, org):
    db.add(HrHoliday(holiday_date=date(2026, 10, 20), name="Withdrawn", holiday_type="national", year=2026, is_active=False))
    db.commit()
    cache = CalendarCache(db)
    assert cache.day_kind(cache.context(org["emp"]), date(2026, 10, 20)) == ("working", None)


def test_holiday_management_needs_hr_app(client, db, org):
    outsider = make_user(db, "crm.user@premnathrail.com", apps=("crm",))
    r = client.post(H, json={"holiday_date": "2026-10-20", "name": "Diwali"}, headers=hdr(outsider))
    assert r.status_code == 403


@pytest.mark.xfail(reason=SELF_SERVICE_BUG, strict=True)
def test_employee_without_hr_app_can_view_own_holiday_calendar(client, db, org):
    plain = make_user(db, "plain.viewer@premnathrail.com", apps=("store",), branch_id=org["plant"].id)
    r = client.get(H, params={"year": 2026, "mine": True}, headers=hdr(plain))
    assert r.status_code == 200, r.text


# ─────────────────────────── late marking ───────────────────────────

class TestLateMarking:
    def _ci(self, hh, mm):
        return datetime.combine(TODAY, time(hh, mm)).replace(tzinfo=IST)

    def test_within_grace_is_on_time(self, db, org):
        assert late_minutes(self._ci(9, 0), org["shift"]) == 0
        assert late_minutes(self._ci(9, 10), org["shift"]) == 0
        assert late_minutes(self._ci(8, 40), org["shift"]) == 0

    def test_after_grace_counts_minutes_past_grace(self, db, org):
        assert late_minutes(self._ci(9, 11), org["shift"]) == 1
        assert late_minutes(self._ci(9, 45), org["shift"]) == 35

    def test_utc_timestamp_is_evaluated_in_ist(self, db, org):
        from datetime import timezone
        utc = datetime(2026, 10, 7, 4, 0, tzinfo=timezone.utc)  # 09:30 IST
        assert late_minutes(utc, org["shift"]) == 20

    def test_no_shift_or_no_checkin_is_not_late(self, db, org):
        assert late_minutes(self._ci(11, 0), None) is None
        assert late_minutes(None, org["shift"]) is None

    def test_summary_counts_late_days(self):
        days = [DayView(date=TODAY, status="present", computed=False, late_minutes=12),
                DayView(date=TODAY, status="present", computed=False, late_minutes=0),
                DayView(date=TODAY, status="half_day", computed=False, late_minutes=None)]
        s = summarize(days)
        assert s["late_days"] == 1 and s["present"] == 2 and s["present_equivalent"] == 2.5


# ─────────────────────────── self check-in / out ───────────────────────────

def test_self_check_in_and_out(client, db, org):
    emp = org["emp"]
    r = client.get(f"{A}/me/today", headers=hdr(emp))
    assert r.status_code == 200 and r.json()["can_check_in"] is True
    assert r.json()["shift"]["grace_minutes"] == 10

    r = client.post(f"{A}/me/check-in", json={}, headers=hdr(emp))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["day"]["status"] == "present" and body["day"]["source"] == "self"
    assert body["can_check_in"] is False and body["can_check_out"] is True
    row = db.query(HrAttendance).filter_by(user_id=emp.id, attendance_date=TODAY).one()
    assert row.shift_id == org["shift"].id and row.marked_by_id == emp.id

    r = client.post(f"{A}/me/check-in", json={}, headers=hdr(emp))
    assert r.status_code == 400 and "already checked in" in r.json()["detail"]

    r = client.post(f"{A}/me/check-out", json={"remarks": "Overtime"}, headers=hdr(emp))
    assert r.status_code == 200, r.text
    assert r.json()["can_check_out"] is False
    r = client.post(f"{A}/me/check-out", json={}, headers=hdr(emp))
    assert r.status_code == 400 and "already checked out" in r.json()["detail"]


@needs_ist
def test_self_check_in_after_grace_is_marked_late(client, db, org):
    """NOW is 09:20 IST, shift 09:00 + 10 min grace -> 10 minutes late."""
    r = client.post(f"{A}/me/check-in", json={}, headers=hdr(org["emp"]))
    assert r.status_code == 200, r.text
    assert r.json()["day"]["check_in_time"] == "09:20"
    assert r.json()["day"]["late_minutes"] == 10
    r = client.get(f"{A}/me/month", params={"year": 2026, "month": 10}, headers=hdr(org["emp"]))
    assert r.json()["counts"]["late_days"] == 1


def test_check_out_without_check_in_refused(client, db, org):
    r = client.post(f"{A}/me/check-out", json={}, headers=hdr(org["emp"]))
    assert r.status_code == 400 and "haven't checked in" in r.json()["detail"]


def test_check_in_refused_on_full_day_leave(client, db, org):
    db.add(HrAttendance(user_id=org["emp"].id, attendance_date=TODAY, status="on_leave", source="leave",
                        remarks="CL leave LV-2026-0001"))
    db.commit()
    r = client.post(f"{A}/me/check-in", json={}, headers=hdr(org["emp"]))
    assert r.status_code == 400 and "approved leave" in r.json()["detail"]


def test_check_in_on_weekly_off_is_annotated(client, db):
    # Plant works only Mon & Tue, so Wednesday TODAY is a weekly off.
    plant = make_branch(db, "PX", "Mon, Tue")
    u = make_user(db, "weekend.worker@premnathrail.com", branch_id=plant.id)
    r = client.post(f"{A}/me/check-in", json={}, headers=hdr(u))
    assert r.status_code == 200, r.text
    assert r.json()["day"]["remarks"] == "Worked on weekly off"


# ─────────────────────────── HR register ───────────────────────────

def test_hr_mark_rules(client, db, org):
    hr, emp = org["hr"], org["emp"]
    ok = client.put(f"{A}/entries", json={"user_id": emp.id, "attendance_date": "2026-10-05", "status": "present",
                                         "check_in": "09:30", "check_out": "18:00"}, headers=hdr(hr))
    assert ok.status_code == 200, ok.text
    assert ok.json()["source"] == "manual" and ok.json()["shift_id"] == org["shift"].id

    r = client.put(f"{A}/entries", json={"user_id": hr.id, "attendance_date": "2026-10-05", "status": "present"}, headers=hdr(hr))
    assert r.status_code == 403 and "your own attendance" in r.json()["detail"]
    r = client.put(f"{A}/entries", json={"user_id": emp.id, "attendance_date": "2026-10-06", "status": "on_leave"}, headers=hdr(hr))
    assert r.status_code == 400 and "leave request" in r.json()["detail"]
    r = client.put(f"{A}/entries", json={"user_id": emp.id, "attendance_date": "2026-10-20", "status": "present"}, headers=hdr(hr))
    assert r.status_code == 400 and "in the future" in r.json()["detail"]
    r = client.put(f"{A}/entries", json={"user_id": emp.id, "attendance_date": "2026-10-20", "status": "on_duty"}, headers=hdr(hr))
    assert r.status_code == 200
    r = client.put(f"{A}/entries", json={"user_id": emp.id, "attendance_date": "2026-10-06", "status": "present",
                                        "check_in": "18:00", "check_out": "09:00"}, headers=hdr(hr))
    assert r.status_code == 400 and "not after check-in" in r.json()["detail"]


def test_hr_cannot_overwrite_leave_day(client, db, org):
    row = HrAttendance(user_id=org["emp"].id, attendance_date=date(2026, 10, 6), status="on_leave", source="leave",
                       remarks="CL leave LV-2026-0007")
    db.add(row)
    db.commit()
    r = client.put(f"{A}/entries", json={"user_id": org["emp"].id, "attendance_date": "2026-10-06", "status": "absent"},
                   headers=hdr(org["hr"]))
    assert r.status_code == 409 and "approved leave" in r.json()["detail"]
    assert client.delete(f"{A}/entries/{row.id}", headers=hdr(org["hr"])).status_code == 409


def test_night_shift_check_out_rolls_to_next_day(db):
    night = type("S", (), {"is_night": True})()
    ci, co = resolve_check_times(date(2026, 10, 5), time(22, 0), time(6, 0), night)
    assert (co - ci).total_seconds() == 8 * 3600


def test_bulk_mark_skips_self_leave_and_existing(client, db, org):
    hr, emp, mgr = org["hr"], org["emp"], org["mgr"]
    other = make_user(db, "bulk.target@premnathrail.com", branch_id=org["plant"].id)
    db.add(HrAttendance(user_id=other.id, attendance_date=date(2026, 10, 5), status="on_leave", source="leave", remarks="CL"))
    db.commit()
    r = client.put(f"{A}/register/bulk", json={"attendance_date": "2026-10-05", "user_ids": [hr.id, emp.id, mgr.id, other.id, 999],
                                               "status": "present"}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 2
    assert {s["user_id"] for s in body["skipped"]} == {hr.id, other.id, 999}


# ─────────────────────────── regularisation ───────────────────────────

def test_regularisation_approve_writes_attendance(client, db, org):
    emp, mgr = org["emp"], org["mgr"]
    r = client.post(f"{A}/regularizations", json={"attendance_date": "2026-10-05", "requested_status": "present",
                                                  "check_in": "09:05", "check_out": "17:40",
                                                  "reason": "Biometric was down"}, headers=hdr(emp))
    assert r.status_code == 200, r.text
    reg = r.json()
    assert reg["status"] == "pending" and reg["approver_id"] == mgr.id and reg["request_no"].startswith("AR-2026-")

    dup = client.post(f"{A}/regularizations", json={"attendance_date": "2026-10-05", "requested_status": "present",
                                                    "check_in": "09:05", "reason": "again"}, headers=hdr(emp))
    assert dup.status_code == 409

    assert client.post(f"{A}/regularizations/{reg['id']}/approve", headers=hdr(emp)).status_code == 403  # own
    pend = client.get(f"{A}/regularizations/pending-for-me", headers=hdr(mgr)).json()
    assert [p["id"] for p in pend] == [reg["id"]]

    r = client.post(f"{A}/regularizations/{reg['id']}/approve", json={"remarks": "ok"}, headers=hdr(mgr))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["current_status"] == "present"
    row = db.query(HrAttendance).filter_by(user_id=emp.id, attendance_date=date(2026, 10, 5)).one()
    assert row.source == "regularization" and row.status == "present" and reg["request_no"] in row.remarks
    assert row.marked_by_id == mgr.id


def test_regularisation_validation(client, db, org):
    emp, mgr = org["emp"], org["mgr"]
    post = lambda **kw: client.post(f"{A}/regularizations", json={"reason": "Forgot to punch", **kw}, headers=hdr(emp))  # noqa: E731
    r = post(attendance_date="2026-10-09", requested_status="on_duty")
    assert r.status_code == 400 and "in the future" in r.json()["detail"]
    r = post(attendance_date="2026-07-01", requested_status="on_duty")
    assert r.status_code == 400 and "60 days" in r.json()["detail"]
    r = post(attendance_date="2026-10-05", requested_status="present")
    assert r.status_code == 400 and "checked in" in r.json()["detail"]

    rid = post(attendance_date="2026-10-06", requested_status="on_duty").json()["id"]
    r = client.post(f"{A}/regularizations/{rid}/reject", json={"remarks": ""}, headers=hdr(mgr))
    assert r.status_code == 400
    r = client.post(f"{A}/regularizations/{rid}/reject", json={"remarks": "You were absent"}, headers=hdr(mgr))
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert db.query(HrAttendance).filter_by(user_id=emp.id).count() == 0

    rid = post(attendance_date="2026-10-06", requested_status="on_duty").json()["id"]
    r = client.post(f"{A}/regularizations/{rid}/cancel", headers=hdr(emp))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


def test_regularisation_refused_on_leave_day(client, db, org):
    db.add(HrAttendance(user_id=org["emp"].id, attendance_date=date(2026, 10, 6), status="on_leave", source="leave", remarks="CL"))
    db.commit()
    r = client.post(f"{A}/regularizations", json={"attendance_date": "2026-10-06", "requested_status": "on_duty",
                                                  "reason": "Was at customer"}, headers=hdr(org["emp"]))
    assert r.status_code == 400 and "approved leave" in r.json()["detail"]


# ─────────────────────────── monthly summary + CSV ───────────────────────────

def _seed_october(client, db, org):
    hr, emp = org["hr"], org["emp"]
    db.add(HrHoliday(holiday_date=date(2026, 10, 2), name="Gandhi Jayanti", holiday_type="national", year=2026))
    db.commit()
    for d, st in (("2026-10-01", "present"), ("2026-10-05", "absent"), ("2026-10-06", "half_day")):
        r = client.put(f"{A}/entries", json={"user_id": emp.id, "attendance_date": d, "status": st}, headers=hdr(hr))
        assert r.status_code == 200, r.text


def test_monthly_summary_counts(client, db, org):
    _seed_october(client, db, org)
    r = client.get(f"{A}/summary", params={"year": 2026, "month": 10}, headers=hdr(org["hr"]))
    assert r.status_code == 200, r.text
    row = next(i for i in r.json()["items"] if i["user_id"] == org["emp"].id)
    assert row["employee_code"] == "E100"
    assert (row["present"], row["absent"], row["half_day"], row["holiday"], row["weekly_off"]) == (1, 1, 1, 1, 4)
    assert row["unmarked"] == 2            # Sat 3rd and today (Wed 7th)
    assert row["present_equivalent"] == 1.5


def test_monthly_summary_csv_export(client, db, org):
    _seed_october(client, db, org)
    r = client.get(f"{A}/summary/export", params={"year": 2026, "month": 10, "search": "fitter"}, headers=hdr(org["hr"]))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert 'filename="attendance_summary_2026_10.csv"' in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0][:5] == ["Employee", "Email", "Employee code", "Department", "Plant"]
    assert "Late Days" in rows[0] and "Present Equivalent" in rows[0]
    assert len(rows) == 2
    data = dict(zip(rows[0], rows[1]))
    assert data["Email"] == org["emp"].email and data["Plant"] == "Plant P1"
    assert data["Present"] == "1" and data["Absent"] == "1" and data["Weekly off"] == "4"
    assert data["Present Equivalent"] == "1.5"


def test_summary_rejects_bad_month(client, db, org):
    r = client.get(f"{A}/summary", params={"year": 2026, "month": 13}, headers=hdr(org["hr"]))
    assert r.status_code == 400 and "Month must be 1–12" in r.json()["detail"]


def test_csv_import_dry_run_then_apply(client, db, org):
    hr, emp = org["hr"], org["emp"]
    content = (
        "email,employee_code,date,status,check_in,check_out,remarks\n"
        f"{emp.email},,2026-10-05,P,09:05,17:45,\n"
        ",E100,06-10-2026,wfh,,,Home\n"
        ",E100,2026-10-20,present,,,future\n"
        f"{hr.email},,2026-10-05,present,,,self\n"
        "ghost@premnathrail.com,,2026-10-05,present,,,\n"
        f"{emp.email},,2026-10-05,absent,,,dup\n"
    ).encode()
    files = {"file": ("att.csv", content, "text/csv")}
    r = client.post(f"{A}/import", params={"dry_run": True}, files=files, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2 and len(r.json()["errors"]) == 4
    assert db.query(HrAttendance).count() == 0

    r = client.post(f"{A}/import", files={"file": ("att.csv", content, "text/csv")}, headers=hdr(hr))
    assert r.json()["created"] == 2
    rows = {a.attendance_date: a for a in db.query(HrAttendance).filter_by(user_id=emp.id).all()}
    assert rows[date(2026, 10, 5)].status == "present" and rows[date(2026, 10, 5)].source == "import"
    assert rows[date(2026, 10, 6)].status == "work_from_home"

    r = client.post(f"{A}/import", files={"file": ("att.xlsx", b"x", "application/octet-stream")}, headers=hdr(hr))
    assert r.status_code == 400 and "isn't a CSV" in r.json()["detail"]


# ─────────────────────────── access split ───────────────────────────

def test_hr_register_screens_need_hr_app(client, db, org):
    outsider = make_user(db, "quality.eng@premnathrail.com", apps=("quality",))
    for url in (f"{A}/register", f"{A}/summary", f"{A}/summary/export", f"{A}/lookups", f"{A}/regularizations"):
        assert client.get(url, headers=hdr(outsider)).status_code == 403, url
    r = client.put(f"{A}/entries", json={"user_id": org["emp"].id, "attendance_date": "2026-10-05", "status": "present"},
                   headers=hdr(outsider))
    assert r.status_code == 403


def test_employee_month_visibility_rules(client, db, org):
    emp, mgr = org["emp"], org["mgr"]
    peer = make_user(db, "peer.hr.app@premnathrail.com", apps=("hr",))
    assert client.get(f"{A}/month", params={"user_id": emp.id}, headers=hdr(mgr)).status_code == 200
    assert client.get(f"{A}/month", params={"user_id": 9999}, headers=hdr(peer)).status_code == 404


@pytest.mark.xfail(reason=SELF_SERVICE_BUG, strict=True)
def test_employee_without_hr_app_can_view_own_attendance(client, db, org):
    plain = make_user(db, "plain.worker@premnathrail.com", apps=("production",), branch_id=org["plant"].id)
    r = client.get(f"{A}/me/month", params={"year": 2026, "month": 10}, headers=hdr(plain))
    assert r.status_code == 200, r.text
    assert client.get(f"{A}/me/today", headers=hdr(plain)).status_code == 200


@pytest.mark.xfail(reason=SELF_SERVICE_BUG, strict=True)
def test_employee_without_hr_app_can_check_in(client, db, org):
    plain = make_user(db, "plain.puncher@premnathrail.com", apps=("production",), branch_id=org["plant"].id)
    r = client.post(f"{A}/me/check-in", json={}, headers=hdr(plain))
    assert r.status_code == 200, r.text


@pytest.mark.xfail(reason=SELF_SERVICE_BUG, strict=True)
def test_employee_without_hr_app_can_request_regularisation(client, db, org):
    plain = make_user(db, "plain.forgetful@premnathrail.com", apps=("store",), branch_id=org["plant"].id,
                      reporting_manager_id=org["mgr"].id)
    r = client.post(f"{A}/regularizations", json={"attendance_date": "2026-10-05", "requested_status": "on_duty",
                                                  "reason": "Customer visit"}, headers=hdr(plain))
    assert r.status_code == 200, r.text


@pytest.mark.xfail(reason=SELF_SERVICE_BUG + " (a manager without the hr app can't see a reportee's month)", strict=True)
def test_manager_without_hr_app_sees_reportee_month(client, db, org):
    boss = make_user(db, "plain.supervisor@premnathrail.com", apps=("production",))
    worker = make_user(db, "plain.reportee@premnathrail.com", apps=("production",), reporting_manager_id=boss.id)
    r = client.get(f"{A}/month", params={"user_id": worker.id}, headers=hdr(boss))
    assert r.status_code == 200, r.text
