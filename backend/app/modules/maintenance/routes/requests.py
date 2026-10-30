from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.priority import map_legacy_priority, parse_priority
from app.modules.maintenance.role_events import role_event
from app.core.permissions import require_any_app_access, require_feature_action, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import (
    MaintenanceRequest, MAINTENANCE_REQUEST_TYPES, MAINTENANCE_REQUEST_STATUSES,
)
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder, MAINTENANCE_WO_TYPES
from app.modules.maintenance.schemas.request import (
    MaintenanceRequestCreate, MaintenanceRequestRejectPayload, MaintenanceRequestConvertPayload,
    MaintenanceRequestConfirmPayload, MaintenanceRequestResponse, MaintenanceRequestWorkOrderSummary,
)
from app.modules.maintenance.service import (
    generate_request_number, generate_work_order_number, default_priority, sync_asset_status,
    user_names, now_utc, maintenance_users_for_branch, notify_many, _aware,
)
from app.modules.maintenance.access import submit_close_out, withdraw_close_out  # also registers the data scopes

# Requesters (production supervisors, shift in-charges) usually hold the
# production app, not maintenance — raising, viewing their own requests and
# confirming a repair accepts either. Triage actions need maintenance.
router = APIRouter(
    prefix="/maintenance/requests", tags=["Maintenance"],
    dependencies=[Depends(require_any_app_access("maintenance", "production"))],
)

REQUEST_WO_TYPE = {"breakdown": "breakdown", "abnormality": "corrective", "improvement": "improvement", "safety": "corrective"}


def _is_maintenance(user: User) -> bool:
    return "maintenance" in user.get_apps()


def _to_response(db: Session, req: MaintenanceRequest, user: User) -> MaintenanceRequestResponse:
    resp = MaintenanceRequestResponse.model_validate(req)
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == req.asset_id).first()
    if asset:
        resp.asset_code, resp.asset_name = asset.asset_code, asset.name
        resp.asset_criticality, resp.asset_status = asset.criticality, asset.status
        branch = db.query(Branch.name).filter(Branch.id == asset.branch_id).first()
        resp.branch_name = branch[0] if branch else None
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.request_id == req.id).order_by(MaintenanceWorkOrder.id.desc()).first()
    names = user_names(db, [req.raised_by_id, req.acknowledged_by_id, wo.assigned_to_id if wo else None])
    resp.raised_by_name = names.get(req.raised_by_id)
    resp.acknowledged_by_name = names.get(req.acknowledged_by_id)
    if wo:
        resp.work_order = MaintenanceRequestWorkOrderSummary(
            id=wo.id, wo_number=wo.wo_number, status=wo.status, assigned_to_name=names.get(wo.assigned_to_id),
            action_taken=wo.action_taken, root_cause=wo.root_cause, downtime_minutes=wo.downtime_minutes,
            requester_confirmed_at=wo.requester_confirmed_at,
        )
        resp.can_confirm = (
            wo.status == "completed" and wo.requester_confirmed_at is None
            and (user.id == req.raised_by_id or user.role == "admin")
        )
    return resp


def _get_or_404(db: Session, request_id: int, user: User) -> MaintenanceRequest:
    req = db.query(MaintenanceRequest).filter(MaintenanceRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail=f"Maintenance request #{request_id} not found.")
    if not _is_maintenance(user) and req.raised_by_id != user.id:
        raise HTTPException(status_code=403, detail="You can only view requests you raised. Ask the Maintenance team for access to other requests.")
    ensure_in_scope(db, user, req)
    return req


def _require_maintenance(user: User) -> None:
    if not _is_maintenance(user):
        raise HTTPException(status_code=403, detail="Only the Maintenance team can triage requests. Ask an admin for the Maintenance module if you need this.")


@router.get("", response_model=list[MaintenanceRequestResponse])
async def list_requests(
    status_filter: str | None = Query(None, alias="status"),
    asset_id: int | None = None,
    branch_id: int | None = None,
    mine: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    query = db.query(MaintenanceRequest)
    if mine or not _is_maintenance(user):
        query = query.filter(MaintenanceRequest.raised_by_id == user.id)
    if status_filter:
        query = query.filter(MaintenanceRequest.status == status_filter)
    if asset_id:
        query = query.filter(MaintenanceRequest.asset_id == asset_id)
    if branch_id or search:
        query = query.join(MaintenanceAsset, MaintenanceAsset.id == MaintenanceRequest.asset_id)
        if branch_id:
            query = query.filter(MaintenanceAsset.branch_id == branch_id)
        if search:
            like = f"%{search}%"
            query = query.filter(
                (MaintenanceRequest.request_number.ilike(like)) | (MaintenanceRequest.problem_description.ilike(like))
                | (MaintenanceAsset.asset_code.ilike(like)) | (MaintenanceAsset.name.ilike(like))
            )
    query = apply_scope(query, user, MaintenanceRequest)
    return [_to_response(db, r, user) for r in query.order_by(MaintenanceRequest.reported_at.desc()).all()]


@router.post("", response_model=MaintenanceRequestResponse)
async def create_request(
    payload: MaintenanceRequestCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    if payload.request_type not in MAINTENANCE_REQUEST_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid request type '{payload.request_type}'. Valid: {', '.join(MAINTENANCE_REQUEST_TYPES)}.")
    if payload.priority:
        payload.priority = parse_priority(payload.priority)
    if not payload.problem_description.strip():
        raise HTTPException(status_code=400, detail="Describe the problem — what happened, and what you saw or heard.")
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == payload.asset_id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
    if not asset:
        raise HTTPException(status_code=404, detail=f"Asset #{payload.asset_id} not found — pick the machine again.")
    if asset.status == "decommissioned":
        raise HTTPException(status_code=400, detail=f"{asset.asset_code} is decommissioned, so requests can't be raised on it.")
    reported_at = _aware(payload.reported_at) or now_utc()
    if reported_at > now_utc():
        raise HTTPException(status_code=400, detail="Reported time can't be in the future.")

    req = MaintenanceRequest(
        request_number=generate_request_number(db),
        asset_id=asset.id,
        request_type=payload.request_type,
        machine_down=payload.machine_down,
        reported_at=reported_at,
        problem_description=payload.problem_description.strip(),
        priority=payload.priority or default_priority(asset.criticality, payload.machine_down, db),
        status="open",
        raised_by_id=user.id,
    )
    db.add(req)
    db.flush()
    sync_asset_status(db, asset)
    down = " — MACHINE DOWN" if req.machine_down else ""
    team = {u.id for u in maintenance_users_for_branch(db, asset.branch_id)}
    role_event(db, background_tasks, "request_raised", title=f"{req.request_number}: {asset.asset_code}{down}",
               message=f"{user.name or user.email} reported {req.request_type.replace('_', ' ')} on {asset.asset_code} {asset.name}: "
                       f"{req.problem_description[:140]}", entity_type="maintenance_request", entity_id=req.id,
               actor=user, record=req, skip_user_ids=team)
    if req.machine_down and asset.criticality == "A":
        role_event(db, background_tasks, "critical_breakdown", title=f"Critical machine down: {asset.asset_code} ({req.request_number})",
                   message=f"{asset.name} (criticality A) is down — {req.problem_description[:140]}. Reported by {user.name or user.email}.",
                   entity_type="maintenance_request", entity_id=req.id, actor=user, record=req)
    notify_many(
        db, list(team),
        f"{'URGENT: ' if req.priority == 'urgent' else ''}{req.request_number}: {asset.asset_code}{down}",
        f"{req.request_type.replace('_', ' ').capitalize()} on {asset.name}: {req.problem_description[:140]}",
        "maintenance_request_raised", "maintenance_request", req.id, exclude_user_id=user.id,
    )
    db.commit()
    db.refresh(req)
    return _to_response(db, req, user)


@router.get("/{request_id}", response_model=MaintenanceRequestResponse)
async def get_request(
    request_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    return _to_response(db, _get_or_404(db, request_id, user), user)


@router.post("/{request_id}/acknowledge", response_model=MaintenanceRequestResponse)
async def acknowledge_request(
    request_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("maintenance", "requests", "triage", "approve")),
):
    _require_maintenance(user)
    req = _get_or_404(db, request_id, user)
    if req.status != "open":
        raise HTTPException(status_code=409, detail=f"{req.request_number} is already {req.status.replace('_', ' ')}, so it can't be acknowledged.")
    req.status = "acknowledged"
    req.acknowledged_by_id = user.id
    req.acknowledged_at = now_utc()
    if req.raised_by_id and req.raised_by_id != user.id:
        notify_many(db, [req.raised_by_id], f"{req.request_number} acknowledged",
                    f"{user.name or user.email} acknowledged your maintenance request — a work order follows.",
                    "maintenance_request_acknowledged", "maintenance_request", req.id, exclude_user_id=user.id)
    role_event(db, background_tasks, "request_acknowledged", title=f"{req.request_number} acknowledged",
               message=f"{user.name or user.email} acknowledged maintenance request {req.request_number}.",
               entity_type="maintenance_request", entity_id=req.id, actor=user, record=req, skip_user_ids={req.raised_by_id})
    db.commit()
    return _to_response(db, req, user)


@router.post("/{request_id}/reject", response_model=MaintenanceRequestResponse)
async def reject_request(
    request_id: int, payload: MaintenanceRequestRejectPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("maintenance", "requests", "triage", "reject")),
):
    _require_maintenance(user)
    req = _get_or_404(db, request_id, user)
    if payload.status not in ("rejected", "duplicate"):
        raise HTTPException(status_code=400, detail="Status must be 'rejected' or 'duplicate'.")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Give a reason — the requester sees it.")
    if req.status not in ("open", "acknowledged"):
        raise HTTPException(status_code=409, detail=f"{req.request_number} is already {req.status}; only open or acknowledged requests can be rejected.")
    req.status = payload.status
    req.rejection_reason = payload.reason.strip()
    req.acknowledged_by_id = req.acknowledged_by_id or user.id
    req.acknowledged_at = req.acknowledged_at or now_utc()
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == req.asset_id).first()
    if asset:
        sync_asset_status(db, asset)
    if req.raised_by_id:
        notify_many(
            db, [req.raised_by_id], f"{req.request_number} {'marked duplicate' if payload.status == 'duplicate' else 'rejected'}",
            req.rejection_reason, "maintenance_request_rejected", "maintenance_request", req.id, exclude_user_id=user.id,
        )
    verb = "marked duplicate" if payload.status == "duplicate" else "rejected"
    role_event(db, background_tasks, "request_rejected", title=f"{req.request_number} {verb}",
               message=f"{user.name or user.email} {verb} maintenance request {req.request_number}: {req.rejection_reason}",
               entity_type="maintenance_request", entity_id=req.id, actor=user, record=req, skip_user_ids={req.raised_by_id})
    db.commit()
    return _to_response(db, req, user)


@router.post("/{request_id}/convert", response_model=MaintenanceRequestResponse)
async def convert_request(
    request_id: int, payload: MaintenanceRequestConvertPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "work_orders", "create")),
):
    """Turns the request into a work order, carrying machine_down and the
    downtime start over so the clock keeps running from the original report."""
    _require_maintenance(user)
    req = _get_or_404(db, request_id, user)
    if req.status not in ("open", "acknowledged"):
        raise HTTPException(status_code=409, detail=f"{req.request_number} is {req.status}; only open or acknowledged requests can become work orders.")
    wo_type = payload.wo_type or REQUEST_WO_TYPE.get(req.request_type, "corrective")
    if wo_type not in MAINTENANCE_WO_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid work order type '{wo_type}'.")
    priority = parse_priority(payload.priority) if payload.priority else map_legacy_priority(req.priority)
    if payload.assigned_to_id:
        tech = db.query(User).filter(User.id == payload.assigned_to_id, User.is_active == True).first()  # noqa: E712
        if not tech:
            raise HTTPException(status_code=404, detail=f"Technician #{payload.assigned_to_id} not found or inactive.")
        # Same assign-to rule as assigning the job itself (Maintenance › Work Orders › Assign technician).
        assignee_rules.ensure_allowed(db, user, "maintenance:work_orders.assign", tech)
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == req.asset_id).first()
    if not asset or asset.is_deleted or asset.status == "decommissioned":
        what = asset.asset_code if asset else f"Asset #{req.asset_id}"
        why = "is decommissioned" if asset and asset.status == "decommissioned" else "was deleted"
        raise HTTPException(
            status_code=409,
            detail=f"{what} {why} after {req.request_number} was raised, so no work order can be opened on it. "
                   "Reject the request (or mark it duplicate) with the reason instead.",
        )

    wo = MaintenanceWorkOrder(
        wo_number=generate_work_order_number(db),
        asset_id=req.asset_id,
        request_id=req.id,
        wo_type=wo_type,
        priority=priority,
        title=(payload.title or "").strip() or f"{req.request_type.capitalize()}: {req.problem_description[:80]}",
        description=payload.description or req.problem_description,
        status="assigned" if payload.assigned_to_id else "draft",
        machine_down=req.machine_down,
        downtime_start=req.reported_at if req.machine_down else None,
        assigned_to_id=payload.assigned_to_id,
        planned_start=date.fromisoformat(payload.planned_start) if payload.planned_start else None,
        created_by_id=user.id,
    )
    db.add(wo)
    req.status = "converted"
    req.acknowledged_by_id = req.acknowledged_by_id or user.id
    req.acknowledged_at = req.acknowledged_at or now_utc()
    db.flush()
    if asset:
        sync_asset_status(db, asset)
    if wo.assigned_to_id:
        notify_many(
            db, [wo.assigned_to_id], f"{wo.wo_number} assigned to you",
            f"{asset.asset_code if asset else ''}: {wo.title}", "maintenance_wo_assigned", "maintenance_work_order", wo.id,
            exclude_user_id=user.id,
        )
        role_event(db, background_tasks, "wo_assigned", title=f"{wo.wo_number} assigned",
                   message=f"{user.name or user.email} raised {wo.wo_number} from {req.request_number} and assigned it — "
                           f"{asset.asset_code if asset else ''}: {wo.title}",
                   entity_type="maintenance_work_order", entity_id=wo.id, actor=user, record=wo, skip_user_ids={wo.assigned_to_id})
    db.commit()
    return _to_response(db, req, user)


@router.post("/{request_id}/confirm", response_model=MaintenanceRequestResponse)
async def confirm_repair(
    request_id: int, payload: MaintenanceRequestConfirmPayload, db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    """The requester confirms the machine is OK after repair (ok=True), or
    sends the job back (ok=False, comment required) — which reopens it."""
    req = _get_or_404(db, request_id, user)
    if user.id != req.raised_by_id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the person who raised this request can confirm the repair.")
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.request_id == req.id).order_by(MaintenanceWorkOrder.id.desc()).first()
    if not wo or wo.status != "completed":
        raise HTTPException(status_code=409, detail="There's nothing to confirm yet — the work order isn't marked Completed.")
    if wo.requester_confirmed_at:
        raise HTTPException(status_code=409, detail=f"You already confirmed {wo.wo_number}.")
    comment = (payload.comment or "").strip()
    if payload.ok:
        wo.requester_confirmed_at = now_utc()
        wo.requester_comment = comment or None
        notify_many(
            db, [wo.created_by_id, req.acknowledged_by_id], f"{wo.wo_number} confirmed by requester",
            "The machine is confirmed OK — the job can be verified and closed.", "maintenance_wo_confirmed",
            "maintenance_work_order", wo.id, exclude_user_id=user.id,
        )
        # Now closable → close-out verification through the approval engine.
        submit_close_out(db, wo)
    else:
        if not comment:
            raise HTTPException(status_code=400, detail="Say what's still wrong so the technician knows what to fix.")
        # Already waiting for close-out approval (confirmation was optional)? Withdraw it.
        withdraw_close_out(db, wo, user, f"Requester reported the machine is not OK: {comment}")
        wo.status = "in_progress"
        wo.requester_comment = comment
        wo.actual_end = None
        if wo.machine_down:
            wo.downtime_end = None
            wo.downtime_minutes = None
        asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == wo.asset_id).first()
        if asset:
            sync_asset_status(db, asset)
        notify_many(
            db, [wo.assigned_to_id, wo.created_by_id], f"{wo.wo_number} reopened — machine not OK",
            comment, "maintenance_wo_confirmation_rejected", "maintenance_work_order", wo.id, exclude_user_id=user.id,
        )
    db.commit()
    return _to_response(db, req, user)
