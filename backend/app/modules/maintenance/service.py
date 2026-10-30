"""Plain-function business rules for the Maintenance module — number
series, the asset ↔ workstation status sync, downtime maths, cost roll-up and
plant-scoped notifications. Kept out of the routes so they're unit-testable
and so there is exactly one place that writes asset.status."""
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder, MAINTENANCE_WO_OPEN_STATUSES
from app.utils.notifications import notify_user

logger = logging.getLogger("maintenance")


def _lock_number_series(db: Session, prefix: str) -> None:
    """Transaction-scoped advisory lock on the prefix (see quality/service.py).
    Skipped on SQLite — the test DB has no advisory locks or concurrency."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def _next_yearly(db: Session, column, code: str) -> str:
    """{code}-{year}-NNNN. The highest number is found by length first, then
    text — a plain string MAX would rank '...-9999' above '...-10000' and
    hand out a duplicate once the year passes 9,999 documents."""
    prefix = f"{code}-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = (
        db.query(column).filter(column.like(f"{prefix}%"))
        .order_by(func.length(column).desc(), column.desc()).limit(1).scalar()
    )
    suffix = last.rsplit("-", 1)[-1] if last else ""
    return f"{prefix}{(int(suffix) + 1) if suffix.isdigit() else 1:04d}"


def generate_request_number(db: Session) -> str:
    return _next_yearly(db, MaintenanceRequest.request_number, "MRQ")


def generate_work_order_number(db: Session) -> str:
    # "WO-" is Production's, hence MWO-.
    return _next_yearly(db, MaintenanceWorkOrder.wo_number, "MWO")


def suggest_asset_code(db: Session) -> str:
    """EQ-NNNN — only used when the user leaves the asset code blank."""
    _lock_number_series(db, "EQ-")
    codes = [c for (c,) in db.query(MaintenanceAsset.asset_code).filter(MaintenanceAsset.asset_code.like("EQ-%")).all()]
    nums = [int(c[3:]) for c in codes if c[3:].isdigit()]
    return f"EQ-{(max(nums) + 1) if nums else 1:04d}"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    # SQLite hands back naive datetimes; treat them as UTC.
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def minutes_between(start: datetime | None, end: datetime | None) -> int | None:
    start, end = _aware(start), _aware(end)
    if not start or not end:
        return None
    return max(0, int(round((end - start).total_seconds() / 60)))


def default_priority(criticality: str, machine_down: bool, db: Session | None = None) -> str:
    """Criticality A + machine down is urgent; everything else is standard.
    With `db`, the matrix comes from Maintenance › Settings (same defaults)."""
    if db is not None:
        from app.modules.maintenance.settings import priority_for
        return priority_for(db, criticality, machine_down)
    return "urgent" if machine_down and criticality == "A" else "standard"


def user_names(db: Session, ids) -> dict[int, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(wanted)).all()}


# ---------------------------------------------------------------------------
# Asset ↔ workstation status sync — the ONLY writer of asset.status for the
# system-managed states. Call after every request / work-order transition.
# ---------------------------------------------------------------------------

def sync_asset_status(db: Session, asset: MaintenanceAsset) -> None:
    if asset.status == "decommissioned":
        return
    # Sessions run with autoflush off — push the caller's pending status
    # change so the queries below see it.
    db.flush()
    down_wos = db.query(MaintenanceWorkOrder).filter(
        MaintenanceWorkOrder.asset_id == asset.id,
        MaintenanceWorkOrder.machine_down == True,  # noqa: E712
        MaintenanceWorkOrder.status.in_(MAINTENANCE_WO_OPEN_STATUSES),
    ).all()
    # A planned (PM) shutdown only takes the machine down once work starts —
    # a job generated days ahead mustn't block the workstation early.
    down_wos = [w for w in down_wos if not (w.pm_plan_id and w.status in ("draft", "assigned"))]
    # A down request that already became a work order is represented by that WO.
    down_requests = db.query(MaintenanceRequest.id).filter(
        MaintenanceRequest.asset_id == asset.id,
        MaintenanceRequest.machine_down == True,  # noqa: E712
        MaintenanceRequest.status.in_(("open", "acknowledged")),
    ).count()

    if any(wo.status == "in_progress" for wo in down_wos):
        new_status = "under_maintenance"
    elif down_wos or down_requests:
        new_status = "breakdown"
    elif asset.status in ("breakdown", "under_maintenance"):
        new_status = "operational"
    else:
        new_status = asset.status  # operational / standby stay as the user set them
    asset.status = new_status

    if asset.workstation_id:
        _sync_workstation(db, asset.workstation_id, down=new_status in ("breakdown", "under_maintenance"))


def _sync_workstation(db: Session, workstation_id: int, down: bool) -> None:
    """Blocks / unblocks the linked Production workstation. A no-op if the
    Production module (or the workstation) isn't there."""
    try:
        from app.modules.production.models.workstation import ProductionWorkstation
    except Exception:  # pragma: no cover — Production module absent
        return
    ws = db.query(ProductionWorkstation).filter(ProductionWorkstation.id == workstation_id).first()
    if not ws:
        return
    if down and ws.status == "active":
        ws.status = "under_maintenance"
    elif not down and ws.status == "under_maintenance":
        ws.status = "active"  # never re-activate a workstation someone set inactive


# ---------------------------------------------------------------------------
# Costs
# ---------------------------------------------------------------------------

def recompute_costs(wo: MaintenanceWorkOrder) -> None:
    wo.labour_cost = round(sum((l.hours or 0) * (l.hourly_rate or 0) for l in wo.labour_logs), 2)
    wo.spares_cost = round(sum(max(0.0, (s.qty_issued or 0) - (s.qty_returned or 0)) * (s.unit_cost or 0) for s in wo.spares), 2)
    # procured_cost: outside service bought through a PR raised from the job
    # (wo_procurement.refresh_procured_cost) — on top of hand-typed external_cost.
    wo.total_cost = round(wo.labour_cost + wo.spares_cost + (wo.external_cost or 0) + (getattr(wo, "procured_cost", 0) or 0), 2)


def close_downtime(wo: MaintenanceWorkOrder, at: datetime | None = None) -> None:
    """Stops the downtime clock (machine handed back) and stores the minutes."""
    if not wo.machine_down or not wo.downtime_start:
        return
    wo.downtime_end = wo.downtime_end or at or now_utc()
    wo.downtime_minutes = minutes_between(wo.downtime_start, wo.downtime_end)


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

def maintenance_users_for_branch(db: Session, branch_id: int | None) -> list[User]:
    """Active users with the maintenance app for this plant. A user with no
    plant assignments at all is treated as covering every plant."""
    users = [u for u in db.query(User).filter(User.is_active == True).all() if "maintenance" in u.get_apps()]  # noqa: E712
    if not branch_id:
        return users
    assignments: dict[int, set[int]] = {}
    for a in db.query(BranchUserAssignment).filter(BranchUserAssignment.user_id.in_([u.id for u in users] or [0])).all():
        assignments.setdefault(a.user_id, set()).add(a.branch_id)
    return [u for u in users if u.id not in assignments or branch_id in assignments[u.id]]


def notify_many(db: Session, user_ids, title: str, message: str, notification_type: str, entity_type: str, entity_id: int, exclude_user_id: int | None = None) -> None:
    for uid in {u for u in user_ids if u and u != exclude_user_id}:
        notify_user(db, uid, title, message, notification_type, entity_type=entity_type, entity_id=entity_id)


# ---------------------------------------------------------------------------
# Spares — read-only over the Store (item master + stock balances). The
# minimum is the Store item's minimum_stock, falling back to reorder_level.
# ---------------------------------------------------------------------------

SPARE_BELOW_MIN = "maintenance_spare_below_min"
SPARE_ENTITY = "maintenance_spare"  # entity_id = store item id → Spares page


def spare_threshold(item) -> float | None:
    return item.minimum_stock if item.minimum_stock is not None else item.reorder_level


def is_below_min(item, on_hand_total: float) -> bool:
    threshold = spare_threshold(item)
    return threshold is not None and on_hand_total < threshold


def suggested_order_qty(item, on_hand_total: float) -> float | None:
    """Reorder quantity if the Store item has one, else the shortfall up to
    the reorder level (or minimum)."""
    if item.reorder_quantity:
        return float(item.reorder_quantity)
    target = item.reorder_level if item.reorder_level is not None else item.minimum_stock
    if target is None:
        return None
    short = target - on_hand_total
    return float(-(-short // 1)) if short > 0 else None  # round up to whole units


def on_hand_totals(db: Session, item_ids) -> dict[int, float]:
    """FREE on-hand per item summed across every Store location."""
    from app.modules.store.models.stock_balance import StoreStockBalance
    ids = list({i for i in item_ids if i})
    if not ids:
        return {}
    rows = db.query(StoreStockBalance.item_id, func.sum(StoreStockBalance.on_hand_qty)).filter(
        StoreStockBalance.item_id.in_(ids)).group_by(StoreStockBalance.item_id).all()
    return {item_id: round(float(total or 0.0), 4) for item_id, total in rows}


def maintenance_planners(db: Session, branch_id: int | None) -> list[User]:
    """Planners = maintenance users of the plant who can verify / close work
    orders (work_orders:approve in the Permission Matrix)."""
    from app.core.permission_registry import can_perform
    return [u for u in maintenance_users_for_branch(db, branch_id) if can_perform(u, "maintenance", "work_orders", "approve")]


def _spare_alert_sent_today(db: Session, user_id: int, item_id: int) -> bool:
    from app.modules.main.models.notification import Notification
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == SPARE_ENTITY,
        Notification.entity_id == item_id, Notification.notification_type == SPARE_BELOW_MIN,
        func.date(Notification.created_at) == date.today(),
    ).first() is not None


def check_spare_below_min(db: Session, item_id: int, wo: MaintenanceWorkOrder | None = None, exclude_user_id: int | None = None) -> int:
    """After a spares issue: if the item is critical on any asset's bill of
    spares and total on-hand is now under its minimum, remind the planners
    (Teams too — it's a reminder). Once per item per planner per day.
    Never raises — a failed alert must not undo the issue. Switched off by
    Maintenance › Settings › critical_spare_alert."""
    from app.modules.maintenance.models.asset import MaintenanceAssetSpare
    from app.modules.maintenance.settings import critical_spare_alert_enabled
    from app.modules.store.models.item import StoreItem
    try:
        if not critical_spare_alert_enabled(db):
            return 0
        critical = db.query(MaintenanceAssetSpare.id).join(
            MaintenanceAsset, MaintenanceAsset.id == MaintenanceAssetSpare.asset_id,
        ).filter(
            MaintenanceAssetSpare.store_item_id == item_id, MaintenanceAssetSpare.is_critical == True,  # noqa: E712
            MaintenanceAsset.is_deleted == False,  # noqa: E712
        ).first()
        if not critical:
            return 0
        item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
        if not item:
            return 0
        total = on_hand_totals(db, [item_id]).get(item_id, 0.0)
        if not is_below_min(item, total):
            return 0
        branch_id = None
        if wo is not None:
            branch_id = db.query(MaintenanceAsset.branch_id).filter(MaintenanceAsset.id == wo.asset_id).scalar()
        threshold = spare_threshold(item)
        label = "minimum" if item.minimum_stock is not None else "reorder level"
        title = f"Critical spare below {label}: {item.item_code}"
        message = (
            f"'{item.item_name}' is down to {total:g} {item.uom or ''} across all stores (min {threshold:g})"
            + (f" after the issue on {wo.wo_number}" if wo is not None else "")
            + ". Raise a PR from Maintenance › Spares."
        )
        sent = 0
        planners = maintenance_planners(db, branch_id)
        for u in planners:
            if u.id == exclude_user_id or _spare_alert_sent_today(db, u.id, item_id):
                continue
            notify_user(db, u.id, title, message, SPARE_BELOW_MIN, entity_type=SPARE_ENTITY, entity_id=item_id, teams=True)
            sent += 1
        if sent:  # first alert today → the subscribed roles too
            from app.modules.maintenance.role_events import role_event
            role_event(db, None, "spare_below_min", title=title, message=message, entity_type=SPARE_ENTITY, entity_id=item_id,
                       skip_user_ids={u.id for u in planners} | {exclude_user_id})
        return sent
    except Exception:  # pragma: no cover — alerting is best-effort
        logger.exception("Below-minimum spare alert failed for item %s", item_id)
        return 0



# ---------------------------------------------------------------------------
# Preventive maintenance — plan numbering, next-due maths, work-order
# generation (shared by the daily scheduler and "Generate now") and rolling
# the plan forward when its work order is closed. See plan.md §5.3.
# ---------------------------------------------------------------------------

PM_WO_ASSIGNED = "maintenance_wo_assigned"
PM_OVERDUE = "maintenance_pm_overdue"
_IST = timezone(timedelta(hours=5, minutes=30))


def generate_pm_plan_code(db: Session) -> str:
    """PM-NNNN (not yearly — a plan lives for years)."""
    from app.modules.maintenance.models.pm_plan import MaintenancePmPlan
    _lock_number_series(db, "PM-")
    codes = [c for (c,) in db.query(MaintenancePmPlan.plan_code).filter(MaintenancePmPlan.plan_code.like("PM-%")).all()]
    nums = [int(c[3:]) for c in codes if c[3:].isdigit()]
    return f"PM-{(max(nums) + 1) if nums else 1:04d}"


def _add_months(d: date, months: int) -> date:
    """Calendar month add, clamped to the month's last day (31 Jan + 1 → 28/29 Feb)."""
    import calendar
    total = d.month - 1 + months
    year, month = d.year + total // 12, total % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def add_pm_interval(basis: date, unit: str, value: int) -> date:
    value = max(1, int(value or 1))
    if unit == "day":
        return basis + timedelta(days=value)
    if unit == "week":
        return basis + timedelta(weeks=value)
    if unit == "month":
        return _add_months(basis, value)
    if unit == "year":
        return _add_months(basis, 12 * value)
    raise ValueError(f"Unknown PM frequency unit '{unit}'")


def next_due_from(plan, basis_date: date) -> date:
    """One interval of the plan's frequency after `basis_date`."""
    return add_pm_interval(basis_date, plan.frequency_unit, plan.frequency_value)


def today_ist() -> date:
    return datetime.now(_IST).date()


def _date_ist(dt: datetime | None) -> date | None:
    dt = _aware(dt)
    return dt.astimezone(_IST).date() if dt else None


def _pm_spare_location_id(db: Session, asset: MaintenanceAsset) -> int | None:
    """Store location the kit is planned from: the plant's default warehouse,
    else the plant's first active Store location."""
    from app.modules.organization.models.branch import Branch
    from app.modules.store.models.location import StoreLocation
    branch = db.query(Branch).filter(Branch.id == asset.branch_id).first()
    if branch and branch.default_warehouse_id:
        loc = db.query(StoreLocation).filter(StoreLocation.id == branch.default_warehouse_id, StoreLocation.is_active == True).first()  # noqa: E712
        if loc:
            return loc.id
    loc = db.query(StoreLocation).filter(StoreLocation.branch_id == asset.branch_id, StoreLocation.is_active == True).order_by(StoreLocation.id).first()  # noqa: E712
    return loc.id if loc else None


def _lock_pm_plan(db: Session, plan) -> None:
    """Serialises PM generation per plan (scheduler vs "Generate now" vs a
    second user) for the rest of the transaction. On PostgreSQL the plan row
    is re-read after the lock so a roll-forward committed by whoever held it
    first is seen. The unique (pm_plan_id, pm_due_date) constraint is the
    final backstop. No-op on SQLite (tests)."""
    if db.get_bind().dialect.name != "postgresql":
        return
    _lock_number_series(db, f"PMPLAN-{plan.id}")
    if plan in db and not db.is_modified(plan, include_collections=False):
        db.refresh(plan)


def asset_retired(asset) -> bool:
    """A deleted or decommissioned machine gets no PM jobs or reminders."""
    return asset is None or bool(asset.is_deleted) or asset.status == "decommissioned"


def retire_asset_pm(db: Session, asset: MaintenanceAsset, reason: str = "Asset decommissioned") -> tuple[list[str], list[str]]:
    """Decommissioning: deactivate every PM plan on the asset and cancel every
    PM job the cancel action would accept (draft / assigned / on_hold), so no
    live PM work is left on a retired machine. An in-progress job blocks the
    decommission earlier (the asset is under maintenance). Returns (plan codes
    deactivated, WO numbers cancelled). Raises ValueError (user-facing) if a
    job to cancel still holds spares issued from Store — the stock ledger
    must be squared first. Flushes nothing; the caller commits."""
    from app.modules.maintenance.models.pm_plan import MaintenancePmPlan
    wos = db.query(MaintenanceWorkOrder).filter(
        MaintenanceWorkOrder.asset_id == asset.id, MaintenanceWorkOrder.pm_plan_id.isnot(None),
        MaintenanceWorkOrder.status.in_(("draft", "assigned", "on_hold")),
    ).all()
    for wo in wos:
        if any((sp.qty_issued or 0) - (sp.qty_returned or 0) > 1e-9 for sp in wo.spares):
            raise ValueError(
                f"Can't decommission {asset.asset_code}: PM job {wo.wo_number} has spares issued from Store that "
                "weren't returned. Return them on the work order first, then decommission."
            )
    plans = db.query(MaintenancePmPlan).filter(
        MaintenancePmPlan.asset_id == asset.id, MaintenancePmPlan.is_active == True,  # noqa: E712
    ).all()
    for plan in plans:
        plan.is_active = False
    for wo in wos:
        wo.status = "cancelled"
        wo.cancel_reason = reason
    if plans or wos:
        logger.info("Asset %s retired: PM plan(s) %s deactivated, PM job(s) %s cancelled",
                    asset.asset_code, [p.plan_code for p in plans], [w.wo_number for w in wos])
    return [p.plan_code for p in plans], [w.wo_number for w in wos]


def open_pm_work_order(db: Session, plan_id: int) -> MaintenanceWorkOrder | None:
    return db.query(MaintenanceWorkOrder).filter(
        MaintenanceWorkOrder.pm_plan_id == plan_id,
        MaintenanceWorkOrder.status.in_(MAINTENANCE_WO_OPEN_STATUSES),
    ).order_by(MaintenanceWorkOrder.id.desc()).first()


def generate_pm_work_order(db: Session, plan, due_date: date, user_id: int | None = None, trigger: str = "calendar") -> MaintenanceWorkOrder:
    """Creates the work order for (plan, due_date) — or returns the one that
    already exists for that pair (idempotent). Copies the checklist and the
    spares kit; assigned to the plan's default assignee (bell only — an
    assignment isn't an approval or reminder, so no Teams push). Flushes but
    doesn't commit. Raises ValueError with a user-facing reason if the asset
    can't take a work order."""
    from app.modules.maintenance.models.work_order import MaintenanceWorkOrderTask, MaintenanceWorkOrderSpare
    from app.modules.store.models.item import StoreItem

    _lock_pm_plan(db, plan)
    existing = db.query(MaintenanceWorkOrder).filter(
        MaintenanceWorkOrder.pm_plan_id == plan.id, MaintenanceWorkOrder.pm_due_date == due_date,
    ).first()
    if existing:
        return existing

    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == plan.asset_id).first()
    if not asset or asset.is_deleted:
        raise ValueError(f"{plan.plan_code}: its asset was deleted, so no work order can be raised. Deactivate the plan.")
    if asset.status == "decommissioned":
        raise ValueError(f"{plan.plan_code}: {asset.asset_code} is decommissioned. Deactivate the plan.")

    assignee = None
    if plan.default_assignee_id:
        assignee = db.query(User).filter(User.id == plan.default_assignee_id, User.is_active == True).first()  # noqa: E712

    notes = [plan.description.strip()] if plan.description and plan.description.strip() else []
    if trigger == "meter":
        due_txt = f"{plan.next_due_meter:g}" if plan.next_due_meter is not None else "—"
        every_txt = f"{plan.meter_interval:g}" if plan.meter_interval else "—"
        notes.append(f"Generated from PM plan {plan.plan_code}: counter at {asset_meter_text(db, plan)}, "
                     f"due at {due_txt} (every {every_txt}).")
    else:
        notes.append(f"Generated from PM plan {plan.plan_code}, due {due_date:%d-%m-%Y}.")
    if plan.default_assignee_id and not assignee:
        notes.append("The plan's default technician is inactive, so this job is unassigned — assign someone.")

    wo = MaintenanceWorkOrder(
        wo_number=generate_work_order_number(db),
        asset_id=asset.id,
        pm_plan_id=plan.id,
        pm_due_date=due_date,
        pm_trigger=trigger,
        wo_type=plan.wo_type,
        priority="standard",
        title=plan.title[:255],
        status="assigned" if assignee else "draft",
        # Planned shutdown: the asset only goes down once the job is started
        # (sync_asset_status skips PM jobs that haven't started), and the
        # breakdown downtime clock isn't run for planned work.
        machine_down=bool(plan.requires_shutdown),
        assigned_to_id=assignee.id if assignee else None,
        planned_start=due_date,
        planned_end=due_date,
        estimated_hours=plan.estimated_hours,
        created_by_id=user_id,
    )
    for idx, t in enumerate(plan.tasks, start=1):
        wo.tasks.append(MaintenanceWorkOrderTask(
            sequence=idx * 10, description=(t.description or "").strip()[:500] or f"Check {idx}",
            expected_value=t.expected_value[:100] if t.expected_value else None,
        ))
    if plan.spares:
        location_id = _pm_spare_location_id(db, asset)
        if location_id is None:
            notes.append(
                f"Spares kit ({len(plan.spares)} item(s)) not copied: the plant has no active Store location. "
                "Set the plant's default warehouse in Company Info, then add the spares on this job."
            )
        else:
            items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([s.store_item_id for s in plan.spares])).all()}
            for s in plan.spares:
                item = items.get(s.store_item_id)
                if not item:
                    continue
                wo.spares.append(MaintenanceWorkOrderSpare(
                    store_item_id=item.id, location_id=location_id, qty_planned=s.qty,
                    unit_cost=float(item.standard_cost or item.moving_average_cost or 0.0), remarks=s.remarks,
                ))
    wo.description = "\n\n".join(notes)
    db.add(wo)
    db.flush()
    sync_asset_status(db, asset)
    if assignee:
        notify_many(
            db, [assignee.id], f"{wo.wo_number} assigned to you",
            f"Preventive job due {due_date:%d-%m-%Y} — {asset.asset_code}: {plan.title}",
            PM_WO_ASSIGNED, "maintenance_work_order", wo.id, exclude_user_id=user_id,
        )
        from app.modules.maintenance.role_events import role_event
        role_event(db, None, "wo_assigned", title=f"PM job {wo.wo_number} assigned",
                   message=f"Preventive job {wo.wo_number} due {due_date:%d-%m-%Y} — {asset.asset_code}: {plan.title} — "
                           f"was assigned to {assignee.name or assignee.email}.",
                   entity_type="maintenance_work_order", entity_id=wo.id, record=wo, skip_user_ids={assignee.id, user_id})
    return wo


def run_pm_plan(db: Session, plan, today: date | None = None, user_id: int | None = None, force: bool = False) -> tuple[str, MaintenanceWorkOrder | None]:
    """One scheduler step for one plan. Returns (outcome, work_order):
    - "open_exists": a work order for the plan is still open, nothing new
    - "waiting_close": the WO for the current due date is completed but not
      closed yet (closing it rolls the plan forward)
    - "not_due": next due minus lead days is still in the future (ignored
      when force=True, i.e. the "Generate now" button)
    - "generated": a new work order was created
    A WO for the current due date that was CANCELLED means that occurrence was
    skipped on purpose: the plan moves on one interval (logged) instead of
    regenerating the same date."""
    today = today or today_ist()
    _lock_pm_plan(db, plan)  # before any existence check — see _lock_pm_plan
    open_wo = open_pm_work_order(db, plan.id)
    if open_wo:
        return "open_exists", open_wo
    if (plan.trigger_type or "calendar") == "meter":
        return _run_meter_only_plan(db, plan, today, user_id, force)
    for _ in range(120):  # bounded — never spin on a pathological plan
        existing = db.query(MaintenanceWorkOrder).filter(
            MaintenanceWorkOrder.pm_plan_id == plan.id, MaintenanceWorkOrder.pm_due_date == plan.next_due_date,
        ).order_by(MaintenanceWorkOrder.id.desc()).first()
        if existing is None:
            break
        if existing.status == "cancelled":
            skipped = plan.next_due_date
            plan.next_due_date = next_due_from(plan, skipped)
            logger.info("PM %s: occurrence due %s was cancelled (%s) — next due moved to %s",
                        plan.plan_code, skipped, existing.wo_number, plan.next_due_date)
            continue
        if existing.status == "closed":
            # Closed without the plan rolling forward — do it now.
            before = plan.next_due_date
            advance_pm_plan(db, existing)
            if plan.next_due_date == before:
                plan.next_due_date = next_due_from(plan, before)
            continue
        return "waiting_close", existing
    date_due = plan.next_due_date - timedelta(days=plan.lead_days or 0) <= today
    if force or date_due:
        return "generated", generate_pm_work_order(db, plan, plan.next_due_date, user_id)
    # calendar_or_meter: whichever comes first — the counter can bring the
    # job forward to today.
    from app.modules.maintenance.counters import meter_due
    if plan.trigger_type == "calendar_or_meter" and meter_due(db, plan):
        if db.query(MaintenanceWorkOrder.id).filter(
            MaintenanceWorkOrder.pm_plan_id == plan.id, MaintenanceWorkOrder.pm_due_date == today,
        ).first():
            return "not_due", None  # today's occurrence already ran (cancelled / closed)
        return "generated", generate_pm_work_order(db, plan, today, user_id, trigger="meter")
    return "not_due", None


def _run_meter_only_plan(db: Session, plan, today: date, user_id: int | None, force: bool):
    """A pure counter plan (trigger "meter"): due when the main counter
    reaches next_due_meter − lead_meter. The job is dated today; a job
    completed but not closed holds the next one back (closing it rolls
    next_due_meter on)."""
    from app.modules.maintenance.counters import meter_due
    waiting = db.query(MaintenanceWorkOrder).filter(
        MaintenanceWorkOrder.pm_plan_id == plan.id, MaintenanceWorkOrder.status == "completed",
    ).order_by(MaintenanceWorkOrder.id.desc()).first()
    if waiting:
        return "waiting_close", waiting
    if not force and not meter_due(db, plan):
        return "not_due", None
    if db.query(MaintenanceWorkOrder.id).filter(
        MaintenanceWorkOrder.pm_plan_id == plan.id, MaintenanceWorkOrder.pm_due_date == today,
    ).first():
        return "not_due", None  # today's occurrence already ran (cancelled / closed)
    return "generated", generate_pm_work_order(db, plan, today, user_id, trigger="meter")


def asset_meter_text(db: Session, plan) -> str:
    asset = db.get(MaintenanceAsset, plan.asset_id)
    if not asset or asset.current_meter_reading is None:
        return "—"
    return f"{asset.current_meter_reading:g} {asset.meter_unit or ''}".strip()


def advance_pm_plan(db: Session, wo: MaintenanceWorkOrder) -> None:
    """Call when a PM work order is CLOSED. Records the completion on the plan
    and moves next_due_date one interval on: from the due date (fixed basis,
    keeps the calendar steady) or from the completion date (floating).
    Fixed basis catches up: if the job was closed so late that the next slot
    is already in the past, the plan keeps stepping along its fixed calendar
    until next_due_date is today or later (missed slots are skipped, not
    raised as a backlog of jobs) and the skip count is noted on the job.
    Cancelled jobs never come here."""
    if not wo.pm_plan_id:
        return
    from app.modules.maintenance.models.pm_plan import MaintenancePmPlan
    plan = db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == wo.pm_plan_id).first()
    if not plan:
        return
    completed_on = _date_ist(wo.actual_end) or _date_ist(wo.closed_at) or today_ist()
    if not plan.last_done_date or completed_on >= plan.last_done_date:
        plan.last_done_date = completed_on
        plan.last_work_order_id = wo.id
    # Performance-based plans: the counter clock restarts from the reading at
    # completion (IP42). A pure counter plan has no calendar to roll.
    from app.modules.maintenance.counters import roll_meter_forward
    roll_meter_forward(db, plan, wo)
    if (plan.trigger_type or "calendar") == "meter":
        return
    if plan.trigger_type == "calendar_or_meter" and wo.pm_trigger == "meter":
        # The counter came first: the calendar restarts from the completion.
        plan.next_due_date = next_due_from(plan, completed_on)
        return
    if wo.pm_due_date and plan.next_due_date > wo.pm_due_date:
        # The plan already moved past this occurrence (rescheduled by hand) —
        # don't drag it back.
        return
    basis = (wo.pm_due_date or plan.next_due_date) if plan.schedule_basis == "fixed" else completed_on
    next_due = next_due_from(plan, basis)
    if plan.schedule_basis == "fixed":
        today = today_ist()
        skipped = 0
        while next_due < today and skipped < 1000:  # bounded — a daily plan years late is still finite
            next_due = next_due_from(plan, next_due)
            skipped += 1
        if skipped:
            note = (f"Closed late: {skipped} missed PM occurrence(s) of {plan.plan_code} skipped; "
                    f"next due {next_due:%d-%m-%Y} (fixed calendar).")
            wo.description = f"{wo.description}\n\n{note}" if wo.description else note
            logger.info("PM %s: %s closed late — %s occurrence(s) skipped, next due %s",
                        plan.plan_code, wo.wo_number, skipped, next_due)
    plan.next_due_date = next_due


def pm_overdue_recipients(db: Session, wo: MaintenanceWorkOrder, branch_id: int | None) -> set[int]:
    """Assignee + the plant's maintenance planners (work_orders:approve)."""
    ids = {u.id for u in maintenance_planners(db, branch_id) if u.role != "admin"}
    if wo.assigned_to_id:
        ids.add(wo.assigned_to_id)
    return ids
