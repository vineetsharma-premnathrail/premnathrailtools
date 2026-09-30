from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_any_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import (
    MaintenanceRequest, MAINTENANCE_REQUEST_TYPES, MAINTENANCE_PRIORITIES, MAINTENANCE_REQUEST_STATUSES,
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
    return [_to_response(db, r, user) for r in query.order_by(MaintenanceRequest.reported_at.desc()).all()]


@router.post("", response_model=MaintenanceRequestResponse)
async def create_request(
    payload: MaintenanceRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    if payload.request_type not in MAINTENANCE_REQUEST_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid request type '{payload.request_type}'. Valid: {', '.join(MAINTENANCE_REQUEST_TYPES)}.")
    if payload.priority and payload.priority not in MAINTENANCE_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{payload.priority}'. Valid: {', '.join(MAINTENANCE_PRIORITIES)}.")
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
        priority=payload.priority or default_priority(asset.criticality, payload.machine_down),
        status="open",
        raised_by_id=user.id,
    )
    db.add(req)
    db.flush()
    sync_asset_status(db, asset)
    down = " — MACHINE DOWN" if req.machine_down else ""
    notify_many(
        db, [u.id for u in maintenance_users_for_branch(db, asset.branch_id)],
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
    request_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "requests", "edit")),
):
    _require_maintenance(user)
    req = _get_or_404(db, request_id, user)
    if req.status != "open":
        raise HTTPException(status_code=409, detail=f"{req.request_number} is already {req.status.replace('_', ' ')}, so it can't be acknowledged.")
    req.status = "acknowledged"
    req.acknowledged_by_id = user.id
    req.acknowledged_at = now_utc()
    db.commit()
    return _to_response(db, req, user)


@router.post("/{request_id}/reject", response_model=MaintenanceRequestResponse)
async def reject_request(
    request_id: int, payload: MaintenanceRequestRejectPayload, db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("maintenance", "requests", "edit")),
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
    db.commit()
    return _to_response(db, req, user)


@router.post("/{request_id}/convert", response_model=MaintenanceRequestResponse)
async def convert_request(
    request_id: int, payload: MaintenanceRequestConvertPayload, db: Session = Depends(get_db),
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
    priority = payload.priority or req.priority
    if priority not in MAINTENANCE_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{priority}'.")
    if payload.assigned_to_id:
        tech = db.query(User).filter(User.id == payload.assigned_to_id, User.is_active == True).first()  # noqa: E712
        if not tech:
            raise HTTPException(status_code=404, detail=f"Technician #{payload.assigned_to_id} not found or inactive.")
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == req.asset_id).first()

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
    else:
        if not comment:
            raise HTTPException(status_code=400, detail="Say what's still wrong so the technician knows what to fix.")
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
