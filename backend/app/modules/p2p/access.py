"""Procurement data scope (app/core/data_scope.py) — the "which records" half
of authorization. Imported by every p2p route module (and the goods-receipt
routes) so the registrations exist before the first request.

    P2PRequest        own = requester · assigned = the buyer · department = the PR's department column
    P2PPurchaseOrder  own = who drafted it · assigned = the buyer of its requisition
    RFQ               own = who started it · assigned = the buyer of its requisition
    P2PGoodsReceipt   (Store › GRN) own = who received it · assigned = who inspected it

None of these has a plant column, so plant / multi-plant scope is the owner's
plant. Approvers always see what they approve: the engine part is built into
data_scope (entity_type), and requisition approvers — PR or PO stage, engine
or the old p2p_request_approvals / p2p_request_po_approvers rows of in-flight
items — are added by pr_scope_expr / ensure_pr_in_scope below.
"""
from __future__ import annotations

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Query, Session

from app.core.data_scope import ensure_in_scope, in_scope, register_scoped, scope_filter
from app.modules.main.models.user import User
from app.modules.p2p.approvals import PO_ENTITY, PR_ENTITY, can_act_now, engine_party_pr_ids
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
from app.modules.p2p.models.p2p_request import ENGINE_SCHEME, P2P_PO_APPROVER_FLAGS, P2PRequest
from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval
from app.modules.p2p.models.p2p_request_po_approver import P2PRequestPOApprover
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.rfq import RFQ


def _bought_by(user):
    return select(P2PRequest.id).where(P2PRequest.assigned_buyer_id == user.id)


register_scoped(
    P2PRequest, "p2p", entity_type=PR_ENTITY, owner=("requested_by_id",), assigned=("assigned_buyer_id",),
    department="department", label="purchase requisition",
)
register_scoped(
    P2PPurchaseOrder, "p2p", entity_type=PO_ENTITY, owner=("created_by_id",),
    assigned=(lambda user: P2PPurchaseOrder.p2p_request_id.in_(_bought_by(user)),), label="purchase order",
)
register_scoped(
    RFQ, "p2p", owner=("created_by_id",), assigned=(lambda user: RFQ.p2p_request_id.in_(_bought_by(user)),), label="RFQ",
)
# GRNs are worked from Store › GRN & Inspection (store:grn permissions), so the
# Store data scope applies. Store's plant access (store/services/plant_access.py)
# still narrows by store location on top of this.
# Plant = the receiving store's plant, so a plant-scoped keeper sees every GRN into their plant.
if not hasattr(P2PGoodsReceipt, "plant_id"):
    from app.modules.store.access import store_plant_column

    P2PGoodsReceipt.plant_id = store_plant_column(P2PGoodsReceipt.store_location_id)
register_scoped(P2PGoodsReceipt, "store", owner=("received_by_id",), assigned=("inspected_by_id",), branch="plant_id",
                label="goods receipt")


def approver_expr(user: User):
    """Requisitions the user approves / approved, whatever the scope says."""
    parts = [
        P2PRequest.id.in_(engine_party_pr_ids(user)),
        # In-flight items from before the engine (old routing tables / columns).
        P2PRequest.approvals.any(P2PRequestApproval.approver_id == user.id),
        P2PRequest.po_approvers.any(P2PRequestPOApprover.approver_id == user.id),
        P2PRequest.approver_id == user.id,
        P2PRequest.project_head_id == user.id,
        P2PRequest.plant_head_id == user.id,
    ]
    if any(getattr(user, flag, False) for flag in P2P_PO_APPROVER_FLAGS):
        # Director / Partner / Purchase Head approve old-scheme POs still in flight.
        parts.append(and_(P2PRequest.status == "po_raised", or_(P2PRequest.approval_scheme.is_(None),
                                                                 P2PRequest.approval_scheme != ENGINE_SCHEME)))
    return or_(*parts)


def pr_scope_expr(db: Session, user: User):
    """SQL filter for the requisitions the user's Procurement data scope covers
    (plus the ones they approve); None = no restriction."""
    expr = scope_filter(db, user, P2PRequest)
    return None if expr is None else or_(expr, approver_expr(user))


def scope_prs(query: Query, db: Session, user: User) -> Query:
    expr = pr_scope_expr(db, user)
    return query if expr is None else query.filter(expr)


def ensure_pr_in_scope(db: Session, user: User, pr: P2PRequest) -> None:
    """403 with the user's scope when the requisition is outside it (approvers,
    their delegates and escalation targets always pass)."""
    if pr is None or in_scope(db, user, pr):
        return
    if db.query(P2PRequest.id).filter(P2PRequest.id == pr.id, approver_expr(user)).first() is not None:
        return
    if can_act_now(db, user, pr):
        return
    ensure_in_scope(db, user, pr)
