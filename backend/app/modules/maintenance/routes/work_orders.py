from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.accounts.models.vendor import Vendor
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import MaintenanceRequest, MAINTENANCE_PRIORITIES
from app.modules.maintenance.models.work_order import (
    MaintenanceWorkOrder, MaintenanceWorkOrderTask, MaintenanceWorkOrderSpare, MaintenanceLabourLog,
    MAINTENANCE_WO_TYPES, MAINTENANCE_WO_OPEN_STATUSES, MAINTENANCE_FAILURE_CATEGORIES,
    MAINTENANCE_WO_TYPES_NEEDING_RCA, MAINTENANCE_TASK_RESULTS,
)
from app.modules.maintenance.schemas.work_order import (
    MaintenanceWorkOrderCreate, MaintenanceWorkOrderUpdate, MaintenanceWorkOrderAssignPayload,
    MaintenanceWorkOrderReasonPayload, MaintenanceWorkOrderCompletePayload, MaintenanceWorkOrderResponse,
    MaintenanceWorkOrderTaskPayload, MaintenanceWorkOrderTaskUpdate, MaintenanceWorkOrderSpareIssuePayload,
    MaintenanceWorkOrderSpareReturnPayload, MaintenanceWorkOrderSparePlanPayload, MaintenanceLabourLogPayload,
)
from app.modules.maintenance.service import (
    generate_work_order_number, sync_asset_status, recompute_costs, close_downtime, user_names,
    now_utc, minutes_between, notify_many, _aware,
)

router = APIRouter(
    prefix="/maintenance/work-orders", tags=["Maintenance"],
    dependencies=[Depends(require_app_access("maintenance"))],
)

STATUS_LABEL = {
    "draft": "Draft", "assigned": "Assigned", "in_progress": "In Progress", "on_hold": "On Hold",
    "completed": "Completed", "closed": "Closed", "cancelled": "Cancelled",
}
SPARE_ACTIVE_STATUSES = ("assigned", "in_progress", "on_hold")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _get_or_404(db: Session, wo_id: int) -> MaintenanceWorkOrder:
    wo = (
        db.query(MaintenanceWorkOrder)
        .options(selectinload(MaintenanceWorkOrder.tasks), selectinload(MaintenanceWorkOrder.spares), selectinload(MaintenanceWorkOrder.labour_logs))
        .filter(MaintenanceWorkOrder.id == wo_id).first()
    )
    if not wo:
        raise HTTPException(status_code=404, detail=f"Maintenance work order #{wo_id} not found.")
    return wo


def _asset(db: Session, wo: MaintenanceWorkOrder) -> MaintenanceAsset | None:
    return db.query(MaintenanceAsset).filter(MaintenanceAsset.id == wo.asset_id).first()


def _require_status(wo: MaintenanceWorkOrder, allowed: tuple[str, ...], action: str, hint: str = "") -> None:
    if wo.status not in allowed:
        allowed_txt = " / ".join(STATUS_LABEL[s] for s in allowed)
        raise HTTPException(
            status_code=409,
            detail=f"Can't {action} {wo.wo_number}: it's {STATUS_LABEL.get(wo.status, wo.status)}, and this needs {allowed_txt}.{(' ' + hint) if hint else ''}",
        )


def _require_editable(wo: MaintenanceWorkOrder, action: str) -> None:
    if wo.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Can't {action}: {wo.wo_number} is {STATUS_LABEL[wo.status]} and locked.")


def _available(db: Session, item_id: int, location_id: int) -> float:
    bal = db.query(StoreStockBalance).filter(StoreStockBalance.item_id == item_id, StoreStockBalance.location_id == location_id).first()
    return round((bal.on_hand_qty - bal.reserved_qty) if bal else 0.0, 4)


def _fmt_qty(q: float) -> str:
    return f"{q:g}"


def _after_change(db: Session, wo: MaintenanceWorkOrder) -> None:
    recompute_costs(wo)
    asset = _asset(db, wo)
    if asset:
        sync_asset_status(db, asset)


def _to_response(db: Session, wo: MaintenanceWorkOrder) -> MaintenanceWorkOrderResponse:
    resp = MaintenanceWorkOrderResponse.model_validate(wo)
    asset = _asset(db, wo)
    if asset:
        resp.asset_code, resp.asset_name, resp.asset_status, resp.branch_id = asset.asset_code, asset.name, asset.status, asset.branch_id
        branch = db.query(Branch.name).filter(Branch.id == asset.branch_id).first()
        resp.branch_name = branch[0] if branch else None
    req = db.query(MaintenanceRequest).filter(MaintenanceRequest.id == wo.request_id).first() if wo.request_id else None
    if req:
        resp.request_number, resp.requester_id = req.request_number, req.raised_by_id
    names = user_names(db, [
        wo.assigned_to_id, wo.verified_by_id, req.raised_by_id if req else None,
        *[t.done_by_id for t in wo.tasks], *[l.technician_id for l in wo.labour_logs],
    ])
    resp.assigned_to_name = names.get(wo.assigned_to_id)
    resp.verified_by_name = names.get(wo.verified_by_id)
    resp.requester_name = names.get(req.raised_by_id) if req else None
    if wo.external_vendor_id:
        v = db.query(Vendor.name).filter(Vendor.id == wo.external_vendor_id).first()
        resp.external_vendor_name = v[0] if v else None
    for t in resp.tasks:
        t.done_by_name = names.get(t.done_by_id)
    for l in resp.labour_logs:
        l.technician_name = names.get(l.technician_id)
        l.cost = round(l.hours * l.hourly_rate, 2)
    item_ids = {s.store_item_id for s in wo.spares}
    loc_ids = {s.location_id for s in wo.spares}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    locs = dict(db.query(StoreLocation.id, StoreLocation.name).filter(StoreLocation.id.in_(loc_ids)).all()) if loc_ids else {}
    for s in resp.spares:
        item = items.get(s.store_item_id)
        if item:
            s.item_code, s.item_name, s.uom = item.item_code, item.item_name, item.uom
        s.location_name = locs.get(s.location_id)
        s.available_qty = _available(db, s.store_item_id, s.location_id)
        s.net_cost = round(max(0.0, s.qty_issued - s.qty_returned) * s.unit_cost, 2)
    resp.awaiting_confirmation = bool(req and wo.status == "completed" and not wo.requester_confirmed_at)
    if wo.machine_down and wo.downtime_start and not wo.downtime_end:
        resp.live_downtime_minutes = minutes_between(wo.downtime_start, now_utc())
    return resp


def _check_user(db: Session, user_id: int, label: str) -> User:
    u = db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
    if not u:
        raise HTTPException(status_code=404, detail=f"{label} #{user_id} not found or inactive — pick them again.")
    return u


def _validate_details(db: Session, data: dict) -> None:
    if data.get("wo_type") and data["wo_type"] not in MAINTENANCE_WO_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid work order type '{data['wo_type']}'. Valid: {', '.join(MAINTENANCE_WO_TYPES)}.")
    if data.get("priority") and data["priority"] not in MAINTENANCE_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{data['priority']}'. Valid: {', '.join(MAINTENANCE_PRIORITIES)}.")
    if data.get("failure_category") and data["failure_category"] not in MAINTENANCE_FAILURE_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid failure category '{data['failure_category']}'.")
    if data.get("planned_start") and data.get("planned_end") and data["planned_end"] < data["planned_start"]:
        raise HTTPException(status_code=400, detail="Planned end can't be before planned start.")
    for key in ("estimated_hours", "external_cost"):
        if data.get(key) is not None and data[key] < 0:
            raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} can't be negative.")
    if data.get("external_vendor_id") and not db.query(Vendor.id).filter(Vendor.id == data["external_vendor_id"]).first():
        raise HTTPException(status_code=404, detail=f"Vendor #{data['external_vendor_id']} not found in the vendor master.")


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.get("", response_model=list[MaintenanceWorkOrderResponse])
async def list_work_orders(
    status_filter: str | None = Query(None, alias="status"),
    open_only: bool = False,
    mine: bool = False,
    asset_id: int | None = None,
    branch_id: int | None = None,
    wo_type: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("maintenance", "work_orders")),
):
    query = db.query(MaintenanceWorkOrder).options(
        selectinload(MaintenanceWorkOrder.tasks), selectinload(MaintenanceWorkOrder.spares), selectinload(MaintenanceWorkOrder.labour_logs),
    )
    if status_filter:
        query = query.filter(MaintenanceWorkOrder.status == status_filter)
    if open_only:
        query = query.filter(MaintenanceWorkOrder.status.in_((*MAINTENANCE_WO_OPEN_STATUSES, "completed")))
    if mine:
        query = query.filter(MaintenanceWorkOrder.assigned_to_id == user.id)
    if asset_id:
        query = query.filter(MaintenanceWorkOrder.asset_id == asset_id)
    if wo_type:
        query = query.filter(MaintenanceWorkOrder.wo_type == wo_type)
    if branch_id or search:
        query = query.join(MaintenanceAsset, MaintenanceAsset.id == MaintenanceWorkOrder.asset_id)
        if branch_id:
            query = query.filter(MaintenanceAsset.branch_id == branch_id)
        if search:
            like = f"%{search}%"
            query = query.filter(
                (MaintenanceWorkOrder.wo_number.ilike(like)) | (MaintenanceWorkOrder.title.ilike(like))
                | (MaintenanceAsset.asset_code.ilike(like)) | (MaintenanceAsset.name.ilike(like))
            )
    return [_to_response(db, w) for w in query.order_by(MaintenanceWorkOrder.created_at.desc()).all()]


@router.post("", response_model=MaintenanceWorkOrderResponse)
async def create_work_order(
    payload: MaintenanceWorkOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "work_orders", "create")),
):
    data = payload.model_dump()
    if not data["title"].strip():
        raise HTTPException(status_code=400, detail="Work order title is required.")
    _validate_details(db, data)
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == payload.asset_id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
    if not asset:
        raise HTTPException(status_code=404, detail=f"Asset #{payload.asset_id} not found — pick the machine again.")
    if asset.status == "decommissioned":
        raise HTTPException(status_code=400, detail=f"{asset.asset_code} is decommissioned; work orders can't be raised on it.")
    if payload.assigned_to_id:
        _check_user(db, payload.assigned_to_id, "Technician")
    downtime_start = (_aware(payload.downtime_start) or now_utc()) if payload.machine_down else None
    if downtime_start and downtime_start > now_utc():
        raise HTTPException(status_code=400, detail="Downtime start can't be in the future.")

    wo = MaintenanceWorkOrder(
        wo_number=generate_work_order_number(db),
        asset_id=asset.id,
        wo_type=payload.wo_type,
        priority=payload.priority,
        title=payload.title.strip(),
        description=payload.description,
        status="assigned" if payload.assigned_to_id else "draft",
        machine_down=payload.machine_down,
        downtime_start=downtime_start,
        assigned_to_id=payload.assigned_to_id,
        planned_start=payload.planned_start,
        planned_end=payload.planned_end,
        estimated_hours=payload.estimated_hours,
        created_by_id=user.id,
    )
    for idx, t in enumerate(payload.tasks, start=1):
        if not t.description.strip():
            raise HTTPException(status_code=400, detail=f"Checklist line {idx} has no description.")
        wo.tasks.append(MaintenanceWorkOrderTask(sequence=t.sequence or idx * 10, description=t.description.strip(), expected_value=t.expected_value))
    db.add(wo)
    db.flush()
    _after_change(db, wo)
    if wo.assigned_to_id:
        notify_many(db, [wo.assigned_to_id], f"{wo.wo_number} assigned to you", f"{asset.asset_code}: {wo.title}",
                    "maintenance_wo_assigned", "maintenance_work_order", wo.id, exclude_user_id=user.id)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.get("/{wo_id}", response_model=MaintenanceWorkOrderResponse)
async def get_work_order(wo_id: int, db: Session = Depends(get_db)):
    return _to_response(db, _get_or_404(db, wo_id))


@router.patch("/{wo_id}", response_model=MaintenanceWorkOrderResponse)
async def update_work_order(
    wo_id: int, payload: MaintenanceWorkOrderUpdate, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_editable(wo, "edit it")
    data = payload.model_dump(exclude_unset=True)
    if "title" in data and not (data["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Work order title can't be empty.")
    merged = {"planned_start": wo.planned_start, "planned_end": wo.planned_end, **data}
    _validate_details(db, merged)
    for field, val in data.items():
        setattr(wo, field, val)
    if "external_cost" in data and data["external_cost"] is None:
        wo.external_cost = 0.0
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


# ---------------------------------------------------------------------------
# Status machine
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/assign", response_model=MaintenanceWorkOrderResponse)
async def assign(
    wo_id: int, payload: MaintenanceWorkOrderAssignPayload, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, MAINTENANCE_WO_OPEN_STATUSES, "assign")
    tech = _check_user(db, payload.assigned_to_id, "Technician")
    changed = wo.assigned_to_id != tech.id
    wo.assigned_to_id = tech.id
    if wo.status == "draft":
        wo.status = "assigned"
    if changed:
        asset = _asset(db, wo)
        notify_many(db, [tech.id], f"{wo.wo_number} assigned to you", f"{asset.asset_code if asset else ''}: {wo.title}",
                    "maintenance_wo_assigned", "maintenance_work_order", wo.id, exclude_user_id=user.id)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/start", response_model=MaintenanceWorkOrderResponse)
async def start(
    wo_id: int, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    if wo.status == "draft":
        raise HTTPException(status_code=409, detail=f"Can't start {wo.wo_number}: assign a technician first.")
    _require_status(wo, ("assigned",), "start")
    wo.status = "in_progress"
    wo.actual_start = wo.actual_start or now_utc()
    wo.hold_reason = None
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/hold", response_model=MaintenanceWorkOrderResponse)
async def hold(
    wo_id: int, payload: MaintenanceWorkOrderReasonPayload, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, ("in_progress",), "put on hold")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Say why the job is on hold (e.g. waiting for spares / service engineer).")
    wo.status = "on_hold"
    wo.hold_reason = payload.reason.strip()
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/resume", response_model=MaintenanceWorkOrderResponse)
async def resume(
    wo_id: int, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, ("on_hold",), "resume")
    wo.status = "in_progress"
    wo.actual_start = wo.actual_start or now_utc()
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/complete", response_model=MaintenanceWorkOrderResponse)
async def complete(
    wo_id: int, payload: MaintenanceWorkOrderCompletePayload, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, ("in_progress",), "complete", "Start the job first.")
    data = payload.model_dump(exclude_unset=True)
    handed_back_at = _aware(data.pop("handed_back_at", None))
    _validate_details(db, data)
    for field, val in data.items():
        if val is not None:
            setattr(wo, field, val.strip() if isinstance(val, str) else val)
    if wo.wo_type in MAINTENANCE_WO_TYPES_NEEDING_RCA:
        missing = [label for attr, label in (("failure_category", "failure category"), ("root_cause", "root cause"), ("action_taken", "action taken")) if not getattr(wo, attr)]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"A {wo.wo_type} work order needs {', '.join(missing)} before it can be completed — these feed the repeat-failure reports.",
            )
    open_tasks = [t.description for t in wo.tasks if not t.result]
    if open_tasks:
        raise HTTPException(
            status_code=400,
            detail=f"{len(open_tasks)} checklist line(s) have no result yet (e.g. '{open_tasks[0][:60]}'). Mark each OK / Not OK / N/A first.",
        )
    now = now_utc()
    if handed_back_at:
        if handed_back_at > now:
            raise HTTPException(status_code=400, detail="Hand-back time can't be in the future.")
        if wo.downtime_start and handed_back_at < _aware(wo.downtime_start):
            raise HTTPException(status_code=400, detail="Hand-back time can't be before the machine went down.")
    wo.status = "completed"
    wo.actual_end = now
    wo.completed_by_id = user.id
    close_downtime(wo, handed_back_at or now)
    _after_change(db, wo)
    req = db.query(MaintenanceRequest).filter(MaintenanceRequest.id == wo.request_id).first() if wo.request_id else None
    if req and req.raised_by_id:
        notify_many(db, [req.raised_by_id], f"{wo.wo_number} done — please confirm",
                    f"Maintenance marked the job on your request {req.request_number} complete. Check the machine and confirm it's OK.",
                    "maintenance_wo_completed", "maintenance_request", req.id, exclude_user_id=user.id)
    notify_many(db, [wo.created_by_id], f"{wo.wo_number} completed", wo.action_taken or wo.title,
                "maintenance_wo_completed", "maintenance_work_order", wo.id, exclude_user_id=user.id)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/reopen", response_model=MaintenanceWorkOrderResponse)
async def reopen(
    wo_id: int, payload: MaintenanceWorkOrderReasonPayload, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "approve")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, ("completed",), "reopen")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Say why the job is being reopened.")
    wo.status = "in_progress"
    wo.actual_end = None
    wo.requester_confirmed_at = None
    wo.requester_comment = payload.reason.strip()
    if wo.machine_down:
        wo.downtime_end = None
        wo.downtime_minutes = None
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/close", response_model=MaintenanceWorkOrderResponse)
async def close(
    wo_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "work_orders", "approve")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, ("completed",), "close", "Mark it Completed first.")
    if wo.request_id and not wo.requester_confirmed_at:
        req = db.query(MaintenanceRequest).filter(MaintenanceRequest.id == wo.request_id).first()
        who = user_names(db, [req.raised_by_id]).get(req.raised_by_id) if req else None
        raise HTTPException(
            status_code=409,
            detail=f"Can't close {wo.wo_number} yet: waiting for {who or 'the requester'} to confirm the machine is OK on request {req.request_number if req else ''}.",
        )
    wo.status = "closed"
    wo.verified_by_id = user.id
    wo.verified_at = now_utc()
    wo.closed_at = wo.verified_at
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/cancel", response_model=MaintenanceWorkOrderResponse)
async def cancel(
    wo_id: int, payload: MaintenanceWorkOrderReasonPayload, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "approve")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, ("draft", "assigned", "on_hold"), "cancel", "An in-progress job has to be put On Hold first.")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Give a reason for cancelling.")
    issued = [s for s in wo.spares if s.qty_issued - s.qty_returned > 1e-9]
    if issued:
        raise HTTPException(
            status_code=409,
            detail=f"Can't cancel {wo.wo_number}: {len(issued)} spare line(s) were issued from Store and not returned. Return them first so the stock ledger stays right.",
        )
    wo.status = "cancelled"
    wo.cancel_reason = payload.reason.strip()
    if wo.request_id:
        # The request goes back to triage so it can be re-converted or rejected.
        req = db.query(MaintenanceRequest).filter(MaintenanceRequest.id == wo.request_id).first()
        if req and req.status == "converted":
            req.status = "acknowledged"
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


# ---------------------------------------------------------------------------
# Checklist tasks
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/tasks", response_model=MaintenanceWorkOrderResponse)
async def add_task(
    wo_id: int, payload: MaintenanceWorkOrderTaskPayload, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_editable(wo, "add a checklist line")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="Checklist line needs a description.")
    seq = payload.sequence or ((max((t.sequence for t in wo.tasks), default=0)) + 10)
    wo.tasks.append(MaintenanceWorkOrderTask(sequence=seq, description=payload.description.strip(), expected_value=payload.expected_value))
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.patch("/{wo_id}/tasks/{task_id}", response_model=MaintenanceWorkOrderResponse)
async def update_task(
    wo_id: int, task_id: int, payload: MaintenanceWorkOrderTaskUpdate, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_editable(wo, "update the checklist")
    task = next((t for t in wo.tasks if t.id == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail=f"Checklist line #{task_id} isn't on {wo.wo_number}.")
    data = payload.model_dump(exclude_unset=True)
    if data.get("result") and data["result"] not in MAINTENANCE_TASK_RESULTS:
        raise HTTPException(status_code=400, detail="Result must be OK, Not OK or N/A.")
    if "description" in data and not (data["description"] or "").strip():
        raise HTTPException(status_code=400, detail="Checklist line description can't be empty.")
    for field, val in data.items():
        setattr(task, field, val)
    if "result" in data:
        task.done_by_id = user.id if data["result"] else None
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.delete("/{wo_id}/tasks/{task_id}", response_model=MaintenanceWorkOrderResponse)
async def delete_task(
    wo_id: int, task_id: int, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_editable(wo, "remove a checklist line")
    task = next((t for t in wo.tasks if t.id == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail=f"Checklist line #{task_id} isn't on {wo.wo_number}.")
    wo.tasks.remove(task)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


# ---------------------------------------------------------------------------
# Spares — every movement goes through the Store ledger
# ---------------------------------------------------------------------------

def _item_and_location(db: Session, item_id: int, location_id: int) -> tuple[StoreItem, StoreLocation]:
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Store item #{item_id} not found — pick the spare again.")
    loc = db.query(StoreLocation).filter(StoreLocation.id == location_id).first()
    if not loc or not loc.is_active:
        raise HTTPException(status_code=404, detail=f"Store location #{location_id} not found or inactive — pick the store again.")
    return item, loc


def _unit_cost(item: StoreItem) -> float:
    return float(getattr(item, "standard_cost", None) or getattr(item, "moving_average_cost", None) or 0.0)


@router.post("/{wo_id}/spares", response_model=MaintenanceWorkOrderResponse)
async def plan_spare(
    wo_id: int, payload: MaintenanceWorkOrderSparePlanPayload, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_editable(wo, "plan spares")
    if payload.qty_planned <= 0:
        raise HTTPException(status_code=400, detail="Planned quantity must be greater than 0.")
    item, _loc = _item_and_location(db, payload.store_item_id, payload.location_id)
    existing = next((s for s in wo.spares if s.store_item_id == item.id and s.location_id == payload.location_id), None)
    if existing:
        existing.qty_planned = payload.qty_planned
    else:
        wo.spares.append(MaintenanceWorkOrderSpare(
            store_item_id=item.id, location_id=payload.location_id, qty_planned=payload.qty_planned,
            unit_cost=_unit_cost(item), remarks=payload.remarks,
        ))
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.delete("/{wo_id}/spares/{spare_id}", response_model=MaintenanceWorkOrderResponse)
async def remove_spare(
    wo_id: int, spare_id: int, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_editable(wo, "remove a spare line")
    spare = next((s for s in wo.spares if s.id == spare_id), None)
    if not spare:
        raise HTTPException(status_code=404, detail=f"Spare line #{spare_id} isn't on {wo.wo_number}.")
    if spare.qty_issued > 0:
        raise HTTPException(status_code=409, detail="This spare was already issued from Store, so the line can't be removed. Return the unused quantity instead.")
    wo.spares.remove(spare)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/spares/issue", response_model=MaintenanceWorkOrderResponse)
async def issue_spare(
    wo_id: int, payload: MaintenanceWorkOrderSpareIssuePayload, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, SPARE_ACTIVE_STATUSES, "issue spares for")
    if payload.quantity is None or payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Issue quantity must be greater than 0.")
    if payload.spare_id:
        spare = next((s for s in wo.spares if s.id == payload.spare_id), None)
        if not spare:
            raise HTTPException(status_code=404, detail=f"Spare line #{payload.spare_id} isn't on {wo.wo_number}.")
        item, loc = _item_and_location(db, spare.store_item_id, spare.location_id)
    else:
        if not payload.store_item_id or not payload.location_id:
            raise HTTPException(status_code=400, detail="Pick the spare part and the Store location to issue from.")
        item, loc = _item_and_location(db, payload.store_item_id, payload.location_id)
        spare = next((s for s in wo.spares if s.store_item_id == item.id and s.location_id == loc.id), None)
        if not spare:
            spare = MaintenanceWorkOrderSpare(store_item_id=item.id, location_id=loc.id, qty_planned=0.0, unit_cost=_unit_cost(item), remarks=payload.remarks)
            wo.spares.append(spare)

    try:
        post_stock_transaction(
            db, item_id=item.id, location_id=loc.id, transaction_type="issue", quantity=payload.quantity,
            reference_type="maintenance_work_order", reference_number=wo.wo_number,
            remarks=payload.remarks or f"Issued to {wo.wo_number}", created_by_id=user.id,
        )
    except ValueError:
        db.rollback()
        available = _available(db, item.id, loc.id)
        raise HTTPException(
            status_code=409,
            detail=(
                f"Only {_fmt_qty(max(0.0, available))} of {_fmt_qty(payload.quantity)} '{item.item_name}' available at {loc.name}. "
                + (f"Issue {_fmt_qty(available)} now or transfer stock in first." if available > 0 else "Transfer stock in or raise a purchase request first.")
            ),
        )
    # Weighted-average cost snapshot across everything issued on this line.
    cost_now = _unit_cost(item)
    prev_net = max(0.0, spare.qty_issued - spare.qty_returned)
    spare.unit_cost = round(((prev_net * (spare.unit_cost or 0)) + payload.quantity * cost_now) / (prev_net + payload.quantity), 4)
    spare.qty_issued += payload.quantity
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.post("/{wo_id}/spares/return", response_model=MaintenanceWorkOrderResponse)
async def return_spare(
    wo_id: int, payload: MaintenanceWorkOrderSpareReturnPayload, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_editable(wo, "return spares")
    spare = next((s for s in wo.spares if s.id == payload.spare_id), None)
    if not spare:
        raise HTTPException(status_code=404, detail=f"Spare line #{payload.spare_id} isn't on {wo.wo_number}.")
    outstanding = spare.qty_issued - spare.qty_returned
    if payload.quantity is None or payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Return quantity must be greater than 0.")
    if payload.quantity - outstanding > 1e-9:
        raise HTTPException(status_code=400, detail=f"Only {_fmt_qty(outstanding)} is still out on this job, so you can't return {_fmt_qty(payload.quantity)}.")
    post_stock_transaction(
        db, item_id=spare.store_item_id, location_id=spare.location_id, transaction_type="return_in", quantity=payload.quantity,
        reference_type="maintenance_work_order", reference_number=wo.wo_number,
        remarks=payload.remarks or f"Unused spare returned from {wo.wo_number}", created_by_id=user.id,
    )
    spare.qty_returned += payload.quantity
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


# ---------------------------------------------------------------------------
# Labour
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/labour", response_model=MaintenanceWorkOrderResponse)
async def add_labour(
    wo_id: int, payload: MaintenanceLabourLogPayload, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_status(wo, ("assigned", "in_progress", "on_hold", "completed"), "log labour on")
    _check_user(db, payload.technician_id, "Technician")
    start, end = _aware(payload.start_time), _aware(payload.end_time)
    if start and end and end <= start:
        raise HTTPException(status_code=400, detail="Labour end time must be after the start time.")
    if (start and start > now_utc()) or (end and end > now_utc()):
        raise HTTPException(status_code=400, detail="Labour times can't be in the future.")
    hours = payload.hours
    if hours is None:
        if not (start and end):
            raise HTTPException(status_code=400, detail="Enter the hours worked, or both a start and an end time.")
        hours = round((end - start).total_seconds() / 3600, 2)
    if hours <= 0 or hours > 24:
        raise HTTPException(status_code=400, detail="Hours must be more than 0 and at most 24 per entry.")
    if payload.hourly_rate < 0:
        raise HTTPException(status_code=400, detail="Hourly rate can't be negative.")
    wo.labour_logs.append(MaintenanceLabourLog(
        technician_id=payload.technician_id, start_time=start, end_time=end, hours=hours,
        hourly_rate=payload.hourly_rate, remarks=payload.remarks,
    ))
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))


@router.delete("/{wo_id}/labour/{log_id}", response_model=MaintenanceWorkOrderResponse)
async def delete_labour(
    wo_id: int, log_id: int, db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("maintenance", "work_orders", "edit")),
):
    wo = _get_or_404(db, wo_id)
    _require_editable(wo, "remove a labour entry")
    log = next((l for l in wo.labour_logs if l.id == log_id), None)
    if not log:
        raise HTTPException(status_code=404, detail=f"Labour entry #{log_id} isn't on {wo.wo_number}.")
    wo.labour_logs.remove(log)
    _after_change(db, wo)
    db.commit()
    return _to_response(db, _get_or_404(db, wo.id))
