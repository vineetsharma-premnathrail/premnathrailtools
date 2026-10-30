"""Maintenance metrics (plan §6) — downtime, MTTR, MTBF, availability, PM
compliance, cost, top-10 problem assets, backlog and failure Pareto.

Aggregation is done in Python over the filtered work orders rather than in
SQL: the volumes are small (one plant's maintenance jobs), the test DB is
SQLite and prod is Postgres, and interval clamping / month splitting is far
clearer here than in portable SQL.

Definitions (also returned in the payload so the UI can explain them):
- Downtime: minutes a machine was down on breakdown + corrective (machine-down)
  work orders, clamped to the report window (a breakdown that started last
  month only counts the part that falls inside this period; one still open
  counts up to now). PM jobs never record downtime, so they stay out.
- Breakdowns: non-cancelled breakdown + corrective (machine-down) work orders
  whose downtime started (or, when no downtime was recorded, which were
  raised) in the period.
- MTTR: mean time to repair = total downtime of breakdowns that started in
  the period and have been handed back ÷ how many there were. Using the full
  repair time of finished repairs (not the clamped minutes) keeps a repair
  that straddles month-end from looking artificially short.
- MTBF: (available hours − breakdown/corrective downtime hours) ÷ breakdowns.
- Availability %: (available hours − breakdown downtime hours) ÷ available
  hours. Planned PM shutdowns are planned downtime and don't count against it.
- Breakdowns / failures: every `breakdown` job, plus `corrective` jobs only
  when the machine was down (machine_down). A corrective job raised while the
  machine keeps running is not a failure.
- PM compliance %: PM work orders due in the period done on/before their due
  date ÷ PM work orders due in the period (excluding ones not due yet). A PM
  job that was cancelled after its due date passed counts as *skipped* — it
  stays in the denominator (SMRP: every scheduled PM that fell due counts) and
  is never on time. A cancelled job not yet due, or cancelled because the
  asset was decommissioned on/before its due date, is left out.
- Cancelled work orders are excluded from every other KPI.

The dashboard's "last 30 days" tiles call compute_summary too, so the same
KPI never shows two different figures on two screens.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.modules.organization.models.branch import Branch
from app.core.priority import map_legacy_priority
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.work_order import (
    MaintenanceWorkOrder, MaintenanceWorkOrderSpare, MaintenanceLabourLog, MAINTENANCE_WO_OPEN_STATUSES,
)
from app.modules.maintenance.service import _aware, now_utc

IST = ZoneInfo("Asia/Kolkata")
DEFAULT_HOURS_PER_DAY = 8.0  # code default of Maintenance › Settings › default_hours_per_day
_DEFAULT_WORKING_DAYS = frozenset({0, 1, 2, 3, 4, 5})  # Mon–Sat

BREAKDOWN_TYPES = ("breakdown", "corrective")
PLANNED_TYPES = ("preventive", "calibration", "inspection")
PRIORITY_ORDER = ("urgent", "standard")
AGE_BUCKETS = (("0-2", 0, 2), ("3-7", 3, 7), ("8-30", 8, 30), (">30", 31, None))

DEFINITIONS = {
    "downtime": "Hours machines were down on breakdown + corrective (machine-down) work orders, counted only inside the selected period.",
    "mttr": "Mean Time To Repair — average downtime per breakdown + corrective (machine-down) job (finished repairs that started in the period). Lower is better.",
    "mtbf": "Mean Time Between Failures — (available hours − breakdown + corrective downtime) ÷ number of breakdown + corrective (machine-down) jobs. Higher is better.",
    "availability": "Share of available (working) hours the machines were not down on breakdown + corrective (machine-down) work orders. Planned PM shutdowns don't count against it.",
    "pm_compliance": "PM jobs done on or before their due date ÷ PM jobs that fell due in the period, including PM jobs cancelled after their due date passed (counted as skipped, never on time). Jobs not yet due — and PM jobs cancelled because the asset was decommissioned on or before the due date — are left out.",
    "cost": "Spares issued (net of returns, at issue cost) + labour + outside-vendor cost of jobs finished in the period.",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def today_ist() -> date:
    return datetime.now(IST).date()


def _day_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=IST)


def _ist_date(dt: datetime | None) -> date | None:
    dt = _aware(dt)
    return dt.astimezone(IST).date() if dt else None


def _overlap_minutes(start: datetime, end: datetime, w_start: datetime, w_end: datetime) -> float:
    s, e = max(start, w_start), min(end, w_end)
    return max(0.0, (e - s).total_seconds() / 60)


def _parse_working_days(text: str | None) -> frozenset[int]:
    """Reuses HR's parser for Branch.working_days ("Mon-Sat", "Mon–Fri" …)."""
    try:
        from app.modules.hr.services.calendar import parse_working_days
        return parse_working_days(text)
    except Exception:  # pragma: no cover — HR module absent
        return _DEFAULT_WORKING_DAYS


def _parse_hours(text: str | None) -> float | None:
    """Branch.working_hours is free text like "09:00–18:00", "9.30 am to
    6.00 pm", "9am-6pm", "0900-1800", "9-6" or "8". Returns hours per day, or
    None when it can't be read (callers then fall back to 8 h and say so in
    availability_basis).

    - Minutes may follow ":" or "." ("9:30", "9.30"); a 3-4 digit run with no
      separator is HHMM ("0900", "1800").
    - 24-hour form = either end has a leading zero ("06:00", "09"), is HHMM,
      or has an hour of 13 or more ("22:00"). Then an end at/before the start
      means an overnight shift: "22:00-06:00" → 8 h.
    - Otherwise a bare end hour (no am/pm) below 12 that is at/before the
      start, and lands after the start once moved to the afternoon, is read
      as pm — whether or not the start said am/pm: "9-6" → 9 h,
      "8:30-5" → 8.5 h, "9am-6" → 9 h.
    - Sanity guard: a span over 16 h is only trusted when it is written in
      explicit 24-hour form or both ends say am/pm; anything else is treated
      as unreadable (None) rather than a believable-but-wrong 15-21 h.
    """
    if not text or not text.strip():
        return None
    low = text.lower()
    times = re.findall(r"(\d{1,4})(?:[:.](\d{2}))?\s*(am|pm)?", low)
    if len(times) >= 2 and re.search(r"[-–—]|\bto\b", low):
        def _parts(t):
            hs, ms, ap = t
            if len(hs) >= 3 and not ms:  # HHMM
                hs, ms = hs[:-2], hs[-2:]
                hhmm = True
            elif len(hs) >= 3:
                return None
            else:
                hhmm = False
            h, m = int(hs), int(ms or 0)
            if m >= 60 or h > 24 or (ap and not 1 <= h <= 12):
                return None
            explicit_24 = hhmm or (len(hs) == 2 and hs.startswith("0")) or h >= 13
            if ap == "pm" and h < 12:
                h += 12
            if ap == "am" and h == 12:
                h = 0
            return h + m / 60, ap, explicit_24

        p1, p2 = _parts(times[0]), _parts(times[1])
        if p1 is None or p2 is None:
            return None
        (a, ap1, x1), (b, ap2, x2) = p1, p2
        is_24h = x1 or x2
        if not is_24h and not ap2 and b <= a and b < 12 and b + 12 > a:
            b += 12
        hours = b - a if b > a else b + 24 - a
        if hours > 16 and not is_24h and not (ap1 and ap2):
            return None
        return round(hours, 2) if 0 < hours <= 24 else None
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours)?\s*", low)
    if m:
        v = float(m.group(1))
        return v if 0 < v <= 24 else None
    return None


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _months(d_from: date, d_to: date) -> list[tuple[str, date, date]]:
    out = []
    cur = date(d_from.year, d_from.month, 1)
    while cur <= d_to:
        nxt = date(cur.year + (cur.month // 12), cur.month % 12 + 1, 1)
        out.append((_month_key(cur), max(cur, d_from), min(nxt - timedelta(days=1), d_to)))
        cur = nxt
    return out


def _scoped(q, user, model):
    """Limit to the user's Maintenance data scope (no user = scheduler /
    internal callers, unrestricted)."""
    if user is None:
        return q
    from app.core.data_scope import apply_scope
    from app.modules.maintenance import access  # noqa: F401 — registers the scopes

    return apply_scope(q, user, model)


def filtered_assets(db: Session, branch_id: int | None = None, asset_id: int | None = None, category: str | None = None,
                    user=None) -> list[MaintenanceAsset]:
    q = _scoped(db.query(MaintenanceAsset).filter(MaintenanceAsset.is_deleted == False), user, MaintenanceAsset)  # noqa: E712
    if branch_id:
        q = q.filter(MaintenanceAsset.branch_id == branch_id)
    if asset_id:
        q = q.filter(MaintenanceAsset.id == asset_id)
    if category:
        q = q.filter(MaintenanceAsset.category == category)
    return q.all()


def _is_failure(wo: MaintenanceWorkOrder) -> bool:
    """A failure for MTBF/MTTR/Pareto: any breakdown job, or a corrective job
    where the machine was actually down."""
    return wo.wo_type == "breakdown" or (wo.wo_type == "corrective" and bool(wo.machine_down))


def _wo_event_time(wo: MaintenanceWorkOrder) -> datetime | None:
    return _aware(wo.downtime_start or wo.actual_start or wo.created_at)


def _wo_done_time(wo: MaintenanceWorkOrder) -> datetime | None:
    if wo.status not in ("completed", "closed"):
        return None
    return _aware(wo.actual_end or wo.closed_at or wo.verified_at)


def _wo_costs(wo: MaintenanceWorkOrder, spares: list, labour: list) -> tuple[float, float, float]:
    sp = sum(max(0.0, (s.qty_issued or 0) - (s.qty_returned or 0)) * (s.unit_cost or 0) for s in spares)
    lb = sum((l.hours or 0) * (l.hourly_rate or 0) for l in labour)
    return round(sp, 2), round(lb, 2), round(wo.external_cost or 0, 2)


# ---------------------------------------------------------------------------
# Available hours
# ---------------------------------------------------------------------------

def available_hours(db: Session, assets: list[MaintenanceAsset], d_from: date, d_to: date) -> tuple[dict[int, float], dict]:
    """Per-asset available hours in [d_from, d_to] (d_to already capped at
    today by the caller) and a description of the basis used."""
    branch_ids = {a.branch_id for a in assets}
    branches = {b.id: b for b in db.query(Branch).filter(Branch.id.in_(branch_ids or {0})).all()}
    ws_hours: dict[int, float] = {}
    ws_ids = [a.workstation_id for a in assets if a.workstation_id]
    if ws_ids:
        try:
            from app.modules.production.models.workstation import ProductionWorkstation
            ws_hours = {w.id: float(w.capacity_hours_per_day or 0) for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_(ws_ids)).all()}
        except Exception:  # pragma: no cover
            ws_hours = {}

    from app.modules.maintenance.settings import default_hours_per_day
    fallback_hpd = default_hours_per_day(db)  # Maintenance › Settings (8 h/day by default)
    days_cache: dict[int, int] = {}
    counts = {"workstation": 0, "plant": 0, "default": 0}
    result: dict[int, float] = {}
    for a in assets:
        b = branches.get(a.branch_id)
        if a.branch_id not in days_cache:
            wd = _parse_working_days(b.working_days if b else None)
            n, d = 0, d_from
            while d <= d_to:
                if d.weekday() in wd:
                    n += 1
                d += timedelta(days=1)
            days_cache[a.branch_id] = n
        # Assets not yet commissioned / already decommissioned in the window.
        start = max(d_from, a.commissioned_on) if a.commissioned_on else d_from
        end = min(d_to, a.decommissioned_on) if a.decommissioned_on else d_to
        if start > end:
            result[a.id] = 0.0
            continue
        if start != d_from or end != d_to:
            wd = _parse_working_days(b.working_days if b else None)
            n, d = 0, start
            while d <= end:
                if d.weekday() in wd:
                    n += 1
                d += timedelta(days=1)
        else:
            n = days_cache[a.branch_id]

        hpd = ws_hours.get(a.workstation_id) if a.workstation_id else None
        if hpd and hpd > 0:
            counts["workstation"] += 1
        else:
            hpd = _parse_hours(b.working_hours if b else None)
            if hpd:
                counts["plant"] += 1
            else:
                hpd = fallback_hpd
                counts["default"] += 1
        result[a.id] = round(hpd * n, 2)

    parts = []
    if counts["workstation"]:
        parts.append(f"{counts['workstation']} asset(s) use their Production workstation's capacity hours/day")
    if counts["plant"]:
        parts.append(f"{counts['plant']} use the plant's working hours")
    if counts["default"]:
        parts.append(f"{counts['default']} assume {fallback_hpd:g} h/day (no workstation link and no readable plant working hours)")
    basis = {
        "assets_from_workstation": counts["workstation"],
        "assets_from_plant_hours": counts["plant"],
        "assets_default_hours": counts["default"],
        "working_days_rule": "Plant's working days (Organization › Plants); Mon–Sat when not set. Holidays are not deducted.",
        "description": ("; ".join(parts) + ". " if parts else "No assets in scope. ")
        + "Working days come from the plant's working-days setting (Mon–Sat when blank); holidays are not deducted; days after today are not counted.",
    }
    return result, basis


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def compute_summary(
    db: Session, d_from: date, d_to: date,
    branch_id: int | None = None, asset_id: int | None = None, category: str | None = None,
    user=None,
) -> dict:
    """`user` given = only the assets and work orders inside their
    Maintenance data scope count."""
    now = now_utc()
    today = today_ist()
    assets = filtered_assets(db, branch_id, asset_id, category, user=user)
    by_id = {a.id: a for a in assets}
    asset_ids = list(by_id) or [0]

    w_start = _day_start(d_from)
    w_end = min(_day_start(d_to + timedelta(days=1)), now)
    avail_to = min(d_to, today)

    # Cancelled jobs are loaded only for PM compliance (a cancelled PM that fell
    # due is a skipped PM); every other KPI uses the non-cancelled list.
    all_wos = _scoped(db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.asset_id.in_(asset_ids)), user, MaintenanceWorkOrder).all()
    wos = [w for w in all_wos if w.status != "cancelled"]
    wo_ids = [w.id for w in wos] or [0]
    spares_by_wo: dict[int, list] = defaultdict(list)
    for s in db.query(MaintenanceWorkOrderSpare).filter(MaintenanceWorkOrderSpare.work_order_id.in_(wo_ids)).all():
        spares_by_wo[s.work_order_id].append(s)
    labour_by_wo: dict[int, list] = defaultdict(list)
    for l in db.query(MaintenanceLabourLog).filter(MaintenanceLabourLog.work_order_id.in_(wo_ids)).all():
        labour_by_wo[l.work_order_id].append(l)

    months = _months(d_from, d_to)
    month_windows = [(k, _day_start(a), min(_day_start(b + timedelta(days=1)), now)) for k, a, b in months]

    def in_period(dt: datetime | None) -> bool:
        return dt is not None and w_start <= dt < _day_start(d_to + timedelta(days=1))

    # ── Downtime (breakdown + corrective machine-down WOs, clamped to the window) ──
    downtime_total = 0.0
    downtime_by_month: dict[str, float] = {k: 0.0 for k, _, _ in months}
    downtime_by_asset: dict[int, float] = defaultdict(float)
    bd_count_by_asset: dict[int, int] = defaultdict(int)
    breakdowns = []
    repaired_minutes, repaired_count = 0.0, 0
    for w in wos:
        if not _is_failure(w):
            continue
        if w.machine_down and w.downtime_start:
            ds = _aware(w.downtime_start)
            de = _aware(w.downtime_end) or now
            mins = _overlap_minutes(ds, de, w_start, w_end)
            if mins:
                downtime_total += mins
                downtime_by_asset[w.asset_id] += mins
                for k, ms, me in month_windows:
                    downtime_by_month[k] += _overlap_minutes(ds, de, ms, me)
        if in_period(_wo_event_time(w)):
            breakdowns.append(w)
            bd_count_by_asset[w.asset_id] += 1
            if w.machine_down and w.downtime_start and w.downtime_end:
                full = w.downtime_minutes if w.downtime_minutes is not None else (_aware(w.downtime_end) - _aware(w.downtime_start)).total_seconds() / 60
                repaired_minutes += full
                repaired_count += 1

    bd_count = len(breakdowns)
    avail_by_asset, basis = available_hours(db, assets, d_from, avail_to) if d_from <= avail_to else ({a.id: 0.0 for a in assets}, {
        "assets_from_workstation": 0, "assets_from_plant_hours": 0, "assets_default_hours": 0,
        "working_days_rule": "", "description": "The period hasn't started yet — no available hours.",
    })
    avail_total = sum(avail_by_asset.values())
    downtime_hours = downtime_total / 60
    mttr = round(repaired_minutes / repaired_count) if repaired_count else None
    mtbf = round(max(0.0, avail_total - downtime_hours) / bd_count, 1) if bd_count and avail_total else None
    availability = round(max(0.0, avail_total - downtime_hours) / avail_total * 100, 1) if avail_total else None

    # ── PM compliance ──
    pm_due = [w for w in all_wos if w.pm_due_date and d_from <= w.pm_due_date <= d_to]
    on_time = late = missed = pending = skipped = excluded = 0
    for w in pm_due:
        if w.status == "cancelled":
            a = by_id.get(w.asset_id)
            if a is not None and a.decommissioned_on and a.decommissioned_on <= w.pm_due_date:
                excluded += 1  # PM retired with the asset — nobody was meant to do it
                continue
            if w.pm_due_date < today:
                skipped += 1
            else:
                excluded += 1  # cancelled before it fell due — left out
            continue
        done = _ist_date(_wo_done_time(w))
        if done is not None:
            if done <= w.pm_due_date:
                on_time += 1
            else:
                late += 1
        elif w.pm_due_date < today:
            missed += 1
        else:
            pending += 1
    pm_denominator = on_time + late + missed + skipped
    pm_compliance = round(on_time / pm_denominator * 100, 1) if pm_denominator else None

    # ── Breakdown vs planned (jobs raised in the period) ──
    raised = [w for w in wos if in_period(_aware(w.created_at))]
    mix = {
        "breakdown": sum(1 for w in raised if w.wo_type in BREAKDOWN_TYPES),
        "planned": sum(1 for w in raised if w.wo_type in PLANNED_TYPES),
        "other": sum(1 for w in raised if w.wo_type not in BREAKDOWN_TYPES + PLANNED_TYPES),
        "by_type": {},
    }
    for w in raised:
        mix["by_type"][w.wo_type] = mix["by_type"].get(w.wo_type, 0) + 1
    total_mix = mix["breakdown"] + mix["planned"]
    mix["planned_pct"] = round(mix["planned"] / total_mix * 100, 1) if total_mix else None

    # ── Cost (jobs finished in the period) ──
    cost_total = {"spares": 0.0, "labour": 0.0, "external": 0.0, "total": 0.0}
    cost_by_month = {k: {"spares": 0.0, "labour": 0.0, "external": 0.0, "total": 0.0} for k, _, _ in months}
    cost_by_asset: dict[int, dict] = defaultdict(lambda: {"spares": 0.0, "labour": 0.0, "external": 0.0, "total": 0.0, "jobs": 0})
    for w in wos:
        done = _wo_done_time(w)
        if not in_period(done):
            continue
        sp, lb, ex = _wo_costs(w, spares_by_wo.get(w.id, []), labour_by_wo.get(w.id, []))
        tot = sp + lb + ex
        mk = _month_key(_ist_date(done))
        for bucket in (cost_total, cost_by_month.get(mk), cost_by_asset[w.asset_id]):
            if bucket is None:
                continue
            bucket["spares"] += sp
            bucket["labour"] += lb
            bucket["external"] += ex
            bucket["total"] += tot
        cost_by_asset[w.asset_id]["jobs"] += 1

    def _r(d: dict) -> dict:
        return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items()}

    def _asset_info(aid: int) -> dict:
        a = by_id.get(aid)
        return {"asset_id": aid, "asset_code": a.asset_code if a else f"#{aid}", "asset_name": a.name if a else ""}

    # ── Per-asset downtime / availability ──
    by_asset_rows = []
    for aid in set(downtime_by_asset) | set(bd_count_by_asset):
        av = avail_by_asset.get(aid, 0.0)
        dh = downtime_by_asset.get(aid, 0.0) / 60
        by_asset_rows.append({
            **_asset_info(aid),
            "downtime_minutes": round(downtime_by_asset.get(aid, 0.0)),
            "breakdowns": bd_count_by_asset.get(aid, 0),
            "available_hours": av,
            "availability_pct": round(max(0.0, av - dh) / av * 100, 1) if av else None,
        })
    by_asset_rows.sort(key=lambda r: (-r["downtime_minutes"], -r["breakdowns"]))

    top_by_count = sorted([r for r in by_asset_rows if r["breakdowns"]], key=lambda r: (-r["breakdowns"], -r["downtime_minutes"]))[:10]
    top_by_downtime = [r for r in by_asset_rows if r["downtime_minutes"]][:10]

    # ── Backlog (open jobs right now, by age × priority) ──
    backlog = {label: {p: 0 for p in PRIORITY_ORDER} for label, _, _ in AGE_BUCKETS}
    backlog_total = 0
    for w in wos:
        if w.status not in MAINTENANCE_WO_OPEN_STATUSES:
            continue
        age = (today - (_ist_date(w.created_at) or today)).days
        label = next(lbl for lbl, lo, hi in AGE_BUCKETS if age >= lo and (hi is None or age <= hi))
        pr = map_legacy_priority(w.priority)
        backlog[label][pr] += 1
        backlog_total += 1

    # ── Failure Pareto (breakdown + machine-down corrective jobs in the period) ──
    fail: dict[str, dict] = defaultdict(lambda: {"count": 0, "downtime_minutes": 0.0})
    for w in wos:
        if not _is_failure(w) or not in_period(_wo_event_time(w)):
            continue
        key = w.failure_category or "not_recorded"
        fail[key]["count"] += 1
        fail[key]["downtime_minutes"] += (w.downtime_minutes or 0)
    pareto, running = [], 0
    fail_total = sum(v["count"] for v in fail.values())
    for k, v in sorted(fail.items(), key=lambda kv: (-kv[1]["count"], -kv[1]["downtime_minutes"])):
        running += v["count"]
        pareto.append({
            "failure_category": k, "count": v["count"], "downtime_minutes": round(v["downtime_minutes"]),
            "pct": round(v["count"] / fail_total * 100, 1), "cumulative_pct": round(running / fail_total * 100, 1),
        })

    out = {
        "period": {"from": d_from.isoformat(), "to": d_to.isoformat(), "available_hours_to": avail_to.isoformat()},
        "filters": {"branch_id": branch_id, "asset_id": asset_id, "category": category},
        "asset_count": len(assets),
        "definitions": DEFINITIONS,
        "availability_basis": basis,
        "kpis": {
            "downtime_minutes": round(downtime_total),
            "breakdowns": bd_count,
            "repaired_breakdowns": repaired_count,
            "mttr_minutes": mttr,
            "mtbf_hours": mtbf,
            "available_hours": round(avail_total, 1),
            "availability_pct": availability,
            "pm_compliance_pct": pm_compliance,
            "maintenance_cost": round(cost_total["total"], 2),
            "open_work_orders": backlog_total,
        },
        "downtime": {
            "total_minutes": round(downtime_total),
            "by_month": [{"month": k, "downtime_minutes": round(v)} for k, v in downtime_by_month.items()],
            "by_asset": by_asset_rows,
        },
        "pm_compliance": {
            "due": len(pm_due) - excluded, "on_time": on_time, "late": late, "missed": missed, "skipped": skipped, "not_yet_due": pending,
            "compliance_pct": pm_compliance,
        },
        "work_mix": mix,
        "cost": {
            "total": _r(cost_total),
            "by_month": [{"month": k, **_r(v)} for k, v in cost_by_month.items()],
            "by_asset": sorted(
                [{**_asset_info(aid), **_r(v)} for aid, v in cost_by_asset.items()],
                key=lambda r: -r["total"],
            ),
        },
        "top_assets": {"by_breakdowns": top_by_count, "by_downtime": top_by_downtime},
        "backlog": {
            "total": backlog_total,
            "buckets": [label for label, _, _ in AGE_BUCKETS],
            "priorities": list(PRIORITY_ORDER),
            "matrix": [{"age_bucket": label, **backlog[label], "total": sum(backlog[label].values())} for label, _, _ in AGE_BUCKETS],
        },
        "failure_pareto": pareto,
    }
    # Maintenance costs switch (maintenance:work_orders.costs:view) — blanks the cost KPI / section.
    from app.modules.maintenance.sensitive import mask_summary
    return mask_summary(user, out)


# ---------------------------------------------------------------------------
# Dashboard additions (Phase 2)
# ---------------------------------------------------------------------------

def critical_spares_below_min(db: Session, asset_ids: list[int]) -> list[dict]:
    """Store items flagged critical on some asset's bill of spares whose total
    on-hand across all Store locations is below the item's minimum stock
    (reorder level when no minimum is set)."""
    from app.modules.maintenance.models.asset import MaintenanceAssetSpare
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.stock_balance import StoreStockBalance

    rows = db.query(MaintenanceAssetSpare).filter(
        MaintenanceAssetSpare.is_critical == True, MaintenanceAssetSpare.asset_id.in_(asset_ids or [0]),  # noqa: E712
    ).all()
    item_assets: dict[int, set[int]] = defaultdict(set)
    for r in rows:
        item_assets[r.store_item_id].add(r.asset_id)
    if not item_assets:
        return []
    on_hand: dict[int, float] = defaultdict(float)
    for b in db.query(StoreStockBalance).filter(StoreStockBalance.item_id.in_(list(item_assets))).all():
        on_hand[b.item_id] += b.on_hand_qty or 0
    out = []
    for item in db.query(StoreItem).filter(StoreItem.id.in_(list(item_assets))).all():
        minimum = item.minimum_stock if item.minimum_stock is not None else item.reorder_level
        if minimum is None or minimum <= 0:
            continue
        qty = round(on_hand.get(item.id, 0.0), 4)
        if qty < minimum:
            out.append({
                "store_item_id": item.id, "item_code": item.item_code, "item_name": item.item_name, "uom": item.uom,
                "on_hand": qty, "minimum_stock": minimum, "shortfall": round(minimum - qty, 4),
                "asset_count": len(item_assets[item.id]),
            })
    out.sort(key=lambda r: -(r["shortfall"] / r["minimum_stock"]))
    return out


def dashboard_extras(db: Session, assets: list[MaintenanceAsset], wos: list[MaintenanceWorkOrder], branch_id: int | None,
                     user=None) -> dict:
    from app.modules.maintenance.models.pm_plan import MaintenancePmPlan

    from app.modules.maintenance.settings import dashboard_pm_window_days
    today = today_ist()
    # "PM due" card window, today included (Maintenance › Settings; 7 = this week).
    window_days = dashboard_pm_window_days(db)
    week_end = today + timedelta(days=window_days - 1)
    by_id = {a.id: a for a in assets}
    open_pm = [w for w in wos if w.pm_due_date and w.status in MAINTENANCE_WO_OPEN_STATUSES]

    due_items = [
        {"kind": "work_order", "id": w.id, "number": w.wo_number, "title": w.title, "due_date": w.pm_due_date,
         "asset_code": by_id[w.asset_id].asset_code if w.asset_id in by_id else "", "status": w.status}
        for w in open_pm if today <= w.pm_due_date <= week_end
    ]
    # Plans due this week whose work order hasn't been generated yet. A job
    # already generated for that due date counts whatever its status (a
    # completed-awaiting-close job must not make the plan look ungenerated);
    # only a cancelled one doesn't. `wos` here holds every status.
    generated = {(w.pm_plan_id, w.pm_due_date) for w in wos if w.pm_plan_id and w.status != "cancelled"}
    plans = _scoped(db.query(MaintenancePmPlan).filter(
        MaintenancePmPlan.is_deleted == False, MaintenancePmPlan.is_active == True,  # noqa: E712
        MaintenancePmPlan.asset_id.in_(list(by_id) or [0]),
        MaintenancePmPlan.next_due_date >= today, MaintenancePmPlan.next_due_date <= week_end,
    ), user, MaintenancePmPlan).all()
    due_items += [
        {"kind": "plan", "id": p.id, "number": p.plan_code, "title": p.title, "due_date": p.next_due_date,
         "asset_code": by_id[p.asset_id].asset_code, "status": "not_generated"}
        for p in plans if (p.id, p.next_due_date) not in generated
    ]
    due_items.sort(key=lambda r: r["due_date"])

    overdue = sorted([w for w in open_pm if w.pm_due_date < today], key=lambda w: w.pm_due_date)
    spares = critical_spares_below_min(db, list(by_id))

    month = compute_summary(db, today.replace(day=1), today, branch_id=branch_id, user=user)
    return {
        "pm_due_this_week": {"count": len(due_items), "items": due_items[:10], "window_days": window_days},
        "pm_overdue": {
            "count": len(overdue),
            "items": [
                {"id": w.id, "wo_number": w.wo_number, "title": w.title, "due_date": w.pm_due_date,
                 "days_overdue": (today - w.pm_due_date).days, "status": w.status,
                 "asset_code": by_id[w.asset_id].asset_code if w.asset_id in by_id else ""}
                for w in overdue[:10]
            ],
        },
        "critical_spares_below_min": {"count": len(spares), "items": spares[:10]},
        "this_month": {
            "from": month["period"]["from"], "to": month["period"]["to"],
            "breakdowns": month["kpis"]["breakdowns"],
            "downtime_minutes": month["kpis"]["downtime_minutes"],
            "mttr_minutes": month["kpis"]["mttr_minutes"],
            "mtbf_hours": month["kpis"]["mtbf_hours"],
            "availability_pct": month["kpis"]["availability_pct"],
            "pm_compliance_pct": month["kpis"]["pm_compliance_pct"],
        },
    }
