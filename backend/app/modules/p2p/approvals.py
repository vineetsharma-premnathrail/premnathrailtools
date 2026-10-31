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

from app.core.priority import PRIORITIES, PRIORITY_LABELS
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest, ApprovalRequestStep, ApprovalWorkflow
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.p2p.models.p2p_request import (
    ENGINE_SCHEME, LINE_CATEGORY, P2P_CATEGORIES, P2P_PROJECT_TYPES, P2P_PURPOSES, P2P_REQUIREMENT_TYPES, P2PRequest,
)
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.po_split import live_pos

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
    "project_type": {"label": "Project type", "type": "choice", "choices": list(P2P_PROJECT_TYPES),
                     "choice_labels": {"existing": "Existing project", "new": "New project"}},
    "purpose": {"label": "Purpose", "type": "choice", "choices": list(P2P_PURPOSES), "choice_labels": dict(P2P_PURPOSES)},
    "category_code": {"label": "Category", "type": "choice", "choices": [c for c in P2P_CATEGORIES if c != LINE_CATEGORY],
                      "choice_labels": {k: f"{v} ({k})" for k, v in P2P_CATEGORIES.items()}},
    # The project manager of the project a production requisition is
    # for (picked on the project) — a "Person named on the record" stage with
    # an "Applies when: Purpose = Production" condition.
    "project_manager_id": {"label": "Project manager (of the project)", "type": "user",
                           "missing": "Project {ref} has no project manager — pick one on the project "
                                      "(Project Management › All Projects), then submit again.",
                           "missing_ref": "order_project_ref"},
    "priority": {"label": "Priority", "type": "choice", "choices": list(PRIORITIES),
                 "choice_labels": dict(PRIORITY_LABELS)},
    "requirement_type": {"label": "Requirement type", "type": "choice", "choices": list(P2P_REQUIREMENT_TYPES),
                         "choice_labels": {t: t for t in P2P_REQUIREMENT_TYPES}},
    "department": {"label": "Requester's department", "type": "text"},
}
_PO_CONTEXT_FIELDS = {
    **_PR_CONTEXT_FIELDS,
    "vendor_name": {"label": "Vendor", "type": "text"},
}


def _condition_category(pr: P2PRequest) -> str | None:
    """The category approval conditions see. A requisition from the PR form has
    no category of its own (LINE_CATEGORY, 2026-10-27): it is judged by its
    purpose's usual category (Procurement › Settings › Purpose rules), so a
    stage such as "Category = Capital Equipment" still applies to it."""
    if pr.category_code != LINE_CATEGORY:
        return pr.category_code
    from sqlalchemy.orm import object_session

    from app.modules.p2p.purpose import resolve_purpose_rules
    rules = resolve_purpose_rules(object_session(pr)).get(pr.purpose or "")
    return (rules or {}).get("category") or pr.category_code


def _pr_context(pr: P2PRequest) -> dict:
    ctx = {
        "project_type": pr.project_type, "purpose": pr.purpose, "category_code": _condition_category(pr), "priority": pr.priority,
        "requirement_type": pr.requirement_type, "department": pr.department, "project_manager_id": None,
    }
    if pr.order_project_id:
        from sqlalchemy.orm import object_session

        from app.modules.projects.models.project import PmProject
        op = object_session(pr).get(PmProject, pr.order_project_id)
        if op is not None:
            ctx["project_manager_id"] = op.project_manager_id
            ctx["order_project_ref"] = op.project_code
    return ctx


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
    """A PO's own approval request finished. Each PO has its own approval and a
    decision changes ONLY that PO (multi-buyer split, 2026-10-31): a rejection
    cancels just that PO and frees its quantity, a return puts just that PO back
    to draft, an approval releases just that PO. The requisition is never
    rejected or returned by a PO decision; its header status is rolled up from
    all its POs afterwards."""
    po = db.get(P2PPurchaseOrder, req.entity_id)
    pr = db.get(P2PRequest, po.p2p_request_id) if po is not None and po.p2p_request_id else None
    if po is None or pr is None:
        return
    if po.status != "issued":
        return  # e.g. the PO itself is being cancelled or withdrawn — its route sets the status
    _split_po_decided(db, req, outcome, actor, pr, po)


def _split_po_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User, pr: P2PRequest, po: P2PPurchaseOrder) -> None:
    """One PO decided: only that PO changes (a rejection cancels just it and
    frees its PR quantity for another PO; the award stays so the buyer can
    re-upload); the requisition's status is then rolled up from all its POs."""
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
        from app.modules.p2p.pre_po import reopen_receipt_for_cancelled_po
        reopen_receipt_for_cancelled_po(db, po, actor)
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
    if outcome != "approved":
        _tell_po_buyer_and_requester(db, pr, po, actor, outcome, comment)


def _tell_po_buyer_and_requester(db: Session, pr: P2PRequest, po: P2PPurchaseOrder, actor: User,
                                 outcome: str, comment: str | None) -> None:
    """A PO rejected / returned: its buyer (the RFQ's buyer, else whoever uploaded it) and the
    requester get a bell with the reason — the generic decision notice carries no reason and
    skips the requester. Bell only, never Teams."""
    from app.modules.p2p.models.rfq import RFQ
    from app.utils.notifications import notify_user

    rfq = db.get(RFQ, po.rfq_id) if po.rfq_id else None
    buyer_id = (rfq.buyer_id if rfq else None) or po.created_by_id
    who = actor.name or actor.email
    if outcome == "rejected":
        what, nxt = "rejected", "It is cancelled; its quantity is back with the buyer to upload a PO again or pick another vendor."
    else:
        what, nxt = "returned for changes", "It is back in draft with its buyer."
    why = f" Reason: {comment}" if comment else ""
    for uid in {buyer_id, pr.requested_by_id} - {None, actor.id}:
        notify_user(db, uid, title=f"PO {po.po_number} {what}",
                    message=f"{who} {what} PO {po.po_number} on {pr.p2p_number}.{why} {nxt}",
                    notification_type="p2p_po_" + ("rejected" if outcome == "rejected" else "returned"),
                    entity_type="p2p_request", entity_id=pr.id)


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
    """Send a PO into approval (PO → issued; the requisition's header status is
    rolled up from all its POs, so it shows po_raised while this one waits).
    Each PO has its own approval request. Flushes, never commits."""
    from app.modules.p2p.purpose import check_po_charge
    check_po_charge(db, pr, po)
    seed_workflows(db)
    pr.approval_scheme = ENGINE_SCHEME
    po.status = "issued"
    db.flush()
    title = f"Purchase order {po.po_number}" + (f" — {po.vendor_name}" if po.vendor_name else "") + f" ({pr.p2p_number})"
    from app.modules.p2p.pre_po import qty_raised_lines
    raised = qty_raised_lines(db, po)
    if raised:
        title += f" — qty raised above requisition on {raised} line(s)"
    req = engine.submit(
        db, PO_KEY, entity_id=po.id, requester=submitter, title=title, reference=po.po_number,
        amount=po.total_value, context={**_pr_context(pr), "vendor_name": po.vendor_name, "qty_above_requisition": bool(raised)},
        branch_id=getattr(submitter, "branch_id", None),
    )
    # Header status = roll-up of every PO (this one now waits for approval). Run after the
    # request exists: a PO without a request would look "released" to the legacy rule.
    from app.modules.p2p import po_split
    db.flush()
    po_split.rollup_pr_status(db, pr, submitter.id, force=True)
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


def pending_po_requests(db: Session, pr_id: int) -> list[tuple[P2PPurchaseOrder, ApprovalRequest]]:
    """(PO, its pending approval request) for every live PO of the requisition
    that is waiting for a decision, oldest PO first. A requisition can have
    several at once (one per buyer / vendor), each decided on its own."""
    pos = live_pos(db, pr_id)
    if not pos:
        return []
    by_po: dict[int, ApprovalRequest] = {}
    reqs = (db.query(ApprovalRequest)
            .filter(ApprovalRequest.entity_type == PO_ENTITY, ApprovalRequest.entity_id.in_([p.id for p in pos]))
            .order_by(ApprovalRequest.id).all())
    for r in reqs:  # ascending id: the latest request of a PO wins
        by_po[r.entity_id] = r
    return [(p, by_po[p.id]) for p in pos if p.id in by_po and by_po[p.id].status == "pending"]


def po_request(db: Session, pr_id: int) -> tuple[P2PPurchaseOrder | None, ApprovalRequest | None]:
    """The PR's PO approval to show: a live PO waiting for approval (the newest),
    else the most recent PO that went through the engine, with its latest request."""
    pending = pending_po_requests(db, pr_id)
    if pending:
        return pending[-1]
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
    page: the PR approval while it is submitted / returned; afterwards the PO
    approval — with several POs waiting, the one the viewer can decide (else the
    first waiting), otherwise the latest PO request, else the PR's."""
    pr_req = pr_request(db, pr.id)
    pending_pos = pending_po_requests(db, pr.id)
    po, po_req = None, None
    if pr.status in ("submitted", "returned"):
        req = pr_req
    else:
        if pending_pos:
            po, po_req = pending_pos[-1]
            if user is not None:
                for cand_po, cand_req in pending_pos:
                    out = engine.request_out(db, cand_req, user)
                    if out.get("can_decide"):
                        po, po_req = cand_po, cand_req
                        break
        else:
            po, po_req = po_request(db, pr.id)
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
        "po_id": po.id if po_req is not None and po is not None and req is po_req else None,
        # Every PO of the requisition waiting for approval, so the page can list them all.
        "pending_po_ids": [p.id for p, _ in pending_pos],
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
    """Delegate / escalation target / approver of the live PR step or of any live
    PO waiting for approval."""
    if engine.can_act_on_entity(db, user, PR_ENTITY, pr.id):
        return True
    return any(engine.can_act_on_entity(db, user, PO_ENTITY, po.id) for po, _ in pending_po_requests(db, pr.id))


def is_approver_user(db: Session, user: User) -> tuple[bool, bool]:
    """(is_pr_approver, is_po_approver) through the engine — someone with an
    approval step (any time) on a requisition / PO, or a current delegate."""
    pr = db.execute(pr_engine_party_pr_ids(user).limit(1)).first() is not None
    po = db.execute(po_engine_party_pr_ids(user).limit(1)).first() is not None
    return pr, po
