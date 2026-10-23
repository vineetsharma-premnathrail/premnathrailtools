"""Procurement approvals on the central approval engine
(Organization › Approval Workflows — app/modules/organization/services/approval_engine.py).

Two transaction types:

    p2p.purchase_requisition   entity p2p_request        (P2PRequest.id)       tab purchase_requisitions
    p2p.purchase_order         entity p2p_purchase_order (P2PPurchaseOrder.id) tab purchase_orders

Default routing = the Procurement › Settings scheme that was in force before
the move (2026-10-07):

    PR: every Settings "PR approver" approves (all must).
    PO: every Settings "PO approver (level 1)" approves (all must), then ANY ONE
        Partner (Organization › Company Info › Partners) gives the final approval;
        someone who approved at level 1 can't also be that Partner.

The stored workflows are created from the values those settings still hold —
by `migrate_p2p_approval_workflows` at deploy, or lazily on the first
submission (`seed_workflows`) — so nothing changes for users on cut-over day.
From then on the admin edits the stages in Organization › Approval Workflows;
the static StageDefs registered below are only what "Reset to default" gives.

Approvers decide through the central /approvals endpoints (ApprovalPanel) or
the module's compatibility endpoints (/p2p/requests/{id}/approve, /approve-po,
/reject), which just call engine.decide.

In-flight items at cut-over: a requisition or PO that entered approval before
the move has no engine request (engine.latest_request is None) and finishes on
the old code path in routes/p2p_requests.py (tables p2p_request_approvals /
p2p_request_po_approvers, which stay readable as history). Every NEW submission
— whatever the requisition's old approval_scheme (settings / matrix / legacy
heads) — goes through the engine and marks the requisition
approval_scheme = "engine".
"""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest, ApprovalRequestStep, ApprovalWorkflow
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.p2p.models.p2p_request import (
    ENGINE_SCHEME, P2P_CATEGORIES, P2P_PROJECT_TYPES, P2P_PURPOSES, P2P_REQUEST_PRIORITIES, P2P_REQUIREMENT_TYPES, P2PRequest,
)
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

logger = logging.getLogger(__name__)

PR_KEY = "p2p.purchase_requisition"
PO_KEY = "p2p.purchase_order"
PR_ENTITY = "p2p_request"
PO_ENTITY = "p2p_purchase_order"


# ── Background work from inside on_decided ───────────────────────────────

class _AfterDecisionTasks:
    """Stand-in for FastAPI BackgroundTasks inside on_decided: the decision may
    arrive through the central /approvals endpoint, which has no
    BackgroundTasks for this module, so the notification rule's emails are sent
    from a short-lived thread instead (fire_rule only adds the task)."""

    def add_task(self, fn, *args, **kwargs) -> None:
        def _run() -> None:
            try:
                result = fn(*args, **kwargs)
                if asyncio.iscoroutine(result):
                    asyncio.run(result)
            except Exception:  # an email must never break an approval
                logger.exception("Procurement notification email failed")

        threading.Thread(target=_run, daemon=True).start()


def _fire(db: Session, event: str, title: str, message: str, pr: P2PRequest, actor: User) -> None:
    from app.core.notify_rules import fire_rule
    from app.modules.p2p.routes.p2p_requests import _pr_details

    fire_rule(db, _AfterDecisionTasks(), "p2p", event, title, message, PR_ENTITY, pr.id, actor, _pr_details(pr, actor))


# ── Context the admin's stage conditions can test ────────────────────────

_PR_CONTEXT_FIELDS = {
    "project_type": {"label": "Project type", "type": "choice", "choices": list(P2P_PROJECT_TYPES)},
    "purpose": {"label": "Purpose", "type": "choice", "choices": list(P2P_PURPOSES)},
    "category_code": {"label": "Category", "type": "choice", "choices": list(P2P_CATEGORIES)},
    "priority": {"label": "Priority", "type": "choice", "choices": list(P2P_REQUEST_PRIORITIES)},
    "requirement_type": {"label": "Requirement type", "type": "choice", "choices": list(P2P_REQUIREMENT_TYPES)},
    "department": {"label": "Requester's department", "type": "text"},
}
_PO_CONTEXT_FIELDS = {
    **_PR_CONTEXT_FIELDS,
    "vendor_name": {"label": "Vendor", "type": "text"},
}


def _pr_context(pr: P2PRequest) -> dict:
    return {
        "project_type": pr.project_type, "purpose": pr.purpose, "category_code": pr.category_code, "priority": pr.priority,
        "requirement_type": pr.requirement_type, "department": pr.department,
    }


# ── Decision handlers ────────────────────────────────────────────────────

def _deciding_step(req: ApprovalRequest) -> ApprovalRequestStep | None:
    """The step decided last (the one that finished the request)."""
    def _at(s: ApprovalRequestStep) -> datetime:
        # Rows read back from the DB may be naive; the one just decided is aware.
        return s.decided_at if s.decided_at.tzinfo else s.decided_at.replace(tzinfo=timezone.utc)

    decided = [s for s in req.steps if s.decided_at is not None]
    return max(decided, key=lambda s: (_at(s), s.id or 0)) if decided else None


def _pr_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.p2p.routes.p2p_requests import _route_lines_on_approval, _write_audit

    pr = db.get(P2PRequest, req.entity_id)
    if pr is None or pr.status != "submitted":
        return  # e.g. the requisition itself is being cancelled — its route sets the status
    who = actor.name or actor.email
    step = _deciding_step(req)
    comment = step.comment if step else None
    if outcome == "approved":
        pr.status = "approved"
        pr.approved_by_id = actor.id
        pr.approved_at = datetime.now(timezone.utc)
        _write_audit(db, pr.id, "approved", actor, summary=f"{pr.p2p_number} got its final approval ({who}).",
                     old_status="submitted", new_status="approved")
        # Stock may have moved since creation — re-check and auto-route the
        # lines (out of stock → procurement; in stock → buyer issues it).
        _route_lines_on_approval(db, pr, actor)
        _fire(db, "pr_approved", "Purchase Requisition Approved",
              f"PR '{pr.p2p_number}' got its final approval from {who}.", pr, actor)
    elif outcome == "rejected":
        pr.status = "rejected"
        pr.rejected_reason = comment
        pr.rejected_by_role = (step.stage_name if step else "approver")[:30]
        pr.rejected_by_name = who
        note = f" Reason: {comment}" if comment else ""
        _write_audit(db, pr.id, "rejected", actor, summary=f"{who} rejected P2P request {pr.p2p_number}.{note}",
                     old_status="submitted", new_status="rejected")
        _fire(db, "pr_rejected", "Purchase Requisition Rejected", f"PR '{pr.p2p_number}' was rejected by {who}.{note}", pr, actor)
    else:  # returned for changes, or the requester withdrew it
        pr.status = "returned"
        what = "returned it for changes" if outcome == "returned" else "withdrew it from approval"
        note = f" Comment: {comment}" if outcome == "returned" and comment else ""
        _write_audit(db, pr.id, "returned", actor, summary=f"{who} {what} ({pr.p2p_number}).{note}",
                     old_status="submitted", new_status="returned")
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.pr_decided(db, _AfterDecisionTasks(), pr, actor, outcome, comment)


def _po_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.p2p.routes.p2p_requests import _cancel_linked_pos, _write_audit

    from app.modules.p2p import po_split
    from app.modules.p2p.info_records import upsert_from_po

    po = db.get(P2PPurchaseOrder, req.entity_id)
    pr = db.get(P2PRequest, po.p2p_request_id) if po is not None and po.p2p_request_id else None
    if po is None or pr is None:
        return
    # ME21N split (2026-10-14): with several POs on one PR, each PO is decided
    # on its own and the PR's status is rolled up from all of them.
    if len(po_split.live_pos(db, pr.id)) > 1:
        if po.status != "issued":
            return
        _split_po_decided(db, req, outcome, actor, pr, po)
        return
    if pr.status != "po_raised":
        return
    who = actor.name or actor.email
    step = _deciding_step(req)
    comment = step.comment if step else None
    now = datetime.now(timezone.utc)
    if outcome == "approved":
        # ME11: the released price becomes the vendor + item info record price.
        upsert_from_po(db, po)
        pr.status = "po_approved"
        pr.po_approved_at = now
        pr.po_approved_by_id = actor.id
        pr.po_approved_by_name = who
        pr.po_approved_role = step.stage_name[:30] if step else None
        pr.po_approval_comment = comment
        _write_audit(db, pr.id, "po_fully_approved", actor,
                     summary=f"PO '{po.po_number}' for {pr.p2p_number} got its final approval ({who}).",
                     old_status="po_raised", new_status="po_approved")
        _fire(db, "po_approved", "Purchase Order Approved",
              f"The PO '{po.po_number}' for PR '{pr.p2p_number}' got its final approval from {who}.", pr, actor)
    elif outcome == "rejected":
        note = f" Reason: {comment}" if comment else ""
        pr.status = "rejected"
        pr.rejected_reason = comment
        pr.rejected_by_role = (step.stage_name if step else "po_approver")[:30]
        pr.rejected_by_name = who
        _write_audit(db, pr.id, "rejected", actor, summary=f"{who} rejected the PO '{po.po_number}' of {pr.p2p_number}.{note}",
                     old_status="po_raised", new_status="rejected")
        # Rejecting at PO approval kills the PO too — otherwise it stays
        # 'issued' in PO Tracking forever against a terminal PR (C-43).
        _cancel_linked_pos(db, pr, actor, f"the PO was rejected at approval.{note}")
        _fire(db, "pr_rejected", "Purchase Requisition Rejected",
              f"PR '{pr.p2p_number}' was rejected by {who} at PO approval.{note}", pr, actor)
    else:  # returned for changes / withdrawn: the PO goes back to an editable draft
        po.status = "draft"
        pr.status = "po_drafted"
        what = "returned the PO for changes" if outcome == "returned" else "withdrew the PO from approval"
        note = f" Comment: {comment}" if outcome == "returned" and comment else ""
        _write_audit(db, pr.id, "po_returned", actor, summary=f"{who} {what} ('{po.po_number}', {pr.p2p_number}).{note}",
                     old_status="po_raised", new_status="po_drafted")
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.po_decided(db, _AfterDecisionTasks(), pr, po, actor, outcome, comment, req.requester_id)


def _split_po_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User, pr: P2PRequest, po: P2PPurchaseOrder) -> None:
    """One PO of a split requisition decided: only that PO changes (a
    rejection cancels just it and frees its PR quantity for another PO); the
    requisition's status is then rolled up from all its POs."""
    from app.modules.p2p import po_split
    from app.modules.p2p.info_records import upsert_from_po
    from app.modules.p2p.routes.p2p_requests import _write_audit

    who = actor.name or actor.email
    step = _deciding_step(req)
    comment = step.comment if step else None
    note = f" Comment: {comment}" if comment else ""
    if outcome == "approved":
        upsert_from_po(db, po)
        pr.po_approved_at = datetime.now(timezone.utc)
        pr.po_approved_by_id = actor.id
        pr.po_approved_by_name = who
        pr.po_approved_role = step.stage_name[:30] if step else None
        pr.po_approval_comment = comment
        _write_audit(db, pr.id, "po_fully_approved", actor, summary=f"PO '{po.po_number}' for {pr.p2p_number} got its final approval ({who}).")
        _fire(db, "po_approved", "Purchase Order Approved",
              f"The PO '{po.po_number}' for PR '{pr.p2p_number}' got its final approval from {who}.", pr, actor)
    elif outcome == "rejected":
        po.status = "cancelled"
        _write_audit(db, pr.id, "po_cancelled", actor,
                     summary=f"{who} rejected PO '{po.po_number}' of {pr.p2p_number}; it is cancelled and its lines can go on another PO.{note}",
                     old_status="issued", new_status="cancelled")
    else:
        po.status = "draft"
        what = "returned the PO for changes" if outcome == "returned" else "withdrew the PO from approval"
        _write_audit(db, pr.id, "po_returned", actor, summary=f"{who} {what} ('{po.po_number}', {pr.p2p_number}).{note}")
    db.flush()
    po_split.rollup_pr_status(db, pr, actor.id, force=True)
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.po_decided(db, _AfterDecisionTasks(), pr, po, actor, outcome, comment, req.requester_id)


register_transaction(TransactionType(
    key=PR_KEY, module_key="p2p", subtab_key="purchase_requisitions", label="Purchase requisition",
    entity_type=PR_ENTITY, url="/dashboard/p2p/{id}?from=approval",
    description="A purchase requisition raised in Procurement (or imported). Until 2026-10-08 the approvers were "
                "the 'PR approvers' in Procurement › Settings, every one of whom had to approve.",
    context_fields=_PR_CONTEXT_FIELDS,
    # Only what "Reset to default" gives once the old Settings list is gone —
    # the live workflow is seeded from Settings (seed_workflows).
    default_stages=[StageDef("PR approvers", "permission", {"permission": "p2p:purchase_requisitions:approve"})],
    # Named approvers approve with 'View' only (RBAC 2026-10-08), and a Settings
    # PR approver could sign their own requisition — kept as the default.
    require_permission=False, allow_self_approval=True, distinct_approvers=False,
    # Approver's comment is mandatory (2026-09-30) — it goes on the approval trail.
    comment_required_on_approve=True,
    on_decided=_pr_decided,
))

register_transaction(TransactionType(
    key=PO_KEY, module_key="p2p", subtab_key="purchase_orders", label="Purchase order",
    entity_type=PO_ENTITY, url="/dashboard/p2p/purchase-orders/{id}",
    description="A purchase order sent for approval (RFQ › PO draft › Submit). Until 2026-10-08: every Settings "
                "'PO approver (level 1)', then any one Partner.",
    context_fields=_PO_CONTEXT_FIELDS,
    default_stages=[StageDef("Partner (final approval)", "partner")],
    # One person can't fill both levels, and the buyer who sends the PO can't
    # approve it themselves (segregation of duties).
    require_permission=False, allow_self_approval=False, distinct_approvers=True,
    # Approver's comment is mandatory (2026-09-30) — it goes on the approval trail.
    comment_required_on_approve=True,
    on_decided=_po_decided,
))


# ── Seeding the workflows from the old Procurement › Settings ────────────

def _legacy_setting_user_ids(db: Session, key: str) -> list[int]:
    """Active user ids still stored under a removed Procurement setting
    (pr_approvers / po_approvers), read straight from module_settings."""
    from app.modules.main.models.module_setting import ModuleSetting

    row = (
        db.query(ModuleSetting)
        .filter(ModuleSetting.module_key == "p2p", ModuleSetting.key == key, ModuleSetting.branch_id.is_(None))
        .first()
    )
    ids = [i for i in (row.value if row is not None and isinstance(row.value, list) else []) if isinstance(i, int)]
    if not ids:
        return []
    active = {u.id for u in db.query(User.id).filter(User.id.in_(ids), User.is_active.is_(True)).all()}
    return [i for i in dict.fromkeys(ids) if i in active]


def _stages_from_settings(db: Session, key: str) -> list[StageDef] | None:
    if key == PR_KEY:
        ids = _legacy_setting_user_ids(db, "pr_approvers")
        return [StageDef("PR approvers", "specific_users", {"user_ids": ids}, approval_mode="all")] if ids else None
    ids = _legacy_setting_user_ids(db, "po_approvers")
    level1 = [StageDef("PO approvers", "specific_users", {"user_ids": ids}, approval_mode="all")] if ids else []
    return level1 + [StageDef("Partner (final approval)", "partner")]


def seed_workflows(db: Session) -> None:
    """Create the stored Procurement workflows from the old Settings approver
    lists if they don't exist yet. Flushes, never commits."""
    for key in (PR_KEY, PO_KEY):
        if db.query(ApprovalWorkflow.id).filter(ApprovalWorkflow.key == key).first() is not None:
            continue
        tt = engine.get_type(key)
        stages = _stages_from_settings(db, key)
        static = tt.default_stages
        if stages:
            tt.default_stages = stages
        try:
            engine.ensure_workflow(db, key)
        finally:
            tt.default_stages = static


def migrate_p2p_approval_workflows(bind) -> None:
    """Data migration for the combined central-authorization migration: turn
    Procurement › Settings pr_approvers / po_approvers into the stored
    approval workflows p2p.purchase_requisition / p2p.purchase_order (only if
    an admin hasn't created them already). Safe to run more than once."""
    from sqlalchemy.orm import Session as _Session

    session = _Session(bind=bind)
    try:
        seed_workflows(session)
        session.commit()
    finally:
        session.close()


# ── Submit ───────────────────────────────────────────────────────────────

def submit_pr(db: Session, pr: P2PRequest, requester: User) -> ApprovalRequest:
    """Send a requisition into approval. If the workflow is off (or no stage
    applies) it is approved at once. Raises 422 with the reason when a stage
    has nobody to approve. Flushes, never commits."""
    seed_workflows(db)
    pr.approval_scheme = ENGINE_SCHEME
    pr.status = "submitted"
    db.flush()
    title = f"Purchase requisition {pr.p2p_number}" + (f" — {pr.project_label}" if pr.project_label else "")
    req = engine.submit(
        db, PR_KEY, entity_id=pr.id, requester=requester, title=title, reference=pr.p2p_number,
        amount=None, context=_pr_context(pr), branch_id=getattr(requester, "branch_id", None),
    )
    # Role event for the people who follow requisitions; the engine already told the approvers.
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.pr_submitted(db, _AfterDecisionTasks(), pr, requester, req)
    return req


def submit_po(db: Session, pr: P2PRequest, po: P2PPurchaseOrder, submitter: User) -> ApprovalRequest:
    """Send a PO into approval (PR → po_raised, PO → issued). Flushes, never commits."""
    seed_workflows(db)
    pr.approval_scheme = ENGINE_SCHEME
    po.status = "issued"
    pr.status = "po_raised"
    db.flush()
    title = f"Purchase order {po.po_number}" + (f" — {po.vendor_name}" if po.vendor_name else "") + f" ({pr.p2p_number})"
    req = engine.submit(
        db, PO_KEY, entity_id=po.id, requester=submitter, title=title, reference=po.po_number,
        amount=po.total_value, context={**_pr_context(pr), "vendor_name": po.vendor_name},
        branch_id=getattr(submitter, "branch_id", None),
    )
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.po_submitted(db, _AfterDecisionTasks(), pr, po, submitter, req)
    return req


# ── Read helpers ─────────────────────────────────────────────────────────

def pr_request(db: Session, pr_id: int) -> ApprovalRequest | None:
    return engine.latest_request(db, PR_ENTITY, pr_id)


def latest_po(db: Session, pr_id: int, *, live_only: bool = True) -> P2PPurchaseOrder | None:
    q = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.p2p_request_id == pr_id)
    if live_only:
        q = q.filter(P2PPurchaseOrder.status != "cancelled")
    return q.order_by(P2PPurchaseOrder.id.desc()).first()


def po_request(db: Session, pr_id: int) -> tuple[P2PPurchaseOrder | None, ApprovalRequest | None]:
    """The PR's most recent PO that went through the engine, and its latest request."""
    pos = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.p2p_request_id == pr_id).order_by(P2PPurchaseOrder.id.desc()).all()
    for po in pos:
        req = engine.latest_request(db, PO_ENTITY, po.id)
        if req is not None:
            return po, req
    return (pos[0] if pos else None), None


def pending_approvers(db: Session, req: ApprovalRequest | None) -> list[tuple[User, str]]:
    """(approver, stage name) for every slot of the request's current stage."""
    if req is None or req.status != "pending":
        return []
    out = []
    for s in req.steps:
        if s.sequence == req.current_sequence and s.status == "pending" and s.approver is not None:
            out.append((s.approver, s.stage_name))
    return out


def approval_info(db: Session, pr: P2PRequest, user: User | None) -> dict | None:
    """The engine approval this requisition is at, for lists and the detail
    page: the PR approval while it is submitted / returned, the PO approval
    while the PO is out for approval, otherwise the latest of the two."""
    pr_req = pr_request(db, pr.id)
    po, po_req = po_request(db, pr.id)
    if pr.status in ("submitted", "returned"):
        req = pr_req
    elif pr.status in ("po_raised", "po_drafted"):
        req = po_req or pr_req
    else:
        req = po_req or pr_req
    if req is None:
        return None
    out = engine.request_out(db, req, user)
    waiting = pending_approvers(db, req)
    return {
        "request_id": req.id, "entity_type": req.entity_type, "entity_id": req.entity_id, "status": req.status,
        "stage": waiting[0][1] if waiting else None,
        "waiting_on": [u.name or u.email for u, _ in waiting],
        "can_decide": bool(out.get("can_decide")), "can_stand_in": bool(out.get("can_stand_in")),
        "pr_request_id": pr_req.id if pr_req else None,
        "po_id": po.id if po_req is not None and po is not None else None,
    }


def engine_party_pr_ids(user: User):
    """SELECT of requisition ids the user approves (or approved) through the
    engine — on the requisition itself or on one of its POs."""
    def _steps(entity_type: str):
        return (
            select(ApprovalRequest.entity_id)
            .join(ApprovalRequestStep, ApprovalRequestStep.request_id == ApprovalRequest.id)
            .where(ApprovalRequest.entity_type == entity_type,
                   or_(ApprovalRequestStep.approver_id == user.id, ApprovalRequestStep.decided_by_id == user.id))
        )

    po_prs = select(P2PPurchaseOrder.p2p_request_id).where(P2PPurchaseOrder.id.in_(_steps(PO_ENTITY)))
    return select(P2PRequest.id).where(or_(P2PRequest.id.in_(_steps(PR_ENTITY)), P2PRequest.id.in_(po_prs)))


def po_engine_party_pr_ids(user: User):
    """Requisition ids whose PO the user approves (or approved) through the engine."""
    steps = (
        select(ApprovalRequest.entity_id)
        .join(ApprovalRequestStep, ApprovalRequestStep.request_id == ApprovalRequest.id)
        .where(ApprovalRequest.entity_type == PO_ENTITY,
               or_(ApprovalRequestStep.approver_id == user.id, ApprovalRequestStep.decided_by_id == user.id))
    )
    return select(P2PPurchaseOrder.p2p_request_id).where(P2PPurchaseOrder.id.in_(steps))


def pr_engine_party_pr_ids(user: User):
    """Requisition ids the user approves (or approved) at PR stage through the engine."""
    return (
        select(ApprovalRequest.entity_id)
        .join(ApprovalRequestStep, ApprovalRequestStep.request_id == ApprovalRequest.id)
        .where(ApprovalRequest.entity_type == PR_ENTITY,
               or_(ApprovalRequestStep.approver_id == user.id, ApprovalRequestStep.decided_by_id == user.id))
    )


def can_act_now(db: Session, user: User, pr: P2PRequest) -> bool:
    """Delegate / escalation target / approver of the live PR or PO step."""
    if engine.can_act_on_entity(db, user, PR_ENTITY, pr.id):
        return True
    po, req = po_request(db, pr.id)
    return bool(po is not None and req is not None and engine.can_act_on_entity(db, user, PO_ENTITY, po.id))


def is_approver_user(db: Session, user: User) -> tuple[bool, bool]:
    """(is_pr_approver, is_po_approver) through the engine — someone with an
    approval step (any time) on a requisition / PO, or a current delegate."""
    pr = db.execute(pr_engine_party_pr_ids(user).limit(1)).first() is not None
    po = db.execute(po_engine_party_pr_ids(user).limit(1)).first() is not None
    return pr, po
