"""HR approvals on the central approval engine, and HR's data-scope tables.

Leave, attendance regularization, travel and expense-claim approvals route
through Organization › Approval Workflows (organization/services/
approval_engine.py). Each request kind is one transaction type; its default
workflow reproduces the pre-engine rule:

    stage 1 "Reporting manager" — the requester's User.reporting_manager_id,
    plus everyone holding hr:approvals:approve (HR deciding alongside the
    manager, or alone when the requester has no manager). Being the named
    manager is the authority (require_permission=False); nobody decides their
    own request (allow_self_approval=False).

The record's own `approver_id` column is still filled at submission (the
requester's manager) for display and for the legacy path. Requests submitted
before the cut-over have no engine request (`latest_request` is None) and are
still decided by the old `access.can_decide` rule.

The route files register their transaction types (they own the `on_decided`
callbacks that change the record's status) through `register_hr_type`.
"""
from __future__ import annotations

from typing import Callable

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope, register_scoped
from app.core.permission_registry import is_admin_user
from app.modules.hr.models.asset import HrAsset
from app.modules.hr.models.attendance import HrAttendance, HrAttendanceRegularization
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.expense import HrExpenseClaim
from app.modules.hr.models.leave import HrLeaveRequest
from app.modules.hr.models.lifecycle import HrChecklistItem, HrLifecycleEvent
from app.modules.hr.models.overtime import HrOvertime
from app.modules.hr.models.safety import HrSafetyAction, HrSafetyIncident, HrSafetyIncidentPerson
from app.modules.hr.models.travel import HrTravelRequest
from app.modules.hr.models.visitor import HrVisitor
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest, ApprovalRequestStep
from app.modules.organization.services import approval_engine as engine

MODULE_KEY = "hr"

LEAVE_KEY = "hr.leave"
REGULARIZATION_KEY = "hr.attendance_regularisation"
TRAVEL_KEY = "hr.travel"
EXPENSE_KEY = "hr.expense"
OVERTIME_KEY = "hr.overtime"
HR_KEYS = (LEAVE_KEY, REGULARIZATION_KEY, TRAVEL_KEY, EXPENSE_KEY, OVERTIME_KEY)

LEAVE_ENTITY = "hr_leave_request"
REGULARIZATION_ENTITY = "hr_attendance_regularization"
TRAVEL_ENTITY = "hr_travel_request"
EXPENSE_ENTITY = "hr_expense_claim"
OVERTIME_ENTITY = "hr_overtime"

# Holders of this grant could decide any HR request before the engine existed
# (access.can_decide); they stay co-approvers of the default stage.
HR_DECIDER_PERMISSION = "hr:approvals:approve"


# ── Data scope ───────────────────────────────────────────────────────────

def _checklist_owner(user):
    """Lifecycle events where `user` owns a checklist task."""
    return HrLifecycleEvent.id.in_(select(HrChecklistItem.event_id).where(HrChecklistItem.owner_user_id == user.id))


register_scoped(HrLeaveRequest, MODULE_KEY, entity_type=LEAVE_ENTITY, owner=("user_id",),
                assigned=("approver_id",), label="leave request")
register_scoped(HrAttendanceRegularization, MODULE_KEY, entity_type=REGULARIZATION_ENTITY, owner=("user_id",),
                assigned=("approver_id",), label="attendance regularization")
register_scoped(HrTravelRequest, MODULE_KEY, entity_type=TRAVEL_ENTITY, owner=("user_id",),
                assigned=("approver_id",), label="travel request")
register_scoped(HrExpenseClaim, MODULE_KEY, entity_type=EXPENSE_ENTITY, owner=("user_id",),
                assigned=("approver_id",), label="expense claim")
register_scoped(HrAttendance, MODULE_KEY, owner=("user_id",), label="attendance record")
register_scoped(HrEmployeeProfile, MODULE_KEY, owner=("user_id",), branch="branch_id", label="employee profile")
register_scoped(HrLifecycleEvent, MODULE_KEY, entity_type="hr_lifecycle_event", owner=("user_id", "created_by_id"),
                assigned=("handover_to_id", "from_manager_id", "to_manager_id", _checklist_owner), label="lifecycle event")
register_scoped(HrAsset, MODULE_KEY, owner=("current_holder_id", "created_by_id"), branch="branch_id", label="asset")
register_scoped(HrVisitor, MODULE_KEY, owner=("host_user_id", "created_by_id"), branch="branch_id", label="visitor")
register_scoped(HrOvertime, MODULE_KEY, entity_type=OVERTIME_ENTITY, owner=("user_id",),
                assigned=("approver_id",), label="overtime request")


def _safety_party(user):
    """Incidents where `user` owns a CAPA action or is a person involved."""
    return or_(
        HrSafetyIncident.id.in_(select(HrSafetyAction.incident_id).where(HrSafetyAction.owner_id == user.id)),
        HrSafetyIncident.id.in_(select(HrSafetyIncidentPerson.incident_id).where(HrSafetyIncidentPerson.user_id == user.id)),
    )


register_scoped(HrSafetyIncident, MODULE_KEY, entity_type="hr_safety_incident", owner=("reported_by_id", "created_by_id"),
                assigned=("investigation_lead_id", _safety_party), branch="branch_id", label="safety incident")


def ensure_scope_unless_party(db: Session, user: User, record, *party_ids: int | None) -> None:
    """`ensure_in_scope` for HR-side access. The record's own parties (the
    employee, the captured approver, the host…) always keep access — My HR and
    approvers must not depend on the HR data-access setting."""
    if user.id in {p for p in party_ids if p}:
        return
    ensure_in_scope(db, user, record)


def employee_scope_filter(db: Session, viewer: User):
    """SQL filter on User rows for HR's employee screens (the employee list
    shows every portal user, profile or not, so it scopes the User row):
    own = themself; assigned = + direct reports; department = + same
    department at their plant; plant / multi-plant = + users of those plants.
    None = organization-wide."""
    from sqlalchemy import func, or_

    from app.core.data_scope import user_branch_ids, user_scope

    level = user_scope(viewer, MODULE_KEY)
    if level == "organization":
        return None
    parts = [User.id == viewer.id]
    if level != "own":
        parts.append(User.reporting_manager_id == viewer.id)
    if level == "department":
        from app.modules.organization.services.department_membership import peers_condition

        same = peers_condition(db, viewer)
        if same is not None:
            parts.append(same)
    if level in ("plant", "multi_plant"):
        ids = user_branch_ids(db, viewer, level)
        if ids:
            parts.append(User.branch_id.in_(ids))
            parts.append(User.id.in_(select(HrEmployeeProfile.user_id).where(HrEmployeeProfile.branch_id.in_(ids))))
    return or_(*parts)


def ensure_employee_in_scope(db: Session, viewer: User, target: User) -> None:
    expr = employee_scope_filter(db, viewer)
    if expr is None or db.query(User.id).filter(User.id == target.id, expr).first() is not None:
        return
    from app.core.data_scope import SCOPE_LABELS, user_scope

    raise HTTPException(
        status_code=403,
        detail=f"{target.name or target.email} is outside your HR data access — your scope for HR is "
               f"'{SCOPE_LABELS[user_scope(viewer, MODULE_KEY)]}'. Ask an admin to widen it in Organization › Role & "
               "Permissions (Data access column of your role) if you need this employee.",
    )


def worker_scope_filter(db: Session, viewer: User):
    """employee_scope_filter for people WITHOUT a portal account, as a SQL
    filter on HrEmployeeProfile rows: assigned = they report to the viewer;
    department = + same department; plant / multi-plant = + those plants.
    None = organization-wide. 'own' sees none (a worker is never the viewer)."""
    from sqlalchemy import false

    from app.core.data_scope import user_branch_ids, user_scope
    from app.modules.organization.services.department_membership import user_department

    P = HrEmployeeProfile
    level = user_scope(viewer, MODULE_KEY)
    if level == "organization":
        return None
    if level == "own":
        return false()
    parts = [P.reporting_manager_id == viewer.id]
    if level == "department":
        dept = user_department(db, viewer)
        if dept is not None:
            parts.append(P.department_id == dept.id)
    if level in ("plant", "multi_plant"):
        ids = user_branch_ids(db, viewer, level)
        if ids:
            parts.append(P.branch_id.in_(ids))
    return or_(*parts)


def ensure_worker_in_scope(db: Session, viewer: User, profile: HrEmployeeProfile) -> None:
    expr = worker_scope_filter(db, viewer)
    if expr is None or db.query(HrEmployeeProfile.id).filter(HrEmployeeProfile.id == profile.id, expr).first() is not None:
        return
    from app.core.data_scope import SCOPE_LABELS, user_scope

    raise HTTPException(
        status_code=403,
        detail=f"{profile.full_name or 'This worker'} is outside your HR data access — your scope for HR is "
               f"'{SCOPE_LABELS[user_scope(viewer, MODULE_KEY)]}'. Ask an admin to widen it in Organization › Role & "
               "Permissions (Data access column of your role) if you need this employee.",
    )


# ── Transaction types ────────────────────────────────────────────────────

def default_stages(subtab_key: str | None = None) -> list[engine.StageDef]:
    """Reporting manager; HR approvers (hr:approvals:approve, or the request's
    own tab approve as before) may also decide — without being pinged."""
    from app.core.permission_registry import MODULES

    perms = [HR_DECIDER_PERMISSION]
    if subtab_key and "approve" in MODULES[MODULE_KEY]["actions"].get(subtab_key, []):
        perms.append(f"{MODULE_KEY}:{subtab_key}:approve")
    return [engine.StageDef("Reporting manager", "reporting_manager", {"plus_permission": perms})]


def register_hr_type(key: str, subtab_key: str, label: str, entity_type: str, url: str,
                     on_decided: Callable, description: str = "", context_fields: dict | None = None) -> None:
    engine.register_transaction(engine.TransactionType(
        key=key, module_key=MODULE_KEY, subtab_key=subtab_key, label=label, entity_type=entity_type, url=url,
        description=description, context_fields=context_fields or {}, default_stages=default_stages(subtab_key),
        on_decided=on_decided, require_permission=False, allow_self_approval=False, distinct_approvers=False,
    ))


# ── Submit / decide / withdraw ───────────────────────────────────────────

def submit(db: Session, key: str, *, entity_id: int, requester: User, title: str, reference: str,
           amount: float | None = None, context: dict | None = None) -> ApprovalRequest:
    """engine.submit with the requester's plant. Raises the engine's 422 when
    nobody can approve (e.g. no reporting manager and no HR approver)."""
    return engine.submit(db, key, entity_id=entity_id, requester=requester, title=title, reference=reference,
                         amount=amount, context=context or {}, branch_id=getattr(requester, "branch_id", None))


def open_request(db: Session, entity_type: str, entity_id: int) -> ApprovalRequest | None:
    req = engine.latest_request(db, entity_type, entity_id)
    return req if req is not None and req.status == "pending" else None


def is_engine_routed(db: Session, entity_type: str, entity_id: int) -> bool:
    return engine.latest_request(db, entity_type, entity_id) is not None


def latest_by_entity(db: Session, entity_type: str, ids) -> dict[int, ApprovalRequest]:
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    rows = (
        db.query(ApprovalRequest)
        .filter(ApprovalRequest.entity_type == entity_type, ApprovalRequest.entity_id.in_(ids))
        .order_by(ApprovalRequest.id.asc())
        .all()
    )
    return {r.entity_id: r for r in rows}  # ascending id → the latest wins


def engine_tracked_ids(entity_type: str):
    """Sub-select of record ids that have (or had) an engine request."""
    return select(ApprovalRequest.entity_id).where(ApprovalRequest.entity_type == entity_type)


def inbox_ids(db: Session, user: User, entity_type: str) -> set[int]:
    """Records of this type waiting for `user` in the engine (as approver,
    delegate or escalation target)."""
    return {r["entity_id"] for r in engine.inbox(db, user) if r["entity_type"] == entity_type}


def can_decide_engine(db: Session, user: User, req: ApprovalRequest | None) -> bool:
    if req is None or req.status != "pending":
        return False
    if engine.can_act_on_entity(db, user, req.entity_type, req.entity_id):
        return True
    # Admin stand-in (the engine asks them for a comment).
    return is_admin_user(user) and req.requester_id != user.id


def decide(db: Session, entity_type: str, entity_id: int, user: User, approve: bool, comment: str | None,
           *, what: str = "request", record_pending: bool = True) -> bool:
    """Decide through the engine when the record has a live engine request.
    Returns False when it doesn't — a pre-engine request (the caller runs the
    legacy path), or one already decided (the caller's own status check then
    says so, exactly as before)."""
    req = open_request(db, entity_type, entity_id)
    if req is None:
        if record_pending and is_engine_routed(db, entity_type, entity_id):
            last = engine.latest_request(db, entity_type, entity_id)
            raise HTTPException(
                status_code=409,
                detail=f"This {what}'s approval is already {last.status} but the {what} is still open — "
                       "ask an admin to check it in Organization › My Approvals.",
            )
        return False
    if req.requester_id == user.id:
        raise HTTPException(
            status_code=403,
            detail=f"You cannot approve or reject your own {what}. It has to be decided by your reporting manager or HR.",
        )
    engine.decide(db, req.id, user, "approve" if approve else "reject", comment)
    return True


def decision_comment(req: ApprovalRequest, actor: User) -> str | None:
    """The comment `actor` left on the step that finished `req`."""
    for s in sorted(req.steps, key=lambda s: (s.decided_at is None, s.decided_at), reverse=True):
        if s.decided_by_id == actor.id and s.comment:
            return s.comment
    return None


def withdraw(db: Session, entity_type: str, entity_id: int, actor: User, reason: str | None = None) -> None:
    """Close the record's live engine request because the record itself was
    cancelled. The HR route has already checked the actor may cancel the record
    (owner with hr:me:edit, HR with the tab's edit, exit completion), which the
    engine's own cancel rule (requester / admin / tab 'cancel' grant) doesn't
    know about — so when the engine refuses with 403 the request is closed as
    the engine would close it."""
    req = open_request(db, entity_type, entity_id)
    if req is None:
        return
    try:
        engine.cancel(db, req.id, actor, reason)
        return
    except HTTPException as exc:
        if exc.status_code != 403:
            raise
    engine._audit(db, req, actor, "approval_cancelled",  # noqa: SLF001 — see docstring
                  f"{actor.name} cancelled the approval of {req.reference or req.title}" + (f": {reason}" if reason else ""))
    engine._finish(db, req, "cancelled", actor)  # noqa: SLF001
    db.flush()


# ── Handover: manager change / exit ──────────────────────────────────────

def reroute_requester_steps(db: Session, requester_id: int, old_mgr_id: int, new_mgr_id: int | None, actor: User | None) -> list[str]:
    """A requester's manager changed: their open HR approval steps addressed
    to the old manager move to the new one. With no new manager the old
    manager's slot is dropped (marked not needed) when HR co-approvers remain
    at that stage, so the request stays with HR. Returns moved references."""
    steps = (
        db.query(ApprovalRequestStep).join(ApprovalRequest, ApprovalRequest.id == ApprovalRequestStep.request_id)
        .filter(
            ApprovalRequest.status == "pending", ApprovalRequest.requester_id == requester_id,
            ApprovalRequest.workflow_key.in_(HR_KEYS), ApprovalRequestStep.approver_id == old_mgr_id,
            ApprovalRequestStep.status.in_(("waiting", "pending")),
        )
        .all()
    )
    moved: list[str] = []
    for step in steps:
        req = step.request
        same_stage = [s for s in req.steps if s.sequence == step.sequence and s.id != step.id]
        if new_mgr_id and new_mgr_id != requester_id:
            if any(s.approver_id == new_mgr_id for s in same_stage):
                step.status = "skipped"
                step.comment = "Reporting manager changed — the new manager is already an approver of this stage."
            else:
                step.approver_id = new_mgr_id
        elif any(s.status in ("waiting", "pending") for s in same_stage):
            step.status = "skipped"
            step.comment = "Reporting manager removed — HR decides."
        else:
            continue  # the old manager is the only approver left — leave it for HR / an admin stand-in
        moved.append(req.reference or req.title)
        if actor is not None:
            db.add(_audit_row(req, actor, f"'{step.stage_name}' approval of {req.reference or req.title} moved after a reporting-manager change"))
    db.flush()
    return moved


def _audit_row(req: ApprovalRequest, actor: User, summary: str):
    from app.modules.main.models.audit_log import AuditLog

    return AuditLog(entity_type=req.entity_type, entity_id=req.entity_id, action="approval_reassigned",
                    module_key=req.module_key, performed_by_id=actor.id, summary=summary)


def pending_steps_of(db: Session, user_id: int) -> list[dict]:
    """Every open engine approval step (any module) addressed to `user_id` —
    the exit / mover impact preview lists these."""
    rows = (
        db.query(ApprovalRequestStep, ApprovalRequest)
        .join(ApprovalRequest, ApprovalRequest.id == ApprovalRequestStep.request_id)
        .filter(ApprovalRequest.status == "pending", ApprovalRequestStep.approver_id == user_id,
                ApprovalRequestStep.status.in_(("waiting", "pending")))
        .order_by(ApprovalRequest.id)
        .all()
    )
    types = engine.transaction_types()
    names = {u.id: u.name for u in db.query(User.id, User.name).filter(
        User.id.in_({r.requester_id for _s, r in rows if r.requester_id} or {-1})).all()}
    out = []
    for step, req in rows:
        tt = types.get(req.workflow_key)
        out.append({
            "request_id": req.id, "module_key": req.module_key, "type_label": tt.label if tt else req.workflow_key,
            "entity_type": req.entity_type, "entity_id": req.entity_id, "ref": req.reference or req.title,
            "stage": step.stage_name, "requester_id": req.requester_id, "requester_name": names.get(req.requester_id),
        })
    return out


def hand_over_engine_steps(db: Session, from_user: User, to_user: User, actor: User, reason: str) -> tuple[list[str], list[str]]:
    """engine.reassign_pending for an exit / mover handover. Steps of requests
    the successor raised themself can't be handed to them (nobody decides
    their own request): those are listed as conflicts and stay put, for HR
    co-approvers or an admin stand-in to decide."""
    open_steps = pending_steps_of(db, from_user.id)
    own = [s for s in open_steps if s["requester_id"] == to_user.id]
    conflicts = [
        f"{s['type_label']} {s['ref']}: {to_user.name} raised it, so its '{s['stage']}' approval can't be handed to them — "
        "decide it in Organization › My Approvals (another approver, or an admin standing in)."
        for s in own
    ]
    if not open_steps:
        return [], conflicts
    # Park the successor's own steps while the rest move, then restore them.
    parked = []
    if own:
        ids = {s["request_id"] for s in own}
        parked = (
            db.query(ApprovalRequestStep)
            .filter(ApprovalRequestStep.request_id.in_(ids), ApprovalRequestStep.approver_id == from_user.id,
                    ApprovalRequestStep.status.in_(("waiting", "pending")))
            .all()
        )
        for s in parked:
            s.approver_id = None
        db.flush()
    moved = engine.reassign_pending(db, from_user.id, to_user.id, actor, reason)
    for s in parked:
        s.approver_id = from_user.id
    db.flush()
    changes = [f"{moved} open approval step(s) across all modules → {to_user.name}"] if moved else []
    return changes, conflicts
