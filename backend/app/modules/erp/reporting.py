"""Service & Commissioning reports (Reports tab) for the shared reports framework
(app/core/reporting).

Two datasets, both computed in Python over narrow-column selects so SQLite
(tests) and Postgres behave the same:

    sr     one row per service request (scoped with apply_scope)
    visit  one row per engineer visit, loaded ONLY through a scoped SR

Derived figures follow docs/agent-runs/2026-10-26-reports-framework: response
hours, resolution days, target date (never called SLA), on time, overdue, age
bucket, come-back, visit effort and money roll-ups. Per-engineer SR figures use
the CURRENT assignee (no assignment history exists); visit figures use the
engineer who made the visit. Cancelled SRs have no cancel timestamp, so they are
left out of timing and pending figures.
"""
from __future__ import annotations

import statistics
from collections import defaultdict
import dataclasses
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope
from app.core.reporting import (
    NONE_TOKEN, DashboardDef, DashboardPage, DateField, DetailColumn, Dimension, FilterDef, Measure, ReportChart, ReportCtx,
    ReportDataset, ReportDef, ReportKpi, ReportResult, VisualSpec, get_dataset, register_dashboard, register_dataset,
    register_report, token,
)
from app.modules.crm.models.organization import Organization
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import (
    SR_BILLING_STATUSES, SR_PRIORITIES, SR_SERVICE_TYPES, SR_WARRANTY_STATUSES, ServiceRequest,
)
from app.modules.erp.models.service_visit import ServiceVisit
from app.modules.erp.schemas.service_request import SR_STATUSES
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch

IST = timezone(timedelta(hours=5, minutes=30))
SR_PAGE = "/dashboard/erp/service-requests"
MACHINE_PAGE = "/dashboard/projects/service-projects"

OPEN_STATUSES = frozenset({"open", "acknowledged", "assigned", "scheduled", "in_progress", "pending_parts", "on_hold"})
AWAITING_CLOSURE = frozenset({"work_completed", "review"})
DONE_STATUSES = frozenset({"work_completed", "review", "closed"})
PLANNED_TYPES = frozenset({"installation_commissioning", "amc", "inspection_maintenance"})
COMEBACK_DAYS = 30
# Bucket codes sort in age order (b1 youngest).
AGE_LABELS = {"b1": "0-2 days", "b2": "3-7 days", "b3": "8-15 days", "b4": "16-30 days",
              "b5": "31-60 days", "b6": "Over 60 days"}
STATUS_GROUP_LABELS = {"open": "Open", "awaiting_closure": "Awaiting closure", "closed": "Closed", "cancelled": "Cancelled"}
NOT_ASSIGNED = "Not assigned"


# ── Time helpers ────────────────────────────────────────────────────────────

def _aware(dt: datetime | None) -> datetime | None:
    """Naive datetimes (SQLite tests, imports) are UTC, like erp/sla.py."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _ist_date(dt: datetime | None) -> date | None:
    dt = _aware(dt)
    return dt.astimezone(IST).date() if dt is not None else None


def _naive_ist(dt: datetime | None) -> datetime | None:
    dt = _aware(dt)
    return dt.astimezone(IST).replace(tzinfo=None) if dt is not None else None


def _hours(a: datetime | None, b: datetime | None) -> float | None:
    a, b = _aware(a), _aware(b)
    if a is None or b is None:
        return None
    return max(0.0, (b - a).total_seconds() / 3600.0)


def _bucket_age(days: int) -> str:
    for code, limit in (("b1", 2), ("b2", 7), ("b3", 15), ("b4", 30), ("b5", 60)):
        if days <= limit:
            return code
    return "b6"


def _label(value: str | None) -> str:
    if not value:
        return "-"
    if value == "unknown":
        return "Not set"
    return " ".join("AMC" if w == "amc" else w.capitalize() for w in value.split("_"))


# ── Loading ─────────────────────────────────────────────────────────────────

_SR_COLS = (
    ("sr_id", ServiceRequest.id), ("request_number", ServiceRequest.request_number),
    ("issue", ServiceRequest.issue_title), ("category_raw", ServiceRequest.issue_category),
    ("sub_category_raw", ServiceRequest.sub_category), ("failure_mode", ServiceRequest.failure_mode),
    ("root_cause", ServiceRequest.root_cause), ("service_type", ServiceRequest.service_type),
    ("status", ServiceRequest.status), ("priority", ServiceRequest.priority),
    ("warranty_status", ServiceRequest.warranty_status), ("is_chargeable", ServiceRequest.is_chargeable),
    ("contract_id", ServiceRequest.service_contract_id), ("billing_status", ServiceRequest.billing_status),
    ("invoice_number", ServiceRequest.invoice_number), ("assignee_id", ServiceRequest.assigned_service_person_id),
    ("assigned_to_name", ServiceRequest.assigned_to_name), ("created_by_id", ServiceRequest.created_by_id),
    ("opened_at", ServiceRequest.opened_at), ("created_at", ServiceRequest.created_at),
    ("updated_at", ServiceRequest.updated_at), ("first_response_at", ServiceRequest.first_response_at),
    ("resolution_at", ServiceRequest.resolution_at), ("closed_at", ServiceRequest.closed_at),
    ("expected_completion", ServiceRequest.expected_completion_date),
    ("sla_resolution_due_at", ServiceRequest.sla_resolution_due_at),
    ("attended_on", ServiceRequest.actual_date_attended),
    ("service_cost", ServiceRequest.service_cost), ("transport_cost", ServiceRequest.transport_cost),
    ("accommodation_cost", ServiceRequest.accommodation_cost), ("miscellaneous_cost", ServiceRequest.miscellaneous_cost),
    ("total_material_cost", ServiceRequest.total_material_cost), ("tax_amount", ServiceRequest.tax_amount),
    ("total_bill", ServiceRequest.total_bill), ("material_cost_actual", ServiceRequest.material_cost_actual),
    ("project_id", ServiceRequest.project_id),
    ("serial", Project.serial_number), ("model", Project.model_name), ("machine_type", Project.machine_type),
    ("customer_id", Project.customer_id), ("org_name", Organization.name), ("client_company", Project.client_company),
    ("site_name", Project.site_name), ("site_location", Project.site_location),
    ("site_state", Project.site_state), ("zone", Project.zone),
)

_VISIT_COLS = (
    ("visit_id", ServiceVisit.id), ("sr_id", ServiceVisit.service_request_id),
    ("engineer_id", ServiceVisit.engineer_id), ("visit_date", ServiceVisit.visit_date),
    ("travel_start", ServiceVisit.travel_start), ("arrive_at", ServiceVisit.arrive_at),
    ("depart_at", ServiceVisit.depart_at), ("work_h", ServiceVisit.work_hours),
    ("travel_h", ServiceVisit.travel_hours), ("km", ServiceVisit.km),
    ("travel_cost", ServiceVisit.travel_cost), ("stay_cost", ServiceVisit.stay_cost),
    ("misc_cost", ServiceVisit.misc_cost), ("work_done", ServiceVisit.work_done),
    ("sign_name", ServiceVisit.customer_sign_name), ("signed_at", ServiceVisit.customer_signed_at),
)


def _f(v: Any) -> float:
    return float(v or 0)


def _scoped_sr_query(db: Session, user: Any):
    """Every SR read starts here: live rows only, inside the viewer's data scope."""
    q = (
        db.query(*[c for _, c in _SR_COLS])
        .select_from(ServiceRequest)
        .join(Project, Project.id == ServiceRequest.project_id)
        .outerjoin(Organization, Organization.id == Project.customer_id)
        .filter(ServiceRequest.is_deleted == False)  # noqa: E712
    )
    return apply_scope(q, user, ServiceRequest)


def _load_all(db: Session, user: Any, today: date) -> tuple[list[dict], list[dict]]:
    """(sr rows, visit rows). Names come from ONE users query; visits are read in
    ONE query restricted to the scoped SR ids."""
    names = [n for n, _ in _SR_COLS]
    sr_rows = [dict(zip(names, r)) for r in _scoped_sr_query(db, user).order_by(ServiceRequest.id).all()]
    ids_q = apply_scope(
        db.query(ServiceRequest.id).filter(ServiceRequest.is_deleted == False), user, ServiceRequest,  # noqa: E712
    ).subquery()
    vnames = [n for n, _ in _VISIT_COLS]
    visit_raw = [
        dict(zip(vnames, r)) for r in
        db.query(*[c for _, c in _VISIT_COLS]).filter(ServiceVisit.service_request_id.in_(select(ids_q.c.id)))
        .order_by(ServiceVisit.visit_date, ServiceVisit.id).all()
    ]
    user_ids: set[int] = set()
    for r in sr_rows:
        for k in ("assignee_id", "created_by_id"):
            if r[k]:
                user_ids.add(r[k])
    for v in visit_raw:
        user_ids.add(v["engineer_id"])
    people: dict[int, tuple[str, int | None]] = {}
    if user_ids:
        for uid, name, branch_id in db.query(User.id, User.name, User.branch_id).filter(User.id.in_(user_ids)).all():
            people[uid] = (name or f"User {uid}", branch_id)
    plant_ids = {b for _, b in people.values() if b}
    plants: dict[int, str] = {}
    if plant_ids:
        plants = {i: n for i, n in db.query(Branch.id, Branch.name).filter(Branch.id.in_(plant_ids)).all()}

    visits_by_sr: dict[int, list[dict]] = defaultdict(list)
    for v in visit_raw:
        visits_by_sr[v["sr_id"]].append(v)

    out: list[dict] = []
    for r in sr_rows:
        out.append(_derive_sr(r, visits_by_sr.get(r["sr_id"], []), people, plants, today))
    _mark_comebacks(out)
    by_id = {r["sr_id"]: r for r in out}
    visit_rows = [_derive_visit(v, by_id[v["sr_id"]], people) for v in visit_raw if v["sr_id"] in by_id]
    return out, visit_rows


COVER_LABELS = {"warranty": "In warranty", "amc": "AMC / contract", "chargeable": "Chargeable", "other": "Other"}


def _cover(r: dict) -> str:
    """Who pays: contract / AMC first, then warranty, then chargeable."""
    if r["contract_id"] or r["service_type"] == "amc" or r["warranty_status"] == "amc":
        return "amc"
    if r["warranty_status"] in ("in_warranty", "extended_warranty") or r["service_type"] == "warranty":
        return "warranty"
    return "chargeable" if r["is_chargeable"] is True else "other"


def _derive_sr(r: dict, visits: list[dict], people: dict, plants: dict, today: date) -> dict:
    status = (r["status"] or "open").lower()
    sg = ("cancelled" if status == "cancelled" else "closed" if status == "closed"
          else "awaiting_closure" if status in AWAITING_CLOSURE else "open")
    open_ts = _aware(r["opened_at"] or r["created_at"])
    reported_on = _ist_date(open_ts)
    done_ts = _aware(r["resolution_at"] or r["closed_at"]) if status in DONE_STATUSES else None
    done_on = _ist_date(done_ts)
    target = r["expected_completion"] or _ist_date(r["sla_resolution_due_at"])
    on_time = (done_on <= target) if (done_on is not None and target is not None) else None
    live = sg in ("open", "awaiting_closure")
    overdue = bool(sg == "open" and target is not None and target < today)
    age_days = max(0, (today - reported_on).days) if (live and reported_on) else None
    resp = _hours(open_ts, r["first_response_at"]) if sg != "cancelled" else None
    resolution = (max(0.0, (done_ts - open_ts).total_seconds() / 86400.0) if (done_ts and open_ts) else None)
    reach = ((r["attended_on"] - reported_on).days if (r["attended_on"] and reported_on and sg != "cancelled") else None)
    eng_id = r["assignee_id"]
    eng_name = (people.get(eng_id, (r["assigned_to_name"] or f"User {eng_id}", None))[0] if eng_id else NOT_ASSIGNED)
    creator = people.get(r["created_by_id"]) if r["created_by_id"] else None
    plant_id = creator[1] if creator else None
    v_work = sum(_f(v["work_h"]) for v in visits)
    v_travel = sum(_f(v["travel_h"]) for v in visits)
    v_km = sum(_f(v["km"]) for v in visits)
    v_exp = sum(_f(v["travel_cost"]) + _f(v["stay_cost"]) + _f(v["misc_cost"]) for v in visits)
    actual_cost = _f(r["material_cost_actual"]) + v_exp
    bill = _f(r["total_bill"])
    billing = r["billing_status"]
    customer = r["org_name"] or r["client_company"] or "No customer"
    return {
        "sr_id": r["sr_id"], "project_id": r["project_id"], "request_number": r["request_number"],
        "issue": r["issue"],
        "category": r["category_raw"] or "Uncategorised", "sub_category": r["sub_category_raw"] or "-",
        "failure_mode": r["failure_mode"] or "-", "root_cause": r["root_cause"],
        "service_type": r["service_type"] or "unknown", "status": status, "status_group": sg,
        "priority": r["priority"] or "standard", "warranty_status": r["warranty_status"] or "unknown",
        "is_chargeable": r["is_chargeable"],
        "chargeable": "chargeable" if r["is_chargeable"] is True else "free" if r["is_chargeable"] is False else "unknown",
        "contract": "yes" if r["contract_id"] else "no", "billing_status": billing or "not_billable",
        "cover": _cover(r),
        "invoice_number": r["invoice_number"],
        "engineer_id": eng_id, "engineer": eng_name,
        "raised_by_id": r["created_by_id"],
        "raised_by": creator[0] if creator else "-",
        "plant_id": plant_id, "plant": plants.get(plant_id, "No plant") if plant_id else "No plant",
        "open_ts": open_ts, "reported_on": reported_on,
        "first_response_ts": _naive_ist(r["first_response_at"]), "response_h": resp,
        "attended_on": r["attended_on"], "reach_days": reach,
        "done_ts": done_ts, "done_on": done_on, "is_done": done_ts is not None,
        "closed_on": _ist_date(r["closed_at"]), "resolution_days": resolution,
        "target_date": target, "on_time": on_time,
        "on_time_label": "on_time" if on_time is True else "late" if on_time is False else "no_target",
        "overdue": overdue, "overdue_label": "yes" if overdue else "no",
        "days_overdue": (today - target).days if overdue else None,
        "age_days": age_days, "age_bucket": _bucket_age(age_days) if age_days is not None else None,
        "last_activity": _ist_date(r["updated_at"]),
        "customer_id": r["customer_id"], "customer": customer,
        "customer_label": r["org_name"] or "No customer linked",
        "serial": r["serial"], "model": r["model"] or "-", "machine_type": r["machine_type"] or "-",
        "site": r["site_name"] or r["site_location"] or "-", "site_name": r["site_name"],
        "site_location": r["site_location"], "zone": r["zone"] or "-", "site_state": r["site_state"] or "-",
        "visit_count": len(visits), "visit_work_h": v_work, "visit_travel_h": v_travel, "visit_km": v_km,
        "visit_expenses": v_exp, "has_visits": bool(visits),
        "service_cost": _f(r["service_cost"]), "transport_cost": _f(r["transport_cost"]),
        "accommodation_cost": _f(r["accommodation_cost"]), "miscellaneous_cost": _f(r["miscellaneous_cost"]),
        "total_material_cost": _f(r["total_material_cost"]), "tax_amount": _f(r["tax_amount"]),
        "total_bill": bill, "material_cost_actual": _f(r["material_cost_actual"]),
        "actual_cost": actual_cost, "gross_margin": bill - _f(r["tax_amount"]) - actual_cost,
        "to_bill": bill if billing == "to_bill" else 0.0,
        "invoiced": bill if billing in ("invoiced", "paid") else 0.0,
        "paid": bill if billing == "paid" else 0.0,
        "comeback": False,
        "_planned": (r["service_type"] or "") in PLANNED_TYPES,
    }


def _mark_comebacks(rows: list[dict]) -> None:
    """Come-back: opened within 30 days after the previous (non-planned) SR on the
    same machine finished (or was opened, when it never finished)."""
    by_machine: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        if not r["_planned"] and r["status_group"] != "cancelled" and r["open_ts"] is not None:
            by_machine[r["project_id"]].append(r)
    for group in by_machine.values():
        group.sort(key=lambda r: (r["open_ts"], r["sr_id"]))
        for prev, cur in zip(group, group[1:]):
            prev_end = prev["done_ts"] or prev["open_ts"]
            if cur["open_ts"] <= prev_end + timedelta(days=COMEBACK_DAYS):
                cur["comeback"] = True


def _derive_visit(v: dict, sr: dict, people: dict) -> dict:
    arrive, depart = _aware(v["arrive_at"]), _aware(v["depart_at"])
    arrive_ist = arrive.astimezone(IST) if arrive else None
    depart_ist = depart.astimezone(IST) if depart else None
    on_site = ((depart - arrive).total_seconds() / 3600.0) if (arrive and depart and depart >= arrive) else None
    expenses = _f(v["travel_cost"]) + _f(v["stay_cost"]) + _f(v["misc_cost"])
    return {
        "visit_id": v["visit_id"], "sr_id": v["sr_id"], "project_id": sr["project_id"],
        "request_number": sr["request_number"], "visit_date": v["visit_date"],
        "engineer_id": v["engineer_id"], "engineer": people.get(v["engineer_id"], (f"User {v['engineer_id']}", None))[0],
        "travel_start": _naive_ist(v["travel_start"]),
        "arrived": arrive_ist.time().replace(microsecond=0) if arrive_ist else None,
        "left": depart_ist.time().replace(microsecond=0) if depart_ist else None,
        "arrival_hour": (arrive_ist.hour + arrive_ist.minute / 60.0) if arrive_ist else None,
        "on_site_h": on_site, "work_h": _f(v["work_h"]), "travel_h": _f(v["travel_h"]), "km": _f(v["km"]),
        "travel_cost": _f(v["travel_cost"]), "stay_cost": _f(v["stay_cost"]), "misc_cost": _f(v["misc_cost"]),
        "expenses": expenses, "signed": bool(v["signed_at"] or v["sign_name"]),
        "signed_label": "yes" if (v["signed_at"] or v["sign_name"]) else "no", "sign_name": v["sign_name"],
        "work_done": v["work_done"],
        "engineer_day": f"{v['engineer_id']}|{v['visit_date']}",
        "arrival_hour_bucket": int(arrive_ist.hour) if arrive_ist else None,
        "customer": sr["customer"], "customer_id": sr["customer_id"], "customer_label": sr["customer_label"],
        "serial": sr["serial"], "site": sr["site"], "zone": sr["zone"],
        "plant_id": sr["plant_id"], "plant": sr["plant"],
        "service_type": sr["service_type"], "priority": sr["priority"], "sr_status_group": sr["status_group"],
    }


def load_sr_rows(ctx: Any, window: Any = None) -> list[dict]:
    """Dataset `sr` loader: every SR in the viewer's scope (the engine applies the
    date window, filters and search; the whole history is read so come-backs and
    pending-now figures do not depend on the chosen period)."""
    return _load_all(ctx.db, ctx.user, ctx.today)[0]


def load_visit_rows(ctx: Any, window: Any = None) -> list[dict]:
    """Dataset `visit` loader: visits of scoped SRs only."""
    return _load_all(ctx.db, ctx.user, ctx.today)[1]


# ── Filter helpers ──────────────────────────────────────────────────────────

def _vals(value: Any) -> set[str]:
    if value is None or value == "":
        return set()
    if isinstance(value, (list, tuple, set, frozenset)):
        return {str(v).strip() for v in value if str(v).strip() != ""}
    return {s.strip() for s in str(value).split(",") if s.strip()}


def _is_on(value: Any) -> bool:
    return value is True or str(value).strip().lower() in ("1", "true", "yes", "on")


def _in(field: str) -> Callable[[dict, Any], bool]:
    def match(row: dict, value: Any) -> bool:
        want = _vals(value)
        if not want:
            return True
        return token(row.get(field)) in want
    return match


def _int_cmp(field: str, op: str) -> Callable[[dict, Any], bool]:
    def match(row: dict, value: Any) -> bool:
        cur = row.get(field)
        if value in (None, ""):
            return True
        if cur is None:
            return False
        return cur >= float(value) if op == "min" else cur <= float(value)
    return match


def _flag(field: str) -> Callable[[dict, Any], bool]:
    def match(row: dict, value: Any) -> bool:
        return bool(row.get(field)) if _is_on(value) else True
    return match


def _opts_enum(values: Iterable[str]) -> tuple[tuple[str, str], ...]:
    return tuple((v, _label(v)) for v in values)


def filter_rows(filters: tuple, rows: list[dict], values: dict[str, Any]) -> list[dict]:
    """AND the chosen filters over `rows` (used by composite reports; the engine
    does the same for pivot reports)."""
    by_key = {f.key: f for f in filters}
    active = [(by_key[k], v) for k, v in (values or {}).items() if k in by_key and by_key[k].match and v not in (None, "", [])]
    return [r for r in rows if all(f.match(r, v) for f, v in active)]


# ── Scoped lookups for filter options (only rows inside the viewer's scope) ─

def _lookup(ctx: Any, q: str, pairs: Callable[[list[dict], list[dict]], Iterable[tuple[Any, str]]]) -> list[dict]:
    srs, visits = _load_all(ctx.db, ctx.user, ctx.today)
    seen: dict[str, str] = {}
    for value, label in pairs(srs, visits):
        if value is None or label is None:
            continue
        seen.setdefault(str(value), str(label))
    needle = (q or "").strip().lower()
    items = [{"value": v, "label": l} for v, l in seen.items() if not needle or needle in l.lower()]
    items.sort(key=lambda i: (i["label"].lower(), i["value"]))
    return items[:50]


def _people_options(ctx: Any, q: str) -> list[dict]:
    """Distinct assignees + visit engineers inside the scope. Without the
    People & performance right only "Me"."""
    if not ctx.sees_people:
        return [{"value": str(ctx.user.id), "label": f"Me ({ctx.user.name or ctx.user.email})"}]

    def pairs(srs, visits):
        for r in srs:
            yield r["engineer_id"], r["engineer"]
        for v in visits:
            yield v["engineer_id"], v["engineer"]
    return _lookup(ctx, q, pairs)


def _raised_by_options(ctx: Any, q: str) -> list[dict]:
    if not ctx.sees_people:
        return [{"value": str(ctx.user.id), "label": f"Me ({ctx.user.name or ctx.user.email})"}]
    return _lookup(ctx, q, lambda srs, v: ((r["raised_by_id"], r["raised_by"]) for r in srs))


def _customer_options(ctx: Any, q: str) -> list[dict]:
    return _lookup(ctx, q, lambda srs, v: ((r["customer_id"], r["customer"]) for r in srs if r["customer_id"]))


def _machine_options(ctx: Any, q: str) -> list[dict]:
    return _lookup(ctx, q, lambda srs, v: ((r["project_id"], r["serial"]) for r in srs))


def _plant_options(ctx: Any, q: str) -> list[dict]:
    return _lookup(ctx, q, lambda srs, v: ((r["plant_id"], r["plant"]) for r in srs if r["plant_id"]))


def _distinct(field: str) -> Callable[[Any, str], list[dict]]:
    def fn(ctx: Any, q: str) -> list[dict]:
        return _lookup(ctx, q, lambda srs, v: ((r[field], r[field]) for r in srs if r[field] not in (None, "-")))
    return fn


# ── Statistics (also used by the composite report) ─────────────────────────

def _avg(xs: list[float]) -> float | None:
    return (sum(xs) / len(xs)) if xs else None


def _median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _month_bounds(key: str) -> tuple[date, date]:
    y, m = int(key[:4]), int(key[5:7])
    start = date(y, m, 1)
    nxt = date(y + (m == 12), (m % 12) + 1, 1)
    return start, nxt - timedelta(days=1)


def _months_between(d_from: date, d_to: date) -> list[str]:
    out, cur = [], date(d_from.year, d_from.month, 1)
    while cur <= d_to:
        out.append(_month_key(cur))
        cur = date(cur.year + (cur.month == 12), (cur.month % 12) + 1, 1)
    return out


# ── Engineer performance (composite) ───────────────────────────────────────

def perf_figures(srs: list[dict], visits: list[dict], d_from: date, d_to: date,
                 snapshot: Callable[[dict], bool] | None = None) -> dict[str, Any]:
    """Figures of one engineer (or one engineer-month) over [d_from, d_to].
    `snapshot` narrows the "now" columns (pending / overdue / awaiting)."""
    def inr(d: date | None) -> bool:
        return d is not None and d_from <= d <= d_to

    live = [s for s in srs if s["status_group"] != "cancelled"]
    assigned = [s for s in live if inr(s["reported_on"])]
    completed = [s for s in live if inr(s["done_on"])]
    snap = [s for s in live if (snapshot is None or snapshot(s))]
    with_target = [s for s in completed if s["on_time"] is not None]
    on_time = [s for s in with_target if s["on_time"]]
    vis = [v for v in visits if inr(v["visit_date"])]
    arrivals = [v["arrival_hour"] for v in vis if v["arrival_hour"] is not None]
    return {
        "assigned": len(assigned),
        "completed": len(completed),
        "on_time_n": len(on_time),
        "with_target_done": len(with_target),
        "on_time_pct": (len(on_time) / len(with_target)) if with_target else None,
        "pending_now": sum(1 for s in snap if s["status_group"] == "open"),
        "overdue_now": sum(1 for s in snap if s["overdue"]),
        "awaiting_closure": sum(1 for s in snap if s["status_group"] == "awaiting_closure"),
        "response_h.avg": _avg([s["response_h"] for s in assigned if s["response_h"] is not None]),
        "resolution_days.avg": _avg([s["resolution_days"] for s in completed if s["resolution_days"] is not None]),
        "resolution_days.median": _median([s["resolution_days"] for s in completed if s["resolution_days"] is not None]),
        "reach_days.avg": _avg([s["reach_days"] for s in assigned if s["reach_days"] is not None]),
        "comebacks": sum(1 for s in assigned if s["comeback"]),
        "visit_count": len(vis),
        "days_on_site": len({v["visit_date"] for v in vis}),
        "work_h.sum": sum(v["work_h"] for v in vis),
        "travel_h.sum": sum(v["travel_h"] for v in vis),
        "km.sum": sum(v["km"] for v in vis),
        "arrival_hour.avg": _avg(arrivals),
        "billed": sum(s["total_bill"] for s in completed if s["billing_status"] in ("invoiced", "paid")),
        "expenses.sum": sum(v["expenses"] for v in vis),
    }


PERF_MEASURES = (
    Measure("assigned", "Assigned", "int", "none", group="Counts"),
    Measure("completed", "Completed", "int", "none", group="Counts", better="up"),
    Measure("on_time_n", "Completed on time", "int", "none", group="Counts", better="up"),
    Measure("on_time_pct", "On-time %", "percent", "none", group="Counts", better="up"),
    Measure("pending_now", "Pending now", "int", "none", group="Counts", better="down"),
    Measure("overdue_now", "Overdue now", "int", "none", group="Counts", better="down"),
    Measure("awaiting_closure", "Awaiting closure", "int", "none", group="Counts"),
    Measure("response_h.avg", "Avg response (h)", "hours", "none", group="Time", better="down"),
    Measure("resolution_days.avg", "Avg resolution (days)", "days", "none", group="Time", better="down"),
    Measure("resolution_days.median", "Median resolution (days)", "days", "none", group="Time", better="down"),
    Measure("reach_days.avg", "Avg time to reach site (days)", "days", "none", group="Time", better="down"),
    Measure("comebacks", "Come-backs", "int", "none", group="Counts", better="down"),
    Measure("visit_count", "Visits", "int", "none", group="Effort"),
    Measure("days_on_site", "Days on site", "int", "none", group="Effort"),
    Measure("work_h.sum", "Work hours", "hours", "none", group="Effort"),
    Measure("travel_h.sum", "Travel hours", "hours", "none", group="Effort"),
    Measure("km.sum", "Km", "decimal", "none", group="Effort"),
    Measure("arrival_hour.avg", "Avg arrival hour (IST)", "decimal", "none", group="Time"),
    Measure("billed", "Billed value", "money", "none", money=True, group="Money"),
    Measure("expenses.sum", "Visit expenses", "money", "none", money=True, group="Money"),
)
_NOT_CANCELLED = "open,awaiting_closure,closed"


def _perf_drills(d_from: date, d_to: date, eng: str, child: bool) -> dict[str, dict[str, str]]:
    """The records behind every figure of one engineer row (child = month row:
    "now" figures then count requests reported in that month)."""
    rng = {"date_from": d_from.isoformat(), "date_to": d_to.isoformat()}
    sr = {"report": "sr_explorer", "f_engineer": eng}
    visit = {"report": "visit_explorer", "date_field": "visit_date", "f_engineer": eng, **rng}
    opened = {**sr, "date_field": "opened", "f_status_group": _NOT_CANCELLED, **rng}
    done = {**sr, "date_field": "done", "f_completed": "1", **rng}
    now = ({**sr, "date_field": "opened", **rng} if child else {**sr, "date_field": "none"})
    return {
        "assigned": opened,
        "completed": done,
        "on_time_n": {**done, "f_on_time": "on_time"},
        "on_time_pct": {**done, "f_on_time": "on_time,late"},
        "pending_now": {**now, "f_status_group": "open"},
        "overdue_now": {**now, "f_status_group": "open", "f_overdue": "yes"},
        "awaiting_closure": {**now, "f_status_group": "awaiting_closure"},
        "response_h.avg": opened, "resolution_days.avg": done, "resolution_days.median": done,
        "reach_days.avg": opened, "comebacks": {**opened, "f_comeback": "1"},
        "visit_count": visit, "days_on_site": visit, "work_h.sum": visit, "travel_h.sum": visit,
        "km.sum": visit, "arrival_hour.avg": visit, "expenses.sum": visit,
        "billed": {**done, "f_billing_status": "invoiced,paid"},
    }


def _has_work(figs: dict[str, Any]) -> bool:
    return any(v not in (None, 0, 0.0) for k, v in figs.items() if k != "on_time_pct")


def engineer_performance(ctx: ReportCtx) -> ReportResult:
    """One row per engineer plus "Not assigned" (optionally with month children, or
    months with engineer children). Without People & performance the viewer sees
    only their own row ("My performance")."""
    srs_all, visits_all = _load_all(ctx.db, ctx.user, ctx.today)
    srs = filter_rows(SR_FILTERS, srs_all, ctx.filters)
    visits = filter_rows(VISIT_FILTERS, visits_all, ctx.filters)
    if ctx.self_only or not ctx.sees_people:
        srs = [s for s in srs if s["engineer_id"] == ctx.user.id]
        visits = [v for v in visits if v["engineer_id"] == ctx.user.id]
    d_from, d_to = ctx.d_from, ctx.d_to
    if d_from is None or d_to is None:  # "all dates"
        dates = [s["reported_on"] for s in srs if s["reported_on"]] + [v["visit_date"] for v in visits]
        d_from, d_to = (min(dates) if dates else ctx.today), ctx.today
    by_sr: dict[Any, list[dict]] = defaultdict(list)
    for s in srs:
        by_sr[s["engineer_id"]].append(s)
    by_v: dict[Any, list[dict]] = defaultdict(list)
    for v in visits:
        by_v[v["engineer_id"]].append(v)
    names: dict[Any, str] = {None: NOT_ASSIGNED}
    for s in srs:
        names[s["engineer_id"]] = s["engineer"]
    for v in visits:
        names.setdefault(v["engineer_id"], v["engineer"])
    engineers = set(by_sr) | set(by_v)
    month_first = ctx.group_by == "period_month"
    with_months = month_first or ctx.group_by2 == "period_month"
    months = _months_between(d_from, d_to) if with_months else []

    def figs_for(eng_list: Iterable[Any], f: date, t: date, month_snapshot: bool) -> dict[str, Any]:
        s_all = [s for e in eng_list for s in by_sr.get(e, [])]
        v_all = [v for e in eng_list for v in by_v.get(e, [])]
        snap = (lambda s: f <= (s["reported_on"] or date.min) <= t) if month_snapshot else None
        return perf_figures(s_all, v_all, f, t, snap)

    def eng_key(e: Any) -> str:
        return NONE_TOKEN if e is None else str(e)

    def month_range(m: str) -> tuple[date, date]:
        a, b = _month_bounds(m)
        return max(a, d_from), min(b, d_to)

    def engineer_row(e: Any, f: date, t: date, child: bool) -> dict | None:
        figs = figs_for([e], f, t, child)
        if not _has_work(figs):
            return None
        return {"key": {"engineer": e}, "label": {"engineer": names[e]}, "values": figs, "compare": {}, "delta_pct": {},
                "drill": {"report": "sr_explorer", "f_engineer": eng_key(e), "date_from": f.isoformat(), "date_to": t.isoformat()},
                "measure_drill": _perf_drills(f, t, eng_key(e), child), "children": []}

    def sort_key(r: dict) -> tuple:
        e = r["key"].get("engineer")
        return (e is None, (r["label"].get("engineer") or "").lower())

    rows: list[dict] = []
    if month_first:
        for m in months:
            f, t = month_range(m)
            kids = [r for r in (engineer_row(e, f, t, True) for e in engineers) if r]
            kids.sort(key=sort_key)
            if kids:
                rows.append({"key": {"period_month": m}, "label": {"period_month": m},
                             "values": figs_for(engineers, f, t, True), "compare": {}, "delta_pct": {},
                             "drill": {"report": "sr_explorer", "date_from": f.isoformat(), "date_to": t.isoformat()},
                             "measure_drill": {}, "children": kids})
        group_by, group_label = "period_month", "Month"
    else:
        for e in engineers:
            row = engineer_row(e, d_from, d_to, False)
            if row is None:
                continue
            for m in months:
                f, t = month_range(m)
                kid = engineer_row(e, f, t, True)
                if kid:
                    kid["key"], kid["label"] = {"period_month": m}, {"period_month": m}
                    row["children"].append(kid)
            rows.append(row)
        rows.sort(key=sort_key)
        group_by, group_label = "engineer", "Engineer"

    tot = figs_for(engineers, d_from, d_to, False)
    n_eng = sum(1 for e in engineers if e is not None and _has_work(figs_for([e], d_from, d_to, False)))
    rng = {"date_from": d_from.isoformat(), "date_to": d_to.isoformat()}
    all_drill = {"report": "sr_explorer", **rng}
    kpis = [
        ReportKpi("engineers_with_work", "Engineers with work", "int", n_eng, people=True, drill=all_drill),
        ReportKpi("completed", "Completed", "int", tot["completed"], better="up",
                  drill={**all_drill, "date_field": "done", "f_completed": "1"}),
        ReportKpi("on_time_pct", "On-time %", "percent", tot["on_time_pct"], better="up",
                  drill={**all_drill, "date_field": "done", "f_completed": "1", "f_on_time": "on_time,late"}),
        ReportKpi("response_h.avg", "Avg response (h)", "hours", tot["response_h.avg"], better="down",
                  drill={**all_drill, "date_field": "opened", "f_status_group": _NOT_CANCELLED}),
        ReportKpi("resolution_days.avg", "Avg resolution (days)", "days", tot["resolution_days.avg"], better="down",
                  drill={**all_drill, "date_field": "done", "f_completed": "1"}),
        ReportKpi("work_h.sum", "Work hours", "hours", tot["work_h.sum"],
                  drill={"report": "visit_explorer", "date_field": "visit_date", **rng}),
        ReportKpi("overdue_now", "Overdue now", "int", tot["overdue_now"], better="down",
                  drill={"report": "sr_explorer", "date_field": "none", "f_status_group": "open", "f_overdue": "yes"}),
    ]
    per_eng = [r for r in (engineer_row(e, d_from, d_to, False) for e in engineers) if r]
    per_eng.sort(key=lambda r: -r["values"]["completed"])
    top = per_eng[:15]
    labels = [r["label"]["engineer"] for r in top]
    all_months = _months_between(d_from, d_to)
    series = {
        "workload": {"labels": labels, "datasets": [
            {"label": "Completed", "data": [r["values"]["completed"] for r in top]},
            {"label": "Pending", "data": [r["values"]["pending_now"] for r in top]},
            {"label": "Overdue", "data": [r["values"]["overdue_now"] for r in top]}]},
        "resolution": {"labels": labels, "datasets": [
            {"label": "Avg resolution (days)", "data": [round(r["values"]["resolution_days.avg"] or 0, 2) for r in top]}]},
        "monthly": {"labels": all_months, "datasets": [
            {"label": r["label"]["engineer"], "data": [
                figs_for([r["key"]["engineer"]], *month_range(m), False)["completed"] for m in all_months]}
            for r in per_eng[:5]]},
    }
    chosen = set(ctx.measures or [])
    return ReportResult(
        rows=rows, group_by=group_by, group_label=group_label,
        measures=[m for m in PERF_MEASURES if not chosen or m.key in chosen],
        totals=tot, kpis=kpis, series=series,
        notes=[
            "Request figures use the engineer the request is assigned to now; visit figures use the engineer who made the visit.",
            "Cancelled requests are left out because no cancel date is kept.",
        ] + ([] if ctx.sees_people else ["Showing only your own figures - team figures need Service > Reports > People & performance."]),
    )


# ── Declarations (dimensions, measures, filters, columns) ──────────────────
# Built from the framework types; see _register() at the bottom.

_MONEY = ("erp", "service_requests", "charges")

def _dim(key: str, label: str, field: str | None = None, *, label_of: Callable[[dict], str] | None = None,
         people: bool = False, money: bool = False, bucket: str | None = None, order: str = "label") -> Dimension:
    f = field or key
    return Dimension(key=key, label=label, value=(lambda r, f=f: r.get(f)), label_of=label_of,
                     people=people, money=money, order=order, time_bucket=bucket)

def _enum_dim(key: str, label: str, field: str | None = None, **kw: Any) -> Dimension:
    f = field or key
    return _dim(key, label, f, label_of=lambda r, f=f: _label(r.get(f)), **kw)

SR_DIMENSIONS = (
    _dim("engineer", "Engineer", "engineer_id", label_of=lambda r: r["engineer"], people=True),
    _dim("raised_by", "Raised by", "raised_by_id", label_of=lambda r: r["raised_by"], people=True),
    _dim("customer", "Customer", "customer_id", label_of=lambda r: r["customer_label"]),
    _dim("machine", "Machine (serial)", "project_id", label_of=lambda r: r["serial"]),
    _dim("model", "Model"), _dim("machine_type", "Machine type"),
    _dim("site", "Site"), _dim("zone", "Zone"), _dim("site_state", "State"),
    _dim("plant", "Plant (of the person who raised it)", "plant_id", label_of=lambda r: r["plant"]),
    _enum_dim("service_type", "Service type"), _enum_dim("priority", "Priority"),
    _enum_dim("status", "Status"),
    _dim("status_group", "Open / awaiting closure / closed / cancelled", label_of=lambda r: STATUS_GROUP_LABELS[r["status_group"]]),
    _dim("category", "Issue category"), _dim("sub_category", "Sub-category"), _dim("failure_mode", "Failure mode"),
    _enum_dim("warranty_status", "Warranty status"),
    _enum_dim("chargeable", "Chargeable / free"),
    _enum_dim("contract", "Under contract"),
    _dim("cover", "Warranty / AMC / chargeable", label_of=lambda r: COVER_LABELS[r["cover"]]),
    _enum_dim("billing_status", "Billing status", money=True),
    _dim("age_bucket", "Age bucket", label_of=lambda r: AGE_LABELS.get(r["age_bucket"], "Not open"), order="value"),
    _enum_dim("overdue", "Overdue", "overdue_label"),
    _dim("on_time", "On time / late / no target", "on_time_label",
         label_of=lambda r: {"on_time": "On time", "late": "Late", "no_target": "No target date"}[r["on_time_label"]]),
    _dim("period_day", "Day", None, bucket="day", order="value"),
    _dim("period_week", "Week", None, bucket="week", order="value"),
    _dim("period_month", "Month", None, bucket="month", order="value"),
    _dim("period_quarter", "Quarter", None, bucket="quarter", order="value"),
    _dim("period_fy", "Financial year", None, bucket="fy", order="value"),
)

_DOWN_IS_GOOD = ("response_h", "resolution_days", "reach_days", "age_days", "days_overdue", "overdue", "comebacks",
                 "comeback_pct", "open", "actual_cost", "visit_expenses")
_EFFORT = ("visit_", "km", "work_h", "travel_h", "on_site_h", "days_on_site", "arrival_hour", "expenses", "srs", "signed")


def _m(key: str, label: str, type: str, agg: str, *, field: str | None = None,
       where: Callable[[dict], bool] | None = None, ratio: tuple[str, str] | None = None,
       money: bool = False, drill: dict[str, str] | None = None, people: bool = False) -> Measure:
    base = key.split(".")[0]
    group = ("Money" if money else "Time" if type in ("hours", "days") and not base.startswith(("work_h", "travel_h", "on_site"))
             else "Effort" if base.startswith(_EFFORT) else "Counts")
    better = "up" if key == "on_time_pct" else "down" if base in _DOWN_IS_GOOD else None
    return Measure(key=key, label=label, type=type, agg=agg, field=field, where=where, ratio=ratio,
                   money=money, people=people, drill_filter=drill, better=better, group=group)


def _stat_measures(field: str, label: str, type: str, aggs: tuple[str, ...]) -> tuple[Measure, ...]:
    names = {"avg": "Avg", "median": "Median", "max": "Max", "p90": "90th percentile", "sum": "Total"}
    return tuple(_m(f"{field}.{a}", f"{names[a]} {label}", type, a, field=field) for a in aggs)

SR_MEASURES = (
    _m("count", "Service requests", "int", "count"),
    _m("machines", "Machines", "int", "count_distinct", field="project_id"),
    _m("customers", "Customers", "int", "count_distinct", field="customer_id"),
    _m("open", "Open", "int", "count", where=lambda r: r["status_group"] == "open", drill={"f_status_group": "open"}),
    _m("awaiting_closure", "Awaiting closure", "int", "count",
       where=lambda r: r["status_group"] == "awaiting_closure", drill={"f_status_group": "awaiting_closure"}),
    _m("overdue", "Overdue", "int", "count", where=lambda r: r["overdue"], drill={"f_overdue": "yes"}),
    _m("completed", "Completed", "int", "count", where=lambda r: r["is_done"], drill={"f_completed": "1"}),
    _m("closed", "Closed", "int", "count", where=lambda r: r["status"] == "closed", drill={"f_status": "closed"}),
    _m("cancelled", "Cancelled", "int", "count", where=lambda r: r["status"] == "cancelled", drill={"f_status": "cancelled"}),
    _m("urgent", "Urgent", "int", "count", where=lambda r: r["priority"] == "urgent", drill={"f_priority": "urgent"}),
    _m("chargeable_count", "Chargeable", "int", "count", where=lambda r: r["is_chargeable"] is True,
       drill={"f_chargeable": "chargeable"}),
    _m("free_count", "Free of charge", "int", "count", where=lambda r: r["is_chargeable"] is False,
       drill={"f_chargeable": "free"}),
    _m("comebacks", "Come-backs", "int", "count", where=lambda r: r["comeback"], drill={"f_comeback": "1"}),
    _m("repeat_machines", "Repeat-failure machines", "int", "count_distinct", field="project_id",
       where=lambda r: r["comeback"], drill={"f_comeback": "1"}),
    _m("pending", "Pending (open + awaiting closure)", "int", "count",
       where=lambda r: r["status_group"] in ("open", "awaiting_closure"),
       drill={"f_status_group": "open,awaiting_closure"}),
    _m("not_assigned", "Not assigned", "int", "count",
       where=lambda r: r["engineer_id"] is None and r["status_group"] in ("open", "awaiting_closure"),
       drill={"f_engineer": "__none__", "f_status_group": "open,awaiting_closure"}),
    _m("engineers", "Engineers with work", "int", "count_distinct", field="engineer_id", people=True),
    _m("on_time_n", "Completed on time", "int", "count", where=lambda r: r["on_time"] is True,
       drill={"f_on_time": "on_time"}),
    _m("with_target_done", "Completed with a target date", "int", "count", where=lambda r: r["on_time"] is not None,
       drill={"f_on_time": "on_time,late"}),
    _m("on_time_pct", "On-time %", "percent", "ratio", ratio=("on_time_n", "with_target_done"),
       drill={"f_on_time": "on_time,late"}),
    _m("urgent_pct", "Urgent %", "percent", "ratio", ratio=("urgent", "count")),
    _m("chargeable_pct", "Chargeable %", "percent", "ratio", ratio=("chargeable_count", "count")),
    _m("comeback_pct", "Come-back %", "percent", "ratio", ratio=("comebacks", "count")),
    *_stat_measures("response_h", "response (h)", "hours", ("avg", "median", "max", "p90")),
    *_stat_measures("resolution_days", "resolution (days)", "days", ("avg", "median", "max", "p90")),
    *_stat_measures("reach_days", "time to reach site (days)", "days", ("avg", "max")),
    *_stat_measures("age_days", "age of open requests (days)", "days", ("avg", "max")),
    *_stat_measures("days_overdue", "days overdue", "days", ("avg", "max")),
    _m("visit_count.sum", "Visits", "int", "sum", field="visit_count"),
    _m("visit_work_h.sum", "Work hours", "hours", "sum", field="visit_work_h"),
    _m("visit_travel_h.sum", "Travel hours", "hours", "sum", field="visit_travel_h"),
    _m("visit_km.sum", "Km", "decimal", "sum", field="visit_km"),
    *(_m(f"{k}", label, "money", "sum", field=k, money=True) for k, label in (
        ("total_bill", "Total bill"), ("service_cost", "Service charges"), ("transport_cost", "Transport"),
        ("accommodation_cost", "Stay"), ("miscellaneous_cost", "Misc"), ("total_material_cost", "Material billed"),
        ("tax_amount", "Tax"), ("material_cost_actual", "Material cost actual"),
        ("visit_expenses", "Visit expenses"), ("actual_cost", "Actual cost"), ("gross_margin", "Gross margin"),
        ("to_bill", "To bill"), ("invoiced", "Invoiced"), ("paid", "Paid"))),
)

def _enum_filter(key: str, label: str, values: Iterable[str], field: str | None = None, **kw: Any) -> FilterDef:
    return FilterDef(key=key, label=label, type="multi_select", options=_opts_enum(values), match=_in(field or key), **kw)

SR_FILTERS = (
    FilterDef("engineer", "Engineer", "user", options_fn=_people_options, match=_in("engineer_id"), people=True),
    FilterDef("raised_by", "Raised by", "user", options_fn=_raised_by_options, match=_in("raised_by_id"), people=True),
    FilterDef("customer", "Customer", "entity", options_fn=_customer_options, match=_in("customer_id")),
    FilterDef("machine", "Machine (serial)", "entity", options_fn=_machine_options, match=_in("project_id")),
    FilterDef("model", "Model", "multi_select", options_fn=_distinct("model"), match=_in("model")),
    FilterDef("machine_type", "Machine type", "multi_select", options_fn=_distinct("machine_type"), match=_in("machine_type")),
    FilterDef("site", "Site", "multi_select", options_fn=_distinct("site"), match=_in("site")),
    FilterDef("zone", "Zone", "multi_select", options_fn=_distinct("zone"), match=_in("zone")),
    FilterDef("site_state", "State", "multi_select", options_fn=_distinct("site_state"), match=_in("site_state")),
    FilterDef("plant", "Plant (of the person who raised it)", "multi_select", options_fn=_plant_options, match=_in("plant_id")),
    _enum_filter("service_type", "Service type", (*SR_SERVICE_TYPES, "unknown")),
    _enum_filter("priority", "Priority", SR_PRIORITIES),
    _enum_filter("status", "Status", SR_STATUSES),
    FilterDef("status_group", "Open / awaiting closure / closed / cancelled", "multi_select",
              options=tuple(STATUS_GROUP_LABELS.items()), match=_in("status_group")),
    FilterDef("category", "Issue category", "multi_select", options_fn=_distinct("category"), match=_in("category")),
    FilterDef("sub_category", "Sub-category", "multi_select", options_fn=_distinct("sub_category"), match=_in("sub_category")),
    FilterDef("failure_mode", "Failure mode", "multi_select", options_fn=_distinct("failure_mode"), match=_in("failure_mode")),
    _enum_filter("warranty_status", "Warranty status", SR_WARRANTY_STATUSES),
    FilterDef("chargeable", "Chargeable / free", "multi_select",
              options=(("chargeable", "Chargeable"), ("free", "Free of charge")), match=_in("chargeable")),
    FilterDef("contract", "Under contract", "multi_select", options=(("yes", "Yes"), ("no", "No")), match=_in("contract")),
    FilterDef("cover", "Warranty / AMC / chargeable", "multi_select", options=tuple(COVER_LABELS.items()), match=_in("cover")),
    FilterDef("billing_status", "Billing status", "multi_select", options=_opts_enum(SR_BILLING_STATUSES),
              match=_in("billing_status"), money=True),
    FilterDef("age_bucket", "Age bucket", "multi_select", options=tuple(AGE_LABELS.items()), match=_in("age_bucket")),
    FilterDef("overdue", "Overdue", "multi_select", options=(("yes", "Yes"), ("no", "No")), match=_in("overdue_label")),
    FilterDef("on_time", "On time / late / no target", "multi_select",
              options=(("on_time", "On time"), ("late", "Late"), ("no_target", "No target date")), match=_in("on_time_label")),
    FilterDef("completed", "Work completed", "bool", match=_flag("is_done")),
    FilterDef("overdue_only", "Overdue only", "bool", match=_flag("overdue")),
    FilterDef("comeback", "Come-backs only", "bool", match=_flag("comeback")),
    FilterDef("has_visits", "Has visits", "bool", match=_flag("has_visits")),
    FilterDef("age_min", "Age from (days)", "int", match=_int_cmp("age_days", "min")),
    FilterDef("age_max", "Age to (days)", "int", match=_int_cmp("age_days", "max")),
    FilterDef("resolution_min", "Resolution from (days)", "int", match=_int_cmp("resolution_days", "min")),
    FilterDef("resolution_max", "Resolution to (days)", "int", match=_int_cmp("resolution_days", "max")),
)

def _col(key: str, label: str, type: str = "text", default: bool = False, **kw: Any) -> DetailColumn:
    return DetailColumn(key=key, label=label, type=type, default=default, **kw)

SR_LINK = ("sr_id", SR_PAGE)
MACHINE_LINK = ("project_id", MACHINE_PAGE)
SR_COLUMNS = (
    _col("request_number", "SR No", default=True, link=SR_LINK, searchable=True),
    _col("reported_on", "Reported on", "date", True),
    _col("first_response_ts", "First response at", "datetime"),
    _col("response_h", "Response (h)", "hours", True),
    _col("attended_on", "Attended on", "date"),
    _col("reach_days", "Reach site (days)", "days"),
    _col("done_on", "Work completed on", "date", True),
    _col("closed_on", "Closed on", "date"),
    _col("resolution_days", "Resolution (days)", "days", True),
    _col("target_date", "Target date", "date", True),
    _col("on_time_label", "On time", "status", True),
    _col("days_overdue", "Days overdue", "int"),
    _col("age_days", "Age (days)", "int"),
    _col("last_activity", "Last activity", "date"),
    _col("status", "Status", "status", True), _col("priority", "Priority", "status", True),
    _col("service_type", "Service type", "text", True), _col("category", "Category", "text", True),
    _col("sub_category", "Sub-category"), _col("failure_mode", "Failure mode"),
    _col("root_cause", "Root cause", "longtext", cut=True),
    _col("customer", "Customer", "text", True, searchable=True),
    _col("serial", "Machine serial", "text", True, link=MACHINE_LINK, searchable=True),
    _col("model", "Model"), _col("machine_type", "Machine type"),
    _col("site", "Site", "text", True, searchable=True), _col("zone", "Zone"), _col("site_state", "State"),
    _col("plant", "Plant"),
    _col("engineer", "Engineer", "text", True, searchable=True), _col("raised_by", "Raised by"),
    _col("warranty_status", "Warranty status"), _col("chargeable", "Chargeable", "text", True),
    _col("contract", "Contract"),
    _col("visit_count", "Visits", "int"), _col("visit_work_h", "Work h", "hours"),
    _col("visit_travel_h", "Travel h", "hours"), _col("visit_km", "Km", "decimal"),
    _col("comeback", "Come-back", "bool"),
    _col("billing_status", "Billing status", "status", money=True),
    _col("invoice_number", "Invoice No", money=True),
    _col("service_cost", "Service", "money", money=True), _col("transport_cost", "Transport", "money", money=True),
    _col("accommodation_cost", "Stay", "money", money=True), _col("miscellaneous_cost", "Misc", "money", money=True),
    _col("total_material_cost", "Material", "money", money=True), _col("tax_amount", "Tax", "money", money=True),
    _col("total_bill", "Total bill", "money", money=True),
    _col("material_cost_actual", "Material cost actual", "money", money=True),
    _col("visit_expenses", "Visit expenses", "money", money=True),
    _col("gross_margin", "Gross margin", "money", money=True),
    _col("issue", "Issue", "longtext", True, cut=True, searchable=True),
)

SR_DATE_FIELDS = (
    DateField("opened", "Reported date", lambda r: r["reported_on"]),
    DateField("done", "Work-completed date", lambda r: r["done_on"]),
    DateField("closed", "Closed date", lambda r: r["closed_on"]),
    DateField("due", "Target date", lambda r: r["target_date"]),
    DateField("last_activity", "Last activity date", lambda r: r["last_activity"]),
    DateField("none", "All dates", None),
)

# Visit dataset
VISIT_DIMENSIONS = (
    _dim("engineer", "Engineer", "engineer_id", label_of=lambda r: r["engineer"], people=True),
    _dim("customer", "Customer", "customer_id", label_of=lambda r: r["customer_label"]),
    _dim("machine", "Machine (serial)", "project_id", label_of=lambda r: r["serial"]),
    _dim("site", "Site"), _dim("zone", "Zone"),
    _dim("plant", "Plant (of the person who raised it)", "plant_id", label_of=lambda r: r["plant"]),
    _enum_dim("service_type", "Service type"), _enum_dim("priority", "Priority"),
    _enum_dim("signed", "Customer signed", "signed_label"),
    _dim("arrival_hour_bucket", "Arrival hour (IST)", label_of=lambda r: (f"{r['arrival_hour_bucket']:02d}:00" if r["arrival_hour_bucket"] is not None else "No arrival time"), order="value"),
    _dim("sr_status_group", "Request state", label_of=lambda r: STATUS_GROUP_LABELS[r["sr_status_group"]]),
    _dim("period_day", "Day", None, bucket="day", order="value"),
    _dim("period_week", "Week", None, bucket="week", order="value"),
    _dim("period_month", "Month", None, bucket="month", order="value"),
    _dim("period_quarter", "Quarter", None, bucket="quarter", order="value"),
    _dim("period_fy", "Financial year", None, bucket="fy", order="value"),
)
VISIT_MEASURES = (
    _m("count", "Visits", "int", "count"),
    _m("srs", "Service requests", "int", "count_distinct", field="sr_id"),
    _m("days_on_site", "Days on site", "int", "count_distinct", field="engineer_day"),
    _m("work_h.sum", "Work hours", "hours", "sum", field="work_h"),
    _m("work_h.avg", "Avg work hours", "hours", "avg", field="work_h"),
    _m("travel_h.sum", "Travel hours", "hours", "sum", field="travel_h"),
    _m("travel_h.avg", "Avg travel hours", "hours", "avg", field="travel_h"),
    _m("km.sum", "Km", "decimal", "sum", field="km"),
    _m("on_site_h.avg", "Avg time on site (h)", "hours", "avg", field="on_site_h"),
    _m("expenses.sum", "Expenses", "money", "sum", field="expenses", money=True),
    _m("signed_n", "Signed visits", "int", "count", where=lambda r: r["signed"], drill={"f_signed": "yes"}),
    _m("signed_pct", "Signed %", "percent", "ratio", ratio=("signed_n", "count")),
    _m("arrival_hour.avg", "Avg arrival hour (IST)", "decimal", "avg", field="arrival_hour"),
)
VISIT_FILTERS = (
    FilterDef("engineer", "Engineer", "user", options_fn=_people_options, match=_in("engineer_id"), people=True),
    FilterDef("customer", "Customer", "entity", options_fn=_customer_options, match=_in("customer_id")),
    FilterDef("machine", "Machine (serial)", "entity", options_fn=_machine_options, match=_in("project_id")),
    FilterDef("site", "Site", "multi_select", options_fn=_distinct("site"), match=_in("site")),
    FilterDef("zone", "Zone", "multi_select", options_fn=_distinct("zone"), match=_in("zone")),
    FilterDef("plant", "Plant (of the person who raised it)", "multi_select", options_fn=_plant_options, match=_in("plant_id")),
    _enum_filter("service_type", "Service type", (*SR_SERVICE_TYPES, "unknown")),
    _enum_filter("priority", "Priority", SR_PRIORITIES),
    FilterDef("signed", "Customer signed", "multi_select", options=(("yes", "Yes"), ("no", "No")), match=_in("signed_label")),
    FilterDef("sr_status_group", "Request state", "multi_select", options=tuple(STATUS_GROUP_LABELS.items()),
              match=_in("sr_status_group")),
)
VISIT_COLUMNS = (
    _col("visit_date", "Date", "date", True),
    _col("request_number", "SR No", default=True, link=SR_LINK, searchable=True),
    _col("customer", "Customer", "text", True, searchable=True),
    _col("serial", "Machine", "text", True, link=MACHINE_LINK, searchable=True),
    _col("site", "Site"), _col("engineer", "Engineer", "text", True, searchable=True),
    _col("travel_start", "Travel start", "datetime"),
    _col("arrived", "Arrived", "time", True), _col("left", "Left", "time", True),
    _col("on_site_h", "On site (h)", "hours"), _col("work_h", "Work h", "hours", True),
    _col("travel_h", "Travel h", "hours", True), _col("km", "Km", "decimal"),
    _col("travel_cost", "Travel", "money", money=True), _col("stay_cost", "Stay", "money", money=True),
    _col("misc_cost", "Misc", "money", money=True), _col("expenses", "Expenses", "money", money=True),
    _col("signed", "Customer signed", "bool", True), _col("sign_name", "Signed by"),
    _col("work_done", "Work done", "longtext", True, cut=True, searchable=True),
)
VISIT_DATE_FIELDS = (
    DateField("visit_date", "Visit date", lambda r: r["visit_date"]),
    DateField("none", "All dates", None),
)


# ── Grouping of filters, column totals, dataset registration ───────────────

_FILTER_GROUPS = {
    "engineer": "People", "raised_by": "People",
    "customer": "Customer & machine", "machine": "Customer & machine", "model": "Customer & machine",
    "machine_type": "Customer & machine", "site": "Customer & machine", "zone": "Customer & machine",
    "site_state": "Customer & machine", "plant": "Customer & machine",
    "warranty_status": "Cover & billing", "chargeable": "Cover & billing", "cover": "Cover & billing", "contract": "Cover & billing",
    "billing_status": "Cover & billing",
    "age_bucket": "Timing", "overdue": "Timing", "on_time": "Timing", "completed": "Timing", "overdue_only": "Timing",
    "comeback": "Timing", "age_min": "Timing", "age_max": "Timing", "resolution_min": "Timing", "resolution_max": "Timing",
}
SR_FILTERS = tuple(dataclasses.replace(f, group=_FILTER_GROUPS.get(f.key, "Classification")) for f in SR_FILTERS)
VISIT_FILTERS = tuple(dataclasses.replace(f, group=_FILTER_GROUPS.get(f.key, "Classification")) for f in VISIT_FILTERS)

_SUM_COLUMNS = {
    "visit_count", "visit_work_h", "visit_travel_h", "visit_km", "service_cost", "transport_cost", "accommodation_cost",
    "miscellaneous_cost", "total_material_cost", "tax_amount", "total_bill", "material_cost_actual", "visit_expenses",
    "gross_margin", "work_h", "travel_h", "km", "travel_cost", "stay_cost", "misc_cost", "expenses",
}
SR_COLUMNS = tuple(dataclasses.replace(c, total="sum") if c.key in _SUM_COLUMNS else c for c in SR_COLUMNS)
VISIT_COLUMNS = tuple(dataclasses.replace(c, total="sum") if c.key in _SUM_COLUMNS else c for c in VISIT_COLUMNS)


def register_datasets() -> None:
    register_dataset(ReportDataset(
        module="erp", key="sr", label="Service requests", record_noun="service requests",
        date_fields=SR_DATE_FIELDS, default_date_field="opened", dimensions=SR_DIMENSIONS,
        measures=SR_MEASURES, filters=SR_FILTERS, columns=SR_COLUMNS, default_sort=("request_number", "asc"),
        load=load_sr_rows, money_feature=_MONEY, id_keys=("sr_id", "project_id")))
    register_dataset(ReportDataset(
        module="erp", key="visit", label="Service visits", record_noun="visits",
        date_fields=VISIT_DATE_FIELDS, default_date_field="visit_date", dimensions=VISIT_DIMENSIONS,
        measures=VISIT_MEASURES, filters=VISIT_FILTERS, columns=VISIT_COLUMNS, default_sort=("visit_date", "asc"),
        load=load_visit_rows, money_feature=_MONEY, id_keys=("visit_id", "sr_id", "project_id")))


# ── Reports ────────────────────────────────────────────────────────────────

_DEF_COMMON = (
    ("Reported date", "The day the request was raised, in Indian time (the opened time; the created time when none)."),
    ("Response (h)", "Hours from raising the request to the first action on it by anyone (a status move or a visit arrival)."),
    ("Resolution (days)", "Days from raising to work completed (the work-completed time, or the closed time on imported requests). Only requests that reached work completed, review or closed."),
    ("Target date", "The expected completion date on the request; when empty, the day of the internal due time."),
    ("On time", "Work completed on or before the target date. Counted only when the request has a target date."),
    ("On-time %", "Completed on time divided by completed requests that have a target date."),
    ("Overdue", "Open request (not yet work completed) whose target date is before today."),
    ("Age (days)", "Today minus the reported date, for open and awaiting-closure requests. Buckets: 0-2, 3-7, 8-15, 16-30, 31-60, over 60 days."),
    ("Time to reach site (days)", "Date the engineer attended minus the reported date."),
    ("Come-back", "A request raised within 30 days after the previous request on the same machine was completed (or raised, if not completed). Installation, AMC and inspection work do not count."),
    ("Engineer", "The engineer the request is assigned to now (assignment history is not kept). Visit figures use the engineer who made the visit."),
    ("Cancelled requests", "Left out of timing and pending figures because no cancel date is kept."),
    ("Visit expenses", "Travel + stay + misc cost of the visits. Actual cost = spares cost + visit expenses."),
    ("Gross margin", "Total bill - tax - actual cost."),
    ("Billed / To bill / Paid", "Total bill of requests by billing status: to bill, invoiced (invoiced or paid), paid."),
)


def _pivot(key: str, label: str, description: str, section: str, order: int, dataset: str, defaults: dict,
           **kw: Any) -> ReportDef:
    return ReportDef(module="erp", key=key, label=label, description=description, section=section, order=order,
                     kind="pivot", dataset=dataset, defaults=defaults, definitions=_DEF_COMMON, **kw)


def register_reports() -> None:
    this_month = {"preset": "this_month"}
    register_report(ReportDef(
        module="erp", key="engineer_performance", label="Engineer performance",
        description="Per engineer: requests assigned and completed, on-time %, pending and overdue now, response and resolution times, visits, hours and km.",
        section="Engineers", order=1, kind="composite", dataset="sr",
        defaults={**this_month, "date_field": "opened", "group_by": "engineer", "level": "summary",
                  "measures": ["assigned", "completed", "on_time_pct", "pending_now", "overdue_now",
                               "response_h.avg", "resolution_days.avg", "work_h.sum"]},
        composite=engineer_performance, measures=PERF_MEASURES,
        group_bys=(("engineer", "Engineer"), ("period_month", "Month")), people_group_bys=("engineer",),
        self_only_without_management=True,
        charts=(ReportChart("workload", "Completed, pending and overdue by engineer", "stacked_bar", people=True),
                ReportChart("resolution", "Average resolution (days) by engineer", "bar", people=True),
                ReportChart("monthly", "Completed per month, top engineers", "line", people=True)),
        definitions=_DEF_COMMON,
        date_basis=("Assigned and response use the reported date; completed and resolution use the work-completed date; "
                    "pending, overdue and awaiting closure are as of today; visits use the visit date."),
    ))
    register_report(_pivot(
        "pending_ageing", "Pending and ageing",
        "Open and awaiting-closure requests as of today, by age, status, priority, customer or engineer.",
        "Pending", 2, "sr",
        {"date_field": "none", "filters": {"status_group": "open,awaiting_closure"}, "group_by": "age_bucket",
         "group_by2": "priority", "measures": ["count", "overdue", "age_days.avg", "age_days.max", "days_overdue.max"],
         "level": "summary", "sort": ["age_days", "desc"]}))
    register_report(_pivot(
        "turnaround", "Response and resolution time",
        "How fast requests get a first response and get completed, and how many finish by their target date.",
        "Timing", 3, "sr",
        {**this_month, "date_field": "done", "group_by": "priority", "group_by2": "service_type",
         "measures": ["completed", "response_h.avg", "response_h.median", "resolution_days.avg", "resolution_days.median",
                      "resolution_days.p90", "on_time_pct", "reach_days.avg"], "level": "summary"}))
    register_report(_pivot(
        "volume", "Volume and trends",
        "How many requests were raised and completed, by month, week, type, category, priority or status.",
        "Volume", 4, "sr",
        {**this_month, "date_field": "opened", "compare": "previous_period", "group_by": "period_month",
         "measures": ["count", "completed", "urgent_pct", "chargeable_pct"], "level": "summary"}))
    register_report(_pivot(
        "customers_machines", "Customers and machines",
        "Requests by customer and machine: how many, repeat problems, resolution time and what is open.",
        "Customers & machines", 5, "sr",
        {**this_month, "date_field": "opened", "group_by": "customer", "group_by2": "machine",
         "measures": ["count", "machines", "comebacks", "resolution_days.avg", "open", "total_bill"], "level": "summary"}))
    register_report(_pivot(
        "repeat_failures", "Repeat failures",
        "Come-back requests: the same machine needing service again within 30 days.",
        "Customers & machines", 6, "sr",
        {**this_month, "date_field": "opened", "group_by": "machine", "group_by2": "category",
         "measures": ["count", "comebacks"], "level": "summary"},
        locked_filters={"comeback": "1"}))
    register_report(_pivot(
        "billing_cost", "Billing and cost",
        "What was billed, what is still to bill, tax, actual cost and gross margin of completed requests.",
        "Billing", 7, "sr",
        {**this_month, "date_field": "done", "group_by": "billing_status", "group_by2": "period_month",
         "measures": ["count", "total_bill", "tax_amount", "actual_cost", "gross_margin", "to_bill", "invoiced", "paid"],
         "level": "summary"},
        money_report=True))
    register_report(_pivot(
        "visit_log", "Visit log",
        "Engineer visits: days on site, work and travel hours, km, arrival time and expenses.",
        "Engineers", 8, "visit",
        {**this_month, "date_field": "visit_date", "group_by": "engineer", "group_by2": "period_week",
         "measures": ["count", "days_on_site", "work_h.sum", "travel_h.sum", "km.sum", "arrival_hour.avg", "expenses.sum"],
         "level": "summary"},
        self_only_without_management=True))
    register_report(_pivot(
        "sr_explorer", "Service request explorer",
        "Every service request with any column, filter and date - build your own list.",
        "Explore", 9, "sr", {**this_month, "date_field": "opened", "level": "detail"}))
    register_report(_pivot(
        "visit_explorer", "Visit explorer",
        "Every service visit with any column, filter and date - build your own list.",
        "Explore", 10, "visit", {**this_month, "date_field": "visit_date", "level": "detail"},
        self_only_without_management=True))


register_datasets()
register_reports()



# ── Dashboard (ready-made pages: KPI cards + charts, click-to-filter) ───────
# Pages that look at a fixed slice of requests use a filtered copy of the `sr`
# dataset, so every card of the page is restricted to it without extra controls.

def _slice_dataset(key: str, label: str, noun: str, keep: Callable[[dict], bool]) -> ReportDataset:
    base = get_dataset("erp", "sr")

    def load(ctx: Any, window: Any = None) -> list[dict]:
        return [r for r in base.load(ctx, window) if keep(r)]
    return dataclasses.replace(base, key=key, label=label, record_noun=noun, load=load)


def register_dashboard_datasets() -> None:
    register_dataset(_slice_dataset("sr_pending", "Pending service requests", "pending service requests",
                                    lambda r: r["status_group"] in ("open", "awaiting_closure")))
    register_dataset(_slice_dataset("sr_overdue", "Overdue service requests", "overdue service requests",
                                    lambda r: r["overdue"]))
    register_dataset(_slice_dataset("sr_repeat", "Come-back service requests", "come-back service requests",
                                    lambda r: r["comeback"]))


def _k(id: str, title: str, measure: str, definition: str, better: str | None = None, dataset: str = "",
       date_field: str | None = None) -> VisualSpec:
    return VisualSpec(id=f"k_{id}", kind="kpi", title=title, measure=measure, definition=definition, better=better,
                      dataset=dataset, date_field=date_field)


def _v(id: str, kind: str, title: str, definition: str, group_by: str | None = None, measure: str | None = None,
       **kw: Any) -> VisualSpec:
    return VisualSpec(id=id, kind=kind, title=title, definition=definition, group_by=group_by, measure=measure, **kw)


_SLICERS = ("engineer", "customer", "machine", "service_type", "priority", "status", "zone", "cover")
_COHORT = "Counts the requests raised in the chosen period. "
_DONE = "Counts requests completed in the chosen period. "

SERVICE_PAGES = (
    DashboardPage(
        key="overview", label="Overview", dataset="sr", date_field="opened", slicers=_SLICERS,
        hint="How many service requests came in, how fast they are handled and what is still open.",
        kpis=(
            _k("total", "Total requests", "count", _COHORT + "Every service request raised, whatever its status."),
            _k("open", "Open now", "open", _COHORT + "Requests not yet at work completed (open, assigned, scheduled, in progress, waiting for parts or on hold).", "down"),
            _k("overdue", "Overdue now", "overdue", _COHORT + "Open requests whose target date is before today.", "down"),
            _k("completed", "Completed", "completed", _COHORT + "Of those, the requests that reached work completed, review or closed.", "up"),
            _k("response", "Avg response (h)", "response_h.avg", "Average hours from raising a request to the first action on it (a status move or a visit arrival).", "down"),
            _k("resolution", "Avg resolution (days)", "resolution_days.avg", "Average days from raising to work completed, for completed requests.", "down"),
            _k("ontime", "On-time %", "on_time_pct", "Completed on or before the target date, out of completed requests that have a target date.", "up"),
            _k("comebacks", "Come-backs", "comebacks", "Requests raised within 30 days after the previous request on the same machine was completed (installation, AMC and inspection work excluded).", "down"),
        ),
        visuals=(
            _v("status", "donut", "Requests by status", "How the requests of the period split by status.", "status", "count"),
            _v("priority", "column", "Requests by priority", "Urgent and standard requests.", "priority", "count"),
            _v("by_month", "column", "Requests by month", "Requests raised each month over the last 12 months.", "period_month", "count",
               time_window="last_12_months", span=2),
            _v("categories", "hbar", "Top issue categories", "The 8 issue categories with most requests.", "category", "count", top_n=8),
            _v("service_type", "donut", "Requests by service type", "Repair, warranty, AMC, installation, inspection and paid service.", "service_type", "count"),
            _v("customers", "hbar", "Top 10 customers", "Customers with the most requests.", "customer", "count", top_n=10),
            _v("cover", "donut", "Warranty and chargeable", "Who pays: in warranty, AMC or contract, chargeable, other.", "cover", "count"),
            _v("raised_done", "line", "Raised and completed by month", "For each month: requests raised and how many of those are completed.", "period_month", None,
               measures=("count", "completed"), time_window="last_12_months", span=2),
        ),
    ),
    DashboardPage(
        key="engineers", label="Engineers", dataset="sr", date_field="opened", slicers=_SLICERS,
        self_only_without_management=True,
        hint="Who is doing the work: completed, pending and overdue requests, time taken and hours on site per engineer.",
        kpis=(
            dataclasses.replace(_k("engineers", "Engineers with work", "engineers", _COHORT + "Engineers who have at least one request assigned."), people=True),
            _k("completed", "Completed", "completed", _COHORT + "Of those, the requests that reached work completed.", "up"),
            _k("ontime", "On-time %", "on_time_pct", "Completed on or before the target date, out of completed requests that have a target date.", "up"),
            _k("response", "Avg response (h)", "response_h.avg", "Average hours to the first action on a request.", "down"),
            _k("resolution", "Avg resolution (days)", "resolution_days.avg", "Average days from raising to work completed.", "down"),
            _k("work_h", "Work hours", "work_h.sum", "Hours engineers worked on site in the chosen period (from the visit logs).", None, "visit", "visit_date"),
            _k("overdue", "Overdue now", "overdue", _COHORT + "Open requests whose target date has passed.", "down"),
        ),
        visuals=(
            _v("workload", "stacked_bar", "Completed, pending and overdue by engineer", _COHORT + "Per engineer the request is assigned to now.",
               "engineer", None, measures=("completed", "open", "overdue"), top_n=15, people=True, span=2),
            _v("resolution", "hbar", "Average resolution by engineer", "Average days from raising to work completed.", "engineer",
               "resolution_days.avg", top_n=15, people=True),
            _v("monthly", "line", "Completed per month, by engineer", "Completed requests per month for the busiest engineers.", "period_month", "completed",
               group_by2="engineer", time_window="last_12_months", people=True, span=2),
            _v("hours", "hbar", "Work hours by engineer", "Hours worked on site (visit logs) per engineer.", "engineer", "work_h.sum",
               dataset="visit", date_field="visit_date", top_n=15, people=True),
            _v("visits", "column", "Visits by engineer", "Number of site visits made by each engineer.", "engineer", "count",
               dataset="visit", date_field="visit_date", top_n=15, people=True),
            _v("table", "table", "Engineer table", _COHORT + "Per engineer: requests, completed, on-time %, pending and overdue.", "engineer", None,
               measures=("count", "completed", "on_time_pct", "open", "overdue"), top_n=15, people=True, span=3),
        ),
    ),
    DashboardPage(
        key="pending", label="Pending & Ageing", dataset="sr_pending", date_mode="snapshot", slicers=_SLICERS,
        hint="What is waiting right now, as of today: how old it is and who has it.",
        kpis=(
            _k("open", "Open", "open", "Requests not yet at work completed.", "down"),
            _k("overdue", "Overdue", "overdue", "Open requests whose target date is before today.", "down"),
            _k("awaiting", "Awaiting closure", "awaiting_closure", "Work is completed (or in review) but the request is not closed yet.", "down"),
            _k("unassigned", "Not assigned", "not_assigned", "Pending requests with no engineer assigned.", "down"),
            _k("oldest", "Oldest pending (days)", "age_days.max", "Days since the oldest pending request was raised.", "down"),
            _k("avg_age", "Avg age (days)", "age_days.avg", "Average days since pending requests were raised.", "down"),
        ),
        visuals=(
            _v("age", "stacked_bar", "Pending by age and priority", "How long pending requests have been waiting, split by priority.", "age_bucket", "count",
               group_by2="priority", sort="label", span=2),
            _v("status", "donut", "Pending by status", "Where pending requests are in the workflow.", "status", "count"),
            _v("engineer", "hbar", "Pending by engineer", "Pending requests per assigned engineer.", "engineer", "count", people=True, top_n=15),
            _v("customer", "hbar", "Pending by customer", "Customers with the most pending requests.", "customer", "count", top_n=10),
            _v("overdue_list", "table", "Most overdue requests", "The 10 requests that are furthest past their target date.", None, None,
               dataset="sr_overdue", columns=("request_number", "customer", "serial", "engineer", "days_overdue"),
               sort=("days_overdue", "desc"), top_n=10, span=3),
        ),
    ),
    DashboardPage(
        key="timing", label="Timing", dataset="sr", date_field="done", slicers=_SLICERS,
        hint="How fast requests get a first response and get completed.",
        kpis=(
            _k("response", "Avg response (h)", "response_h.avg", _DONE + "Average hours from raising to the first action.", "down"),
            _k("median", "Median resolution (days)", "resolution_days.median", _DONE + "The middle value of days from raising to work completed.", "down"),
            _k("p90", "90th percentile resolution (days)", "resolution_days.p90", _DONE + "9 out of 10 requests finish within this many days.", "down"),
            _k("ontime", "On-time %", "on_time_pct", _DONE + "Completed on or before the target date, out of those with a target date.", "up"),
            _k("reach", "Avg time to reach site (days)", "reach_days.avg", _DONE + "Days from raising to the date the engineer attended.", "down"),
        ),
        visuals=(
            _v("res_priority", "column", "Resolution by priority", _DONE + "Average days to complete, by priority.", "priority", "resolution_days.avg"),
            _v("resp_priority", "column", "Response by priority", _DONE + "Average hours to first action, by priority.", "priority", "response_h.avg"),
            _v("res_type", "hbar", "Resolution by service type", _DONE + "Average days to complete, by service type.", "service_type", "resolution_days.avg"),
            _v("res_month", "line", "Resolution by month", "Average days to complete, by month of completion, last 12 months.", "period_month", "resolution_days.avg",
               time_window="last_12_months", span=2),
            _v("resp_zone", "hbar", "Response time by zone", _DONE + "Average hours to first action, by zone.", "zone", "response_h.avg", top_n=10),
            _v("ontime_eng", "hbar", "On-time % by engineer", _DONE + "Share completed by the target date, per assigned engineer.", "engineer", "on_time_pct",
               people=True, top_n=15),
        ),
    ),
    DashboardPage(
        key="customers", label="Customers & Machines", dataset="sr", date_field="opened", slicers=_SLICERS,
        hint="Which customers and machines need the most service, and which keep coming back.",
        kpis=(
            _k("customers", "Customers served", "customers", _COHORT + "Different customers with at least one request."),
            _k("machines", "Machines serviced", "machines", _COHORT + "Different machines with at least one request."),
            _k("repeat", "Repeat-failure machines", "repeat_machines", "Machines that had a come-back request in the period.", "down"),
            _k("comebacks", "Come-backs", "comebacks", "Requests raised within 30 days after the previous request on the same machine was completed.", "down"),
            _k("chargeable", "Chargeable %", "chargeable_pct", "Requests marked chargeable, out of all requests of the period."),
        ),
        visuals=(
            _v("customers", "hbar", "Top 10 customers", "Customers with the most requests.", "customer", "count", top_n=10),
            _v("machines", "hbar", "Top 10 machines", "Machines with the most requests.", "machine", "count", top_n=10),
            _v("repeat", "table", "Repeat failures by machine", "Machines with come-back requests, most first.", "machine", None,
               dataset="sr_repeat", measures=("count",), top_n=10, span=2),
            _v("zone", "column", "Requests by zone", "Requests per zone.", "zone", "count", top_n=10),
            _v("model", "hbar", "Requests by model", "Machine models with the most requests.", "model", "count", top_n=10),
            _v("cover", "donut", "Warranty, AMC and chargeable", "Who pays: in warranty, AMC or contract, chargeable, other.", "cover", "count"),
        ),
    ),
    DashboardPage(
        key="billing", label="Billing", dataset="sr", date_field="done", slicers=_SLICERS, money_page=True,
        hint="What was billed, what is still to bill, what it cost and the margin.",
        kpis=(
            _k("billed", "Billed", "invoiced", _DONE + "Total bill of requests that have an invoice (invoiced or paid).", "up"),
            _k("to_bill", "To bill", "to_bill", _DONE + "Total bill of chargeable requests with no invoice yet.", "down"),
            _k("paid", "Collected", "paid", _DONE + "Total bill of requests whose invoice is fully paid.", "up"),
            _k("free", "Free jobs", "free_count", _DONE + "Requests that were free of charge (warranty, AMC or marked free).", None),
            _k("cost", "Actual cost", "actual_cost", _DONE + "Spares cost plus visit expenses.", "down"),
            _k("margin", "Gross margin", "gross_margin", _DONE + "Total bill minus tax minus actual cost.", "up"),
        ),
        visuals=(
            _v("status", "donut", "By billing status", _DONE + "How the completed requests split by billing status.", "billing_status", "count"),
            _v("month", "column", "Billed by month", "Invoiced value by month of completion, last 12 months.", "period_month", "invoiced",
               time_window="last_12_months", span=2),
            _v("cost", "stacked_bar", "Cost breakdown", _DONE + "Spares cost and visit expenses, by billing status.", "billing_status", None,
               measures=("material_cost_actual", "visit_expenses")),
            _v("customer", "hbar", "Billed by customer", "Invoiced value per customer.", "customer", "invoiced", top_n=10),
            _v("margin", "hbar", "Margin by service type", "Gross margin per service type.", "service_type", "gross_margin"),
        ),
    ),
    DashboardPage(
        key="visits", label="Visits", dataset="visit", date_field="visit_date",
        slicers=("engineer", "customer", "machine", "service_type", "priority", "zone"),
        self_only_without_management=True,
        hint="Site visits: how many, how many hours, how far and when engineers arrive.",
        kpis=(
            _k("visits", "Visits", "count", "Site visits logged in the chosen period."),
            _k("days", "Days on site", "days_on_site", "Different engineer-days with a visit."),
            _k("work", "Work hours", "work_h.sum", "Hours worked on site."),
            _k("travel", "Travel hours", "travel_h.sum", "Hours spent travelling to site."),
            _k("km", "Km", "km.sum", "Kilometres travelled to site."),
            _k("expenses", "Expenses", "expenses.sum", "Travel, stay and miscellaneous cost of the visits.", "down"),
        ),
        visuals=(
            _v("by_month", "column", "Visits by month", "Visits per month, last 12 months.", "period_month", "count",
               time_window="last_12_months", span=2),
            _v("hours", "hbar", "Hours by engineer", "Work hours per engineer.", "engineer", "work_h.sum", people=True, top_n=15),
            _v("customers", "hbar", "Visits by customer", "Customers with the most visits.", "customer", "count", top_n=10),
            _v("signed", "donut", "Customer signed", "Visits where the customer signed the service report.", "signed", "count"),
            _v("arrival", "column", "Arrival hour", "How many visits started in each hour of the day (Indian time).", "arrival_hour_bucket", "count",
               sort="label"),
        ),
    ),
)


def register_service_dashboard() -> None:
    register_dashboard(DashboardDef(module="erp", key="service", label="Service dashboard", order=1, pages=SERVICE_PAGES))


register_dashboard_datasets()
register_service_dashboard()
