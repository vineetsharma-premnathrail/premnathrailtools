"""Plain-function business rules for the Maintenance module — number
series, the asset ↔ workstation status sync, downtime maths, cost roll-up and
plant-scoped notifications. Kept out of the routes so they're unit-testable
and so there is exactly one place that writes asset.status."""
import logging
from datetime import date, datetime, timezone

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
    prefix = f"{code}-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(column)).filter(column.like(f"{prefix}%")).scalar()
    return f"{prefix}{(int(last.rsplit('-', 1)[-1]) + 1) if last else 1:04d}"


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


def default_priority(criticality: str, machine_down: bool) -> str:
    """Criticality A + machine down is urgent; the rest scale down from there."""
    if machine_down:
        return {"A": "urgent", "B": "high"}.get(criticality, "normal")
    return {"A": "high"}.get(criticality, "normal")


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
    wo.total_cost = round(wo.labour_cost + wo.spares_cost + (wo.external_cost or 0), 2)


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
