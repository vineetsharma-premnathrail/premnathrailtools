"""Hydraulic & Pneumatic on the central authorization framework.

Data scope (app/core/data_scope.py), module key "hydraulic":
  - Systems: own = created by me; assigned = I'm the system owner;
    plant = the system's plant (branch_id).
  - Circuits: own = created or submitted by me. BOMs: own = created by me.
    Tests: own = created by me; assigned = I'm the tester. (No plant column —
    plant scope goes by the creator's plant.)
  - Retired service records / maintenance plans stay readable within scope:
    own = created by me; assigned = performed by / assigned to me.
  - Documents check their parent record. Component / spare-part masters,
    calculations (an engineering tool) and dropdown lookups aren't scoped.

Approvals (central engine, Organization › Approval Workflows):
  - hydraulic.circuit      — circuit revision review (draft → under_review →
    approved; return/reject → draft). Default stage: holders of
    hydraulic:circuits:approve, never the submitter (four-eyes, as before).
  - hydraulic.bom_release  — releasing a BOM revision (draft → under_review →
    released). Default stage: holders of hydraulic:bom:approve.
  - hydraulic.test_result  — signing off a test result (planned/in_progress →
    under_review → completed). Default stage: holders of
    hydraulic:testing:approve.
  Before the engine an approver released a BOM / completed a test in one
  step, so those two allow self-approval and the old /release and /complete
  routes, used by an approver, submit + approve at once (`submit_and_approve`).
  Users without the approve permission now use the new /submit routes.

In-flight items: circuits already 'under_review' before the cut-over have no
engine request; the old /approve and /return routes decide them with the old
rules (`latest_request` is None). BOMs and tests had no pending state before.
When nobody but the submitter / admins holds the approve permission (and the
workflow is still permission-based), the engine can't route the request; the
record then goes the pre-engine way (a circuit waits for an admin on the old
route, an approver's release / completion is applied directly).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import register_scoped
from app.core.permission_registry import is_admin_user
from app.modules.hydraulic.models.bom import HydBom
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord
from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.models.testing import HydTest
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction

MODULE = "hydraulic"
CIRCUIT_KEY, CIRCUIT_ENTITY = "hydraulic.circuit", "hyd_circuit"
BOM_KEY, BOM_ENTITY = "hydraulic.bom_release", "hyd_bom"
TEST_KEY, TEST_ENTITY = "hydraulic.test_result", "hyd_test"
CIRCUIT_PERM = "hydraulic:circuits:approve"
BOM_PERM = "hydraulic:bom:approve"
TEST_PERM = "hydraulic:testing:approve"


# ── Data scope ───────────────────────────────────────────────────────────

register_scoped(HydSystem, MODULE, owner=("created_by_id",), assigned=("owner_id",), branch="branch_id", label="system")
register_scoped(HydCircuit, MODULE, entity_type=CIRCUIT_ENTITY, owner=("created_by_id", "submitted_by_id"), label="circuit")
register_scoped(HydBom, MODULE, entity_type=BOM_ENTITY, owner=("created_by_id",), label="hydraulic BOM")
register_scoped(HydTest, MODULE, entity_type=TEST_ENTITY, owner=("created_by_id",), assigned=("tested_by_id",), label="test")
register_scoped(HydServiceRecord, MODULE, owner=("created_by_id",), assigned=("performed_by_id",), label="service record")
register_scoped(HydMaintenancePlan, MODULE, owner=("created_by_id",), assigned=("assigned_to_id",), label="maintenance plan")


# ── Role-based notifications (app/core/events/hydraulic.py) ──────────────

def notify_hyd_event(db: Session, background_tasks, event: str, record, entity_type: str, *, title: str, message: str,
                     actor: User | None = None, skip: set | None = None) -> set[int]:
    """Send a Hydraulic event to subscribed role members who may open
    `record` (its data scope). Returns the user ids reached."""
    from app.core.data_scope import ensure_in_scope
    from app.core.notification_events import notify_event

    def can_open(u: User) -> bool:
        try:
            ensure_in_scope(db, u, record)
            return True
        except HTTPException:
            return False

    return notify_event(
        db, background_tasks, MODULE, event, title=title, message=message,
        entity_type=entity_type, entity_id=record.id, actor=actor, can_open=can_open,
        skip_user_ids={i for i in (skip or set()) if i},
    )


def approver_ids(req: ApprovalRequest | None) -> set[int]:
    return {s.approver_id for s in req.steps if s.approver_id} if req is not None else set()


# ── Shared approval helpers ──────────────────────────────────────────────

def no_engine_approver(db: Session, key: str, perm: str, user: User) -> bool:
    """True when the engine has nobody to route to: the workflow is still the
    permission-based default and nobody except `user` (and admins) holds it."""
    wf = engine.ensure_workflow(db, key)
    default_shape = wf.is_active and all(
        s.approver_rule == "permission" and (s.rule_config or {}).get("permission") == perm for s in wf.stages
    )
    return default_shape and not [i for i in engine.permission_holders(db, perm) if i != user.id]


def live_request(db: Session, entity_type: str, entity_id: int) -> ApprovalRequest | None:
    req = engine.latest_request(db, entity_type, entity_id)
    return req if req is not None and req.status == "pending" else None


def live_request_ids(db: Session, entity_type: str, ids) -> dict[int, int]:
    """record id → pending request id, for list responses."""
    ids = [i for i in ids if i]
    if not ids:
        return {}
    rows = db.query(ApprovalRequest.entity_id, ApprovalRequest.id).filter(
        ApprovalRequest.entity_type == entity_type, ApprovalRequest.entity_id.in_(ids), ApprovalRequest.status == "pending",
    ).all()
    return {e: r for e, r in rows}


def decide_live(db: Session, req: ApprovalRequest, user: User, decision: str, comment: str | None) -> None:
    """Old approve/return routes on a record with an engine request: decide it
    there. An admin who isn't the stage approver stands in; the old routes
    didn't ask admins for a reason, so a default one is written."""
    comment = (comment or "").strip() or None
    if not comment and is_admin_user(user) and not engine.can_act_on_entity(db, user, req.entity_type, req.entity_id):
        comment = f"Decided by admin {user.name or user.email} from the Hydraulic page"
    engine.decide(db, req.id, user, decision, comment)


def submit(db: Session, key: str, perm: str, *, entity_id: int, user: User, title: str, reference: str,
           context: dict | None = None, amount: float | None = None) -> ApprovalRequest | None:
    """engine.submit; None when the engine has no approver to route to."""
    try:
        return engine.submit(db, key, entity_id=entity_id, requester=user, title=title, reference=reference,
                             amount=amount, context=context or {})
    except HTTPException as e:
        if e.status_code == 422 and no_engine_approver(db, key, perm, user):
            return None
        raise


def submit_and_approve(db: Session, key: str, perm: str, *, entity_id: int, user: User, title: str, reference: str,
                       context: dict | None, direct, comment: str | None = None, amount: float | None = None) -> None:
    """An approver acting in one step (the pre-engine behaviour): submit and
    approve at once when they're an approver of the first stage (or an
    admin). With no routable approver at all, `direct()` applies it the old way."""
    req = submit(db, key, perm, entity_id=entity_id, user=user, title=title, reference=reference, context=context, amount=amount)
    if req is None:
        direct()
        return
    if req.status != "pending":
        return
    if engine.can_act_on_entity(db, user, req.entity_type, entity_id):
        engine.decide(db, req.id, user, "approve", comment)
    elif is_admin_user(user):
        engine.decide(db, req.id, user, "approve", comment or f"Approved directly by admin {user.name or user.email}")


def cancel_live(db: Session, entity_type: str, entity_id: int, user: User, reason: str) -> None:
    try:
        engine.cancel_for_entity(db, entity_type, entity_id, user, reason)
    except HTTPException:
        pass  # not theirs to withdraw — the request stays for the approvers


def _step_comment(req: ApprovalRequest, actor: User) -> str | None:
    decided = [s for s in req.steps if s.decided_by_id == actor.id and s.comment]
    return decided[-1].comment if decided else None


# ── Circuits ─────────────────────────────────────────────────────────────

def apply_circuit_approval(db: Session, circuit: HydCircuit, actor: User, remarks: str | None) -> None:
    # Approving a revision supersedes whichever revision was approved before.
    db.query(HydCircuit).filter(
        HydCircuit.circuit_number == circuit.circuit_number, HydCircuit.id != circuit.id, HydCircuit.status == "approved",
    ).update({"status": "superseded"}, synchronize_session=False)
    circuit.status = "approved"
    circuit.approved_by_id = actor.id
    circuit.approved_at = datetime.now(timezone.utc)
    circuit.review_remarks = remarks
    notify_hyd_event(
        db, None, "circuit_approved", circuit, CIRCUIT_ENTITY,
        title=f"Circuit {circuit.circuit_number} Rev {circuit.revision} approved",
        message=f"{actor.name or actor.email} approved \"{circuit.title}\" — Rev {circuit.revision} is now the revision in force; "
                "BOMs can be released against it.",
        actor=actor, skip={circuit.submitted_by_id},
    )


def notify_circuit_returned(db: Session, background_tasks, circuit: HydCircuit, actor: User) -> None:
    notify_hyd_event(
        db, background_tasks, "circuit_returned", circuit, CIRCUIT_ENTITY,
        title=f"Circuit {circuit.circuit_number} Rev {circuit.revision} returned for changes",
        message=f"{actor.name or actor.email} returned \"{circuit.title}\" to draft"
                + (f": {circuit.review_remarks}" if circuit.review_remarks else ".") + " Fix it and submit it again.",
        actor=actor, skip={circuit.submitted_by_id},
    )


def _circuit_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    circuit = db.get(HydCircuit, req.entity_id)
    if circuit is None or circuit.is_deleted or circuit.status != "under_review":
        return
    comment = _step_comment(req, actor)
    if outcome == "approved":
        apply_circuit_approval(db, circuit, actor, comment)
    else:  # rejected / returned / cancelled → back to draft for changes
        circuit.status = "draft"
        if outcome in ("rejected", "returned"):
            circuit.review_remarks = comment
            notify_circuit_returned(db, None, circuit, actor)


register_transaction(TransactionType(
    key=CIRCUIT_KEY, module_key=MODULE, subtab_key="circuits", label="Hydraulic / pneumatic circuit",
    entity_type=CIRCUIT_ENTITY, url="/dashboard/hydraulic/circuits/{id}",
    description="A circuit diagram revision submitted for review. Approving it supersedes the previously approved revision.",
    context_fields={"system_type": {"label": "Medium", "type": "choice", "choices": ["hydraulic", "pneumatic"],
                                   "choice_labels": {"hydraulic": "Hydraulic", "pneumatic": "Pneumatic"}}},
    default_stages=[StageDef("Circuit approver", "permission", {"permission": CIRCUIT_PERM})],
    require_permission=True, allow_self_approval=False,
    on_decided=_circuit_decided,
))


def submit_circuit(db: Session, circuit: HydCircuit, user: User) -> ApprovalRequest | None:
    return submit(db, CIRCUIT_KEY, CIRCUIT_PERM, entity_id=circuit.id, user=user,
                  title=f"Circuit {circuit.circuit_number} Rev {circuit.revision} — {circuit.title}",
                  reference=f"{circuit.circuit_number} Rev {circuit.revision}", context={"system_type": circuit.system_type})


# ── BOM release ──────────────────────────────────────────────────────────

def check_bom_circuit(db: Session, bom: HydBom) -> None:
    """Plan §11 stage order: circuit drawing approved → HBOM → HBOM release."""
    if bom.circuit_id:
        c = db.query(HydCircuit).filter(HydCircuit.id == bom.circuit_id).first()
        if c and c.status != "approved":
            raise HTTPException(
                status_code=409,
                detail=f"{c.circuit_number} Rev {c.revision} is {c.status.replace('_', ' ')} — get the circuit approved "
                       "(or link the approved revision) before releasing this BOM.",
            )


def apply_bom_release(db: Session, bom: HydBom, actor: User, skip: set | None = None) -> None:
    check_bom_circuit(db, bom)
    # Releasing a revision makes the previously released one obsolete.
    db.query(HydBom).filter(
        HydBom.bom_number == bom.bom_number, HydBom.id != bom.id, HydBom.status == "released",
    ).update({"status": "obsolete"}, synchronize_session=False)
    bom.status = "released"
    bom.released_by_id = actor.id
    bom.released_at = datetime.now(timezone.utc)
    notify_hyd_event(
        db, None, "bom_released", bom, BOM_ENTITY, title=f"BOM {bom.bom_number} Rev {bom.revision} released",
        message=f"{actor.name or actor.email} released \"{bom.title}\" (Rev {bom.revision}); earlier released revisions are now obsolete.",
        actor=actor, skip=skip,
    )


def _bom_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    bom = db.get(HydBom, req.entity_id)
    if bom is None or bom.is_deleted or bom.status != "under_review":
        return
    if outcome == "approved":
        apply_bom_release(db, bom, actor, skip={req.requester_id})
    else:
        bom.status = "draft"


register_transaction(TransactionType(
    key=BOM_KEY, module_key=MODULE, subtab_key="bom", label="Hydraulic BOM release",
    entity_type=BOM_ENTITY, url="/dashboard/hydraulic/bom/{id}",
    description="Releasing a hydraulic / pneumatic BOM revision. Releasing it makes the previously released revision obsolete.",
    context_fields={"system_type": {"label": "Medium", "type": "choice", "choices": ["hydraulic", "pneumatic"],
                                   "choice_labels": {"hydraulic": "Hydraulic", "pneumatic": "Pneumatic"}},
                    "line_count": {"label": "Number of lines", "type": "number"}},
    default_stages=[StageDef("BOM approver", "permission", {"permission": BOM_PERM})],
    require_permission=True, allow_self_approval=True,
    on_decided=_bom_decided,
))


def bom_submission(bom: HydBom, total_cost: float | None = None) -> dict:
    return {"title": f"BOM {bom.bom_number} Rev {bom.revision} — {bom.title}", "reference": f"{bom.bom_number} Rev {bom.revision}",
            "context": {"system_type": bom.system_type, "line_count": len(bom.items)}, "amount": total_cost}


# ── Test result sign-off ─────────────────────────────────────────────────

def apply_test_completion(test: HydTest, actor: User, result: str, remarks: str | None,
                          db: Session | None = None, skip: set | None = None) -> None:
    test.status = "completed"
    test.result = result
    test.test_date = test.test_date or date.today()
    if remarks:
        test.remarks = remarks
    test.completed_by_id = actor.id
    test.completed_at = datetime.now(timezone.utc)
    if db is not None and result == "fail":
        notify_hyd_event(
            db, None, "test_failed", test, TEST_ENTITY, title=f"Test {test.test_number} failed",
            message=f"{test.test_number} — {test.title} was signed off as FAILED by {actor.name or actor.email}"
                    + (f": {remarks}" if remarks else ".") + " Fix the fault and raise a re-test from the test page.",
            actor=actor, skip=skip,
        )


def _test_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    test = db.get(HydTest, req.entity_id)
    if test is None or test.is_deleted or test.status != "under_review":
        return
    ctx = req.context or {}
    if outcome == "approved":
        apply_test_completion(test, actor, ctx.get("result") or test.result, ctx.get("remarks"), db=db,
                              skip={req.requester_id})
    else:  # back to the tester; the proposed result is cleared
        test.status = "in_progress"
        test.result = "pending"


register_transaction(TransactionType(
    key=TEST_KEY, module_key=MODULE, subtab_key="testing", label="Hydraulic test result",
    entity_type=TEST_ENTITY, url="/dashboard/hydraulic/testing/{id}",
    description="Signing off a hydraulic / pneumatic test or inspection with its result (pass / fail / conditional).",
    context_fields={"result": {"label": "Proposed result", "type": "choice", "choices": ["pass", "fail", "conditional"],
                               "choice_labels": {"pass": "Pass", "fail": "Fail", "conditional": "Conditional pass"}},
                    "test_type": {"label": "Test type", "type": "text"},
                    "system_type": {"label": "Medium", "type": "choice", "choices": ["hydraulic", "pneumatic"],
                                   "choice_labels": {"hydraulic": "Hydraulic", "pneumatic": "Pneumatic"}},
                    "remarks": {"label": "Remarks", "type": "text"}},
    default_stages=[StageDef("Test approver", "permission", {"permission": TEST_PERM})],
    require_permission=True, allow_self_approval=True,
    on_decided=_test_decided,
))


def test_submission(test: HydTest, result: str, remarks: str | None) -> dict:
    return {"title": f"Test {test.test_number} — {test.title} ({result})", "reference": test.test_number,
            "context": {"result": result, "test_type": test.test_type, "system_type": test.system_type, "remarks": remarks}}
