"""Preventive-maintenance plans (PM-NNNN): CRUD, "Generate now" and the PM
calendar. Work-order generation itself lives in service.generate_pm_work_order
so the daily scheduler (tasks/maintenance_pm_scheduler.py) and the button
here run exactly the same code."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core import assignee_rules
from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_can_delete, require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.store.models.item import StoreItem
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.pm_plan import (
    MaintenancePmPlan, MaintenancePmPlanTask, MaintenancePmPlanSpare,
    MAINTENANCE_PM_WO_TYPES, MAINTENANCE_PM_TRIGGER_TYPES, MAINTENANCE_PM_FREQUENCY_UNITS, MAINTENANCE_PM_SCHEDULE_BASES,
)
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder, MAINTENANCE_WO_OPEN_STATUSES
from app.modules.maintenance.schemas.pm_plan import (
    MaintenancePmPlanCreate, MaintenancePmPlanUpdate, MaintenancePmPlanResponse, MaintenancePmPlanSpareResponse,
    MaintenancePmPlanWorkOrderSummary, MaintenancePmCalendarEntry, MaintenancePmPlanTaskPayload, MaintenancePmPlanSparePayload,
)
from app.modules.maintenance.settings import default_pm_lead_days
from app.modules.maintenance import access  # noqa: F401 — registers the maintenance data scopes
from app.modules.maintenance.service import (
    generate_pm_plan_code, run_pm_plan, add_pm_interval, open_pm_work_order, today_ist, user_names, _date_ist,
)

router = APIRouter(
    prefix="/maintenance", tags=["Maintenance"],
    dependencies=[Depends(require_app_access("maintenance"))],
)

WO_STATUS_LABEL = {
    "draft": "Draft", "assigned": "Assigned", "in_progress": "In Progress", "on_hold": "On Hold",
    "completed": "Completed", "closed": "Closed", "cancelled": "Cancelled",
}
UNIT_WORDS = {"day": ("day", "Daily"), "week": ("week", "Weekly"), "month": ("month", "Monthly"), "year": ("year", "Yearly")}
CALENDAR_MAX_DAYS = 400
ASSIGNEE_RULE = "maintenance:schedule.default_assignee"  # core/assignee_rules.PICKERS


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def frequency_label(unit: str, value: int) -> str:
    word, single = UNIT_WORDS.get(unit, (unit, unit))
    if value == 1:
        return single
    if unit == "month" and value == 3:
        return "Quarterly"
    if unit == "month" and value == 6:
        return "Half-yearly"
    return f"Every {value} {word}s"


def _due_state(plan: MaintenancePmPlan, today: date, asset: MaintenanceAsset | None = None) -> str:
    if not plan.is_active:
        return "inactive"
    from app.modules.maintenance.counters import meter_state
    m_state = meter_state(plan, asset)
    if plan.trigger_type == "meter":
        return m_state or "scheduled"
    if m_state in ("overdue", "due_soon") and plan.next_due_date >= today:
        return m_state  # calendar_or_meter: the counter is the nearer due
    if plan.next_due_date < today:
        return "overdue"
    if plan.next_due_date - timedelta(days=plan.lead_days or 0) <= today:
        return "due_soon"
    return "scheduled"


def _get_or_404(db: Session, plan_id: int, user: User | None = None) -> MaintenancePmPlan:
    plan = (
        db.query(MaintenancePmPlan)
        .options(selectinload(MaintenancePmPlan.tasks), selectinload(MaintenancePmPlan.spares))
        .filter(MaintenancePmPlan.id == plan_id, MaintenancePmPlan.is_deleted == False)  # noqa: E712
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail=f"PM plan #{plan_id} not found — it may have been deleted.")
    if user is not None:
        ensure_in_scope(db, user, plan)  # 403 when outside the user's Maintenance data scope
    return plan


def _list_context(db: Session, plans: list[MaintenancePmPlan]) -> dict:
    """Everything _to_response looks up, fetched once for a whole list (no
    per-row queries)."""
    asset_ids = {p.asset_id for p in plans}
    assets = {a.id: a for a in db.query(MaintenanceAsset).filter(MaintenanceAsset.id.in_(asset_ids)).all()} if asset_ids else {}
    branch_ids = {a.branch_id for a in assets.values() if a.branch_id}
    branches = dict(db.query(Branch.id, Branch.name).filter(Branch.id.in_(branch_ids)).all()) if branch_ids else {}
    plan_ids = [p.id for p in plans]
    open_wos: dict[int, MaintenanceWorkOrder] = {}
    if plan_ids:
        # Highest id wins — same pick as service.open_pm_work_order.
        for w in db.query(MaintenanceWorkOrder).filter(
            MaintenanceWorkOrder.pm_plan_id.in_(plan_ids), MaintenanceWorkOrder.status.in_(MAINTENANCE_WO_OPEN_STATUSES),
        ).order_by(MaintenanceWorkOrder.id).all():
            open_wos[w.pm_plan_id] = w
    last_ids = {p.last_work_order_id for p in plans if p.last_work_order_id}
    last_numbers = dict(db.query(MaintenanceWorkOrder.id, MaintenanceWorkOrder.wo_number).filter(
        MaintenanceWorkOrder.id.in_(last_ids)).all()) if last_ids else {}
    names = user_names(db, [p.default_assignee_id for p in plans])
    return {"assets": assets, "branches": branches, "open_wos": open_wos, "last_numbers": last_numbers, "names": names}


def _to_response(db: Session, plan: MaintenancePmPlan, detail: bool = False, today: date | None = None, ctx: dict | None = None) -> MaintenancePmPlanResponse:
    """ctx (from _list_context) avoids per-row queries in lists; single-plan
    callers leave it None and the lookups run for this one plan."""
    today = today or today_ist()
    ctx = ctx or _list_context(db, [plan])
    resp = MaintenancePmPlanResponse.model_validate(plan)
    asset = ctx["assets"].get(plan.asset_id)
    if asset:
        resp.asset_code, resp.asset_name, resp.asset_status = asset.asset_code, asset.name, asset.status
        resp.asset_criticality, resp.branch_id = asset.criticality, asset.branch_id
        resp.branch_name = ctx["branches"].get(asset.branch_id)
    resp.frequency_label = frequency_label(plan.frequency_unit, plan.frequency_value)
    resp.due_state = _due_state(plan, today, asset)
    if asset is not None:
        from app.modules.maintenance.counters import meter_state
        resp.meter_unit, resp.current_meter_reading = asset.meter_unit, asset.current_meter_reading
        resp.meter_due_state = meter_state(plan, asset)
    if plan.trigger_type == "meter":
        unit = (asset.meter_unit if asset else None) or "units"
        resp.frequency_label = f"Every {plan.meter_interval:g} {unit}" if plan.meter_interval else "Counter-based"
    elif plan.trigger_type == "calendar_or_meter" and plan.meter_interval:
        unit = (asset.meter_unit if asset else None) or "units"
        resp.frequency_label = f"{resp.frequency_label} or every {plan.meter_interval:g} {unit}"
    open_wo = ctx["open_wos"].get(plan.id)
    if open_wo:
        resp.open_work_order_id, resp.open_work_order_number, resp.open_work_order_status = open_wo.id, open_wo.wo_number, open_wo.status
    if plan.last_work_order_id:
        resp.last_work_order_number = ctx["last_numbers"].get(plan.last_work_order_id)

    recent: list[MaintenanceWorkOrder] = []
    if detail:
        recent = (
            db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.pm_plan_id == plan.id)
            .order_by(MaintenanceWorkOrder.id.desc()).limit(15).all()
        )
    names = dict(ctx["names"])
    missing = [w.assigned_to_id for w in recent if w.assigned_to_id and w.assigned_to_id not in names]
    if missing:
        names.update(user_names(db, missing))
    resp.default_assignee_name = names.get(plan.default_assignee_id)

    if detail:
        items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([s.store_item_id for s in plan.spares])).all()} if plan.spares else {}
        resp.spares = []
        for s in plan.spares:
            r = MaintenancePmPlanSpareResponse.model_validate(s)
            item = items.get(s.store_item_id)
            if item:
                r.item_code, r.item_name, r.uom = item.item_code, item.item_name, item.uom
            resp.spares.append(r)
        for w in recent:
            done_on = _date_ist(w.actual_end) if w.status in ("completed", "closed") else None
            resp.recent_work_orders.append(MaintenancePmPlanWorkOrderSummary(
                id=w.id, wo_number=w.wo_number, status=w.status, pm_due_date=w.pm_due_date,
                assigned_to_name=names.get(w.assigned_to_id), actual_end=w.actual_end, closed_at=w.closed_at,
                on_time=(done_on <= w.pm_due_date) if (done_on and w.pm_due_date) else None,
            ))
    return resp


def _check_assignee(db: Session, user_id: int | None, user: User, current_id: int | None = None) -> None:
    if not user_id:
        return
    tech = db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technician #{user_id} not found or inactive — pick the default technician again.")
    # The role's assign-to rule (Maintenance › Schedule › Default technician), on a change only.
    if tech.id != current_id:
        assignee_rules.ensure_allowed(db, user, ASSIGNEE_RULE, tech)


def _check_asset(db: Session, asset_id: int) -> MaintenanceAsset:
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == asset_id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
    if not asset:
        raise HTTPException(status_code=404, detail=f"Asset #{asset_id} not found — pick the machine again.")
    if asset.status == "decommissioned":
        raise HTTPException(status_code=400, detail=f"{asset.asset_code} is decommissioned, so it can't have a PM plan.")
    return asset


def _validate(db: Session, data: dict, user: User, plan: MaintenancePmPlan | None = None) -> None:
    def _enum(key: str, allowed: tuple, label: str) -> None:
        if key in data and data[key] is not None and data[key] not in allowed:
            raise HTTPException(status_code=400, detail=f"Invalid {label} '{data[key]}'. Valid: {', '.join(allowed)}.")

    _enum("wo_type", MAINTENANCE_PM_WO_TYPES, "work order type for a PM plan")
    _enum("trigger_type", MAINTENANCE_PM_TRIGGER_TYPES, "trigger type")
    _enum("frequency_unit", MAINTENANCE_PM_FREQUENCY_UNITS, "frequency unit")
    _enum("schedule_basis", MAINTENANCE_PM_SCHEDULE_BASES, "schedule basis")
    if "title" in data and not (data["title"] or "").strip():
        raise HTTPException(status_code=400, detail="PM plan title is required (e.g. 'Monthly lubrication & oil level check').")
    if data.get("frequency_value") is not None and not (1 <= data["frequency_value"] <= 366):
        raise HTTPException(status_code=400, detail="Frequency must be between 1 and 366 (e.g. every 3 months).")
    if data.get("lead_days") is not None and not (0 <= data["lead_days"] <= 365):
        raise HTTPException(status_code=400, detail="Lead days must be between 0 and 365.")
    if data.get("estimated_hours") is not None and data["estimated_hours"] < 0:
        raise HTTPException(status_code=400, detail="Estimated hours can't be negative.")
    if "next_due_date" in data and data["next_due_date"] is None and data.get("trigger_type", "calendar") != "meter":
        raise HTTPException(status_code=400, detail="Next due date is required — it's when the first job falls due.")
    for key, label in (("meter_interval", "Counter interval"), ("lead_meter", "Counter lead"), ("next_due_meter", "Next due reading")):
        if data.get(key) is not None and data[key] < 0:
            raise HTTPException(status_code=400, detail=f"{label} can't be negative.")
    _check_assignee(db, data.get("default_assignee_id"), user, plan.default_assignee_id if plan else None)


def _build_tasks(tasks: list[MaintenancePmPlanTaskPayload]) -> list[MaintenancePmPlanTask]:
    out = []
    for idx, t in enumerate(tasks, start=1):
        if not (t.description or "").strip():
            raise HTTPException(status_code=400, detail=f"Checklist line {idx} has no description — fill it in or remove the line.")
        if t.expected_value and len(t.expected_value) > 100:
            raise HTTPException(status_code=400, detail=f"Checklist line {idx}: expected value is longer than 100 characters.")
        out.append(MaintenancePmPlanTask(sequence=idx * 10, description=t.description.strip()[:500], expected_value=(t.expected_value or "").strip() or None))
    return out


def _build_spares(db: Session, spares: list[MaintenancePmPlanSparePayload]) -> list[MaintenancePmPlanSpare]:
    ids = {s.store_item_id for s in spares}
    found = {i for (i,) in db.query(StoreItem.id).filter(StoreItem.id.in_(ids)).all()} if ids else set()
    seen: set[int] = set()
    out = []
    for idx, s in enumerate(spares, start=1):
        if s.store_item_id not in found:
            raise HTTPException(status_code=404, detail=f"Spares kit line {idx}: Store item #{s.store_item_id} not found — pick the spare again.")
        if s.store_item_id in seen:
            raise HTTPException(status_code=400, detail=f"Spares kit line {idx}: the same spare is listed twice — combine the quantities into one line.")
        if s.qty is None or s.qty <= 0:
            raise HTTPException(status_code=400, detail=f"Spares kit line {idx}: quantity must be greater than 0.")
        seen.add(s.store_item_id)
        out.append(MaintenancePmPlanSpare(store_item_id=s.store_item_id, qty=s.qty, remarks=(s.remarks or "").strip() or None))
    return out


# ---------------------------------------------------------------------------
# Calendar (declared before /{plan_id} so "calendar" isn't parsed as an id)
# ---------------------------------------------------------------------------

@router.get("/pm-plans/calendar", response_model=list[MaintenancePmCalendarEntry])
async def pm_calendar(
    from_date: date = Query(..., alias="from"),
    to_date: date = Query(..., alias="to"),
    branch_id: int | None = None,
    asset_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("maintenance", "schedule")),
):
    """Projected due dates of active plans in [from, to] (stepping forward by
    each plan's frequency from its next due date) plus the PM work orders
    already generated for due dates in the window."""
    if to_date < from_date:
        raise HTTPException(status_code=400, detail="'to' date is before the 'from' date.")
    if (to_date - from_date).days > CALENDAR_MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Calendar window is limited to {CALENDAR_MAX_DAYS} days — narrow the date range.")
    today = today_ist()

    plan_q = db.query(MaintenancePmPlan).filter(MaintenancePmPlan.is_deleted == False)  # noqa: E712
    if asset_id:
        plan_q = plan_q.filter(MaintenancePmPlan.asset_id == asset_id)
    if branch_id:
        plan_q = plan_q.join(MaintenanceAsset, MaintenanceAsset.id == MaintenancePmPlan.asset_id).filter(MaintenanceAsset.branch_id == branch_id)
    plans = {p.id: p for p in apply_scope(plan_q, user, MaintenancePmPlan).all()}
    if not plans:
        return []
    assets = {a.id: a for a in db.query(MaintenanceAsset).filter(MaintenanceAsset.id.in_({p.asset_id for p in plans.values()})).all()}

    wos = db.query(MaintenanceWorkOrder).filter(
        MaintenanceWorkOrder.pm_plan_id.in_(list(plans)),
        MaintenanceWorkOrder.pm_due_date >= from_date, MaintenanceWorkOrder.pm_due_date <= to_date,
    ).all()
    names = user_names(db, [w.assigned_to_id for w in wos])
    generated = {(w.pm_plan_id, w.pm_due_date) for w in wos}

    entries: list[MaintenancePmCalendarEntry] = []

    def _base(p: MaintenancePmPlan) -> dict:
        a = assets.get(p.asset_id)
        return {"plan_id": p.id, "plan_code": p.plan_code, "title": p.title, "asset_id": p.asset_id,
                "asset_code": a.asset_code if a else None, "asset_name": a.name if a else None, "wo_type": p.wo_type}

    for w in wos:
        p = plans[w.pm_plan_id]
        state = "overdue" if (w.status in MAINTENANCE_WO_OPEN_STATUSES and w.pm_due_date < today) else w.status
        entries.append(MaintenancePmCalendarEntry(
            kind="work_order", date=w.pm_due_date, state=state, work_order_id=w.id, wo_number=w.wo_number,
            wo_status=w.status, assigned_to_name=names.get(w.assigned_to_id), **_base(p),
        ))

    for p in plans.values():
        if not p.is_active or p.trigger_type == "meter":
            continue  # a pure counter plan has no calendar dates to project
        d = p.next_due_date
        for _ in range(CALENDAR_MAX_DAYS + 1):
            if d > to_date:
                break
            if d >= from_date and (p.id, d) not in generated:
                if d < today:
                    state = "overdue"
                elif d - timedelta(days=p.lead_days or 0) <= today:
                    state = "due"
                else:
                    state = "upcoming"
                entries.append(MaintenancePmCalendarEntry(kind="projected", date=d, state=state, **_base(p)))
            d = add_pm_interval(d, p.frequency_unit, p.frequency_value)

    entries.sort(key=lambda e: (e.date, e.asset_code or "", e.plan_code))
    return entries


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.get("/pm-plans", response_model=list[MaintenancePmPlanResponse])
async def list_pm_plans(
    asset_id: int | None = None,
    branch_id: int | None = None,
    is_active: bool | None = None,
    due_within_days: int | None = Query(None, description="Only plans whose next due date is within N days (overdue included)"),
    overdue: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("maintenance", "schedule")),
):
    today = today_ist()
    q = db.query(MaintenancePmPlan).options(selectinload(MaintenancePmPlan.tasks), selectinload(MaintenancePmPlan.spares)).filter(
        MaintenancePmPlan.is_deleted == False,  # noqa: E712
    )
    if asset_id:
        q = q.filter(MaintenancePmPlan.asset_id == asset_id)
    if is_active is not None:
        q = q.filter(MaintenancePmPlan.is_active == is_active)
    if overdue:
        q = q.filter(MaintenancePmPlan.next_due_date < today)
    if due_within_days is not None:
        q = q.filter(MaintenancePmPlan.next_due_date <= today + timedelta(days=max(0, due_within_days)))
    if branch_id or search:
        q = q.join(MaintenanceAsset, MaintenanceAsset.id == MaintenancePmPlan.asset_id)
        if branch_id:
            q = q.filter(MaintenanceAsset.branch_id == branch_id)
        if search:
            like = f"%{search.strip()}%"
            q = q.filter(
                (MaintenancePmPlan.plan_code.ilike(like)) | (MaintenancePmPlan.title.ilike(like))
                | (MaintenanceAsset.asset_code.ilike(like)) | (MaintenanceAsset.name.ilike(like))
            )
    plans = apply_scope(q, user, MaintenancePmPlan).order_by(MaintenancePmPlan.next_due_date, MaintenancePmPlan.plan_code).all()
    ctx = _list_context(db, plans)
    return [_to_response(db, p, today=today, ctx=ctx) for p in plans]


@router.post("/pm-plans", response_model=MaintenancePmPlanResponse)
async def create_pm_plan(
    payload: MaintenancePmPlanCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "schedule", "create")),
):
    data = payload.model_dump()
    _validate(db, data, user)
    asset = _check_asset(db, payload.asset_id)
    from app.modules.maintenance.counters import validate_meter_plan, is_meter_plan
    validate_meter_plan(asset, payload.trigger_type, payload.meter_interval, payload.lead_meter)
    plan = MaintenancePmPlan(
        plan_code=generate_pm_plan_code(db),
        asset_id=payload.asset_id,
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        wo_type=payload.wo_type,
        trigger_type=payload.trigger_type,
        frequency_unit=payload.frequency_unit,
        frequency_value=payload.frequency_value,
        schedule_basis=payload.schedule_basis,
        lead_days=payload.lead_days if payload.lead_days is not None else default_pm_lead_days(db),
        next_due_date=payload.next_due_date or today_ist(),
        estimated_hours=payload.estimated_hours,
        default_assignee_id=payload.default_assignee_id,
        requires_shutdown=payload.requires_shutdown,
        is_active=payload.is_active,
        created_by_id=user.id,
    )
    if is_meter_plan(plan):
        plan.meter_interval, plan.lead_meter = payload.meter_interval, payload.lead_meter
        plan.last_done_meter = asset.current_meter_reading
        plan.next_due_meter = (payload.next_due_meter if payload.next_due_meter is not None
                               else round((asset.current_meter_reading or 0) + payload.meter_interval, 4))
    plan.tasks = _build_tasks(payload.tasks)
    plan.spares = _build_spares(db, payload.spares)
    db.add(plan)
    db.commit()
    return _to_response(db, _get_or_404(db, plan.id), detail=True)


@router.get("/pm-plans/{plan_id}", response_model=MaintenancePmPlanResponse)
async def get_pm_plan(
    plan_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("maintenance", "schedule")),
):
    return _to_response(db, _get_or_404(db, plan_id, user), detail=True)


@router.patch("/pm-plans/{plan_id}", response_model=MaintenancePmPlanResponse)
async def update_pm_plan(
    plan_id: int, payload: MaintenancePmPlanUpdate, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "schedule", "edit")),
):
    plan = _get_or_404(db, plan_id, user)
    data = payload.model_dump(exclude_unset=True)
    tasks = data.pop("tasks", None)
    spares = data.pop("spares", None)
    for key in ("title", "wo_type", "frequency_unit", "frequency_value", "schedule_basis", "lead_days", "requires_shutdown", "is_active", "asset_id"):
        if key in data and data[key] is None:
            raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} can't be blank.")
    _validate(db, data, user, plan)
    if "asset_id" in data and data["asset_id"] != plan.asset_id:
        _check_asset(db, data["asset_id"])
        open_wo = open_pm_work_order(db, plan.id)
        if open_wo:
            raise HTTPException(
                status_code=409,
                detail=f"Can't move {plan.plan_code} to another asset while {open_wo.wo_number} is open on the current one. Close or cancel it first.",
            )
    if data.get("is_active") and not plan.is_active:
        _check_asset(db, data.get("asset_id") or plan.asset_id)
    if "next_due_date" in data and data["next_due_date"] is None:
        data.pop("next_due_date")  # a counter plan keeps its placeholder date
    for field, val in data.items():
        setattr(plan, field, val.strip() if isinstance(val, str) and field in ("title",) else val)
    from app.modules.maintenance.counters import validate_meter_plan, is_meter_plan
    asset_now = db.get(MaintenanceAsset, plan.asset_id)
    validate_meter_plan(asset_now, plan.trigger_type, plan.meter_interval, plan.lead_meter)
    if is_meter_plan(plan) and plan.next_due_meter is None:
        base = plan.last_done_meter if plan.last_done_meter is not None else (asset_now.current_meter_reading or 0)
        plan.next_due_meter = round(base + plan.meter_interval, 4)
    if "description" in data:
        plan.description = (data["description"] or "").strip() or None
    if tasks is not None:
        plan.tasks = _build_tasks(payload.tasks or [])
    if spares is not None:
        plan.spares = _build_spares(db, payload.spares or [])
    db.commit()
    return _to_response(db, _get_or_404(db, plan.id), detail=True)


@router.delete("/pm-plans/{plan_id}")
async def delete_pm_plan(
    plan_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "schedule", "delete")),
):
    plan = _get_or_404(db, plan_id, user)
    ensure_can_delete(user, plan, "maintenance", "schedule", what="PM plan")
    open_wo = open_pm_work_order(db, plan.id)
    if open_wo:
        raise HTTPException(
            status_code=409,
            detail=f"Can't delete {plan.plan_code}: work order {open_wo.wo_number} generated from it is still {WO_STATUS_LABEL.get(open_wo.status, open_wo.status)}. "
                   "Close or cancel that job first, or just deactivate the plan.",
        )
    plan.is_deleted = True
    plan.deleted_at = datetime.now(timezone.utc)
    plan.is_active = False
    db.commit()
    return {"message": f"{plan.plan_code} deleted. Work orders already generated from it stay on record."}


@router.post("/pm-plans/{plan_id}/generate-now", response_model=MaintenancePmPlanResponse)
async def generate_now(
    plan_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "schedule", "create")),
):
    """Raise the work order for the plan's next due date right away, ignoring
    the lead-days window — same code path as the daily scheduler."""
    plan = _get_or_404(db, plan_id, user)
    if not plan.is_active:
        raise HTTPException(status_code=409, detail=f"{plan.plan_code} is inactive. Activate it (Edit) before generating a work order.")
    try:
        outcome, wo = run_pm_plan(db, plan, user_id=user.id, force=True)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    except IntegrityError:  # flush hit the unique (plan, due date) constraint
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Another user just generated the job for this due date — refresh the page to see it.",
        )
    if outcome == "open_exists":
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"{plan.plan_code} already has an open work order, {wo.wo_number} ({WO_STATUS_LABEL.get(wo.status, wo.status)}, due "
                   f"{wo.pm_due_date:%d-%m-%Y}). Finish or cancel it before raising the next one." if wo and wo.pm_due_date else
                   f"{plan.plan_code} already has an open work order. Finish or cancel it before raising the next one.",
        )
    if outcome == "waiting_close":
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"{wo.wo_number} for the {wo.pm_due_date:%d-%m-%Y} due date is Completed but not closed yet. "
                   "Close it (that rolls the plan to its next due date), then generate the next job.",
        )
    try:
        db.commit()
    except IntegrityError:
        # The unique (plan, due date) constraint: the scheduler or another
        # user raised this occurrence in the same instant.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Another user just generated the job for this due date — refresh the page to see it.",
        )
    return _to_response(db, _get_or_404(db, plan.id), detail=True)
