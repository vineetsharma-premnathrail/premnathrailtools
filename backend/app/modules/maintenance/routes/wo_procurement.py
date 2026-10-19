"""Raise a purchase requisition from a maintenance work order (SAP IW32
external services / non-stock components → ME51N from the order).

The PR is created through the normal Procurement path — same validation
(every line an Item Master item), same number series, same approval
workflow (Organization › Approval Workflows › Purchase requisition), same
line routing on approval. The work order keeps the link
(maintenance_wo_purchase_requests) and shows the PR / PO status; the posted
vendor-invoice value of an outside-service PR flows back as the job's
procured_cost (maintenance/procurement.py)."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.notify_rules import fire_rule
from app.core.permissions import require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.modules.maintenance.sensitive import sees_costs
from app.modules.maintenance.role_events import role_event
from app.core.data_scope import ensure_in_scope
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.maintenance import access  # noqa: F401 — registers the maintenance data scopes
from app.modules.maintenance import procurement
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.wo_procurement import MaintenanceWorkOrderPurchaseRequest, MAINTENANCE_WO_PR_PURPOSES
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder
from app.modules.maintenance.service import recompute_costs

router = APIRouter(
    prefix="/maintenance/work-orders", tags=["Maintenance"],
    dependencies=[Depends(require_app_access("maintenance"))],
)

PR_OPEN_WO_STATUSES = ("draft", "assigned", "in_progress", "on_hold")


class WorkOrderPRLine(BaseModel):
    store_item_id: int | None = None
    quantity: float = 1
    make: str | None = None
    ship_to: str | None = None


class WorkOrderRaisePRPayload(BaseModel):
    purpose: str = "spares"          # spares | external_service
    category_code: str = "OTH"
    priority: str = "medium"
    required_date: date | None = None
    requirement_type: str | None = None
    reason: str | None = None
    items: list[WorkOrderPRLine] = Field(default_factory=list)


def _wo(db: Session, wo_id: int, user: User) -> MaintenanceWorkOrder:
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail=f"Maintenance work order #{wo_id} not found.")
    ensure_in_scope(db, user, wo)
    return wo


@router.get("/{wo_id}/purchase-requests")
async def list_wo_purchase_requests(
    wo_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("maintenance", "work_orders", "purchase", "view")),
):
    wo = _wo(db, wo_id, user)
    if procurement.refresh_procured_cost(db, wo):
        db.commit()
    invoiced, committed = procurement.procured_amounts(db, wo.id)
    prs = procurement.summary(db, wo.id)
    if not sees_costs(user):  # maintenance:work_orders.costs:view — blank the money
        invoiced = committed = None
        for pr in prs:
            for po in pr["purchase_orders"]:
                po["total_value"] = po["invoiced_amount"] = None
    return {"purchase_requests": prs, "procured_cost": (wo.procured_cost or 0) if sees_costs(user) else None,
            "service_committed": committed, "service_invoiced": invoiced}


@router.post("/{wo_id}/raise-pr", status_code=201)
async def raise_wo_purchase_request(
    wo_id: int, payload: WorkOrderRaisePRPayload, background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("maintenance", "work_orders", "purchase", "create")),
):
    from app.modules.p2p import approvals as p2p_approvals
    from app.modules.p2p.models.p2p_request import (
        ENGINE_SCHEME, P2P_CATEGORIES, P2P_REQUEST_PRIORITIES, P2P_REQUIREMENT_TYPES, P2PRequest, resolve_auto_buyer_id,
    )
    from app.modules.p2p.routes.p2p_requests import _sync_pr_lines, _validate_pr_payload, _write_audit as p2p_audit
    from app.modules.p2p.schemas.p2p_request import P2PRequestCreate, P2PRequestItemPayload
    from app.modules.p2p.service import generate_p2p_number

    wo = _wo(db, wo_id, user)
    if wo.status not in PR_OPEN_WO_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Can't raise a purchase requisition on {wo.wo_number}: it's {wo.status.replace('_', ' ')}. "
                   "PRs are raised while the job is open (draft, assigned, in progress or on hold).",
        )
    # Gated by Work Orders › Edit (like an SAP order generating its own PR) —
    # the PR then goes through the normal Procurement approval.
    if payload.purpose not in MAINTENANCE_WO_PR_PURPOSES:
        raise HTTPException(status_code=400, detail=f"Invalid purpose '{payload.purpose}'. Valid: spares (out-of-stock parts) or external_service (outside repair).")
    if payload.category_code not in P2P_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Pick a valid Purchase Requisition category (got '{payload.category_code}').")
    if payload.priority not in P2P_REQUEST_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{payload.priority}' — use {', '.join(P2P_REQUEST_PRIORITIES)}.")
    requirement_type = payload.requirement_type or ("Service" if payload.purpose == "external_service" else "Material")
    if requirement_type not in P2P_REQUIREMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid requirement type '{requirement_type}'.")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Add at least one line — pick the spare or the service from the Item Master.")

    asset = db.get(MaintenanceAsset, wo.asset_id)
    pr_payload = P2PRequestCreate(
        project_label=f"Maintenance {wo.wo_number}" + (f" — {asset.asset_code}" if asset else ""),
        category_code=payload.category_code, required_date=payload.required_date,
        requirement_type=requirement_type, priority=payload.priority, project_type="existing",
        remarks=f"Raised from maintenance work order {wo.wo_number} ({wo.title})."
                + (f" Reason: {payload.reason.strip()}" if (payload.reason or "").strip() else ""),
        items=[P2PRequestItemPayload(store_item_id=l.store_item_id, quantity=l.quantity, make=l.make,
                                     project_inhouse="Inhouse", ship_to=l.ship_to) for l in payload.items],
    )
    lines = _validate_pr_payload(db, pr_payload, draft=False)
    for idx, (_line, master) in enumerate(lines, start=1):
        is_service = (master.item_type or "").strip().lower() == "service"
        if payload.purpose == "external_service" and not is_service:
            raise HTTPException(
                status_code=400,
                detail=f"Line {idx} ({master.item_code} {master.item_name}) is a {master.item_type or 'material'} item, not a service. "
                       "An outside-repair PR carries Item Master items of type Service (e.g. 'Motor rewinding'); raise "
                       "spare parts as a separate Spares PR.",
            )
        if payload.purpose == "spares" and is_service:
            raise HTTPException(
                status_code=400,
                detail=f"Line {idx} ({master.item_code} {master.item_name}) is a service item. Raise it as an Outside repair / "
                       "service PR, so its vendor bill is costed to this job.",
            )

    auto_buyer_id = resolve_auto_buyer_id(db, payload.category_code)
    pr = P2PRequest(
        p2p_number=generate_p2p_number(db, payload.category_code),
        category_code=payload.category_code, project_label=pr_payload.project_label, project_type="existing",
        approval_scheme=ENGINE_SCHEME, required_date=payload.required_date, requirement_type=requirement_type,
        request_date=date.today(), department=user.department, requested_by_id=user.id, priority=payload.priority,
        assigned_buyer_id=auto_buyer_id, assignment_date=date.today() if auto_buyer_id else None,
        remarks=pr_payload.remarks, status="submitted",
    )
    db.add(pr)
    db.flush()
    _sync_pr_lines(db, pr, lines)
    p2p_audit(db, pr.id, "created", user, summary=f"{user.name or user.email} raised P2P request {pr.p2p_number} from "
                                                  f"maintenance work order {wo.wo_number}.", new_status="submitted")
    db.add(MaintenanceWorkOrderPurchaseRequest(work_order_id=wo.id, p2p_request_id=pr.id, purpose=payload.purpose, created_by_id=user.id))
    db.flush()
    # Into the normal PR approval (engine refuses with the reason when a stage
    # has nobody — nothing is saved then).
    p2p_approvals.submit_pr(db, pr, user)
    role_event(db, background_tasks, "wo_pr_raised", title=f"PR {pr.p2p_number} raised for {wo.wo_number}",
               message=f"{user.name or user.email} raised purchase requisition {pr.p2p_number} ({payload.purpose}) for {wo.wo_number} — "
                       f"{wo.title}. Purchase will source it.",
               entity_type="maintenance_work_order", entity_id=wo.id, actor=user, record=wo)
    fire_rule(db, background_tasks, "p2p", "pr_create", "New Purchase Requisition",
              f"PR '{pr.p2p_number}' was raised by {user.name or user.email} for {pr.project_label}.", "p2p_request", pr.id, user,
              [("Requisition", pr.p2p_number), ("For", pr.project_label or ""), ("Raised by", user.name or user.email)])
    note = f"PR {pr.p2p_number} ({'outside repair / service' if payload.purpose == 'external_service' else 'spares'}) raised."
    wo.description = f"{wo.description}\n\n{note}" if wo.description else note
    recompute_costs(wo)
    db.commit()
    db.refresh(pr)
    return {"id": pr.id, "p2p_number": pr.p2p_number, "status": pr.status, "purpose": payload.purpose,
            "purchase_requests": procurement.summary(db, wo.id)}
