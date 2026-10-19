"""Production on the central authorization framework
(docs/02-modules/platform/authorization-architecture.md).

Data scope (core/data_scope.py) — module "production":
  work orders     owner = creator, assigned = supervisor, plant = WO branch
  RRV builds      owner = creator, assigned = build manager + stage assignees, plant = build branch
  rework orders   owner = creator, assigned = assignee / doer, plant = its build's branch
  time logs       owner = operator / booker, plant = its work order's branch
BOMs and workstations are engineering masters (organization-wide, not scoped).

Approvals (organization/services/approval_engine.py) — Organization › Approval Workflows:
  production.bom_activation      BOM draft → active           default: holders of production:bom:approve
  production.work_order_release  Work order draft → released  default: holders of production:work_orders:approve
  production.rrv_signoff         RRV sign-off stage complete  default: the build manager or any production manager
The transaction types themselves are registered by the route modules (their
on_decided callbacks run the route logic); `submit_and_self_approve` is the
shared submit path.
"""
from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, column_property

from app.core.data_scope import ensure_in_scope, register_scoped
from app.core.permission_registry import can_feature, can_perform, is_admin_user
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine
from app.modules.production.models.rrv_build import ProductionReworkOrder, ProductionRrvBuild, ProductionRrvBuildStage
from app.modules.production.models.work_order import ProductionTimeLog, ProductionWorkOrder

BOM_KEY, BOM_ENTITY = "production.bom_activation", "production_bom"
WO_KEY, WO_ENTITY = "production.work_order_release", "production_work_order"
RRV_KEY, RRV_ENTITY = "production.rrv_signoff", "production_rrv_build"


# ── Data scope ──────────────────────────────────────────────────────────────

if not hasattr(ProductionReworkOrder, "plant_id"):
    ProductionReworkOrder.plant_id = column_property(
        select(ProductionRrvBuild.branch_id).where(ProductionRrvBuild.id == ProductionReworkOrder.build_id)
        .correlate_except(ProductionRrvBuild).scalar_subquery(), deferred=True,
    )
if not hasattr(ProductionTimeLog, "plant_id"):
    ProductionTimeLog.plant_id = column_property(
        select(ProductionWorkOrder.branch_id).where(ProductionWorkOrder.id == ProductionTimeLog.work_order_id)
        .correlate_except(ProductionWorkOrder).scalar_subquery(), deferred=True,
    )


def _assigned_a_build_stage(user):
    return ProductionRrvBuild.id.in_(
        select(ProductionRrvBuildStage.build_id).where(ProductionRrvBuildStage.assignee_id == user.id))


register_scoped(ProductionWorkOrder, "production", entity_type=WO_ENTITY, owner=("created_by_id",),
                assigned=("supervisor_id",), branch="branch_id", label="work order")
register_scoped(ProductionRrvBuild, "production", entity_type=RRV_ENTITY, owner=("created_by_id",),
                assigned=("build_manager_id", _assigned_a_build_stage), branch="branch_id", label="RRV build")
register_scoped(ProductionReworkOrder, "production", owner=("created_by_id",), assigned=("assigned_to_id", "done_by_id"),
                branch="plant_id", label="rework order")
register_scoped(ProductionTimeLog, "production", owner=("operator_id", "created_by_id"), branch="plant_id",
                label="time log")


def scope_path_record(model, param: str):
    """Router dependency: every route with `{param}` in its path checks the
    record against the caller's data scope (after its own 404 handling, a
    missing record is left to the route)."""
    from app.db.session import get_db
    from app.modules.main.routes.auth import get_current_user
    from fastapi import Depends

    def _check(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
        raw = request.path_params.get(param)
        if raw is None or not str(raw).isdigit():
            return
        record = db.query(model).filter(model.id == int(raw)).first()
        if record is not None:
            ensure_in_scope(db, user, record)

    return _check


# ── Approvals ───────────────────────────────────────────────────────────────

def pending_request(db: Session, entity_type: str, entity_id: int) -> ApprovalRequest | None:
    req = engine.latest_request(db, entity_type, entity_id)
    return req if req is not None and req.status == "pending" else None


def ensure_not_pending(db: Session, entity_type: str, entity_id: int, what: str, action: str) -> None:
    if pending_request(db, entity_type, entity_id):
        raise HTTPException(
            status_code=409,
            detail=f"{what} is waiting for approval, so it can't be {action} now. Withdraw the approval request "
                   "(Approval panel on the page) first, or wait for the decision.",
        )


def submit_and_self_approve(db: Session, key: str, *, entity_id: int, requester: User, title: str,
                            reference: str | None, context: dict | None = None, branch_id: int | None = None,
                            admin_note: str = "Done directly by an admin") -> ApprovalRequest:
    """Submit to the engine; when the requester is themselves an approver of
    the stage now open (and the workflow allows self-approval, the default for
    these permission-based flows), approve that stage at once — so someone who
    could do it directly before still does it in one click, and someone who
    couldn't now sends it to the approvers instead of getting a 403. An admin
    stands in (recorded as an admin stand-in with `admin_note`)."""
    tt = engine.get_type(key)
    open_req = pending_request(db, tt.entity_type, entity_id)
    if open_req is not None and open_req.workflow_key == key and engine.can_act_on_entity(db, requester, tt.entity_type, entity_id):
        # Already waiting for this user (e.g. an approver pressing Activate /
        # Release / Complete on someone else's request): that click decides it.
        engine.decide(db, open_req.id, requester, "approve")
        return open_req
    try:
        req = engine.submit(db, key, entity_id=entity_id, requester=requester, title=title, reference=reference,
                            context=context, branch_id=branch_id)
    except HTTPException as e:
        # Nobody else to route it to (e.g. no one holds the approve grant yet):
        # an admin still does it directly, exactly as before the engine.
        if e.status_code != 422 or not is_admin_user(requester) or tt.on_decided is None:
            raise
        direct = ApprovalRequest(workflow_key=key, module_key=tt.module_key, entity_type=tt.entity_type, entity_id=entity_id,
                                 title=title, reference=reference, context=dict(context or {}), status="approved")
        tt.on_decided(db, direct, "approved", requester)
        return direct
    if req.status != "pending":
        return req
    wf = engine.ensure_workflow(db, key)
    if not wf.allow_self_approval:
        return req
    if engine.can_act_on_entity(db, requester, tt.entity_type, entity_id):
        # Same permission the inbox checks: the approval type's feature when it has one.
        holds = (can_feature(requester, tt.module_key, tt.subtab_key, tt.feature_key, "approve") if tt.feature_key
                 else can_perform(requester, tt.module_key, tt.subtab_key, "approve"))
        if not wf.require_permission or holds:
            engine.decide(db, req.id, requester, "approve")
    elif is_admin_user(requester):
        engine.decide(db, req.id, requester, "approve", admin_note)
    return req
