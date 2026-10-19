"""Measuring documents (SAP IK11 / IK17) and performance-based PM (IP42).

post_reading() is the ONLY writer of a counter value:
  * a counter (the asset's main meter, or an is_counter measuring point)
    never goes backwards — a lower reading needs an admin and a reason
    (meter replaced / reset), and is kept on the document;
  * a reading outside a point's lower / upper limit raises a maintenance
    request of type 'abnormality' (one open request per point at a time)
    and tells the plant's maintenance users (bell — it's an alert, not an
    approval or a reminder, so no Teams push);
  * a main-meter reading re-checks the asset's meter-triggered PM plans and
    raises the job when the counter reached next_due_meter − lead_meter.

Meter maths for PM plans lives here too (meter_due / roll_meter_forward) so
service.run_pm_plan and advance_pm_plan stay readable."""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import is_admin_user
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.counters import (
    MaintenanceMeasuringPoint, MaintenanceMeasurementDoc, MAINTENANCE_READING_SOURCES,
)
from app.modules.maintenance.models.pm_plan import MaintenancePmPlan, MAINTENANCE_PM_METER_TRIGGERS

logger = logging.getLogger("maintenance")

LIMIT_BREACH = "maintenance_reading_limit_breach"


def _fmt(v: float | None) -> str:
    return "—" if v is None else f"{v:g}"


def _now():
    from app.modules.maintenance.service import now_utc
    return now_utc()


def last_doc(db: Session, asset_id: int, point_id: int | None) -> MaintenanceMeasurementDoc | None:
    q = db.query(MaintenanceMeasurementDoc).filter(MaintenanceMeasurementDoc.asset_id == asset_id)
    q = q.filter(MaintenanceMeasurementDoc.measuring_point_id == point_id) if point_id else q.filter(
        MaintenanceMeasurementDoc.measuring_point_id.is_(None))
    return q.order_by(MaintenanceMeasurementDoc.read_at.desc(), MaintenanceMeasurementDoc.id.desc()).first()


def check_limits(point: MaintenanceMeasuringPoint | None, reading: float) -> str | None:
    if point is None:
        return None
    if point.lower_limit is not None and reading < point.lower_limit:
        return "low"
    if point.upper_limit is not None and reading > point.upper_limit:
        return "high"
    return None


def _open_breach_request(db: Session, point_id: int):
    """An abnormality request raised by an earlier breach of this point that
    is still open / acknowledged — a second breach doesn't raise another."""
    from app.modules.maintenance.models.request import MaintenanceRequest
    return db.query(MaintenanceRequest).join(
        MaintenanceMeasurementDoc, MaintenanceMeasurementDoc.request_id == MaintenanceRequest.id,
    ).filter(
        MaintenanceMeasurementDoc.measuring_point_id == point_id,
        MaintenanceRequest.status.in_(("open", "acknowledged")),
    ).order_by(MaintenanceRequest.id.desc()).first()


def _raise_breach_request(db: Session, asset: MaintenanceAsset, point: MaintenanceMeasuringPoint,
                          doc: MaintenanceMeasurementDoc, user_id: int | None):
    from app.modules.maintenance.models.request import MaintenanceRequest
    from app.modules.maintenance.service import (
        default_priority, generate_request_number, maintenance_users_for_branch, notify_many,
    )
    existing = _open_breach_request(db, point.id)
    if existing is not None:
        doc.request_id = existing.id
        return existing, False
    limit = point.lower_limit if doc.limit_breach == "low" else point.upper_limit
    req = MaintenanceRequest(
        request_number=generate_request_number(db),
        asset_id=asset.id,
        request_type="abnormality",
        machine_down=False,
        reported_at=doc.read_at,
        problem_description=(
            f"Measuring point '{point.name}' read {_fmt(doc.reading)} {point.unit} — "
            f"{'below the lower' if doc.limit_breach == 'low' else 'above the upper'} limit of {_fmt(limit)} {point.unit}. "
            "Raised automatically from the reading."
        ),
        priority=default_priority(asset.criticality, False, db),
        status="open",
        raised_by_id=user_id,
    )
    db.add(req)
    db.flush()
    doc.request_id = req.id
    notify_many(
        db, [u.id for u in maintenance_users_for_branch(db, asset.branch_id)],
        f"Limit breach on {asset.asset_code}: {point.name}",
        f"{_fmt(doc.reading)} {point.unit} is outside {_fmt(point.lower_limit)}–{_fmt(point.upper_limit)} {point.unit}. "
        f"Request {req.request_number} was raised — check the machine.",
        LIMIT_BREACH, "maintenance_request", req.id,
    )
    from app.modules.maintenance.role_events import role_event
    role_event(db, None, "reading_limit_breach", title=f"Limit breach on {asset.asset_code}: {point.name}",
               message=f"{_fmt(doc.reading)} {point.unit} is outside {_fmt(point.lower_limit)}–{_fmt(point.upper_limit)} {point.unit}. "
                       f"Request {req.request_number} was raised — check the machine.",
               entity_type="maintenance_request", entity_id=req.id, record=req,
               skip_user_ids={u.id for u in maintenance_users_for_branch(db, asset.branch_id)})
    return req, True


def post_reading(
    db: Session, asset: MaintenanceAsset, reading: float, user, *, point: MaintenanceMeasuringPoint | None = None,
    read_at: datetime | None = None, source: str = "manual", work_order_id: int | None = None,
    remarks: str | None = None, override_reason: str | None = None, trigger_pm: bool = True,
) -> dict:
    """Validates and books one reading. Flushes, never commits. Returns
    {"doc", "request" (abnormality raised or reused, or None),
    "generated" (PM work orders raised by this reading)}."""
    from app.modules.maintenance.service import _aware
    if reading is None or not math.isfinite(float(reading)):
        raise HTTPException(status_code=400, detail="Enter the reading as a number.")
    reading = float(reading)
    if source not in MAINTENANCE_READING_SOURCES:
        raise HTTPException(status_code=400, detail=f"Invalid reading source '{source}'. Valid: {', '.join(MAINTENANCE_READING_SOURCES)}.")
    if asset.is_deleted or asset.status == "decommissioned":
        raise HTTPException(status_code=409, detail=f"{asset.asset_code} is {'deleted' if asset.is_deleted else 'decommissioned'} — readings can't be entered on it.")
    if point is None and not asset.meter_unit:
        raise HTTPException(
            status_code=400,
            detail=f"{asset.asset_code} has no meter unit, so it has no main counter. Edit the asset and set the meter unit "
                   "(e.g. hours, km), or add a measuring point and enter the reading against it.",
        )
    if point is not None and (point.asset_id != asset.id):
        raise HTTPException(status_code=404, detail=f"Measuring point #{point.id} isn't on {asset.asset_code}.")
    if point is not None and not point.is_active:
        raise HTTPException(status_code=409, detail=f"Measuring point '{point.name}' is inactive — activate it before entering readings.")
    now = _now()
    read_at = _aware(read_at) or now
    if read_at > now + timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Reading time can't be in the future.")
    unit = point.unit if point is not None else asset.meter_unit
    is_counter = point is None or point.is_counter
    label = f"'{point.name}'" if point is not None else "the main counter"

    prev = last_doc(db, asset.id, point.id if point else None)
    prev_value = prev.reading if prev else (point.current_reading if point is not None else asset.current_meter_reading)
    override = (override_reason or "").strip() or None
    if prev is not None and read_at < _aware(prev.read_at) and is_counter:
        raise HTTPException(
            status_code=409,
            detail=f"The last reading of {label} was taken {(_aware(prev.read_at)):%d-%m-%Y %H:%M}; a counter reading can't be "
                   "back-dated before it. Enter readings in the order they were taken.",
        )
    if is_counter and prev_value is not None and reading < prev_value - 1e-9:
        if not is_admin_user(user):
            raise HTTPException(
                status_code=409,
                detail=f"A counter can't go backwards: {label} last read {_fmt(prev_value)} {unit}, you entered {_fmt(reading)}. "
                       "Check the figure. If the meter was replaced or reset, ask an admin to enter it with the reason.",
            )
        if not override:
            raise HTTPException(
                status_code=422,
                detail=f"{_fmt(reading)} {unit} is lower than the last reading ({_fmt(prev_value)}). Give the reason "
                       "(e.g. 'hour meter replaced on 12-10') to record a counter reset.",
            )
    elif override:
        override = None  # nothing to override — don't store a misleading reason

    doc = MaintenanceMeasurementDoc(
        asset_id=asset.id, measuring_point_id=point.id if point else None, reading=reading,
        previous_reading=prev_value, difference=(round(reading - prev_value, 4) if prev_value is not None else None),
        read_at=read_at, read_by_id=getattr(user, "id", None), source=source, work_order_id=work_order_id,
        limit_breach=check_limits(point, reading), override_reason=override,
        remarks=(remarks or "").strip() or None,
    )
    db.add(doc)
    latest = prev is None or read_at >= _aware(prev.read_at)
    if latest:
        if point is not None:
            point.current_reading, point.last_read_at = reading, read_at
        else:
            asset.current_meter_reading, asset.meter_updated_at = reading, read_at
    db.flush()

    request = None
    if doc.limit_breach and point is not None:
        request, _new = _raise_breach_request(db, asset, point, doc, getattr(user, "id", None))

    generated = []
    if point is None and trigger_pm and latest:
        generated = trigger_meter_plans(db, asset, getattr(user, "id", None))
    return {"doc": doc, "request": request, "generated": generated}


# ---------------------------------------------------------------------------
# Performance-based PM
# ---------------------------------------------------------------------------

def is_meter_plan(plan) -> bool:
    return (plan.trigger_type or "calendar") in MAINTENANCE_PM_METER_TRIGGERS


def meter_due(db: Session, plan, asset: MaintenanceAsset | None = None) -> bool:
    """The asset's main counter has reached the plan's next due reading minus
    its lead (e.g. 50 h before the 500 h service)."""
    if not is_meter_plan(plan) or plan.next_due_meter is None:
        return False
    asset = asset or db.get(MaintenanceAsset, plan.asset_id)
    if asset is None or asset.current_meter_reading is None:
        return False
    return asset.current_meter_reading >= plan.next_due_meter - (plan.lead_meter or 0)


def meter_state(plan, asset: MaintenanceAsset | None) -> str | None:
    """overdue (counter past the due reading) · due_soon (inside the lead) ·
    scheduled — None for calendar plans or with no reading yet."""
    if not is_meter_plan(plan) or plan.next_due_meter is None or asset is None or asset.current_meter_reading is None:
        return None
    if asset.current_meter_reading >= plan.next_due_meter:
        return "overdue"
    if asset.current_meter_reading >= plan.next_due_meter - (plan.lead_meter or 0):
        return "due_soon"
    return "scheduled"


def roll_meter_forward(db: Session, plan, wo) -> None:
    """On closing a PM job: last done = the reading captured at completion
    (else the asset's current reading), next due = last done + interval."""
    if not is_meter_plan(plan) or not plan.meter_interval:
        return
    reading = wo.meter_reading_at_completion
    if reading is None:
        asset = db.get(MaintenanceAsset, plan.asset_id)
        reading = asset.current_meter_reading if asset else None
    if reading is None:
        return
    if plan.last_done_meter is None or reading >= plan.last_done_meter:
        plan.last_done_meter = reading
        plan.next_due_meter = round(reading + plan.meter_interval, 4)


def validate_meter_plan(asset: MaintenanceAsset, trigger_type: str, meter_interval: float | None,
                        lead_meter: float | None) -> None:
    if (trigger_type or "calendar") not in MAINTENANCE_PM_METER_TRIGGERS:
        return
    if not asset.meter_unit:
        raise HTTPException(
            status_code=400,
            detail=f"{asset.asset_code} has no meter unit, so a counter-based plan can't run on it. Edit the asset and set its "
                   "meter unit (e.g. hours, km) and current reading first.",
        )
    if meter_interval is None or meter_interval <= 0:
        raise HTTPException(status_code=400, detail=f"A counter-based plan needs the interval in {asset.meter_unit} (e.g. every 500 {asset.meter_unit}).")
    if lead_meter is not None and not (0 <= lead_meter < meter_interval):
        raise HTTPException(status_code=400, detail=f"Lead must be 0 or more and less than the interval ({meter_interval:g} {asset.meter_unit}).")


def trigger_meter_plans(db: Session, asset: MaintenanceAsset, user_id: int | None) -> list:
    """After a main-counter reading: run every active meter plan of the
    asset through the normal PM step (service.run_pm_plan). A plan that
    can't take a job (asset problem) is logged, never fails the reading."""
    from app.modules.maintenance.service import run_pm_plan
    out = []
    plans = db.query(MaintenancePmPlan).filter(
        MaintenancePmPlan.asset_id == asset.id, MaintenancePmPlan.is_active == True,  # noqa: E712
        MaintenancePmPlan.is_deleted == False, MaintenancePmPlan.trigger_type.in_(MAINTENANCE_PM_METER_TRIGGERS),  # noqa: E712
    ).all()
    for plan in plans:
        if not meter_due(db, plan, asset):
            continue
        try:
            outcome, wo = run_pm_plan(db, plan, user_id=user_id)
            if outcome == "generated" and wo is not None:
                out.append(wo)
        except ValueError:  # asset can't take a job — raised before anything is written
            logger.exception("Meter PM %s: generation after reading failed", plan.plan_code)
    return out
