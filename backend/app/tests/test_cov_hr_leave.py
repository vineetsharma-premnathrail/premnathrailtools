"""HR leave: yearly allotment (pro-rating, carry-forward, gender rules),
balance adjustment, apply / approve / reject / cancel with attendance
write-back, day counting (weekly offs, plant holidays, half days, the
"sandwich" question) and the self-service vs HR-team access split."""
from datetime import date

import pytest

from app.modules.hr.models.attendance import HrAttendance
from app.modules.hr.models.holiday import HrHoliday
from app.modules.hr.models.leave import HrLeaveBalance, HrLeaveRequest
from app.modules.hr.services.calendar import CalendarCache
from app.modules.hr.services.leave import _prorated_quota, count_leave_days
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

L = f"{HR}/leave"

SELF_SERVICE_BUG = (
    "BUG: self-service gated by full-HR check — require_hr_module is applied router-wide in "
    "app/main.py (include_router(..., dependencies=[Depends(require_hr_module)])) so an employee "
    "without the 'hr' app gets 403 on My HR endpoints that use get_current_user"
)


@pytest.fixture
def org(db):
    """Plant working Mon-Sat; HR user, a manager and an employee reporting to them."""
    plant = make_branch(db, "P1", "Mon-Sat")
    hr = make_user(db, "hr.admin@premnathrail.com", apps=("hr",))
    mgr = make_user(db, "line.manager@premnathrail.com", apps=("hr",), branch_id=plant.id)
    emp = make_user(db, "emp.one@premnathrail.com", apps=("hr",), branch_id=plant.id, reporting_manager_id=mgr.id)
    cl = make_leave_type(db, "CL", "Casual Leave", 12)
    make_balance(db, emp, cl, 2026, allotted=10)
    return {"plant": plant, "hr": hr, "mgr": mgr, "emp": emp, "cl": cl}


def apply(client, user, lt, start, end, fs="full", ts="full", reason="Family function", **extra):
    data = {"leave_type_id": str(lt.id), "from_date": start.isoformat(), "to_date": end.isoformat(),
            "from_session": fs, "to_session": ts, "reason": reason}
    data.update({k: str(v) for k, v in extra.items()})
    return client.post(f"{L}/requests", data=data, headers=hdr(user))


def preview(client, user, lt, start, end, fs="full", ts="full"):
    r = client.post(f"{L}/requests/preview", json={
        "leave_type_id": lt.id, "from_date": start.isoformat(), "to_date": end.isoformat(),
        "from_session": fs, "to_session": ts}, headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def bal(db, user, lt, year=2026):
    db.expire_all()
    return db.query(HrLeaveBalance).filter_by(user_id=user.id, leave_type_id=lt.id, year=year).one()


# ─────────────────────────── allotment ───────────────────────────

class TestProrating:
    @pytest.mark.parametrize("doj,quota,expected", [
        (None, 12, 12),                       # no DOJ -> full quota
        (date(2025, 7, 1), 12, 12),           # joined an earlier year -> full quota
        (date(2026, 3, 10), 12, 10),          # joined by the 15th: joining month counts (10 months)
        (date(2026, 3, 20), 12, 9),           # joined after the 15th: joining month skipped (9 months)
        (date(2026, 2, 10), 15, 13.5),        # 15*11/12 = 13.75 -> floored to the half day
        (date(2026, 12, 31), 12, 0),          # joined after the 15th of December -> nothing this year
    ])
    def test_prorated_quota(self, doj, quota, expected):
        assert _prorated_quota(Decimal(quota), doj, 2026) == Decimal(str(expected))

    def test_joiner_after_year_is_skipped(self):
        assert _prorated_quota(Decimal(12), date(2027, 1, 5), 2026) is None


def test_allot_year_prorates_joiners_and_is_idempotent(client, db):
    hr = make_user(db, "hr.allot@premnathrail.com")
    old = make_user(db, "old.timer@premnathrail.com", date_of_joining=date(2020, 1, 1))
    mid = make_user(db, "mid.year@premnathrail.com", date_of_joining=date(2026, 3, 20))
    future = make_user(db, "future.joiner@premnathrail.com", date_of_joining=date(2027, 2, 1))
    cl = make_leave_type(db, "CL", "Casual Leave", 12)

    r = client.post(f"{L}/balances/allot", json={"year": 2026}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["leave_types"] == ["CL"]
    assert s["skipped_not_joined"] == 1
    assert s["created"] == 3  # hr, old, mid
    assert bal(db, old, cl).allotted == Decimal("12")
    assert bal(db, mid, cl).allotted == Decimal("9")
    assert db.query(HrLeaveBalance).filter_by(user_id=future.id).count() == 0

    # Usage is never touched by a re-run.
    b = bal(db, mid, cl)
    b.used = Decimal("2")
    db.commit()
    r = client.post(f"{L}/balances/allot", json={"year": 2026}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 0 and r.json()["updated"] == 0 and r.json()["unchanged"] == 3
    assert bal(db, mid, cl).used == Decimal("2")

    # Without pro-rating everyone gets the full quota.
    r = client.post(f"{L}/balances/allot", json={"year": 2026, "prorate_joiners": False}, headers=hdr(hr))
    assert r.json()["updated"] == 1
    assert bal(db, mid, cl).allotted == Decimal("12")


def test_allot_carry_forward_capped_at_max(client, db):
    hr = make_user(db, "hr.cf@premnathrail.com")
    big = make_user(db, "big.saver@premnathrail.com")
    small = make_user(db, "small.saver@premnathrail.com")
    none = make_user(db, "no.history@premnathrail.com")
    el = make_leave_type(db, "EL", "Earned Leave", 15, carry_forward=True, max_carry_forward=Decimal("5"))
    make_balance(db, big, el, 2025, allotted=15, used=7)    # 8 left -> capped at 5
    make_balance(db, small, el, 2025, allotted=15, used=12)  # 3 left -> 3
    make_balance(db, hr, el, 2025, allotted=15, used=15)    # 0 left -> 0

    r = client.post(f"{L}/balances/allot", json={"year": 2026}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert bal(db, big, el).opening == Decimal("5")
    assert bal(db, small, el).opening == Decimal("3")
    assert bal(db, none, el).opening == Decimal("0")
    assert bal(db, hr, el).opening == Decimal("0")
    assert bal(db, big, el).available == Decimal("20")

    # Previous year changes -> re-run refreshes the carried amount.
    prev = db.query(HrLeaveBalance).filter_by(user_id=small.id, year=2025).one()
    prev.used = Decimal("11")
    db.commit()
    client.post(f"{L}/balances/allot", json={"year": 2026}, headers=hdr(hr))
    assert bal(db, small, el).opening == Decimal("4")


def test_allot_skips_gender_restricted_types(client, db):
    hr = make_user(db, "hr.gender@premnathrail.com")
    woman = make_user(db, "she.emp@premnathrail.com")
    man = make_user(db, "he.emp@premnathrail.com")
    make_profile(db, woman, gender="Female")
    make_profile(db, man, gender="male")
    ml = make_leave_type(db, "ML", "Maternity Leave", 182, gender_restriction="female")
    r = client.post(f"{L}/balances/allot", json={"year": 2026}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert bal(db, woman, ml).allotted == Decimal("182")
    assert db.query(HrLeaveBalance).filter_by(user_id=man.id).count() == 0
    assert r.json()["skipped_gender"] == 2  # man + hr (no gender recorded)


def test_allot_without_active_types_explains(client, db):
    hr = make_user(db, "hr.none@premnathrail.com")
    r = client.post(f"{L}/balances/allot", json={"year": 2026}, headers=hdr(hr))
    assert r.status_code == 400
    assert "Leave Types" in r.json()["detail"]


def test_adjust_balance_rules(client, db, org):
    hr, emp, cl = org["hr"], org["emp"], org["cl"]
    r = client.post(f"{L}/balances/adjust", json={"user_id": emp.id, "leave_type_id": cl.id, "year": 2026,
                                                  "delta": 1.5, "reason": "Comp-off for Sunday work"}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    assert bal(db, emp, cl).available == Decimal("11.5")

    r = client.post(f"{L}/balances/adjust", json={"user_id": emp.id, "leave_type_id": cl.id, "year": 2026,
                                                  "delta": -20, "reason": "Recovery"}, headers=hdr(hr))
    assert r.status_code == 400 and "negative" in r.json()["detail"]

    r = client.post(f"{L}/balances/adjust", json={"user_id": hr.id, "leave_type_id": cl.id, "year": 2026,
                                                  "delta": 2, "reason": "Self bonus"}, headers=hdr(hr))
    assert r.status_code == 403

    r = client.post(f"{L}/balances/adjust", json={"user_id": emp.id, "leave_type_id": cl.id, "year": 2026,
                                                  "delta": 0.3, "reason": "Odd step"}, headers=hdr(hr))
    assert r.status_code == 422


# ─────────────────────────── apply / approve / reject ───────────────────────────

def test_apply_approve_writes_attendance_and_deducts_balance(client, db, org):
    emp, mgr, cl = org["emp"], org["mgr"], org["cl"]
    r = apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 4))  # Mon-Wed
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["status"] == "pending"
    assert Decimal(str(req["days"])) == Decimal("3")
    assert req["approver_id"] == mgr.id
    assert req["request_no"].startswith("LV-2026-")

    pend = client.get(f"{L}/requests/pending-for-me", headers=hdr(mgr)).json()
    assert [p["id"] for p in pend] == [req["id"]]
    assert pend[0]["can_decide"] is True

    r = client.post(f"{L}/requests/{req['id']}/approve", json={"remarks": "Enjoy"}, headers=hdr(mgr))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["decided_by_id"] == mgr.id
    assert bal(db, emp, cl).used == Decimal("3")

    rows = db.query(HrAttendance).filter_by(user_id=emp.id).order_by(HrAttendance.attendance_date).all()
    assert [r.attendance_date for r in rows] == [date(2026, 11, 2), date(2026, 11, 3), date(2026, 11, 4)]
    assert {r.status for r in rows} == {"on_leave"} and {r.source for r in rows} == {"leave"}
    assert req["request_no"] in rows[0].remarks

    # Approving twice is refused.
    r = client.post(f"{L}/requests/{req['id']}/approve", headers=hdr(mgr))
    assert r.status_code == 400 and "already approved" in r.json()["detail"]


def test_half_day_leave_writes_half_day_attendance(client, db, org):
    emp, mgr, cl = org["emp"], org["mgr"], org["cl"]
    r = apply(client, emp, cl, date(2026, 11, 5), date(2026, 11, 5), fs="first_half", ts="first_half")
    assert r.status_code == 200, r.text
    assert Decimal(str(r.json()["days"])) == Decimal("0.5")
    client.post(f"{L}/requests/{r.json()['id']}/approve", headers=hdr(mgr))
    row = db.query(HrAttendance).filter_by(user_id=emp.id, attendance_date=date(2026, 11, 5)).one()
    assert row.status == "half_day" and "(half day)" in row.remarks
    assert bal(db, emp, cl).used == Decimal("0.5")


def test_single_day_half_session_in_to_session_deducts_half(client, db, org):
    """from_session 'full' + to_session 'second_half' on one day counts 0.5 at
    apply; approval must recount the same 0.5 (it used to store 'full' and
    deduct a whole day)."""
    emp, mgr, cl = org["emp"], org["mgr"], org["cl"]
    r = apply(client, emp, cl, date(2026, 11, 6), date(2026, 11, 6), fs="full", ts="second_half")
    assert r.status_code == 200, r.text
    assert Decimal(str(r.json()["days"])) == Decimal("0.5")
    assert r.json()["from_session"] == r.json()["to_session"] == "second_half"
    r = client.post(f"{L}/requests/{r.json()['id']}/approve", headers=hdr(mgr))
    assert r.status_code == 200, r.text
    assert Decimal(str(r.json()["days"])) == Decimal("0.5")
    assert bal(db, emp, cl).used == Decimal("0.5")


def test_multi_day_starting_with_first_half_rejected(client, db, org):
    r = apply(client, org["emp"], org["cl"], date(2026, 11, 2), date(2026, 11, 3), fs="first_half")
    assert r.status_code == 400
    assert "can't start with only the first half" in r.json()["detail"]


def test_reject_needs_reason_and_leaves_balance(client, db, org):
    emp, mgr, cl = org["emp"], org["mgr"], org["cl"]
    rid = apply(client, emp, cl, date(2026, 11, 10), date(2026, 11, 10)).json()["id"]
    r = client.post(f"{L}/requests/{rid}/reject", json={"remarks": "  "}, headers=hdr(mgr))
    assert r.status_code == 400
    r = client.post(f"{L}/requests/{rid}/reject", json={"remarks": "Audit week"}, headers=hdr(mgr))
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert bal(db, emp, cl).used == Decimal("0")
    assert db.query(HrAttendance).filter_by(user_id=emp.id).count() == 0


def test_nobody_decides_own_leave_even_hr(client, db, org):
    hr, cl = org["hr"], org["cl"]
    make_balance(db, hr, cl, 2026, allotted=5)
    rid = apply(client, hr, cl, date(2026, 11, 10), date(2026, 11, 10)).json()["id"]
    r = client.post(f"{L}/requests/{rid}/approve", headers=hdr(hr))
    assert r.status_code == 403 and "your own" in r.json()["detail"]


def test_apply_needs_reason_balance_and_no_overlap(client, db, org):
    emp, cl = org["emp"], org["cl"]
    r = apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 2), reason=" ")
    assert r.status_code == 400 and "reason" in r.json()["detail"]

    r = apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 14))  # 12 working days > 10
    assert r.status_code == 400 and "balance is 10 days" in r.json()["detail"]

    assert apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 6)).status_code == 200  # 5 days pending
    r = apply(client, emp, cl, date(2026, 11, 16), date(2026, 11, 21))  # 6 more > 10 - 5 pending
    assert r.status_code == 400 and "pending requests" in r.json()["detail"]

    r = apply(client, emp, cl, date(2026, 11, 4), date(2026, 11, 4))
    assert r.status_code == 400 and "overlap" in r.json()["detail"]


def test_no_balance_allotted_and_unpaid_leave(client, db, org):
    emp = org["emp"]
    sl = make_leave_type(db, "SL", "Sick Leave", 6)
    r = apply(client, emp, sl, date(2026, 11, 2), date(2026, 11, 2))
    assert r.status_code == 400 and "No Sick Leave balance" in r.json()["detail"]
    lwp = make_leave_type(db, "LWP", "Leave Without Pay", 0, is_paid=False)
    r = apply(client, emp, lwp, date(2026, 11, 2), date(2026, 11, 3))
    assert r.status_code == 200, r.text


def test_cross_year_leave_refused(client, db, org):
    r = apply(client, org["emp"], org["cl"], date(2026, 12, 30), date(2027, 1, 2))
    assert r.status_code == 400 and "per calendar year" in r.json()["detail"]


def test_cancel_approved_future_leave_restores_balance_and_attendance(client, db, org):
    emp, mgr, cl = org["emp"], org["mgr"], org["cl"]
    rid = apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 3)).json()["id"]
    client.post(f"{L}/requests/{rid}/approve", headers=hdr(mgr))
    assert bal(db, emp, cl).used == Decimal("2")
    r = client.post(f"{L}/requests/{rid}/cancel", json={"remarks": "Plans changed"}, headers=hdr(emp))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    assert bal(db, emp, cl).used == Decimal("0")
    assert db.query(HrAttendance).filter_by(user_id=emp.id).count() == 0


def test_cancel_started_approved_leave_refused(client, db, org):
    emp, cl = org["emp"], org["cl"]
    req = HrLeaveRequest(request_no="LV-2026-0900", user_id=emp.id, leave_type_id=cl.id,
                         from_date=date(2026, 10, 5), to_date=date(2026, 10, 8), days=Decimal("4"), status="approved")
    db.add(req)
    db.commit()
    r = client.post(f"{L}/requests/{req.id}/cancel", headers=hdr(emp))
    assert r.status_code == 400 and "no longer be cancelled" in r.json()["detail"]


def test_approve_refused_when_attendance_shows_worked(client, db, org):
    emp, mgr, cl = org["emp"], org["mgr"], org["cl"]
    rid = apply(client, emp, cl, date(2026, 10, 12), date(2026, 10, 13)).json()["id"]
    db.add(HrAttendance(user_id=emp.id, attendance_date=date(2026, 10, 13), status="present", source="manual"))
    db.commit()
    r = client.post(f"{L}/requests/{rid}/approve", headers=hdr(mgr))
    assert r.status_code == 409 and "13-10-2026" in r.json()["detail"]
    assert bal(db, emp, cl).used == Decimal("0")


def test_holiday_added_after_apply_is_recounted_on_approval(client, db, org):
    emp, mgr, cl, plant = org["emp"], org["mgr"], org["cl"], org["plant"]
    rid = apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 4)).json()["id"]
    db.add(HrHoliday(holiday_date=date(2026, 11, 3), name="Plant foundation day", holiday_type="festival",
                     branch_id=plant.id, year=2026))
    db.commit()
    r = client.post(f"{L}/requests/{rid}/approve", headers=hdr(mgr))
    assert r.status_code == 200, r.text
    assert Decimal(str(r.json()["days"])) == Decimal("2")
    assert bal(db, emp, cl).used == Decimal("2")
    assert db.query(HrAttendance).filter_by(user_id=emp.id, attendance_date=date(2026, 11, 3)).count() == 0


# ─────────────────────────── day counting / sandwich ───────────────────────────

def set_sandwich(client, user, on: bool):
    r = client.put(f"{HR}/settings", json={"values": {"leave_sandwich_rule": on}}, headers=hdr(user))
    assert r.status_code == 200, r.text
    assert r.json()["values"]["leave_sandwich_rule"] is on


class TestSandwichRule:
    """Policy in app/modules/hr/services/leave.py: with the HR setting
    `leave_sandwich_rule` OFF (the default) only working days count — weekly
    offs and plant holidays that fall INSIDE a leave are never charged.
    The tests in this class run with the setting at its default (OFF)."""

    def test_setting_defaults_off(self, client, db, org):
        r = client.get(f"{HR}/settings", headers=hdr(org["hr"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["values"]["leave_sandwich_rule"] is False
        assert body["is_default"]["leave_sandwich_rule"] is True
        assert [g["label"] for g in body["groups"]][0] == "Leave"

    def test_weekend_between_leave_days_not_charged_mon_fri_plant(self, client, db):
        plant = make_branch(db, "P5", "Mon-Fri")
        emp = make_user(db, "five.day@premnathrail.com", branch_id=plant.id)
        cl = make_leave_type(db, "CL", "Casual Leave", 12)
        make_balance(db, emp, cl)
        p = preview(client, emp, cl, date(2026, 11, 6), date(2026, 11, 9))  # Fri..Mon
        assert Decimal(str(p["days"])) == Decimal("2")
        kinds = {x["date"]: (x["kind"], Decimal(str(x["portion"]))) for x in p["breakdown"]}
        assert kinds["2026-11-07"] == ("weekly_off", Decimal("0"))
        assert kinds["2026-11-08"] == ("weekly_off", Decimal("0"))
        assert p["errors"] == []

    def test_saturday_is_charged_on_mon_sat_plant(self, client, db, org):
        p = preview(client, org["emp"], org["cl"], date(2026, 11, 6), date(2026, 11, 9))
        assert Decimal(str(p["days"])) == Decimal("3")

    def test_holiday_inside_leave_not_charged_only_for_that_plant(self, client, db, org):
        other = make_branch(db, "P2", "Mon-Sat")
        db.add_all([
            HrHoliday(holiday_date=date(2026, 11, 3), name="All plants holiday", holiday_type="national", year=2026),
            HrHoliday(holiday_date=date(2026, 11, 4), name="P2 local holiday", holiday_type="festival",
                      branch_id=other.id, year=2026),
            HrHoliday(holiday_date=date(2026, 11, 5), name="Optional festival", holiday_type="restricted", year=2026),
        ])
        db.commit()
        p = preview(client, org["emp"], org["cl"], date(2026, 11, 2), date(2026, 11, 5))
        # 3rd all-plant holiday skipped; P2's holiday and restricted holiday still count.
        assert Decimal(str(p["days"])) == Decimal("3")
        h = [x for x in p["breakdown"] if x["kind"] == "holiday"]
        assert [x["holiday_name"] for x in h] == ["All plants holiday"]

    def test_only_offs_and_holidays_cannot_be_applied(self, client, db, org):
        r = apply(client, org["emp"], org["cl"], date(2026, 11, 8), date(2026, 11, 8))  # Sunday
        assert r.status_code == 400 and "weekly off or a plant holiday" in r.json()["detail"]


class TestSandwichRuleOn:
    """`leave_sandwich_rule` ON: offs/holidays BETWEEN two leave days of the
    same request are charged; offs/holidays at either edge are not."""

    @pytest.fixture
    def admin(self, db):
        return make_user(db, "it.admin@premnathrail.com", role="admin")

    def test_only_admin_or_explicit_grant_can_edit(self, client, db, org, admin):
        # An HR-app user without the explicit hr:settings:edit grant can read but not edit.
        r = client.put(f"{HR}/settings", json={"values": {"leave_sandwich_rule": True}}, headers=hdr(org["emp"]))
        assert r.status_code == 403 and "Settings" in r.json()["detail"]
        r = client.post(f"{HR}/settings/reset/leave_sandwich_rule", headers=hdr(org["hr"]))
        assert r.status_code == 403
        granted = make_user(db, "hr.head@premnathrail.com",
                            granular_permissions=["hr:settings:view", "hr:settings:edit"])
        set_sandwich(client, granted, True)
        r = client.post(f"{HR}/settings/reset/leave_sandwich_rule", headers=hdr(admin))
        assert r.status_code == 200 and r.json()["values"]["leave_sandwich_rule"] is False

    def test_weekend_between_leave_days_charged(self, client, db, admin):
        plant = make_branch(db, "P6", "Mon-Fri")
        emp = make_user(db, "sandwich.on@premnathrail.com", branch_id=plant.id)
        cl = make_leave_type(db, "CL", "Casual Leave", 12)
        make_balance(db, emp, cl)
        set_sandwich(client, admin, True)
        p = preview(client, emp, cl, date(2026, 11, 6), date(2026, 11, 9))  # Fri..Mon
        assert Decimal(str(p["days"])) == Decimal("4")
        kinds = {x["date"]: (x["kind"], Decimal(str(x["portion"]))) for x in p["breakdown"]}
        assert kinds["2026-11-07"] == ("weekly_off", Decimal("1"))
        assert kinds["2026-11-08"] == ("weekly_off", Decimal("1"))
        # Offs at the edges are never charged: Sat..Mon = Monday only.
        p = preview(client, emp, cl, date(2026, 11, 7), date(2026, 11, 9))
        assert Decimal(str(p["days"])) == Decimal("1")
        # Fri..Sun = Friday only.
        p = preview(client, emp, cl, date(2026, 11, 6), date(2026, 11, 8))
        assert Decimal(str(p["days"])) == Decimal("1")

    def test_holiday_between_leave_days_charged(self, client, db, org, admin):
        db.add(HrHoliday(holiday_date=date(2026, 11, 3), name="All plants holiday", holiday_type="national", year=2026))
        db.commit()
        set_sandwich(client, admin, True)
        p = preview(client, org["emp"], org["cl"], date(2026, 11, 2), date(2026, 11, 4))
        assert Decimal(str(p["days"])) == Decimal("3")

    def test_approval_recount_uses_setting(self, client, db, admin):
        plant = make_branch(db, "P7", "Mon-Fri")
        mgr = make_user(db, "sandwich.mgr@premnathrail.com", branch_id=plant.id)
        emp = make_user(db, "sandwich.emp@premnathrail.com", branch_id=plant.id, reporting_manager_id=mgr.id)
        cl = make_leave_type(db, "CL", "Casual Leave", 12)
        make_balance(db, emp, cl, allotted=10)
        r = apply(client, emp, cl, date(2026, 11, 6), date(2026, 11, 9))  # applied with the rule OFF
        assert r.status_code in (200, 201), r.text
        assert Decimal(str(r.json()["days"])) == Decimal("2")
        set_sandwich(client, admin, True)
        r = client.post(f"{L}/requests/{r.json()['id']}/approve", headers=hdr(mgr))
        assert r.status_code == 200, r.text
        assert Decimal(str(r.json()["days"])) == Decimal("4")
        assert bal(db, emp, cl).used == Decimal("4")
        sat = db.query(HrAttendance).filter_by(user_id=emp.id, attendance_date=date(2026, 11, 7)).one()
        assert sat.status == "on_leave"


def test_count_leave_days_sandwich_unit(db):
    plant = make_branch(db, "PS", "Mon-Fri")
    u = make_user(db, "unit.sandwich@premnathrail.com", branch_id=plant.id)
    cache = CalendarCache(db)
    ctx = cache.context(u)
    days, breakdown, errs = count_leave_days(
        cache, ctx, date(2026, 11, 6), date(2026, 11, 10), "second_half", "first_half", sandwich=True)
    # Fri 0.5 + Sat 1 + Sun 1 + Mon 1 + Tue 0.5
    assert errs == [] and days == Decimal("4")
    assert [p.portion for p in breakdown] == [Decimal("0.5"), 1, 1, Decimal("1"), Decimal("0.5")]


def test_count_leave_days_unit(db):
    plant = make_branch(db, "PU", "Mon-Fri")
    u = make_user(db, "unit.count@premnathrail.com", branch_id=plant.id)
    cache = CalendarCache(db)
    ctx = cache.context(u)
    days, breakdown, errs = count_leave_days(cache, ctx, date(2026, 11, 6), date(2026, 11, 10), "second_half", "first_half")
    # Fri 0.5 + Sat/Sun 0 + Mon 1 + Tue 0.5
    assert errs == [] and days == Decimal("2")
    assert [p.portion for p in breakdown] == [Decimal("0.5"), 0, 0, Decimal("1"), Decimal("0.5")]
    _, _, errs = count_leave_days(cache, ctx, date(2026, 11, 10), date(2026, 11, 6), "full", "full")
    assert errs and "before the 'from' date" in errs[0]


def test_leave_type_rules_document_and_max_stretch(client, db, org):
    emp = org["emp"]
    sl = make_leave_type(db, "SL", "Sick Leave", 12, requires_document_after_days=2, max_consecutive_days=3)
    make_balance(db, emp, sl, allotted=12)
    r = apply(client, emp, sl, date(2026, 11, 2), date(2026, 11, 5))  # 4 days
    detail = r.json()["detail"]
    assert r.status_code == 400
    assert "at most 3 days" in detail and "supporting document" in detail


# ─────────────────────────── access split ───────────────────────────

def test_hr_team_leave_screens_need_hr_app(client, db, org):
    outsider = make_user(db, "store.keeper@premnathrail.com", apps=("store",))
    for method, url, kw in (
        ("get", f"{L}/balances", {}),
        ("get", f"{L}/requests", {}),
        ("post", f"{L}/balances/allot", {"json": {"year": 2026}}),
        ("post", f"{L}/types", {"json": {"code": "XL", "name": "X"}}),
    ):
        r = getattr(client, method)(url, headers=hdr(outsider), **kw)
        assert r.status_code == 403, (url, r.status_code)


def test_hr_user_without_admin_role_can_use_hr_screens(client, db, org):
    r = client.get(f"{L}/balances", params={"year": 2026}, headers=hdr(org["hr"]))
    assert r.status_code == 200, r.text
    assert any(b["user_id"] == org["emp"].id for b in r.json())


def test_hr_applies_on_behalf_of_employee(client, db, org):
    emp, hr, cl = org["emp"], org["hr"], org["cl"]
    r = apply(client, hr, cl, date(2026, 11, 2), date(2026, 11, 2), user_id=emp.id)
    assert r.status_code == 200 and r.json()["user_id"] == emp.id
    assert r.json()["approver_id"] == org["mgr"].id


@pytest.mark.xfail(reason=SELF_SERVICE_BUG, strict=True)
def test_employee_without_hr_app_can_apply_and_see_own_leave(client, db):
    plant = make_branch(db, "PS", "Mon-Sat")
    mgr = make_user(db, "plain.mgr@premnathrail.com", apps=("store",), branch_id=plant.id)
    emp = make_user(db, "plain.emp@premnathrail.com", apps=("store",), branch_id=plant.id, reporting_manager_id=mgr.id)
    cl = make_leave_type(db, "CL", "Casual Leave", 12)
    make_balance(db, emp, cl)
    assert client.get(f"{L}/balances/me", headers=hdr(emp)).status_code == 200
    r = apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 3))
    assert r.status_code == 200, r.text
    assert client.get(f"{L}/requests/me", headers=hdr(emp)).status_code == 200


@pytest.mark.xfail(reason=SELF_SERVICE_BUG + " (manager approving a reportee's leave is an approvals-for-me screen)", strict=True)
def test_manager_without_hr_app_can_approve_reportee_leave(client, db):
    plant = make_branch(db, "PM", "Mon-Sat")
    mgr = make_user(db, "plain.boss@premnathrail.com", apps=("erp",), branch_id=plant.id)
    emp = make_user(db, "plain.staff@premnathrail.com", apps=("hr",), branch_id=plant.id, reporting_manager_id=mgr.id)
    cl = make_leave_type(db, "CL", "Casual Leave", 12)
    make_balance(db, emp, cl)
    rid = apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 3)).json()["id"]
    assert client.get(f"{L}/requests/pending-for-me", headers=hdr(mgr)).status_code == 200
    r = client.post(f"{L}/requests/{rid}/approve", headers=hdr(mgr))
    assert r.status_code == 200, r.text


def test_non_hr_colleague_cannot_decide_or_view_others_leave(client, db, org):
    """Whatever the module gate does, an unrelated non-HR user must never
    approve or read someone else's leave."""
    emp, cl = org["emp"], org["cl"]
    rid = apply(client, emp, cl, date(2026, 11, 2), date(2026, 11, 2)).json()["id"]
    colleague = make_user(db, "nosy.colleague@premnathrail.com", apps=("crm",))
    assert client.post(f"{L}/requests/{rid}/approve", headers=hdr(colleague)).status_code == 403
    assert client.get(f"{L}/requests/{rid}", headers=hdr(colleague)).status_code == 403
