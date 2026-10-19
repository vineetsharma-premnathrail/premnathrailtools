"""HR & Administration: employee profiles, masters, holidays, leave, attendance, lifecycle, travel, claims, assets, visitors.

Everything goes through the real HR API as the right demo person: HR (the
demo HR Manager) keeps the masters, profiles, balances and the gate; each
employee raises their own leave / regularization / travel / claims through
My HR; the reporting manager decides (approval engine, default stage =
reporting manager + hr:approvals:approve holders). HR can't act on its own
record, so the HR Manager's own profile / attendance / balance is done by
`demo.me` (another HR user, as the app requires). Payroll stays in ADP — no
salary, PF/ESI amounts or payslips here.

Leave balances: HR › Leave › "Allot" allots to EVERY active portal user, so
the demo uses a per-person balance adjustment ("DEMO <year> annual
allotment") instead — real employees' balances are never touched.

demo.data keys set here:

  employees       dict people key -> HR profile dict from the API
                  (GET /hr/employees/{id}), plus "joiner", "leaver_notice",
                  "former_employee" (extra DEMO people for the lifecycle).
  leave_requests  dict label -> leave request dict (approved_past, approved_half,
                  approved_medical, approved_comp_off, approved_lwp,
                  pending_design, pending_rnd, pending_hr_manager (waits for the
                  Partner / you), rejected_buyer, cancelled_service).
  hr_masters      {"grades": {code: id}, "designations": {people key: id},
                   "shifts": {code: id}, "leave_types": {code: id}}.
  travel_requests dict label -> travel request dict.
  expense_claims  dict label -> expense claim dict.
  hr_assets       dict asset code -> asset dict.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from demo._common import LABEL

IST = timezone(timedelta(hours=5, minutes=30))

# ── Masters ───────────────────────────────────────────────────────────────

GRADES = [  # code, name, level
    ("DEMO-L1", f"{LABEL} L1 – Leadership", 90),
    ("DEMO-M2", f"{LABEL} M2 – Manager / Head", 70),
    ("DEMO-E3", f"{LABEL} E3 – Engineer / Executive", 50),
    ("DEMO-S4", f"{LABEL} S4 – Supervisor / Staff", 30),
    ("DEMO-W5", f"{LABEL} W5 – Workman", 10),
]

SHIFTS = [  # code, name, start, end, grace, hours
    ("DEMO-GEN", f"{LABEL} General shift", time(9, 0), time(17, 30), 10, 8),
    ("DEMO-B", f"{LABEL} Second shift", time(14, 0), time(22, 30), 10, 8),
    ("DEMO-N", f"{LABEL} Night shift", time(22, 0), time(6, 30), 15, 8),
]

# people key: (grade, joined, gender, dob, blood, marital, employment_type, shift)
PROFILE = {
    "partner": ("DEMO-L1", date(2004, 4, 1), "male", date(1968, 3, 12), "B+", "married", "permanent", "DEMO-GEN"),
    "director": ("DEMO-L1", date(2008, 7, 1), "male", date(1971, 9, 4), "O+", "married", "permanent", "DEMO-GEN"),
    "bd_head": ("DEMO-M2", date(2012, 6, 18), "male", date(1979, 1, 22), "A+", "married", "permanent", "DEMO-GEN"),
    "bd": ("DEMO-E3", date(2021, 8, 2), "female", date(1994, 6, 30), "B+", "single", "permanent", "DEMO-GEN"),
    "rnd_head": ("DEMO-M2", date(2011, 1, 10), "male", date(1977, 11, 2), "AB+", "married", "permanent", "DEMO-GEN"),
    "rnd_engineer": ("DEMO-E3", date(2022, 7, 11), "male", date(1997, 2, 14), "O+", "single", "permanent", "DEMO-GEN"),
    "design_head": ("DEMO-M2", date(2013, 3, 4), "male", date(1980, 8, 19), "B-", "married", "permanent", "DEMO-GEN"),
    "design_engineer": ("DEMO-E3", date(2023, 1, 16), "female", date(1998, 12, 5), "A-", "single", "permanent", "DEMO-GEN"),
    "electrical_head": ("DEMO-M2", date(2014, 9, 1), "male", date(1982, 4, 27), "O-", "married", "permanent", "DEMO-GEN"),
    "hydraulic_head": ("DEMO-M2", date(2015, 2, 2), "male", date(1981, 10, 9), "B+", "married", "permanent", "DEMO-GEN"),
    "store_manager": ("DEMO-M2", date(2010, 5, 3), "male", date(1976, 7, 15), "A+", "married", "permanent", "DEMO-GEN"),
    "store_keeper": ("DEMO-S4", date(2026, 3, 2), "male", date(1999, 3, 3), "O+", "single", "probation", "DEMO-GEN"),
    "buyer": ("DEMO-E3", date(2020, 11, 9), "female", date(1993, 5, 21), "B+", "married", "permanent", "DEMO-GEN"),
    "purchase_manager": ("DEMO-M2", date(2012, 10, 15), "male", date(1978, 12, 30), "AB-", "married", "permanent", "DEMO-GEN"),
    "production_manager": ("DEMO-M2", date(2009, 8, 24), "male", date(1975, 2, 8), "O+", "married", "permanent", "DEMO-GEN"),
    "production_supervisor": ("DEMO-S4", date(2016, 4, 4), "male", date(1987, 9, 17), "B+", "married", "permanent", "DEMO-B"),
    "quality_manager": ("DEMO-M2", date(2013, 12, 2), "male", date(1980, 6, 6), "A+", "married", "permanent", "DEMO-GEN"),
    "quality_inspector": ("DEMO-E3", date(2019, 6, 3), "male", date(1995, 1, 11), "O+", "single", "permanent", "DEMO-GEN"),
    "project_manager": ("DEMO-M2", date(2014, 1, 20), "female", date(1984, 3, 25), "B+", "married", "permanent", "DEMO-GEN"),
    "service_head": ("DEMO-M2", date(2011, 11, 7), "male", date(1979, 10, 1), "A-", "married", "permanent", "DEMO-GEN"),
    "service_engineer": ("DEMO-E3", date(2018, 2, 12), "male", date(1992, 8, 13), "B+", "married", "permanent", "DEMO-GEN"),
    "maintenance_engineer": ("DEMO-E3", date(2017, 7, 17), "male", date(1990, 4, 4), "O+", "married", "permanent", "DEMO-GEN"),
    "hr_manager": ("DEMO-M2", date(2012, 4, 9), "female", date(1983, 11, 28), "A+", "married", "permanent", "DEMO-GEN"),
    "employee": ("DEMO-W5", date(2026, 5, 4), "male", date(2001, 7, 7), "B+", "single", "probation", "DEMO-GEN"),
    "accounts_manager": ("DEMO-M2", date(2010, 9, 13), "male", date(1977, 5, 18), "O+", "married", "permanent", "DEMO-GEN"),
    "accountant": ("DEMO-E3", date(2021, 3, 1), "female", date(1996, 9, 9), "AB+", "single", "permanent", "DEMO-GEN"),
    # Added by later seeders (Design/E/H and Maintenance) when they run before HR.
    "design_checker": ("DEMO-E3", date(2019, 9, 2), "male", date(1991, 2, 19), "A+", "married", "permanent", "DEMO-GEN"),
    "electrical_engineer": ("DEMO-E3", date(2020, 6, 15), "male", date(1994, 10, 3), "B+", "single", "permanent", "DEMO-GEN"),
    "hydraulic_engineer": ("DEMO-E3", date(2021, 1, 4), "male", date(1995, 12, 21), "O+", "single", "permanent", "DEMO-GEN"),
    "maintenance_head": ("DEMO-M2", date(2011, 3, 14), "male", date(1978, 6, 2), "B+", "married", "permanent", "DEMO-GEN"),
}
# Anyone else a seeder adds gets a plain staff profile instead of stopping HR.
_DEFAULT_PROFILE = ("DEMO-E3", date(2022, 4, 1), "male", date(1995, 1, 1), "O+", "single", "permanent", "DEMO-GEN")

# Indian holidays, all plants. national/festival close the plant; restricted/optional are taken as leave.
HOLIDAYS = {
    2026: [
        ("2026-01-14", "Makar Sankranti / Lohri", "optional"),
        ("2026-01-26", "Republic Day", "national"),
        ("2026-03-04", "Holi", "festival"),
        ("2026-03-20", "Eid-ul-Fitr", "restricted"),
        ("2026-04-03", "Good Friday", "restricted"),
        ("2026-08-15", "Independence Day", "national"),
        ("2026-08-28", "Raksha Bandhan", "festival"),
        ("2026-09-04", "Janmashtami", "restricted"),
        ("2026-10-02", "Gandhi Jayanti", "national"),
        ("2026-10-20", "Dussehra", "festival"),
        ("2026-10-29", "Karva Chauth", "optional"),
        ("2026-11-09", "Govardhan Puja (Diwali holiday)", "festival"),
        ("2026-11-11", "Bhai Dooj", "restricted"),
        ("2026-11-24", "Guru Nanak Jayanti", "restricted"),
        ("2026-12-25", "Christmas", "national"),
    ],
}


# ── Small helpers ─────────────────────────────────────────────────────────

def _people(demo):
    return demo.data["people"]


def _hr(demo):
    return _people(demo)["hr_manager"]


def _approve(demo, url, approver, json):
    """Decide as `approver`; if the engine says the request waits for someone
    else (a later seeder changed a reporting line — e.g. Maintenance gives the
    maintenance engineer a Maintenance Head), decide as that person instead."""
    import re
    from app.modules.main.models.user import User
    status, resp = demo.try_call("POST", url, approver, json=json)
    if status == 403 and isinstance(resp, dict):
        m = re.search(r"waiting for (.+?) at stage", str(resp.get("detail", "")))
        who = m and demo.db.query(User).filter(User.name == m.group(1), User.email.like("demo.%")).first()
        if who:
            return demo.call("POST", url, who, json=json)
    if status >= 400:
        raise SystemExit(f"\nPOST {url} as {approver.email} failed ({status}): {str(resp)[:800]}")
    return resp


def _as_hr(demo, target):
    """HR may not act on its own record — then another HR user (you) does."""
    return demo.me if target.id == _hr(demo).id else _hr(demo)


def _off_days(demo) -> set[date]:
    return {date.fromisoformat(d) for d, _n, t in HOLIDAYS.get(demo.today.year, []) if t in ("national", "festival")}


def _is_workday(demo, d: date) -> bool:
    return d.weekday() != 6 and d not in _off_days(demo)


def _workday(demo, d: date, step: int = 1) -> date:
    while not _is_workday(demo, d):
        d += timedelta(days=step)
    return d


def _span(demo, start: date, workdays: int) -> tuple[date, date]:
    """`workdays` working days starting at the first working day >= start."""
    first = d = _workday(demo, start)
    left = workdays - 1
    while left:
        d = _workday(demo, d + timedelta(days=1))
        left -= 1
    return first, d


def _detail(body) -> str:
    return body.get("detail") if isinstance(body, dict) else str(body)[:300]


def _seeded(demo, model, *filters) -> bool:
    return demo.db.query(model).filter(*filters).first() is not None


# ── Masters ───────────────────────────────────────────────────────────────

def seed_masters(demo) -> None:
    """Grades, designations (one per demo job), shifts; leave types are read (seeded by the app)."""
    hr = _hr(demo)
    grades = {g["code"]: g["id"] for g in demo.call("GET", "/hr/masters/grades", hr)}
    for code, name, level in GRADES:
        if code not in grades:
            grades[code] = demo.call("POST", "/hr/masters/grades", hr, json={
                "code": code, "name": name, "level": level, "description": f"{LABEL} grade band (no pay data — payroll is in ADP)."})["id"]

    shifts = {s["code"]: s["id"] for s in demo.call("GET", "/hr/masters/shifts", hr)}
    for code, name, start, end, grace, hours in SHIFTS:
        if code not in shifts:
            shifts[code] = demo.call("POST", "/hr/masters/shifts", hr, json={
                "code": code, "name": name, "start_time": start.isoformat(), "end_time": end.isoformat(),
                "grace_minutes": grace, "working_hours": hours})["id"]

    existing = {d["code"]: d["id"] for d in demo.call("GET", "/hr/masters/designations", hr)}
    designations = {}
    for i, (key, u) in enumerate(_people(demo).items(), 1):
        code = f"DEMO-D{i:02d}"
        if code not in existing:
            existing[code] = demo.call("POST", "/hr/masters/designations", hr, json={
                "code": code, "name": f"{LABEL} {u.designation}", "grade_id": grades[PROFILE.get(key, _DEFAULT_PROFILE)[0]],
                "department_id": demo.data["departments"].get(u.department)})["id"]
        designations[key] = existing[code]

    leave_types = {t["code"]: t["id"] for t in demo.call("GET", "/hr/leave/types", hr)}
    for code, name, quota, paid, doc_after in (("CL", "Casual Leave", 8, True, None), ("SL", "Sick Leave", 7, True, 2),
                                               ("EL", "Earned Leave", 15, True, None), ("LWP", "Leave Without Pay", 0, False, None),
                                               ("CO", "Compensatory Off", 0, True, None)):
        if code not in leave_types:  # the app seeds these; only a stripped DB lacks them
            leave_types[code] = demo.call("POST", "/hr/leave/types", hr, json={
                "code": code, "name": name, "annual_quota": quota, "is_paid": paid, "requires_document_after_days": doc_after})["id"]
    demo.data["hr_masters"] = {"grades": grades, "designations": designations, "shifts": shifts, "leave_types": leave_types}
    demo.note("hr", f"masters: {len(GRADES)} grades, {len(designations)} designations, {len(SHIFTS)} shifts; leave types {', '.join(leave_types)}")


def seed_holidays(demo) -> None:
    """This year's holiday calendar (all plants), in one bulk call."""
    rows = HOLIDAYS.get(demo.today.year)
    if not rows:
        demo.note("hr", f"no DEMO holiday list for {demo.today.year} — holidays skipped (add the year to HOLIDAYS)")
        return
    res = demo.call("POST", "/hr/holidays/bulk", _hr(demo), json={"rows": [
        {"holiday_date": d, "name": f"{LABEL} {n}", "holiday_type": t, "description": f"{LABEL} holiday calendar {demo.today.year}"}
        for d, n, t in rows]})
    demo.note("hr", f"holiday calendar {demo.today.year}: {len(res['created'])} added, {len(res['skipped'])} already there")


# ── Employees ─────────────────────────────────────────────────────────────

def _profile_payload(demo, key, u, i: int) -> dict:
    grade, joined, gender, dob, blood, marital, etype, shift = PROFILE.get(key, _DEFAULT_PROFILE)
    m = demo.data["hr_masters"]
    payload = {
        "employee_code": f"DEMO-E{i:03d}", "department_id": demo.data["departments"].get(u.department),
        "designation_id": m["designations"][key], "grade_id": m["grades"][grade], "branch_id": u.branch_id,
        "shift_id": m["shifts"][shift], "date_of_joining": joined.isoformat(), "employment_type": etype,
        "employment_status": "probation" if etype == "probation" else "active",
        "gender": gender, "date_of_birth": dob.isoformat(), "blood_group": blood, "marital_status": marital,
        "personal_phone": f"+91 98{i:03d} 4{i:04d}", "personal_email": f"{u.email.split('@')[0]}.personal@example.invalid",
        "emergency_contact_name": f"{LABEL} Family contact of {u.name.replace(LABEL, '').strip()}",
        "emergency_contact_phone": f"+91 99{i:03d} 5{i:04d}", "emergency_contact_relation": "Spouse" if marital == "married" else "Parent",
        "current_address": f"House {100 + i}, Sector {15 + i % 20}, Faridabad, Haryana 1210{i % 10:02d}",
        "permanent_address": f"House {100 + i}, Sector {15 + i % 20}, Faridabad, Haryana 1210{i % 10:02d}",
        "pan_number": f"ABCP{chr(65 + i % 26)}{1000 + i:04d}{chr(65 + (i * 7) % 26)}", "aadhaar_last4": f"{4000 + i * 37:04d}"[-4:],
        "uan_number": f"1010{i:08d}", "work_location": "Faridabad – Unit 1" if u.branch_id == demo.data["branch_id"] else "Faridabad – RDC",
        "notes": f"{LABEL} employee record.",
    }
    if etype == "probation":
        payload["probation_end_date"] = (joined + timedelta(days=182)).isoformat()
    return payload


def seed_employees(demo) -> None:
    """HR profile for every demo person (PATCH upsert as HR; the HR Manager's own by you)."""
    out = {}
    for i, (key, u) in enumerate(_people(demo).items(), 1):
        demo.call("PATCH", f"/hr/employees/{u.id}", _as_hr(demo, u), json=_profile_payload(demo, key, u, i))
        out[key] = demo.call("GET", f"/hr/employees/{u.id}", demo.me)
    demo.data["employees"] = out
    demo.note("hr", f"{len(out)} employee profiles (code, grade, designation, shift, PII) — 2 on probation")


# ── Leave ─────────────────────────────────────────────────────────────────

def seed_leave_balances(demo) -> None:
    """CL 8 / SL 7 / EL 15 for this calendar year, per demo person (adjustment, see module docstring)."""
    from app.modules.hr.models.leave import HrLeaveBalance

    lt = demo.data["hr_masters"]["leave_types"]
    year = demo.today.year
    n = 0
    for u in _people(demo).values():
        for code, days in (("CL", 8), ("SL", 7), ("EL", 15)):
            if code not in lt or _seeded(demo, HrLeaveBalance, HrLeaveBalance.user_id == u.id,
                                         HrLeaveBalance.leave_type_id == lt[code], HrLeaveBalance.year == year):
                continue
            demo.call("POST", "/hr/leave/balances/adjust", _as_hr(demo, u), json={
                "user_id": u.id, "leave_type_id": lt[code], "year": year, "delta": days,
                "reason": f"{LABEL} {year} annual allotment ({code} {days} days)"})
            n += 1
    # Comp-off earned for Sunday breakdown work.
    me = _people(demo)["maintenance_engineer"]
    if "CO" in lt and not _seeded(demo, HrLeaveBalance, HrLeaveBalance.user_id == me.id, HrLeaveBalance.leave_type_id == lt["CO"], HrLeaveBalance.year == year):
        demo.call("POST", "/hr/leave/balances/adjust", _hr(demo), json={
            "user_id": me.id, "leave_type_id": lt["CO"], "year": year, "delta": 1,
            "reason": f"{LABEL} worked Sunday on the press-brake breakdown — 1 comp-off"})
    demo.note("hr", f"leave balances: {n} allotments for {year} (+1 comp-off for the maintenance engineer)")


def _apply(demo, who, code, start, end, reason, session="full", attachment=None):
    lt = demo.data["hr_masters"]["leave_types"][code]
    data = {"leave_type_id": str(lt), "from_date": start.isoformat(), "to_date": end.isoformat(),
            "from_session": session, "to_session": session, "reason": f"{LABEL} {reason}",
            "contact_during_leave": "+91 98100 00000"}
    return demo.call("POST", "/hr/leave/requests", who, data=data,
                     files={"attachment": attachment} if attachment else None)


def seed_leave_requests(demo) -> None:
    """Leave at every stage: approved (past, half-day, medical w/ certificate, comp-off, LWP), pending, rejected, cancelled."""
    from app.modules.hr.models.leave import HrLeaveRequest

    p, t = _people(demo), demo.today
    ids = [u.id for u in p.values()]
    if _seeded(demo, HrLeaveRequest, HrLeaveRequest.user_id.in_(ids), HrLeaveRequest.reason.like(f"{LABEL} %")):
        demo.note("hr", "leave requests already seeded — reused")
        demo.data["leave_requests"] = {r.request_no: {"id": r.id, "request_no": r.request_no, "status": r.status} for r in
                                       demo.db.query(HrLeaveRequest).filter(HrLeaveRequest.user_id.in_(ids)).all()}
        return
    out = {}

    def decide(label, req, approver, ok=True, remarks=None):
        verb = "approve" if ok else "reject"
        url, body = f"/hr/leave/requests/{req['id']}/{verb}", {"remarks": remarks or ("Approved." if ok else "Not now.")}
        resp = _approve(demo, url, approver, body)
        out[label] = resp

    s, e = _span(demo, t - timedelta(days=15), 2)
    decide("approved_past", _apply(demo, p["employee"], "CL", s, e, "Sister's wedding in Palwal"), p["production_supervisor"])
    s, e = _span(demo, t - timedelta(days=24), 3)
    decide("approved_medical", _apply(demo, p["service_head"], "SL", s, e, "Viral fever — doctor advised rest",
                                      attachment=demo.pdf("DEMO-medical-certificate.pdf")), p["partner"], remarks="Get well soon.")
    s, e = _span(demo, t - timedelta(days=17), 1)
    decide("approved_lwp", _apply(demo, p["production_supervisor"], "LWP", s, e, "Personal work at native village (Etawah)"),
           p["production_manager"])
    s, e = _span(demo, t + timedelta(days=3), 1)
    decide("approved_half", _apply(demo, p["quality_inspector"], "CL", s, e, "Bank work — first half", session="first_half"),
           p["quality_manager"])
    s, e = _span(demo, t + timedelta(days=4), 1)
    decide("approved_comp_off", _apply(demo, p["maintenance_engineer"], "CO", s, e, "Comp-off for Sunday breakdown work"),
           p["production_manager"])

    s, e = _span(demo, t + timedelta(days=24), 5)
    out["pending_design"] = _apply(demo, p["design_engineer"], "EL", s, e, "Family trip to Shimla")
    s, e = _span(demo, t + timedelta(days=7), 1)
    out["pending_rnd"] = _apply(demo, p["rnd_engineer"], "CL", s, e, "Driving licence renewal at RTO Faridabad")
    s, e = _span(demo, t + timedelta(days=40), 4)
    out["pending_hr_manager"] = _apply(demo, p["hr_manager"], "EL", s, e, "Annual leave — waits for the Partner (or you, as admin)")

    s, e = _span(demo, t + timedelta(days=18), 3)
    decide("rejected_buyer", _apply(demo, p["buyer"], "EL", s, e, "Short vacation"), p["purchase_manager"], ok=False,
           remarks="Quarter-end vendor rate negotiations that week — please pick the week after.")
    s, e = _span(demo, t + timedelta(days=10), 2)
    req = _apply(demo, p["service_engineer"], "CL", s, e, "Home town visit")
    out["cancelled_service"] = demo.call("POST", f"/hr/leave/requests/{req['id']}/cancel", p["service_engineer"],
                                         json={"remarks": "Commissioning at Lucknow got preponed."})
    demo.data["leave_requests"] = out
    demo.note("hr", "leave: 5 approved (incl. half-day, medical w/ certificate, comp-off, LWP), 3 pending (1 for the Partner/you), 1 rejected, 1 cancelled")


# ── Attendance ────────────────────────────────────────────────────────────

def seed_attendance(demo) -> None:
    """Last three weeks: bulk 'present', then late arrivals with punch times, absences, WFH, on-duty, half day; today's self check-ins."""
    from app.modules.hr.models.attendance import HrAttendance

    p, t = _people(demo), demo.today
    ids = [u.id for u in p.values()]
    start = t - timedelta(days=21)
    if _seeded(demo, HrAttendance, HrAttendance.user_id.in_(ids), HrAttendance.attendance_date == _workday(demo, start),
               HrAttendance.source == "manual"):
        demo.note("hr", "attendance already seeded — reused")
        return
    hr = _hr(demo)
    others = [u.id for k, u in p.items() if k != "hr_manager"]
    days = [start + timedelta(days=i) for i in range(21) if _is_workday(demo, start + timedelta(days=i))]
    leave_days = {(r.user_id, r.attendance_date) for r in demo.db.query(HrAttendance).filter(
        HrAttendance.user_id.in_(ids), HrAttendance.source == "leave").all()}
    late = ["employee", "store_keeper", "production_supervisor", "quality_inspector", "buyer", "accountant"]
    special = {  # (key, day index) -> (status, remark)
        ("bd", 4): ("absent", None), ("employee", 8): ("absent", None), ("buyer", 12): ("half_day", "Left at 13:30 — child unwell"),
        ("design_engineer", 9): ("work_from_home", "WFH — drawing release for DMRC"),
        **{("service_engineer", d): ("on_duty", "On duty — RRV commissioning at Northern Railway, Lucknow") for d in (5, 6, 7, 8)},
    }
    for di, d in enumerate(days):
        demo.call("PUT", "/hr/attendance/register/bulk", hr, json={"attendance_date": d.isoformat(), "user_ids": others,
                                                                    "status": "present", "overwrite_existing": True})
        demo.call("PUT", "/hr/attendance/register/bulk", demo.me, json={"attendance_date": d.isoformat(), "user_ids": [p["hr_manager"].id],
                                                                         "status": "present", "overwrite_existing": True})
        for n, key in enumerate(late):
            u = p[key]
            if (u.id, d) in leave_days or (key, di) in special:
                continue
            arrive = 8 * 60 + 50 + (di * 7 + n * 11) % 45  # 08:50–09:34: a few arrive after the 10-minute grace
            demo.call("PUT", "/hr/attendance/entries", hr, json={
                "user_id": u.id, "attendance_date": d.isoformat(), "status": "present",
                "check_in": time(arrive // 60, arrive % 60).isoformat(),
                "check_out": time(17, 35 + n).isoformat(), "remarks": f"{LABEL} biometric punch"})
        for (key, idx), (status, remark) in special.items():
            if idx == di and (p[key].id, d) not in leave_days:
                demo.call("PUT", "/hr/attendance/entries", hr, json={
                    "user_id": p[key].id, "attendance_date": d.isoformat(), "status": status,
                    "check_in": "09:02" if status == "half_day" else None, "check_out": "13:30" if status == "half_day" else None,
                    "remarks": f"{LABEL} {remark}" if remark else f"{LABEL} no punch"})
    demo.data["_attendance_days"] = days

    # Today: a few people punch in themselves (My HR › Check in).
    if _is_workday(demo, t):
        for key in ("employee", "store_keeper", "accountant", "quality_inspector"):
            status, body = demo.try_call("POST", "/hr/attendance/me/check-in", p[key], json={"remarks": f"{LABEL} self check-in"})
            if status >= 400:
                demo.note("hr", f"self check-in for {p[key].name} skipped: {_detail(body)}")
    demo.note("hr", f"attendance: {len(days)} working days for {len(ids)} people (late punches, absences, WFH, on-duty, half day) + today's self check-ins")


def seed_regularizations(demo) -> None:
    """Attendance corrections: one pending, one approved (on-duty), one rejected."""
    from app.modules.hr.models.attendance import HrAttendanceRegularization

    p = _people(demo)
    days = demo.data.get("_attendance_days") or []
    if len(days) < 10 or _seeded(demo, HrAttendanceRegularization, HrAttendanceRegularization.reason.like(f"{LABEL} %")):
        demo.note("hr", "regularizations skipped (no fresh attendance seeded / already there)")
        return
    reg = demo.call("POST", "/hr/attendance/regularizations", p["employee"], json={
        "attendance_date": days[8].isoformat(), "requested_status": "present", "check_in": "09:05", "check_out": "17:40",
        "reason": f"{LABEL} Biometric was down at gate 2 — I was on the assembly line all day."})
    reg2 = demo.call("POST", "/hr/attendance/regularizations", p["bd"], json={
        "attendance_date": days[4].isoformat(), "requested_status": "on_duty",
        "reason": f"{LABEL} Was at DMRC Metro Bhawan for the pre-bid meeting all day."})
    _approve(demo, f"/hr/attendance/regularizations/{reg2['id']}/approve", p["bd_head"], json={"remarks": "Confirmed — I sent you."})
    reg3 = demo.call("POST", "/hr/attendance/regularizations", p["buyer"], json={
        "attendance_date": days[12].isoformat(), "requested_status": "present", "check_in": "09:00", "check_out": "17:30",
        "reason": f"{LABEL} Worked the second half from home on vendor follow-ups."})
    demo.call("POST", f"/hr/attendance/regularizations/{reg3['id']}/reject", p["purchase_manager"],
              json={"remarks": "WFH wasn't approved that day — it stays a half day."})
    demo.note("hr", f"regularizations: {reg['request_no']} pending, {reg2['request_no']} approved, {reg3['request_no']} rejected")


# ── Lifecycle ─────────────────────────────────────────────────────────────

def _extra_people(demo) -> dict:
    """DEMO people used only for joiner / leaver stories (not in the core 26)."""
    unit1 = demo.data["branch_id"]
    rows = {
        "joiner": demo.user("design.trainee", "Design Trainee (new joiner)", [], designation="Graduate Engineer Trainee – Design", department="Design"),
        "leaver_notice": demo.user("fitter.notice", "Fitter (serving notice)", [], designation="Fitter – Assembly", department="Production"),
        "former_employee": demo.user("former.employee", "Welder (exited)", [], designation="Welder – Fabrication", department="Production"),
    }
    for u in rows.values():
        u.branch_id = u.branch_id or unit1
    rows["joiner"].reporting_manager_id = _people(demo)["design_head"].id
    rows["leaver_notice"].reporting_manager_id = rows["former_employee"].reporting_manager_id = _people(demo)["production_supervisor"].id
    demo.db.commit()
    return rows


def _items(ev):
    return ev.get("items") or []


def _tick(demo, ev, n=None, owner=None):
    """Mark the first `n` checklist items done (all when n is None)."""
    for it in _items(ev)[: n if n is not None else len(_items(ev))]:
        if it["status"] == "pending":
            demo.call("PATCH", f"/hr/lifecycle/items/{it['id']}", owner or _hr(demo), json={"status": "done", "remarks": f"{LABEL} done"})


def seed_lifecycle(demo) -> None:
    """Joining (candidate in progress + linked joiner completed), confirmation (done + open), promotion draft, exit in notice + completed exit."""
    from app.modules.hr.models.lifecycle import HrLifecycleEvent

    p, hr, t = _people(demo), _hr(demo), demo.today
    if _seeded(demo, HrLifecycleEvent, HrLifecycleEvent.remarks.like(f"{LABEL} %")):
        demo.note("hr", "lifecycle events already seeded — reused")
        return
    extra = _extra_people(demo)
    depts, m = demo.data["departments"], demo.data["hr_masters"]
    events = {}

    ev = demo.call("POST", "/hr/lifecycle/events", hr, json={
        "event_type": "joining", "candidate_name": f"{LABEL} Ritika Sharma", "candidate_email": "ritika.sharma.demo@example.invalid",
        "effective_date": (t + timedelta(days=12)).isoformat(), "to_department_id": depts.get("Production"),
        "to_branch_id": demo.data["branch_id"], "to_manager_id": p["production_manager"].id,
        "remarks": f"{LABEL} GET (mechanical) from YMCA Faridabad — offer accepted, joins after convocation."})
    _tick(demo, ev, 2)
    events["joining_candidate"] = ev

    joiner = extra["joiner"]
    ev = demo.call("POST", "/hr/lifecycle/events", hr, json={
        "event_type": "joining", "user_id": joiner.id, "effective_date": (t - timedelta(days=20)).isoformat(),
        "to_department_id": depts.get("Design"), "to_designation_id": m["designations"]["design_engineer"],
        "to_grade_id": m["grades"]["DEMO-E3"], "to_manager_id": p["design_head"].id,
        "remarks": f"{LABEL} Design trainee joined RDC — induction done by the Design Head."})
    _tick(demo, ev)
    events["joining_completed"] = demo.call("POST", f"/hr/lifecycle/events/{ev['id']}/complete", hr, json={
        "employment_type": "trainee", "employee_code": "DEMO-E101", "probation_end_date": (t + timedelta(days=345)).isoformat(),
        "remarks": f"{LABEL} joined"})

    ev = demo.call("POST", "/hr/lifecycle/events", hr, json={
        "event_type": "confirmation", "user_id": p["store_keeper"].id, "effective_date": (t - timedelta(days=5)).isoformat(),
        "remarks": f"{LABEL} Six-month probation reviewed by the Store Manager — confirmed."})
    events["confirmation_done"] = demo.call("POST", f"/hr/lifecycle/events/{ev['id']}/complete", hr, json={"remarks": f"{LABEL} confirmed"})
    events["confirmation_open"] = demo.call("POST", "/hr/lifecycle/events", hr, json={
        "event_type": "confirmation", "user_id": p["employee"].id,
        "effective_date": (date.fromisoformat(PROFILE["employee"][1].isoformat()) + timedelta(days=183)).isoformat(),
        "remarks": f"{LABEL} Probation ends next month — waiting for the supervisor's review."})
    events["promotion_draft"] = demo.call("POST", "/hr/lifecycle/events", hr, json={
        "event_type": "promotion", "user_id": p["quality_inspector"].id, "status": "draft",
        "effective_date": (t + timedelta(days=22)).isoformat(), "to_grade_id": m["grades"]["DEMO-M2"],
        "remarks": f"{LABEL} Proposed: QC Inspector → Sr. QC Engineer after the ISO 3834 audit."})

    # Exit in notice: profile first, an unreturned laptop shows as a blocker.
    leaver = extra["leaver_notice"]
    demo.call("PATCH", f"/hr/employees/{leaver.id}", hr, json={
        "employee_code": "DEMO-E102", "department_id": depts.get("Production"), "grade_id": m["grades"]["DEMO-W5"],
        "branch_id": demo.data["branch_id"], "shift_id": m["shifts"]["DEMO-GEN"], "date_of_joining": "2019-09-02",
        "employment_type": "permanent", "employment_status": "active", "gender": "male"})
    events["exit_notice"] = demo.call("POST", "/hr/lifecycle/events", hr, json={
        "event_type": "exit", "user_id": leaver.id, "exit_type": "resignation", "resignation_date": (t - timedelta(days=10)).isoformat(),
        "last_working_day": (t + timedelta(days=20)).isoformat(), "notice_period_days": 30, "handover_to_id": p["production_supervisor"].id,
        "exit_reason": "Moving to a job near home (Agra)", "remarks": f"{LABEL} Serving notice — laptop and tools still to be returned."})
    _tick(demo, events["exit_notice"], 1, owner=hr)

    former = extra["former_employee"]
    demo.call("PATCH", f"/hr/employees/{former.id}", hr, json={
        "employee_code": "DEMO-E103", "department_id": depts.get("Production"), "grade_id": m["grades"]["DEMO-W5"],
        "branch_id": demo.data["branch_id"], "shift_id": m["shifts"]["DEMO-GEN"], "date_of_joining": "2017-01-09",
        "employment_type": "permanent", "employment_status": "active", "gender": "male"})
    demo.data["_former"] = former
    demo.data["_leaver"] = leaver
    events["_exit_former_draft"] = demo.call("POST", "/hr/lifecycle/events", hr, json={
        "event_type": "exit", "user_id": former.id, "exit_type": "resignation", "resignation_date": (t - timedelta(days=45)).isoformat(),
        "last_working_day": (t - timedelta(days=15)).isoformat(), "notice_period_days": 30, "handover_to_id": p["production_supervisor"].id,
        "exit_reason": "Higher studies (ITI advanced welding)", "remarks": f"{LABEL} Relieved — full & final done in ADP."})
    demo.data["_lifecycle"] = events
    demo.data["employees"].update({k: demo.call("GET", f"/hr/employees/{u.id}", demo.me) for k, u in extra.items()})
    demo.note("hr", "lifecycle: joining (candidate, in progress) + joining completed, confirmation done + open, promotion draft, exit in notice")


def complete_former_exit(demo) -> None:
    """Finish the former employee's exit once their asset is back (deactivates the DEMO account)."""
    ev = (demo.data.get("_lifecycle") or {}).pop("_exit_former_draft", None)
    if not ev:
        return
    _tick(demo, ev)
    done = demo.call("POST", f"/hr/lifecycle/events/{ev['id']}/complete", _hr(demo), json={
        "handover_to_id": _people(demo)["production_supervisor"].id, "remarks": f"{LABEL} exit completed"})
    demo.data["_lifecycle"]["exit_completed"] = done
    demo.note("hr", f"exit {done['event_no']} completed — DEMO welder's portal account deactivated")


# ── Travel & claims ───────────────────────────────────────────────────────

def seed_travel(demo) -> None:
    """Trips: completed (commissioning), approved (upcoming), pending, rejected, cancelled."""
    from app.modules.hr.models.travel import HrTravelRequest

    p, t = _people(demo), demo.today
    if _seeded(demo, HrTravelRequest, HrTravelRequest.purpose.like(f"{LABEL} %")):
        demo.note("hr", "travel requests already seeded — reused")
        return
    out = {}

    def raise_(key, purpose, frm, to, dep, ret, mode, est, adv=0, hotel=True, ref=None):
        return demo.call("POST", "/hr/travel", p[key], json={
            "purpose": f"{LABEL} {purpose}", "from_city": frm, "to_city": to, "depart_date": dep.isoformat(),
            "return_date": ret.isoformat(), "travel_mode": mode, "accommodation_required": hotel,
            "advance_required": adv, "estimated_cost": est, "project_reference": ref})

    tr = raise_("service_engineer", "RRV-8W commissioning & trial run at Northern Railway, Lucknow", "Faridabad", "Lucknow",
                t - timedelta(days=17), t - timedelta(days=13), "train", 14000, adv=5000, ref="DEMO-RRV-8W / Northern Railway")
    _approve(demo, f"/hr/travel/{tr['id']}/approve", p["service_head"], json={"remarks": "Approved — carry the trial-run checklist."})
    out["completed"] = demo.call("POST", f"/hr/travel/{tr['id']}/complete", _hr(demo), json={"remarks": "Commissioning signed off."})

    tr = raise_("design_engineer", "Design review of the rail grinding machine with L&T Metro, Uppal depot", "Delhi", "Hyderabad",
                t + timedelta(days=12), t + timedelta(days=14), "air", 32000, ref="DEMO-RGM-16 / L&T Metro")
    out["approved"] = _approve(demo, f"/hr/travel/{tr['id']}/approve", p["design_head"], json={"remarks": "OK. Book economy, 14-day advance."})
    out["pending"] = raise_("bd", "Pre-bid meeting for the Matunga workshop tender (Central Railway)", "Delhi", "Mumbai",
                            t + timedelta(days=9), t + timedelta(days=10), "air", 28000, adv=10000, ref="DEMO Central Railway tender")
    tr = raise_("rnd_engineer", "Engine mounting trial at DEMO Powertrain, Chakan", "Faridabad", "Pune",
                t + timedelta(days=15), t + timedelta(days=17), "air", 30000)
    out["rejected"] = demo.call("POST", f"/hr/travel/{tr['id']}/reject", p["rnd_head"],
                                json={"remarks": "Combine it with the November vendor audit — one trip, not two."})
    tr = raise_("quality_manager", "Third-party inspection of bogie frames at the vendor's works", "Faridabad", "Chennai",
                t + timedelta(days=20), t + timedelta(days=22), "air", 26000)
    out["cancelled"] = demo.call("POST", f"/hr/travel/{tr['id']}/cancel", p["quality_manager"], json={"remarks": "Vendor will ship to us for inspection."})
    demo.data["travel_requests"] = out
    demo.note("hr", "travel: 1 completed, 1 approved, 1 pending, 1 rejected, 1 cancelled")


def _claim(demo, key, title, items, trip=None, receipts=True):
    u = _people(demo)[key]
    c = demo.call("POST", "/hr/expenses", u, json={
        "title": f"{LABEL} {title}", "travel_request_id": trip, "claim_date": demo.today.isoformat(),
        "items": [{"expense_date": d.isoformat(), "category": cat, "description": f"{LABEL} {desc}", "amount": amt} for d, cat, desc, amt in items]})
    if receipts:
        for it in c["items"]:
            if it["receipt_required"]:
                c = demo.call("POST", f"/hr/expenses/{c['id']}/items/{it['id']}/receipt", u, files={"file": demo.pdf(f"DEMO-receipt-{it['id']}.pdf")})
    return c


def seed_expense_claims(demo) -> None:
    """Claims: paid (linked to the commissioning trip), approved, submitted, rejected, draft."""
    from app.modules.hr.models.expense import HrExpenseClaim

    p, t = _people(demo), demo.today
    if _seeded(demo, HrExpenseClaim, HrExpenseClaim.title.like(f"{LABEL} %")):
        demo.note("hr", "expense claims already seeded — reused")
        return
    out = {}
    trip = (demo.data.get("travel_requests") or {}).get("completed")
    d0 = t - timedelta(days=17)
    c = _claim(demo, "service_engineer", "Lucknow commissioning trip", [
        (d0, "travel", "Train Faridabad–Lucknow 3AC (Lucknow Mail), return", 2980),
        (d0 + timedelta(days=1), "lodging", "Hotel near Charbagh, 4 nights", 9600),
        (d0 + timedelta(days=2), "food", "Meals during commissioning, 4 days", 2400),
        (d0 + timedelta(days=2), "local_conveyance", "Auto to Alambagh shed and back", 380),
    ], trip=trip["id"] if trip else None)
    demo.call("POST", f"/hr/expenses/{c['id']}/submit", p["service_engineer"])
    _approve(demo, f"/hr/expenses/{c['id']}/approve", p["service_head"], json={"remarks": "Matches the trip — OK."})
    out["paid"] = demo.call("POST", f"/hr/expenses/{c['id']}/mark-paid", _hr(demo), json={
        "paid_on": t.isoformat(), "payment_reference": "DEMO NEFT HDFC N2810-4417 (reimbursement batch)"})

    c = _claim(demo, "maintenance_engineer", "Fuel for spares pick-up, Okhla", [(t - timedelta(days=6), "fuel", "Diesel for company Bolero, Okhla run", 1150)])
    demo.call("POST", f"/hr/expenses/{c['id']}/submit", p["maintenance_engineer"])
    out["approved"] = _approve(demo, f"/hr/expenses/{c['id']}/approve", p["production_manager"], json={"remarks": "OK."})

    c = _claim(demo, "bd", "Customer lunch — DMRC track team", [(t - timedelta(days=3), "food", "Lunch with Dy. GM / Track and team, Connaught Place", 2650)])
    out["submitted"] = demo.call("POST", f"/hr/expenses/{c['id']}/submit", p["bd"])

    c = _claim(demo, "buyer", "Mobile bill September", [(t - timedelta(days=9), "phone", "Personal mobile bill used for vendor calls", 699)])
    demo.call("POST", f"/hr/expenses/{c['id']}/submit", p["buyer"])
    out["rejected"] = demo.call("POST", f"/hr/expenses/{c['id']}/reject", p["purchase_manager"],
                                json={"remarks": "Vendor calls go on the company SIM — please use it."})

    out["draft"] = _claim(demo, "employee", "Local conveyance — tool crib run", [(t - timedelta(days=2), "local_conveyance", "Shared auto to Sector 24 tool shop", 120),
                                                                              (t - timedelta(days=2), "food", "Tea and snacks", 60)], receipts=False)
    demo.data["expense_claims"] = out
    demo.note("hr", "expense claims: 1 paid (linked to the Lucknow trip), 1 approved, 1 submitted, 1 rejected, 1 draft")


# ── Company assets ────────────────────────────────────────────────────────

ASSETS = [  # code, name, category, make, model, serial, cost, holder key or None, status
    ("DEMO-LT-001", f"{LABEL} Laptop Dell Latitude 5440", "laptop", "Dell", "Latitude 5440", "DEMO5440A01", 78500, "design_engineer", None),
    ("DEMO-LT-002", f"{LABEL} Laptop Lenovo ThinkPad E14", "laptop", "Lenovo", "ThinkPad E14 Gen 5", "DEMOE14B02", 64200, "accountant", None),
    ("DEMO-LT-003", f"{LABEL} Laptop HP ProBook 440", "laptop", "HP", "ProBook 440 G10", "DEMO440C03", 61800, None, None),
    ("DEMO-LT-004", f"{LABEL} Laptop Dell Vostro 3520", "laptop", "Dell", "Vostro 3520", "DEMO3520D04", 52400, "_leaver", None),
    ("DEMO-LT-005", f"{LABEL} Laptop Dell Vostro 3520", "laptop", "Dell", "Vostro 3520", "DEMO3520E05", 52400, "_former", None),
    ("DEMO-MB-001", f"{LABEL} Mobile Samsung Galaxy M34", "mobile", "Samsung", "Galaxy M34", "DEMO35M3401", 16999, "service_engineer", None),
    ("DEMO-SIM-001", f"{LABEL} Jio postpaid SIM 98100 77001", "sim", "Jio", "Postpaid 599", "DEMO89910001", 0, "service_engineer", None),
    ("DEMO-AC-001", f"{LABEL} Access card – Unit 1 gate", "access_card", "HID", "iCLASS", "DEMOHID0001", 450, "employee", None),
    ("DEMO-VH-001", f"{LABEL} Mahindra Bolero Pik-Up HR51 AB 1234", "vehicle", "Mahindra", "Bolero Pik-Up", "DEMOMA1BPU001", 945000, "service_head", None),
    ("DEMO-MN-001", f"{LABEL} Monitor LG 24in", "monitor", "LG", "24MP400", "DEMOLG24001", 9800, None, "under_repair"),
    ("DEMO-TL-001", f"{LABEL} Torque wrench set 40–200 Nm", "tool", "Stahlwille", "730", "DEMOSTW730", 38500, "production_supervisor", None),
]


def seed_assets(demo) -> None:
    """Company assets: issued (laptops, mobile, SIM, vehicle, tools), in stock, under repair, issued+returned history."""
    from app.modules.hr.models.asset import HrAsset

    p, hr, t = _people(demo), _hr(demo), demo.today
    holders = {**p, "_leaver": demo.data.get("_leaver"), "_former": demo.data.get("_former")}
    out = {}
    for code, name, cat, make, model, serial, cost, holder, status in ASSETS:
        row = demo.db.query(HrAsset).filter(HrAsset.asset_code == code).first()
        if row:
            out[code] = demo.call("GET", f"/hr/assets/{row.id}", hr)
            continue
        a = demo.call("POST", "/hr/assets", hr, json={
            "asset_code": code, "name": name, "category": cat, "make": make, "model": model, "serial_number": serial,
            "purchase_date": (t - timedelta(days=200)).isoformat(), "purchase_cost": cost, "vendor_name": f"{LABEL} Nehru Place IT Traders",
            "invoice_no": f"DEMO/IT/{serial[-4:]}", "warranty_until": (t + timedelta(days=530)).isoformat(),
            "branch_id": demo.data["branch_id"], "condition": "new"})
        who = holders.get(holder) if holder else None
        if who is not None:
            a = demo.call("POST", f"/hr/assets/{a['id']}/issue", hr, json={
                "user_id": who.id, "issued_on": (t - timedelta(days=90 if holder != "_former" else 400)).isoformat(),
                "condition_on_issue": "new", "remarks": f"{LABEL} issued"})
            if holder == "_former":
                a = demo.call("POST", f"/hr/assets/{a['id']}/return", hr, json={
                    "returned_on": (t - timedelta(days=15)).isoformat(), "condition_on_return": "good", "next_status": "in_stock",
                    "remarks": f"{LABEL} returned on the last working day"})
        if status:
            a = demo.call("POST", f"/hr/assets/{a['id']}/status", hr, json={"status": status, "remarks": f"{LABEL} panel flicker — sent to LG service"})
        out[code] = a
    demo.data["hr_assets"] = out
    demo.note("hr", f"{len(out)} company assets (issued / in stock / under repair / returned)")


# ── Visitors ──────────────────────────────────────────────────────────────

def seed_visitors(demo) -> None:
    """Visitors: expected (pre-registered by the host), inside now, checked out, cancelled."""
    from app.modules.hr.models.visitor import HrVisitor

    p, hr = _people(demo), _hr(demo)
    if _seeded(demo, HrVisitor, HrVisitor.visitor_name.like(f"{LABEL} %")):
        demo.note("hr", "visitors already seeded — reused")
        return
    now = datetime.now(IST)
    tomorrow_11 = (now + timedelta(days=1)).replace(hour=11, minute=0, second=0, microsecond=0)
    demo.call("POST", "/hr/visitors", p["bd_head"], json={
        "visitor_name": f"{LABEL} Alok Srivastava", "visitor_company": f"{LABEL} Northern Railway – Lucknow Division",
        "visitor_phone": "+91 94150 00011", "purpose": "Stage inspection of RRV-8W before dispatch",
        "expected_at": tomorrow_11.isoformat(), "number_of_persons": 2, "vehicle_no": "UP32 GA 1180"})
    demo.call("POST", "/hr/visitors", hr, json={
        "visitor_name": f"{LABEL} Rakesh Arora", "visitor_company": f"{LABEL} Hydro Seals & Fluid Power Pvt Ltd",
        "visitor_phone": "+91 98100 00001", "purpose": "Seal-kit rate discussion", "host_user_id": p["purchase_manager"].id,
        "id_proof_type": "Aadhaar", "id_proof_last4": "4821", "items_carried": "Laptop, sample seal kits",
        "check_in_now": True, "badge_no": "V-014"})
    v = demo.call("POST", "/hr/visitors", hr, json={
        "visitor_name": f"{LABEL} S. K. Mishra", "visitor_company": f"{LABEL} RDSO Lucknow (inspecting officer)",
        "purpose": "Prototype inspection – track inspection car", "host_user_id": p["quality_manager"].id,
        "expected_at": (now - timedelta(days=1)).replace(hour=10, minute=0).isoformat(), "id_proof_type": "Company ID"})
    demo.call("POST", f"/hr/visitors/{v['id']}/check-in", hr, json={"badge_no": "V-011", "check_in_at": (now - timedelta(days=1)).replace(hour=10, minute=12).isoformat()})
    demo.call("POST", f"/hr/visitors/{v['id']}/check-out", hr, json={"check_out_at": (now - timedelta(days=1)).replace(hour=16, minute=40).isoformat(),
                                                                       "remarks": f"{LABEL} inspection complete"})
    v = demo.call("POST", "/hr/visitors", p["accounts_manager"], json={
        "visitor_name": f"{LABEL} CA Neeraj Goel", "visitor_company": f"{LABEL} Goel & Associates (statutory auditors)",
        "purpose": "Half-yearly limited review", "expected_at": (now + timedelta(days=3)).replace(hour=10, minute=30).isoformat()})
    demo.call("POST", f"/hr/visitors/{v['id']}/cancel", p["accounts_manager"], json={"remarks": "Review moved to next month."})
    demo.note("hr", "visitors: 1 expected tomorrow, 1 inside now, 1 checked out, 1 cancelled")


# ── Entry point ──────────────────────────────────────────────────────────

def seed(demo) -> None:
    seed_masters(demo)
    seed_holidays(demo)
    seed_employees(demo)
    seed_leave_balances(demo)
    seed_leave_requests(demo)   # before attendance: approving leave refuses days already marked worked
    seed_attendance(demo)
    seed_regularizations(demo)
    seed_lifecycle(demo)
    seed_travel(demo)
    seed_expense_claims(demo)
    seed_assets(demo)
    complete_former_exit(demo)
    seed_visitors(demo)
    for k in [k for k in demo.data if k.startswith("_") and k in ("_attendance_days", "_former", "_leaver", "_lifecycle")]:
        if k == "_lifecycle":
            demo.data["lifecycle_events"] = demo.data[k]
        demo.data.pop(k)
