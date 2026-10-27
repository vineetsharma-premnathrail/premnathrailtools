"""Service (ERP) on the central authorization framework.

Data scope (app/core/data_scope.py):
  - Machines (erp_projects): own = registered by me; assigned = machines I
    raised or am the assigned service engineer of a service request on.
    No plant column, so plant scope uses the registering user's plant.
  - Service requests: own = raised by me; assigned = I am the assigned
    service engineer.
  - Letters / attachments / materials are children — routes check the
    parent machine / SR.

Approvals (central engine, Organization › Approval Workflows):
  - erp.machine      — a newly registered machine (Settings switch
                       "New machines need approval").
  - erp.sr_closure   — closing a service request (Settings switch
                       "Closing a service request needs approval").
  The approver lists that used to live in Service → Settings
  (project_approvers / sr_close_approvers) seed the workflow the first time
  it is used (`seed_workflow`, `migrate_erp_approval_workflows`); a blank list
  meant "admins only", which is the registered default stage. The on/off
  switches stay in Service → Settings because they change the process
  (status flow), not who approves.

In-flight items (pending machine / SR in 'review' with no engine request,
i.e. sent before the cut-over) are still decided through the old
/approve, /reject, /approve-close, /reject-close routes with the old approver
lists (`legacy_is_approver`).
"""
from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone

from fastapi import BackgroundTasks
from sqlalchemy import event, or_, select
from sqlalchemy.orm import Session

from app.core.data_scope import register_scoped
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalWorkflow, ApprovalWorkflowStage
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction

MACHINE_KEY = "erp.machine"
MACHINE_ENTITY = "erp_machine"
SR_CLOSE_KEY = "erp.sr_closure"
SR_ENTITY = "service_request"

# Old Service → Settings keys that held the approver user ids.
LEGACY_APPROVER_SETTING = {MACHINE_KEY: "project_approvers", SR_CLOSE_KEY: "sr_close_approvers"}


# ── Data scope ───────────────────────────────────────────────────────────

def _machines_i_work_on(user):
    sub = select(ServiceRequest.project_id).where(
        ServiceRequest.is_deleted == False,  # noqa: E712
        or_(ServiceRequest.assigned_service_person_id == user.id, ServiceRequest.created_by_id == user.id),
    )
    return Project.id.in_(sub)


# Machines follow the Project Management scope since they moved there (2026-10-26; migration f7c3a9e1d5b2 copied Service scopes).
register_scoped(Project, "projects", entity_type=MACHINE_ENTITY, owner=("created_by_id",),
                assigned=(_machines_i_work_on,), label="machine")
register_scoped(ServiceRequest, "erp", entity_type=SR_ENTITY, owner=("created_by_id",),
                assigned=("assigned_service_person_id",), label="service request")


# ── Approver seeding from the old settings ───────────────────────────────

def legacy_approver_ids(db: Session, key: str) -> list[int]:
    """User ids stored in the retired Service → Settings approver list."""
    row = (
        db.query(ModuleSetting)
        .filter(ModuleSetting.module_key == "erp", ModuleSetting.key == LEGACY_APPROVER_SETTING[key],
                ModuleSetting.branch_id.is_(None))
        .first()
    )
    vals = row.value if row is not None and isinstance(row.value, list) else []
    return [int(v) for v in vals if isinstance(v, int) or (isinstance(v, str) and v.isdigit())]


def legacy_is_approver(db: Session, user: User, key: str) -> bool:
    """Old rule for in-flight items: admins, or a user in the old setting list."""
    if user.role == "admin" or getattr(user, "is_azure_admin", False):
        return True
    return user.id in legacy_approver_ids(db, key)


def legacy_approver_names(db: Session, key: str) -> str:
    ids = legacy_approver_ids(db, key)
    q = db.query(User).filter(User.is_active == True)  # noqa: E712
    q = q.filter(User.id.in_(ids)) if ids else q.filter(User.role == "admin")
    names = [u.name or u.email for u in q.all()]
    return ", ".join(names) if names else "an admin"


def seed_workflow(db: Session, key: str) -> None:
    """Create the stored workflow from the old approver setting the first time,
    so the people who approved before keep approving. No-op once a workflow
    row exists (the admin owns it from then on)."""
    if db.query(ApprovalWorkflow.id).filter(ApprovalWorkflow.key == key).first():
        return
    ids = legacy_approver_ids(db, key)
    if not ids:
        engine.ensure_workflow(db, key)  # registered default: admins
        return
    tt = engine.get_type(key)
    wf = ApprovalWorkflow(key=key, module_key=tt.module_key, name=tt.label, allow_self_approval=tt.allow_self_approval,
                          distinct_approvers=tt.distinct_approvers, require_permission=tt.require_permission)
    wf.stages = [ApprovalWorkflowStage(sequence=1, name=tt.default_stages[0].name, approver_rule="specific_users",
                                       rule_config={"user_ids": ids}, approval_mode="any", conditions=[])]
    db.add(wf)
    db.flush()


def migrate_erp_approval_workflows(bind) -> None:
    """Data migration: create the erp.machine / erp.sr_closure workflows from
    the old Service → Settings approver lists. Safe to run more than once."""
    db = Session(bind=bind)
    try:
        for key in (MACHINE_KEY, SR_CLOSE_KEY):
            seed_workflow(db, key)
        db.commit()
    finally:
        db.close()


def cancel_live(db: Session, entity_type: str, entity_id: int, user: User, reason: str) -> None:
    """Withdraw the record's live approval request when the record itself is
    deleted. The engine only lets the requester / an admin / a Cancel-permission
    holder cancel; if the deleting user is none of those the request is left
    for the approvers (it shows the record as deleted)."""
    from fastapi import HTTPException

    try:
        engine.cancel_for_entity(db, entity_type, entity_id, user, reason)
    except HTTPException:
        pass


def admin_ids(db: Session) -> list[int]:
    return [u.id for u in db.query(User.id).filter(User.role == "admin", User.is_active == True).order_by(User.id).all()]  # noqa: E712


def _context(db: Session) -> dict:
    return {"admin_ids": admin_ids(db)}


def decision_comment(req, actor: User) -> str:
    """The comment the deciding person wrote on their (latest) step."""
    steps = [s for s in req.steps if s.decided_by_id == actor.id and s.status in ("approved", "rejected", "returned")]
    return (max(steps, key=lambda s: s.id).comment or "") if steps else ""


# ── After-commit side effects (emails) ───────────────────────────────────

def run_after_commit(db: Session, tasks: BackgroundTasks) -> None:
    """Run FastAPI-style background tasks once the caller commits. on_decided
    has no BackgroundTasks of its own (the central /approvals route commits),
    so emails go out on a short-lived thread after the commit."""
    def _go(_session):
        def _target():
            try:
                asyncio.run(tasks())
            except Exception:  # an email failure never undoes the approval
                pass
        threading.Thread(target=_target, daemon=True).start()

    event.listen(db, "after_commit", _go, once=True)


# ── Machine approval ─────────────────────────────────────────────────────

def submit_machine(db: Session, project: Project, user: User) -> None:
    seed_workflow(db, MACHINE_KEY)
    project.approval_status = "pending"
    engine.submit(
        db, MACHINE_KEY, entity_id=project.id, requester=user,
        title=f"Machine {project.serial_number}" + (f" — {project.client_company}" if project.client_company else ""),
        reference=project.serial_number, context=_context(db),
    )


def _machine_decided(db: Session, req, outcome: str, actor: User) -> None:
    project = db.get(Project, req.entity_id)
    if project is None:
        return
    remarks = decision_comment(req, actor) or None
    who = actor.name or actor.email
    if outcome == "approved":
        project.approval_status = "approved"
        project.approved_by_id = actor.id
        project.approved_at = datetime.now(timezone.utc)
        project.approval_remarks = remarks
        summary = f"Machine {project.serial_number} approved by {who}." + (f" Remarks: {remarks}" if remarks else "")
    elif outcome in ("rejected", "returned"):
        project.approval_status = "rejected"
        project.approved_by_id = actor.id
        project.approved_at = datetime.now(timezone.utc)
        project.approval_remarks = remarks
        summary = f"Machine {project.serial_number} rejected by {who}: {remarks or 'no reason given'}"
    else:  # cancelled — withdrawn by the requester / admin
        project.approval_status = "rejected"
        project.approval_remarks = "Approval request withdrawn — edit and save the machine to send it again."
        summary = f"Approval of machine {project.serial_number} withdrawn by {who}."
    db.add(AuditLog(entity_type="project", entity_id=project.id, action=outcome, performed_by_id=actor.id, summary=summary))


# ── SR closure approval ──────────────────────────────────────────────────

def submit_sr_closure(db: Session, sr: ServiceRequest, user: User):
    """Returns the ApprovalRequest (its steps name the approvers asked)."""
    seed_workflow(db, SR_CLOSE_KEY)
    return engine.submit(
        db, SR_CLOSE_KEY, entity_id=sr.id, requester=user,
        title=f"Close {sr.request_number}: {sr.issue_title or ''}".strip(" :"),
        reference=sr.request_number, context=_context(db),
    )


def _sr_closure_decided(db: Session, req, outcome: str, actor: User) -> None:
    from app.modules.erp.routes import service_requests as sr_routes
    from app.modules.erp.notify import fire_event

    sr = db.get(ServiceRequest, req.entity_id)
    if sr is None or (sr.status or "").lower() != "review":
        return
    remarks = decision_comment(req, actor)
    who = actor.name or actor.email
    if outcome == "approved":
        sr.status = "closed"
        sr.closed_at = datetime.now(timezone.utc)
        sr_routes._write_audit(db, sr.id, "field_updated", actor, field_name="Status", old_value="review", new_value="closed",
                               summary=f"Closure approved by {who}." + (f" Remarks: {remarks}" if remarks else ""))
        from app.modules.erp.warranty import on_sr_closed
        if (note := on_sr_closed(db, sr, actor.id)):
            sr_routes._write_audit(db, sr.id, "machine_commissioned", actor, summary=note)
        project = db.get(Project, sr.project_id)
        tasks = BackgroundTasks()
        fire_event(db, tasks, "sr_close", "Service Request Closed",
                   f"Service request '{sr.request_number}' ({sr.issue_title}) was closed — closure approved by {who}.",
                   "service_request", sr.id, actor, sr_routes._sr_details(sr, project, actor))
        sr_routes._announce_closed(db, tasks, sr, actor, f"— closure approved by {who}")
        tasks.add_task(sr_routes._run_sr_emails_background, sr.id, "closed", actor.id, actor.name)
        run_after_commit(db, tasks)
        return
    # rejected / returned → back to In Progress; cancelled (withdrawn) too.
    sr.status = "in_progress"
    from app.modules.erp.sla import on_status_change as _sla_status
    _sla_status(sr, "review", "in_progress")  # back to work — the resolution clock runs again
    why = f"Closure sent back by {who}: {remarks}" if outcome != "cancelled" else f"Closure request withdrawn by {who}."
    sr_routes._write_audit(db, sr.id, "field_updated", actor, field_name="Status", old_value="review", new_value="in_progress",
                           summary=why)


register_transaction(TransactionType(
    key=MACHINE_KEY, module_key="projects", subtab_key="service_projects", label="New machine",
    entity_type=MACHINE_ENTITY, url="/dashboard/projects/service-projects/{id}",
    description="A newly registered machine, when Service → Settings › 'New machines need approval' is on. "
                "Service requests can't be raised on the machine until it is approved.",
    context_fields={"admin_ids": {"label": "Portal admins", "type": "user"}},
    # Before the engine: Service → Settings 'Machine approvers'; blank = admins.
    # seed_workflow() turns a non-blank old list into a 'Specific users' stage.
    default_stages=[StageDef("Machine approvers", "record_field", {"field": "admin_ids"}, skip_if_no_approver=True)],
    allow_all_skipped=True,  # nobody configured = this approval isn't in use
    require_permission=False,  # the Machines tab has no 'approve' action; the stage names the people
    on_decided=_machine_decided,
))

register_transaction(TransactionType(
    key=SR_CLOSE_KEY, module_key="erp", subtab_key="service_requests", label="Service request closure",
    entity_type=SR_ENTITY, url="/dashboard/erp/service-requests/{id}",
    description="Closing a service request, when Service → Settings › 'Closing a service request needs approval' is on. "
                "Approved = the SR closes; rejected / returned = it goes back to In Progress.",
    context_fields={"admin_ids": {"label": "Portal admins", "type": "user"}},
    default_stages=[StageDef("SR closure approvers", "record_field", {"field": "admin_ids"}, skip_if_no_approver=True)],
    allow_all_skipped=True,  # nobody configured = this approval isn't in use
    require_permission=False,
    on_decided=_sr_closure_decided,
))
