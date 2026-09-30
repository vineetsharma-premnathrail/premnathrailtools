"""HR dashboard aggregates (Integration agent).

Everything is computed on the fly from the HR tables. "Today" and "this
month" are IST (services/calendar.today_ist). The headcount population is
the same one the Employees list uses: active portal users that are real
people (services/employees.people_filter) and not marked exited in HR."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.main.models.user_document import UserDocument
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.hr.models.asset import HrAsset
from app.modules.hr.models.attendance import HrAttendance, HrAttendanceRegularization
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.expense import HrExpenseClaim
from app.modules.hr.models.holiday import HrHoliday
from app.modules.hr.models.leave import HrLeaveRequest, HrLeaveType
from app.modules.hr.models.lifecycle import HrLifecycleEvent, HrChecklistItem
from app.modules.hr.models.masters import HrDesignation
from app.modules.hr.models.travel import HrTravelRequest
from app.modules.hr.models.visitor import HrVisitor
from app.modules.hr.services.calendar import today_ist
from app.modules.hr.services.employees import people_filter

LIST_LIMIT = 10
WINDOW_DAYS = 30
OPEN_EVENT_STATUSES = ("draft", "in_progress")
# Attendance statuses that mean the person is working today.
WORKING_STATUSES = ("present", "on_duty", "work_from_home", "half_day")


def _month_bounds(today: date) -> tuple[date, date]:
    start = today.replace(day=1)
    nxt = (start + timedelta(days=32)).replace(day=1)
    return start, nxt - timedelta(days=1)


def _headcount_query(db: Session):
    """Active people not exited in HR, with resolved department/plant names."""
    P = HrEmployeeProfile
    branch_expr = func.coalesce(P.branch_id, User.branch_id)
    return (
        db.query(
            User.id.label("user_id"),
            func.coalesce(P.employment_status, "no_profile").label("status"),
            func.coalesce(Department.name, func.nullif(func.trim(User.department), ""), "Unassigned").label("department"),
            func.coalesce(Branch.name, "Unassigned").label("branch"),
        )
        .outerjoin(P, P.user_id == User.id)
        .outerjoin(Department, Department.id == P.department_id)
        .outerjoin(Branch, Branch.id == branch_expr)
        .filter(people_filter(), User.is_active.is_(True))
        .filter(or_(P.id.is_(None), P.employment_status != "exited"))
    )


def _breakdown(rows, key: str) -> list[dict]:
    counts: dict[str, int] = {}
    for r in rows:
        k = getattr(r, key)
        counts[k] = counts.get(k, 0) + 1
    return [{"label": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


def _names(db: Session, ids: set[int]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {uid: name for uid, name in db.query(User.id, User.name).filter(User.id.in_(ids)).all()}


def build_dashboard(db: Session, today: date | None = None) -> dict:
    today = today or today_ist()
    month_start, month_end = _month_bounds(today)
    window_end = today + timedelta(days=WINDOW_DAYS)

    # ---------------------------------------------------------- headcount
    people = _headcount_query(db).all()
    people_ids = {r.user_id for r in people}
    headcount = {
        "total": len(people),
        "by_status": _breakdown(people, "status"),
        "by_department": _breakdown(people, "department"),
        "by_branch": _breakdown(people, "branch"),
    }

    # --------------------------------------------------- joiners / exits
    P = HrEmployeeProfile
    joiner_rows = (
        db.query(User.id, User.name, User.date_of_joining, Department.name, HrDesignation.name, User.department, User.designation)
        .outerjoin(P, P.user_id == User.id)
        .outerjoin(Department, Department.id == P.department_id)
        .outerjoin(HrDesignation, HrDesignation.id == P.designation_id)
        .filter(people_filter(), User.date_of_joining >= month_start, User.date_of_joining <= month_end)
        .order_by(User.date_of_joining.asc(), User.name.asc())
        .all()
    )
    joiners = [
        {"user_id": uid, "name": name, "date": doj, "department": dname or udept, "designation": desig or udesig}
        for uid, name, doj, dname, desig, udept, udesig in joiner_rows
    ]
    # Joinings raised in HR Lifecycle but not completed yet (candidate may
    # not have a portal account).
    pending_joinings = (
        db.query(HrLifecycleEvent)
        .filter(HrLifecycleEvent.event_type == "joining", HrLifecycleEvent.status.in_(OPEN_EVENT_STATUSES),
                HrLifecycleEvent.effective_date.isnot(None),
                HrLifecycleEvent.effective_date >= month_start, HrLifecycleEvent.effective_date <= month_end)
        .all()
    )
    joined_ids = {j["user_id"] for j in joiners}
    for ev in pending_joinings:
        if ev.user_id and ev.user_id in joined_ids:
            continue
        joiners.append({"user_id": ev.user_id, "name": ev.candidate_name or "Candidate", "date": ev.effective_date,
                        "department": None, "designation": None, "event_id": ev.id, "pending": True})

    exits: list[dict] = []
    exited_rows = (
        db.query(P.user_id, P.date_of_exit, User.name)
        .join(User, User.id == P.user_id)
        .filter(P.date_of_exit >= month_start, P.date_of_exit <= month_end)
        .all()
    )
    seen_exit: set[int] = set()
    for uid, dox, name in exited_rows:
        seen_exit.add(uid)
        exits.append({"user_id": uid, "name": name, "date": dox, "status": "exited"})
    exit_events = (
        db.query(HrLifecycleEvent)
        .filter(HrLifecycleEvent.event_type == "exit", HrLifecycleEvent.status.in_(OPEN_EVENT_STATUSES),
                HrLifecycleEvent.last_working_day.isnot(None),
                HrLifecycleEvent.last_working_day >= month_start, HrLifecycleEvent.last_working_day <= month_end)
        .all()
    )
    ev_names = _names(db, {e.user_id for e in exit_events if e.user_id})
    for ev in exit_events:
        if ev.user_id in seen_exit:
            continue
        exits.append({"user_id": ev.user_id, "name": ev_names.get(ev.user_id, "Employee"), "date": ev.last_working_day,
                      "status": "scheduled", "event_id": ev.id})
    joiners.sort(key=lambda j: (j["date"] or today, j["name"]))
    exits.sort(key=lambda e: (e["date"] or today, e["name"]))

    # ------------------------------------------------------ on leave today
    leave_rows = (
        db.query(HrLeaveRequest, User.name, HrLeaveType.code, HrLeaveType.name)
        .join(User, User.id == HrLeaveRequest.user_id)
        .join(HrLeaveType, HrLeaveType.id == HrLeaveRequest.leave_type_id)
        .filter(HrLeaveRequest.status == "approved", HrLeaveRequest.from_date <= today, HrLeaveRequest.to_date >= today)
        .order_by(User.name.asc())
        .all()
    )
    on_leave = [
        {"request_id": r.id, "user_id": r.user_id, "name": name, "leave_type": code, "leave_type_name": tname,
         "from_date": r.from_date, "to_date": r.to_date,
         "half_day": (r.from_date == today and r.from_session != "full") or (r.to_date == today and r.to_session != "full")}
        for r, name, code, tname in leave_rows
    ]

    # ---------------------------------------------------- attendance today
    att_counts = dict(
        db.query(HrAttendance.status, func.count(HrAttendance.id))
        .filter(HrAttendance.attendance_date == today, HrAttendance.user_id.in_(people_ids or {0}))
        .group_by(HrAttendance.status)
        .all()
    )
    marked = sum(att_counts.values())
    holidays_today = [
        h.name for h in db.query(HrHoliday).filter(HrHoliday.holiday_date == today, HrHoliday.is_active.is_(True),
                                                    HrHoliday.branch_id.is_(None)).all()
    ]
    attendance = {
        "date": today,
        "headcount": len(people_ids),
        "present": sum(att_counts.get(s, 0) for s in WORKING_STATUSES),
        "absent": att_counts.get("absent", 0),
        "on_leave": att_counts.get("on_leave", 0),
        "marked": marked,
        "not_marked": max(len(people_ids) - marked, 0),
        "by_status": [{"label": k, "count": v} for k, v in sorted(att_counts.items())],
        "holidays_today": holidays_today,
    }

    # --------------------------------------------------- pending approvals
    def _pending(model, status: str) -> dict:
        total, no_approver = db.query(
            func.count(model.id), func.count(model.id).filter(model.approver_id.is_(None))
        ).filter(model.status == status).one()
        return {"total": int(total or 0), "awaiting_hr": int(no_approver or 0)}

    pending_checklist = (
        db.query(func.count(HrChecklistItem.id))
        .join(HrLifecycleEvent, HrLifecycleEvent.id == HrChecklistItem.event_id)
        .filter(HrChecklistItem.status == "pending", HrLifecycleEvent.status.in_(OPEN_EVENT_STATUSES))
        .scalar() or 0
    )
    claims_to_pay, claims_to_pay_amount = db.query(
        func.count(HrExpenseClaim.id), func.coalesce(func.sum(HrExpenseClaim.total_amount), 0)
    ).filter(HrExpenseClaim.status == "approved").one()
    approvals = {
        "leave": _pending(HrLeaveRequest, "pending"),
        "regularization": _pending(HrAttendanceRegularization, "pending"),
        "travel": _pending(HrTravelRequest, "pending"),
        "expense": _pending(HrExpenseClaim, "submitted"),
        "claims_to_pay": int(claims_to_pay or 0),
        "claims_to_pay_amount": float(claims_to_pay_amount or 0),
        "checklist_items_pending": int(pending_checklist),
    }

    # --------------------------------------------- open lifecycle events
    open_counts = dict(
        db.query(HrLifecycleEvent.event_type, func.count(HrLifecycleEvent.id))
        .filter(HrLifecycleEvent.status.in_(OPEN_EVENT_STATUSES))
        .group_by(HrLifecycleEvent.event_type)
        .all()
    )
    due = func.coalesce(HrLifecycleEvent.last_working_day, HrLifecycleEvent.effective_date)
    open_events_rows = (
        db.query(HrLifecycleEvent)
        .filter(HrLifecycleEvent.status.in_(OPEN_EVENT_STATUSES))
        .order_by(due.asc().nullslast(), HrLifecycleEvent.id.desc())
        .limit(LIST_LIMIT)
        .all()
    )
    ev_ids = [e.id for e in open_events_rows]
    progress: dict[int, tuple[int, int]] = {}
    if ev_ids:
        for eid, total, done in (
            db.query(HrChecklistItem.event_id, func.count(HrChecklistItem.id),
                     func.count(HrChecklistItem.id).filter(HrChecklistItem.status != "pending"))
            .filter(HrChecklistItem.event_id.in_(ev_ids))
            .group_by(HrChecklistItem.event_id)
            .all()
        ):
            progress[eid] = (int(total), int(done))
    subj = _names(db, {e.user_id for e in open_events_rows if e.user_id})
    lifecycle = {
        "total_open": sum(open_counts.values()),
        "by_type": [{"label": k, "count": v} for k, v in sorted(open_counts.items())],
        "events": [
            {"id": e.id, "event_no": e.event_no, "event_type": e.event_type, "status": e.status,
             "name": subj.get(e.user_id) if e.user_id else (e.candidate_name or "Candidate"),
             "due_date": e.last_working_day or e.effective_date,
             "items_total": progress.get(e.id, (0, 0))[0], "items_done": progress.get(e.id, (0, 0))[1]}
            for e in open_events_rows
        ],
    }

    # --------------------------------------------------------------- assets
    asset_counts = dict(
        db.query(HrAsset.status, func.count(HrAsset.id)).filter(HrAsset.is_deleted.is_(False)).group_by(HrAsset.status).all()
    )
    assets = {
        "total": sum(asset_counts.values()),
        "issued": asset_counts.get("issued", 0),
        "in_stock": asset_counts.get("in_stock", 0),
        "under_repair": asset_counts.get("under_repair", 0),
        "lost": asset_counts.get("lost", 0),
        "retired": asset_counts.get("retired", 0),
        # Assets still held by someone HR has exited or who is deactivated.
        "held_by_inactive": int(
            db.query(func.count(HrAsset.id))
            .join(User, User.id == HrAsset.current_holder_id)
            .outerjoin(P, P.user_id == User.id)
            .filter(HrAsset.is_deleted.is_(False), HrAsset.status == "issued",
                    or_(User.is_active.is_(False), P.employment_status == "exited"))
            .scalar() or 0
        ),
    }

    # ------------------------------------------------------------- visitors
    inside_rows = (
        db.query(HrVisitor, User.name)
        .join(User, User.id == HrVisitor.host_user_id)
        .filter(HrVisitor.status == "checked_in")
        .order_by(HrVisitor.check_in_at.asc().nullslast())
        .all()
    )
    visitors = {
        "inside_now": len(inside_rows),
        "persons_inside": sum(int(v.number_of_persons or 1) for v, _ in inside_rows),
        "expected_today": int(
            db.query(func.count(HrVisitor.id))
            .filter(HrVisitor.status == "expected", HrVisitor.expected_at.isnot(None),
                    func.date(func.timezone("Asia/Kolkata", HrVisitor.expected_at)) == today)
            .scalar() or 0
        ),
        "inside": [
            {"id": v.id, "visit_no": v.visit_no, "visitor_name": v.visitor_name, "visitor_company": v.visitor_company,
             "host_name": host, "check_in_at": v.check_in_at, "badge_no": v.badge_no, "number_of_persons": v.number_of_persons}
            for v, host in inside_rows[:LIST_LIMIT]
        ],
    }

    # -------------------------------------------------- expiring documents
    doc_q = (
        db.query(UserDocument, User.name)
        .join(User, User.id == UserDocument.user_id)
        .filter(User.is_active.is_(True), UserDocument.expiry_date.isnot(None), UserDocument.expiry_date <= window_end)
    )
    expired_count = doc_q.filter(UserDocument.expiry_date < today).count()
    doc_rows = doc_q.filter(UserDocument.expiry_date >= today).order_by(UserDocument.expiry_date.asc()).all()
    documents = {
        "expiring_count": len(doc_rows),
        "expired_count": int(expired_count),
        "items": [
            {"document_id": d.id, "user_id": d.user_id, "name": name, "document_type": d.document_type,
             "document_name": d.document_name, "expiry_date": d.expiry_date, "days_left": (d.expiry_date - today).days}
            for d, name in doc_rows[:LIST_LIMIT]
        ],
    }

    # --------------------------------------------------------- probation
    prob_rows = (
        db.query(P, User.name)
        .join(User, User.id == P.user_id)
        .filter(User.is_active.is_(True), P.employment_status.in_(("onboarding", "probation")),
                P.probation_end_date.isnot(None), P.probation_end_date <= window_end)
        .order_by(P.probation_end_date.asc())
        .all()
    )
    probation = {
        "count": len(prob_rows),
        "overdue_count": sum(1 for p, _ in prob_rows if p.probation_end_date < today),
        "items": [
            {"user_id": p.user_id, "name": name, "probation_end_date": p.probation_end_date,
             "days_left": (p.probation_end_date - today).days, "employment_status": p.employment_status}
            for p, name in prob_rows[:LIST_LIMIT]
        ],
    }

    # Profiles HR hasn't created yet — the biggest data-quality gap early on.
    missing_profiles = sum(1 for r in people if r.status == "no_profile")

    return {
        "today": today,
        "month_start": month_start,
        "month_end": month_end,
        "headcount": headcount,
        "missing_profiles": missing_profiles,
        "joiners_this_month": joiners[:LIST_LIMIT * 2],
        "joiners_count": len(joiners),
        "exits_this_month": exits[:LIST_LIMIT * 2],
        "exits_count": len(exits),
        "on_leave_today": on_leave,
        "attendance_today": attendance,
        "approvals": approvals,
        "lifecycle": lifecycle,
        "assets": assets,
        "visitors": visitors,
        "documents": documents,
        "probation": probation,
    }


__all__ = ["build_dashboard"]
