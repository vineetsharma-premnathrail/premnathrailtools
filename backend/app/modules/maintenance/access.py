"""Maintenance on the central authorization framework
(docs/02-modules/platform/authorization-architecture.md).

Data scope — the records a user lists / opens are limited by their
Maintenance data scope (Organization › Role & Permissions, "Data access"):

    work orders   own = raised by them; assigned = + assigned technician,
                  anyone who logged labour, the person who raised the request
    requests      own = raised by them; assigned = + who triaged it, the
                  technician of the work order it became
    assets        own = registered by them
    PM plans      own = created by them; assigned = + default assignee

Work orders, requests and PM plans have no plant column of their own — their
plant and department are the asset's (`scope_branch_id` / `scope_department`,
deferred SQL expressions on the models, not DB columns).

Approval — the only approval in Maintenance is the planner's close-out
verification of a completed job (before the engine: Work Orders › Approve
holders pressed "Verify & Close" / "Reopen"). It is now the engine
transaction `maintenance.work_order`:

    in_progress → completed  (technician)            ─┐
    requester confirms the machine is OK (if needed)  ├→ engine.submit
    approve  → closed (verified_by, PM plan rolls forward)
    reject / return / withdrawn → back to in_progress (reopened)

Work orders that were already Completed when this shipped have no engine
request; their old Verify & Close / Reopen endpoints keep working unchanged.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.data_scope import register_scoped
from app.core.permission_registry import is_admin_user
from app.modules.main.models.user import User
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.pm_plan import MaintenancePmPlan
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import MaintenanceLabourLog, MaintenanceWorkOrder
from app.modules.maintenance.service import (
    advance_pm_plan, now_utc, recompute_costs, sync_asset_status,
)
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction

WO_ENTITY = "maintenance_work_order"
REQUEST_ENTITY = "maintenance_request"
CLOSE_OUT_KEY = "maintenance.work_order"


# ── Data scope ───────────────────────────────────────────────────────────

def _wo_labour_by(user):
    return MaintenanceWorkOrder.id.in_(
        select(MaintenanceLabourLog.work_order_id).where(MaintenanceLabourLog.technician_id == user.id))


def _wo_request_raised_by(user):
    return MaintenanceWorkOrder.request_id.in_(
        select(MaintenanceRequest.id).where(MaintenanceRequest.raised_by_id == user.id))


def _request_wo_assigned_to(user):
    return MaintenanceRequest.id.in_(
        select(MaintenanceWorkOrder.request_id).where(
            MaintenanceWorkOrder.request_id.isnot(None), MaintenanceWorkOrder.assigned_to_id == user.id))


register_scoped(
    MaintenanceWorkOrder, "maintenance", entity_type=WO_ENTITY,
    owner=("created_by_id",),
    assigned=("assigned_to_id", "completed_by_id", _wo_labour_by, _wo_request_raised_by),
    branch="scope_branch_id", department="scope_department", label="maintenance work order",
)
register_scoped(
    MaintenanceRequest, "maintenance",
    owner=("raised_by_id",), assigned=("acknowledged_by_id", _request_wo_assigned_to),
    branch="scope_branch_id", department="scope_department", label="maintenance request",
)
register_scoped(
    MaintenanceAsset, "maintenance",
    owner=("created_by_id",), branch="branch_id", department="scope_department", label="maintenance asset",
)
register_scoped(
    MaintenancePmPlan, "maintenance",
    owner=("created_by_id",), assigned=("default_assignee_id",),
    branch="scope_branch_id", department="scope_department", label="PM plan",
)


# ── Close-out (verify & close) — shared by the engine and the legacy endpoints ──

def _sync(db: Session, wo: MaintenanceWorkOrder) -> None:
    recompute_costs(wo)
    asset = db.get(MaintenanceAsset, wo.asset_id)
    if asset:
        sync_asset_status(db, asset)


def apply_close(db: Session, wo: MaintenanceWorkOrder, verifier: User) -> None:
    """Completed → Closed: the verifier signs the job off, its cost freezes
    and a PM job rolls its plan to the next due date."""
    wo.status = "closed"
    wo.verified_by_id = verifier.id
    wo.verified_at = now_utc()
    wo.closed_at = wo.verified_at
    _sync(db, wo)
    advance_pm_plan(db, wo)


def apply_reopen(db: Session, wo: MaintenanceWorkOrder, reason: str) -> None:
    """Completed → In Progress (verification refused / completion withdrawn)."""
    wo.status = "in_progress"
    wo.actual_end = None
    wo.requester_confirmed_at = None
    wo.requester_comment = reason
    if wo.machine_down:
        wo.downtime_end = None
        wo.downtime_minutes = None
    _sync(db, wo)


def _decision_comment(req) -> str | None:
    decided = [s for s in req.steps if s.status in ("rejected", "returned") and s.comment]
    return decided[-1].comment if decided else None


def _close_out_decided(db: Session, req, outcome: str, actor: User) -> None:
    wo = db.get(MaintenanceWorkOrder, req.entity_id)
    if wo is None or wo.status != "completed":
        return  # moved on meanwhile (e.g. closed through the legacy path) — nothing to do
    if outcome == "approved":
        apply_close(db, wo, actor)
        return
    reason = _decision_comment(req) or {
        "rejected": f"Verification rejected by {actor.name}",
        "returned": f"Sent back by {actor.name}",
        "cancelled": f"Completion withdrawn by {actor.name}",
    }.get(outcome, f"Reopened by {actor.name}")
    apply_reopen(db, wo, reason)
    if outcome != "cancelled" and wo.assigned_to_id and wo.assigned_to_id != req.requester_id:
        from app.modules.maintenance.service import notify_many

        notify_many(db, [wo.assigned_to_id], f"{wo.wo_number} reopened", reason,
                    "maintenance_wo_reopened", WO_ENTITY, wo.id, exclude_user_id=actor.id)


register_transaction(TransactionType(
    key=CLOSE_OUT_KEY, module_key="maintenance", subtab_key="work_orders", feature_key="close_out",
    label="Maintenance work order close-out", entity_type=WO_ENTITY,
    url="/dashboard/maintenance/work-orders/{id}",
    description="Verification of a completed maintenance job before it is closed (cost frozen, PM plan rolled "
                "forward). Submitted automatically when the technician marks the job Completed — or, for jobs "
                "raised from a breakdown request, when the requester confirms the machine is OK.",
    context_fields={
        "wo_type": {"label": "Work order type", "type": "choice",
                    "choices": ["breakdown", "preventive", "corrective", "calibration", "improvement", "inspection"]},
        "priority": {"label": "Priority", "type": "choice", "choices": ["low", "normal", "high", "urgent"]},
        "machine_down": {"label": "Machine was down", "type": "bool"},
        "downtime_minutes": {"label": "Downtime (minutes)", "type": "number"},
        "criticality": {"label": "Asset criticality", "type": "choice", "choices": ["A", "B", "C"]},
    },
    # Today's rule: anyone holding Work Orders › Approve verifies and closes.
    # same_plant: each plant's own planners verify its jobs (as before the engine).
    default_stages=[StageDef("Work order approver", "permission", {"permission": "maintenance:work_orders:approve", "same_plant": True})],
    require_permission=True,
    # Before the engine a planner could verify a job they completed themselves
    # (small plants have one planner). Kept as the default; switch on
    # four-eyes in Organization › Approval Workflows if wanted.
    allow_self_approval=True,
    on_decided=_close_out_decided,
))


def live_close_out(db: Session, wo_id: int):
    req = engine.latest_request(db, WO_ENTITY, wo_id)
    return req if req is not None and req.status == "pending" else None


def awaiting_requester(db: Session, wo: MaintenanceWorkOrder) -> bool:
    from app.modules.maintenance.settings import requester_confirmation_required

    return bool(wo.request_id and not wo.requester_confirmed_at and requester_confirmation_required(db))


def submit_close_out(db: Session, wo: MaintenanceWorkOrder, completer: User | None = None):
    """Send a completed job for close-out verification. Returns the request,
    or None when no approver could be resolved (then the job stays Completed
    and the Verify & Close button closes it as before — completing a repair
    must never be blocked by approval routing). Flushes, never commits."""
    if wo.status != "completed" or awaiting_requester(db, wo):
        return None
    live = live_close_out(db, wo.id)
    if live is not None:
        return live
    requester = completer or (db.get(User, wo.completed_by_id) if wo.completed_by_id else None)
    if requester is None:
        return None
    asset = db.get(MaintenanceAsset, wo.asset_id)
    try:
        return engine.submit(
            db, CLOSE_OUT_KEY, entity_id=wo.id, requester=requester,
            title=f"Close {wo.wo_number} — {(asset.asset_code + ': ') if asset else ''}{wo.title}",
            reference=wo.wo_number, amount=wo.total_cost, branch_id=asset.branch_id if asset else None,
            context={"wo_type": wo.wo_type, "priority": wo.priority, "machine_down": wo.machine_down,
                     "downtime_minutes": wo.downtime_minutes, "criticality": asset.criticality if asset else None},
        )
    except HTTPException as exc:
        if exc.status_code == 422:
            return None
        raise


def withdraw_close_out(db: Session, wo: MaintenanceWorkOrder, actor: User, reason: str) -> bool:
    """Cancel a live close-out request (the job is being reopened). The
    requester confirming "not OK" may not hold the engine's cancel right, so
    the cancel is then recorded under the job's completer (who submitted it).
    Returns True if there was one."""
    req = live_close_out(db, wo.id)
    if req is None:
        return False
    # Work Orders has no Cancel action, so the engine lets only the submitter or an admin cancel.
    allowed = req.requester_id == actor.id or is_admin_user(actor)
    by = actor if allowed else (db.get(User, req.requester_id) or actor)
    engine.cancel(db, req.id, by, reason if allowed else f"{reason} (reported by {actor.name})")
    return True
