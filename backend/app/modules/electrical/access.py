"""Electrical on the central authorization framework.

Data scope (app/core/data_scope.py), module key "electrical":
  - Electrical jobs are the one top-level record. own = created by me;
    assigned = I'm the lead engineer or own one of the job's stages;
    plant = the job's plant (branch_id).
  - Everything else (drawings + revisions, BOM lines, cables, panels, tests,
    issues, documents) is a child of a job: list endpoints keep only rows of
    jobs in scope (`scoped_job_ids`) and record endpoints check the parent
    job (`get_scoped_job` / `ensure_job_in_scope`).
  - Someone who is (or was) an approver of a drawing revision / BOM line of a
    job may open that job even outside their scope, so they can see what
    they approve.

Approvals (central engine, Organization › Approval Workflows):
  - electrical.drawing_revision — a drawing revision submitted for approval
    (draft → submitted → approved / rejected; "return" sends it back to
    draft). Default stage: holders of electrical:drawings:approve, any one,
    never the submitter (four-eyes, as before).
  - electrical.bom_selection — approving a BOM line's component selection
    (make + part number). Default stage: holders of electrical:jobs:approve
    (the old `_require_approver` rule). Before the engine an approver marked
    a line approved in one step, so the submitter may approve their own
    request (allow_self_approval) and an approver's direct "approved" edit
    submits + approves at once (`submit_and_approve`).

In-flight items: a revision already 'submitted' before the cut-over has no
engine request; the old /approve and /reject routes decide it with the old
rules (`latest_request` is None). There were no pending BOM approvals before
(approval was a one-step edit), so nothing needs migrating.

When nobody but the submitter / admins holds the approve permission (and the
workflow is still permission-based), the engine can't route the request; the
record then goes the pre-engine way (submitted for an admin to approve via
the old route, or approved directly by an approving user) instead of failing.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope, register_scoped, scope_filter
from app.core.permission_registry import can_perform, is_admin_user
from app.modules.electrical.models.bom import ElectricalBomItem
from app.modules.electrical.models.drawing import ElectricalDrawing, ElectricalDrawingRevision
from app.modules.electrical.models.job import ElectricalJob, ElectricalJobStage, ELECTRICAL_WORKING_STATUSES
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest, ApprovalRequestStep
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.utils.notifications import notify_user

MODULE = "electrical"
REVISION_KEY = "electrical.drawing_revision"
REVISION_ENTITY = "electrical_drawing_revision"
BOM_KEY = "electrical.bom_selection"
BOM_ENTITY = "electrical_bom_item"
APPROVAL_URL = "/dashboard/electrical/approval/{entity}/{{id}}"


# ── Data scope ───────────────────────────────────────────────────────────

def _jobs_with_my_stages(user):
    return ElectricalJob.id.in_(select(ElectricalJobStage.job_id).where(ElectricalJobStage.assignee_id == user.id))


register_scoped(ElectricalJob, MODULE, owner=("created_by_id",), assigned=("lead_engineer_id", _jobs_with_my_stages),
                branch="branch_id", label="electrical job")


def _approver_job_expr(user):
    """Jobs on which the user is / was an approver of a revision or BOM line."""
    def requests(entity_type):
        return (
            select(ApprovalRequest.entity_id)
            .join(ApprovalRequestStep, ApprovalRequestStep.request_id == ApprovalRequest.id)
            .where(ApprovalRequest.entity_type == entity_type,
                   or_(ApprovalRequestStep.approver_id == user.id, ApprovalRequestStep.decided_by_id == user.id))
        )
    via_revision = (
        select(ElectricalDrawing.job_id)
        .join(ElectricalDrawingRevision, ElectricalDrawingRevision.drawing_id == ElectricalDrawing.id)
        .where(ElectricalDrawingRevision.id.in_(requests(REVISION_ENTITY)))
    )
    via_bom = select(ElectricalBomItem.job_id).where(ElectricalBomItem.id.in_(requests(BOM_ENTITY)))
    return or_(ElectricalJob.id.in_(via_revision), ElectricalJob.id.in_(via_bom))


def job_scope_expr(db: Session, user):
    """SQL filter on ElectricalJob for the user's scope; None = everything."""
    expr = scope_filter(db, user, ElectricalJob)
    return None if expr is None else or_(expr, _approver_job_expr(user))


def scope_jobs(query, db: Session, user):
    expr = job_scope_expr(db, user)
    return query if expr is None else query.filter(expr)


def scoped_job_ids(db: Session, user):
    """Sub-select of job ids in scope (for child lists), or None = all."""
    expr = job_scope_expr(db, user)
    return None if expr is None else select(ElectricalJob.id).where(expr)


def ensure_job_in_scope(db: Session, user, job: ElectricalJob) -> None:
    expr = job_scope_expr(db, user)
    if expr is None or db.query(ElectricalJob.id).filter(ElectricalJob.id == job.id, expr).first():
        return
    ensure_in_scope(db, user, job)  # raises 403 with the user's scope in the message


# ── Role-based notifications (app/core/events/electrical.py) ─────────────

def notify_job_event(db: Session, background_tasks, event: str, job: ElectricalJob, *, title: str, message: str,
                     actor: User | None = None, skip: set | None = None) -> set[int]:
    """Send an Electrical event to subscribed role members who may open the
    job (data scope incl. approvers). Returns the user ids reached."""
    from app.core.notification_events import notify_event

    def can_open(u: User) -> bool:
        try:
            ensure_job_in_scope(db, u, job)
            return True
        except HTTPException:
            return False

    return notify_event(
        db, background_tasks, MODULE, event, title=title, message=message,
        entity_type="electrical_job", entity_id=job.id, actor=actor, can_open=can_open,
        details=[("Job", f"{job.job_number} — {job.title}"), *([("Customer", job.customer_name)] if job.customer_name else [])],
        skip_user_ids={i for i in (skip or set()) if i},
    )


# ── Shared approval helpers ──────────────────────────────────────────────

def _only_permission_stages(db: Session, key: str, perm: str) -> bool:
    wf = engine.ensure_workflow(db, key)
    return wf.is_active and all(
        s.approver_rule == "permission" and (s.rule_config or {}).get("permission") == perm for s in wf.stages
    )


def no_engine_approver(db: Session, key: str, perm: str, user: User) -> bool:
    """True when the engine has nobody to route to: the workflow is still the
    permission-based default and nobody except `user` (and admins) holds it."""
    return _only_permission_stages(db, key, perm) and not [i for i in engine.permission_holders(db, perm) if i != user.id]


def live_request(db: Session, entity_type: str, entity_id: int) -> ApprovalRequest | None:
    req = engine.latest_request(db, entity_type, entity_id)
    return req if req is not None and req.status == "pending" else None


def decide_live(db: Session, req: ApprovalRequest, user: User, decision: str, comment: str | None) -> None:
    """Old approve/reject routes on a record with an engine request: decide it
    there. An admin who isn't the stage approver stands in; the old routes
    didn't ask admins for a reason, so a default one is written."""
    comment = (comment or "").strip() or None
    if not comment and is_admin_user(user) and not engine.can_act_on_entity(db, user, req.entity_type, req.entity_id):
        comment = f"Decided by admin {user.name or user.email} from the Electrical page"
    engine.decide(db, req.id, user, decision, comment)


def submit_and_approve(db: Session, key: str, *, entity_id: int, user: User, title: str, reference: str,
                       context: dict, perm: str, direct, amount: float | None = None) -> None:
    """An approver acting in one step (the pre-engine behaviour): submit to the
    engine and approve at once when they're an approver of the first stage
    (or an admin). With no routable approver at all, `direct()` applies the
    approval the old way."""
    try:
        req = engine.submit(db, key, entity_id=entity_id, requester=user, title=title, reference=reference,
                            amount=amount, context=context)
    except HTTPException as e:
        if e.status_code == 422 and no_engine_approver(db, key, perm, user):
            direct()
            return
        raise
    if req.status != "pending":
        return
    if engine.can_act_on_entity(db, user, req.entity_type, entity_id):
        engine.decide(db, req.id, user, "approve", None)
    elif is_admin_user(user):
        engine.decide(db, req.id, user, "approve", f"Approved directly by admin {user.name or user.email}")


def cancel_live(db: Session, entity_type: str, entity_id: int, user: User, reason: str) -> None:
    """Withdraw a record's live request when the record goes away. If the
    user may not cancel it, the request stays for the approvers."""
    try:
        engine.cancel_for_entity(db, entity_type, entity_id, user, reason)
    except HTTPException:
        pass


def _step_comment(req: ApprovalRequest, actor: User) -> str | None:
    decided = [s for s in req.steps if s.decided_by_id == actor.id and s.comment]
    return decided[-1].comment if decided else None


# ── Drawing revisions ────────────────────────────────────────────────────

def apply_revision_approval(db: Session, revision: ElectricalDrawingRevision, actor: User, comment: str | None,
                            notify_preparer: bool = True) -> None:
    """What approving a revision does (old route and engine alike)."""
    drawing = revision.drawing
    for r in drawing.revisions:
        if not r.is_deleted and r.status == "approved" and r.id != revision.id:
            r.status = "superseded"
    revision.status = "approved"
    revision.decided_by_id = actor.id
    revision.decided_at = datetime.now(timezone.utc)
    revision.decision_comment = (comment or "").strip() or None
    job = db.get(ElectricalJob, drawing.job_id)
    notify_job_event(
        db, None, "drawing_approved", job, title="Electrical Drawing Approved",
        message=f"{drawing.drawing_number} {revision.revision_label} ({drawing.title}) on {job.job_number} was approved by "
                f"{actor.name or actor.email} and is now the drawing in force.",
        actor=actor, skip={revision.prepared_by_id},
    )
    if notify_preparer and revision.prepared_by_id and revision.prepared_by_id != actor.id:
        notify_user(
            db, revision.prepared_by_id, title="Electrical Drawing Approved",
            message=f"{drawing.drawing_number} {revision.revision_label} ({drawing.title}) on {job.job_number} was approved by {actor.name or actor.email}.",
            notification_type="electrical_drawing_approved", entity_type="electrical_job", entity_id=job.id,
        )


def apply_revision_rejection(db: Session, revision: ElectricalDrawingRevision, actor: User, comment: str,
                             notify_preparer: bool = True) -> None:
    drawing = revision.drawing
    revision.status = "rejected"
    revision.decided_by_id = actor.id
    revision.decided_at = datetime.now(timezone.utc)
    revision.decision_comment = comment
    job = db.get(ElectricalJob, drawing.job_id)
    notify_job_event(
        db, None, "drawing_rejected", job, title="Electrical Drawing Rejected",
        message=f"{drawing.drawing_number} {revision.revision_label} on {job.job_number} was rejected: {comment}. "
                "The preparer has to raise a corrected revision.",
        actor=actor, skip={revision.prepared_by_id},
    )
    if notify_preparer and revision.prepared_by_id and revision.prepared_by_id != actor.id:
        notify_user(
            db, revision.prepared_by_id, title="Electrical Drawing Rejected",
            message=f"{drawing.drawing_number} {revision.revision_label} on {job.job_number} was rejected: {comment}",
            notification_type="electrical_drawing_rejected", entity_type="electrical_job", entity_id=job.id,
        )


def _revision_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    revision = db.get(ElectricalDrawingRevision, req.entity_id)
    if revision is None or revision.is_deleted or revision.status != "submitted":
        return
    comment = _step_comment(req, actor)
    # The engine already told the submitter; the preparer only needs the old
    # notice when somebody else submitted it.
    notify = revision.prepared_by_id != req.requester_id
    if outcome in ("approved", "rejected"):
        job = db.get(ElectricalJob, revision.drawing.job_id)
        if job.status not in ELECTRICAL_WORKING_STATUSES:
            raise HTTPException(status_code=409, detail=f"Job {job.job_number} is {job.status.replace('_', ' ')}, so its drawings can't be "
                                                        "approved or rejected. Resume / reopen the job first.")
    if outcome == "approved":
        apply_revision_approval(db, revision, actor, comment, notify_preparer=notify)
    elif outcome == "rejected":
        apply_revision_rejection(db, revision, actor, comment or "Rejected", notify_preparer=notify)
    else:  # returned / cancelled → back to draft, editable again
        revision.status = "draft"
        revision.submitted_at = None
        if outcome == "returned":
            revision.decision_comment = comment


register_transaction(TransactionType(
    key=REVISION_KEY, module_key=MODULE, subtab_key="drawings", label="Electrical drawing revision",
    entity_type=REVISION_ENTITY, url=APPROVAL_URL.format(entity=REVISION_ENTITY),
    description="A drawing revision (R0, R1 …) of an RRV electrical job, submitted for approval. Approving it "
                "supersedes the drawing's previously approved revision.",
    context_fields={
        "drawing_type": {"label": "Drawing type", "type": "text"},
        "is_as_built": {"label": "As-built drawing", "type": "bool"},
        "lead_engineer_id": {"label": "Job lead engineer", "type": "user"},
    },
    default_stages=[StageDef("Drawings approver", "permission", {"permission": "electrical:drawings:approve"})],
    require_permission=True, allow_self_approval=False,
    on_decided=_revision_decided,
))


def submit_revision(db: Session, revision: ElectricalDrawingRevision, job: ElectricalJob, user: User) -> ApprovalRequest | None:
    """Start engine approval of a revision (caller sets status + commits).
    Returns None when the engine has no approver and the revision waits for
    an admin through the old route."""
    drawing = revision.drawing
    try:
        return engine.submit(
            db, REVISION_KEY, entity_id=revision.id, requester=user,
            title=f"{drawing.drawing_number} {revision.revision_label} — {drawing.title}",
            reference=f"{job.job_number} / {drawing.drawing_number} {revision.revision_label}",
            branch_id=job.branch_id,
            context={"drawing_type": drawing.drawing_type, "is_as_built": drawing.is_as_built,
                     "lead_engineer_id": job.lead_engineer_id},
        )
    except HTTPException as e:
        if e.status_code == 422 and no_engine_approver(db, REVISION_KEY, "electrical:drawings:approve", user):
            return None
        raise


# ── BOM component selection ──────────────────────────────────────────────

def _bom_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    item = db.get(ElectricalBomItem, req.entity_id)
    if item is None or item.is_deleted:
        return
    if outcome == "approved" and item.selection_status == "selected":
        item.selection_status = "approved"
        job = db.get(ElectricalJob, item.job_id)
        notify_job_event(
            db, None, "bom_selection_approved", job, title="Electrical Component Selection Approved",
            message=f"BOM line {item.line_no} ({item.description} — {item.make} {item.part_number}) on {job.job_number} "
                    "was approved; it can now be bought.",
            actor=actor, skip={req.requester_id},
        )
    # rejected / returned / cancelled: the line stays 'selected' — pick another
    # part or submit it again.


register_transaction(TransactionType(
    key=BOM_KEY, module_key=MODULE, subtab_key="jobs", label="Electrical component selection",
    feature_key="bom",  # decided with Electrical › Jobs › BOM › Approve (app/core/features/electrical.py)
    entity_type=BOM_ENTITY, url=APPROVAL_URL.format(entity=BOM_ENTITY),
    description="The make + part number picked for one electrical BOM line, submitted for approval.",
    context_fields={
        "category": {"label": "Component category", "type": "text"},
        "lead_engineer_id": {"label": "Job lead engineer", "type": "user"},
    },
    default_stages=[StageDef("Electrical jobs approver", "permission", {"permission": "electrical:jobs:approve"})],
    require_permission=True, allow_self_approval=True,
    on_decided=_bom_decided,
))


def bom_submission(item: ElectricalBomItem, job: ElectricalJob) -> dict:
    est = (item.estimated_unit_cost or 0) * (item.quantity or 0)
    return {
        "title": f"BOM line {item.line_no}: {item.description} — {item.make} {item.part_number}",
        "reference": f"{job.job_number} / BOM {item.line_no}",
        "amount": round(est, 2) if est else None,
        "context": {"category": item.category, "lead_engineer_id": job.lead_engineer_id},
    }


def submit_bom_item(db: Session, item: ElectricalBomItem, job: ElectricalJob, user: User) -> ApprovalRequest:
    s = bom_submission(item, job)
    return engine.submit(db, BOM_KEY, entity_id=item.id, requester=user, title=s["title"], reference=s["reference"],
                         amount=s["amount"], branch_id=job.branch_id, context=s["context"])


def approve_bom_item_now(db: Session, item: ElectricalBomItem, job: ElectricalJob, user: User) -> None:
    """An approver setting a line to 'approved' directly (old one-step flow)."""
    s = bom_submission(item, job)
    item.selection_status = "selected"

    def direct():
        item.selection_status = "approved"

    db.flush()
    submit_and_approve(db, BOM_KEY, entity_id=item.id, user=user, title=s["title"], reference=s["reference"],
                       context=s["context"], perm="electrical:jobs:approve", direct=direct, amount=s["amount"])


def can_approve_bom(user: User) -> bool:
    return can_perform(user, MODULE, "jobs", "approve")
