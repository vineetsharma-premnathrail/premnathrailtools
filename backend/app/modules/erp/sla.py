"""Service-level clock for service requests (SAP CS response profile /
service level).

Profiles are coded (no metadata customisation): one per SR priority. When
an AMC / service contract has already put its own hours on the SR
(sla_response_hours / sla_resolution_hours set before apply_profile runs),
those win and the profile is recorded as "contract".

  response   = first move out of 'open' (acknowledged / assigned / …) or
               the first engineer arrival logged on a visit, whichever is
               earlier
  resolution = first move to work_completed / review / closed; reopening
               the job clears it (the clock runs again)

sla_*_met is set when the event happens; the hourly task
(tasks/erp_sla_reminders.py) flags a running clock that passed its due time
as breached (met = False) and sends the escalation reminders."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

SLA_PROFILES: dict[str, dict] = {
    "urgent": {"label": "Urgent — machine down", "response_hours": 4, "resolution_hours": 48},
    "standard": {"label": "Standard", "response_hours": 24, "resolution_hours": 120},
}
DEFAULT_PROFILE = "standard"
# Share of the window elapsed at which the "about to breach" reminder fires.
WARNING_FRACTION = 0.8

RESPONSE_STATUSES = ("acknowledged", "assigned", "scheduled", "in_progress", "pending_parts", "on_hold",
                     "work_completed", "review", "closed")
RESOLVED_STATUSES = ("work_completed", "review", "closed")
STOPPED_STATUSES = ("cancelled",)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _contract(sr):
    """The service contract covering the SR, if the contracts module set one."""
    cid = getattr(sr, "service_contract_id", None)
    if not cid:
        return None
    from sqlalchemy.orm import object_session
    db = object_session(sr)
    if db is None:
        return None
    try:
        from app.modules.erp.models.service_contract import ServiceContract
    except ImportError:  # pragma: no cover — contracts module absent
        return None
    return db.get(ServiceContract, cid)


def _set_due(sr) -> None:
    start = _aware(sr.opened_at) or _aware(sr.created_at) or now_utc()
    sr.sla_response_due_at = start + timedelta(hours=sr.sla_response_hours) if sr.sla_response_hours else None
    sr.sla_resolution_due_at = start + timedelta(hours=sr.sla_resolution_hours) if sr.sla_resolution_hours else None


def apply_profile(sr, *, force: bool = False) -> None:
    """At SR create (and on a priority change, force=True): hours from the
    priority's coded profile unless a contract already set them. An AMC /
    CMC covering the SR (service_contract_id, set by the entitlement check)
    with its own SLA hours wins over the profile."""
    contract = _contract(sr)
    if contract is not None and (contract.sla_response_hours or contract.sla_resolution_hours):
        prof = SLA_PROFILES.get((sr.priority or DEFAULT_PROFILE).lower(), SLA_PROFILES[DEFAULT_PROFILE])
        sr.sla_profile = "contract"
        sr.sla_response_hours = contract.sla_response_hours or prof["response_hours"]
        sr.sla_resolution_hours = contract.sla_resolution_hours or prof["resolution_hours"]
        _set_due(sr)
        _recheck_met(sr)
        return
    if not force and (sr.sla_response_hours or sr.sla_resolution_hours) and sr.sla_profile in (None, "contract"):
        sr.sla_profile = "contract"
        _set_due(sr)
        return
    if sr.sla_profile == "contract" and force:
        _set_due(sr)
        return
    key = (sr.priority or DEFAULT_PROFILE).lower()
    prof = SLA_PROFILES.get(key, SLA_PROFILES[DEFAULT_PROFILE])
    sr.sla_profile = key if key in SLA_PROFILES else DEFAULT_PROFILE
    sr.sla_response_hours = prof["response_hours"]
    sr.sla_resolution_hours = prof["resolution_hours"]
    _set_due(sr)
    _recheck_met(sr)


def _recheck_met(sr) -> None:
    if sr.first_response_at and sr.sla_response_due_at:
        sr.sla_response_met = _aware(sr.first_response_at) <= _aware(sr.sla_response_due_at)
    if sr.resolution_at and sr.sla_resolution_due_at:
        sr.sla_resolution_met = _aware(sr.resolution_at) <= _aware(sr.sla_resolution_due_at)


def record_response(sr, at: datetime) -> None:
    at = _aware(at)
    if sr.first_response_at is None or at < _aware(sr.first_response_at):
        sr.first_response_at = at
    if sr.sla_response_due_at:
        sr.sla_response_met = _aware(sr.first_response_at) <= _aware(sr.sla_response_due_at)


def on_status_change(sr, old_status: str | None, new_status: str | None, at: datetime | None = None) -> None:
    at = at or now_utc()
    old, new = (old_status or "").lower(), (new_status or "").lower()
    if old == new:
        return
    if new in RESPONSE_STATUSES and sr.first_response_at is None:
        record_response(sr, at)
    if new in RESOLVED_STATUSES and sr.resolution_at is None:
        sr.resolution_at = at
        if sr.sla_resolution_due_at:
            sr.sla_resolution_met = at <= _aware(sr.sla_resolution_due_at)
    elif new not in RESOLVED_STATUSES and new not in STOPPED_STATUSES and old in RESOLVED_STATUSES:
        # Reopened — the resolution clock runs again (the earlier stop is void).
        sr.resolution_at = None
        sr.sla_resolution_met = None
        if sr.sla_resolution_due_at and at > _aware(sr.sla_resolution_due_at):
            sr.sla_resolution_met = False


def clock_state(due: datetime | None, done_at: datetime | None, met: bool | None, start: datetime | None,
                stopped: bool = False, now: datetime | None = None) -> str | None:
    """met · breached · at_risk · running · stopped · None (no SLA)."""
    if due is None:
        return None
    due, done_at, start = _aware(due), _aware(done_at), _aware(start)
    if done_at is not None:
        return "met" if (met if met is not None else done_at <= due) else "breached"
    if stopped:
        return "stopped"
    now = now or now_utc()
    if now > due:
        return "breached"
    if start and (now - start) >= (due - start) * WARNING_FRACTION:
        return "at_risk"
    return "running"


def response_state(sr, now: datetime | None = None) -> str | None:
    return clock_state(sr.sla_response_due_at, sr.first_response_at, sr.sla_response_met,
                       sr.opened_at or sr.created_at, (sr.status or "").lower() in STOPPED_STATUSES, now)


def resolution_state(sr, now: datetime | None = None) -> str | None:
    return clock_state(sr.sla_resolution_due_at, sr.resolution_at, sr.sla_resolution_met,
                       sr.opened_at or sr.created_at, (sr.status or "").lower() in STOPPED_STATUSES, now)


def sla_filter(query, model, state: str, now: datetime | None = None):
    """SR list filter: breached | at_risk | met (both clocks met)."""
    from sqlalchemy import and_, or_
    now = now or now_utc()
    live = ~model.status.in_(("closed", "cancelled"))
    if state == "breached":
        return query.filter(or_(
            model.sla_response_met == False,  # noqa: E712
            model.sla_resolution_met == False,  # noqa: E712
            and_(model.first_response_at.is_(None), model.sla_response_due_at < now, live),
            and_(model.resolution_at.is_(None), model.sla_resolution_due_at < now, live),
        ))
    if state == "met":
        return query.filter(model.sla_response_met == True, model.sla_resolution_met == True)  # noqa: E712
    if state == "at_risk":
        # Python-side precision isn't needed for a list filter: open clocks
        # due within the next 20 % of their window are approximated by the
        # remaining hours of the standard profile windows.
        soon_resp = now + timedelta(hours=SLA_PROFILES["urgent"]["response_hours"])
        soon_res = now + timedelta(hours=24)
        return query.filter(live, or_(
            and_(model.first_response_at.is_(None), model.sla_response_due_at >= now, model.sla_response_due_at <= soon_resp),
            and_(model.resolution_at.is_(None), model.sla_resolution_due_at >= now, model.sla_resolution_due_at <= soon_res),
        ))
    from fastapi import HTTPException
    raise HTTPException(status_code=400, detail=f"Invalid SLA filter '{state}'. Use breached, at_risk or met.")
