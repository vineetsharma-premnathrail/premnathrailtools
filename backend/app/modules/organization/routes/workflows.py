"""Organization › Approval Workflows (definitions) and the central approval
endpoints every module's UI uses (inbox, decide, cancel, status)."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.data_scope import scoped_models
from app.core.permission_registry import MODULES
from app.core.permissions import require_feature_action, require_tab_action
from app.core.notification_events import notify_event
from app.db.session import get_db
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.approval import (
    APPROVER_FLAGS, APPROVER_RULES, CONDITION_OPS, ESCALATION_RULES, ApprovalWorkflow,
)
from app.modules.organization.services import approval_engine as engine

router = APIRouter(prefix="/organization/workflows", tags=["Organization - Workflows"])
approvals_router = APIRouter(prefix="/approvals", tags=["Approvals"])

_can_view = require_tab_action("organization", "workflows", "view")
_can_edit = require_tab_action("organization", "workflows", "edit")


class StagePayload(BaseModel):
    name: str
    approver_rule: str
    rule_config: dict = {}
    approval_mode: str = "any"
    conditions: list[dict] = []
    skip_if_no_approver: bool = False
    escalate_after_hours: int | None = None
    escalation_rule: str | None = None
    escalation_config: dict = {}


class WorkflowPayload(BaseModel):
    stages: list[StagePayload]
    is_active: bool | None = None
    allow_self_approval: bool | None = None
    distinct_approvers: bool | None = None
    require_permission: bool | None = None


class PreviewPayload(BaseModel):
    requester_id: int
    branch_id: int | None = None
    context: dict = {}
    # The workflow as edited on screen (not yet saved); omitted = the saved one.
    draft: WorkflowPayload | None = None


class DecisionPayload(BaseModel):
    decision: str
    comment: str | None = None


class CancelPayload(BaseModel):
    reason: str | None = None


def _type_out(tt: engine.TransactionType) -> dict:
    m = MODULES[tt.module_key]
    return {
        "key": tt.key, "module_key": tt.module_key, "module_label": m["label"], "subtab_key": tt.subtab_key,
        "subtab_label": m["subtabs"][tt.subtab_key], "label": tt.label, "description": tt.description,
        "context_fields": tt.context_fields,
        "default_stages": [s.__dict__ for s in tt.default_stages],
    }


def _tell_changed(db: Session, background_tasks: BackgroundTasks, key: str, actor: User, what: str) -> None:
    """organization.workflow_changed (core/events/organization.py)."""
    tt = engine.get_type(key)
    label = f"{MODULES[tt.module_key]['label']} › {tt.label}"
    notify_event(db, background_tasks, "organization", "workflow_changed", title=f"Approval workflow changed: {label}",
                 message=f"{actor.name or actor.email} {what} the approval workflow for {label}. "
                         "It applies to documents submitted from now on.", actor=actor)


@router.get("/meta")
async def workflow_meta(db: Session = Depends(get_db), _user: User = Depends(_can_view)):
    perms = sorted(f"{mk}:{tk}:{a}" for mk, m in MODULES.items() for tk, acts in m["actions"].items()
                   for a in acts if a in ("approve", "reject"))
    # The same permissions in words, for the pickers: grouped by module (in
    # module order), each "Tab — Approve" / "Section › Tab — Reject".
    options = [
        {"value": f"{mk}:{tk}:{a}", "module_key": mk, "module": m["label"],
         "label": f"{(m['groups'].get(tk) + ' › ') if m['groups'].get(tk) else ''}{m['subtabs'][tk]} — {a.capitalize()}"}
        for mk, m in MODULES.items() for tk, acts in m["actions"].items() for a in acts if a in ("approve", "reject")
    ]
    return {
        "approver_rules": APPROVER_RULES, "approver_flags": APPROVER_FLAGS, "escalation_rules": ESCALATION_RULES,
        "condition_ops": CONDITION_OPS, "approval_permissions": perms, "approval_permission_options": options,
        "roles": [{"id": r.id, "name": r.name} for r in db.query(Role).filter(Role.is_active.is_(True)).order_by(Role.name)],
    }


@router.get("")
async def list_workflows(db: Session = Depends(get_db), _user: User = Depends(_can_view)):
    stored = {w.key: w for w in db.query(ApprovalWorkflow).all()}
    out = []
    for key, tt in sorted(engine.transaction_types().items(), key=lambda kv: (MODULES[kv[1].module_key]["label"], kv[1].label)):
        wf = stored.get(key)
        stages = wf.stages if wf else None
        out.append({
            **_type_out(tt),
            "is_active": wf.is_active if wf else True,
            "customised": wf is not None,
            "stage_names": [s.name for s in stages] if stages is not None else [s.name for s in tt.default_stages],
            "updated_at": wf.updated_at if wf else None,
        })
    return out


@router.get("/{key}")
async def get_workflow(key: str, db: Session = Depends(get_db), _user: User = Depends(_can_view)):
    tt = engine.get_type(key)
    wf = engine.ensure_workflow(db, key)
    db.commit()
    return {"type": _type_out(tt), "workflow": engine.workflow_out(wf)}


@router.put("/{key}")
async def save_workflow(key: str, payload: WorkflowPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                        actor: User = Depends(_can_edit)):
    if not payload.stages and payload.is_active is not False:
        raise HTTPException(status_code=422, detail="Add at least one stage — or switch the workflow off if this "
                                                    "transaction should not need approval.")
    data = payload.model_dump()
    wf = engine.save_workflow(db, key, data, actor)
    _tell_changed(db, background_tasks, key, actor, "saved with new settings" if wf.is_active else "switched off (no approval needed)")
    db.commit()
    return {"type": _type_out(engine.get_type(key)), "workflow": engine.workflow_out(wf)}


@router.post("/{key}/reset")
async def reset_workflow(key: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                         actor: User = Depends(require_feature_action("organization", "workflows", "reset", "edit"))):
    wf = engine.reset_workflow(db, key, actor)
    _tell_changed(db, background_tasks, key, actor, "reset to the module default")
    db.commit()
    return {"type": _type_out(engine.get_type(key)), "workflow": engine.workflow_out(wf)}


@router.post("/{key}/preview")
async def preview_workflow(key: str, payload: PreviewPayload, db: Session = Depends(get_db),
                           _user: User = Depends(require_feature_action("organization", "workflows", "simulate", "view"))):
    requester = db.get(User, payload.requester_id)
    if not requester:
        raise HTTPException(status_code=404, detail="Pick an existing user to preview as the requester.")
    stages = engine.preview(db, key, requester=requester, context=payload.context, branch_id=payload.branch_id,
                            draft=payload.draft.model_dump() if payload.draft else None)
    db.rollback()
    return {"stages": stages}


@router.post("/{key}/check")
async def check_workflow(key: str, payload: WorkflowPayload, db: Session = Depends(get_db),
                         _user: User = Depends(require_feature_action("organization", "workflows", "simulate", "view"))):
    """Dry-run the workflow as edited (not yet saved) against everyone who can
    raise this document: who would be refused, and weak controls."""
    out = engine.check_workflow(db, key, payload.model_dump())
    db.rollback()
    return out


@router.get("/{key}/history")
async def workflow_history(key: str, db: Session = Depends(get_db),
                           _user: User = Depends(require_feature_action("organization", "workflows", "history", "view"))):
    out = engine.workflow_history(db, key)
    db.commit()
    return out


@router.get("/-/approves-in/role/{role_id}")
async def approves_in_role(role_id: int, db: Session = Depends(get_db),
                           _user: User = Depends(require_tab_action("organization", "roles", "view"))):
    """Read-only: the workflow stages this role's holders approve in."""
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="This role no longer exists — go back to the role list and reload.")
    return engine.approves_in_role(db, role)


@router.get("/-/approves-in/user/{user_id}")
async def approves_in_user(user_id: int, db: Session = Depends(get_db),
                           _user: User = Depends(require_tab_action("organization", "users", "view"))):
    """Read-only: the workflow stages this person can approve in, and the
    approvals waiting on them now."""
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="This user no longer exists — go back to the user list and reload.")
    return engine.approves_in_user(db, target)


@router.get("/-/data-scope-models")
async def data_scope_models(_user: User = Depends(_can_view)):
    """Which record tables each module scopes (for the admin's reference)."""
    out: dict[str, list[str]] = {}
    for spec in scoped_models().values():
        out.setdefault(spec.module_key, []).append(spec.label)
    return out


# ── Central approval endpoints (any signed-in user) ──────────────────────

@approvals_router.get("/types")
async def approval_types(_user: User = Depends(get_current_user)):
    """Document types that go through approval (labels only) — for delegation pickers."""
    return [
        {"key": tt.key, "module_key": tt.module_key, "module_label": MODULES[tt.module_key]["label"], "label": tt.label,
         "subtab_key": tt.subtab_key, "subtab_label": MODULES[tt.module_key]["subtabs"][tt.subtab_key], "description": tt.description,
         "context_fields": {}, "default_stages": []}
        for tt in sorted(engine.transaction_types().values(), key=lambda t: (MODULES[t.module_key]["label"], t.label))
    ]


@approvals_router.get("/inbox")
async def approval_inbox(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return engine.inbox(db, user)


@approvals_router.get("/mine")
async def my_approval_requests(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return engine.my_requests(db, user)


@approvals_router.get("/decided")
async def decided_by_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return engine.decided_by_me(db, user)


def _ensure_can_see_entity_approvals(db: Session, user: User, entity_type: str, entity_id: int) -> None:
    """Approval history carries the document's title, amount and approver
    comments, so it is shown only to the approval's own parties (requester,
    approvers, deciders, delegates / escalation targets) and to people who can
    open the record itself: a view grant in its module (self-service tabs such
    as My HR excluded) AND the record inside their data scope."""
    from app.core.data_scope import ensure_in_scope
    from app.core.permission_registry import can_view_tab, is_admin_user
    from app.modules.organization.models.approval import ApprovalRequest

    if is_admin_user(user):
        return
    reqs = db.query(ApprovalRequest).filter(
        ApprovalRequest.entity_type == entity_type, ApprovalRequest.entity_id == entity_id).all()
    if not reqs:
        return  # nothing to disclose
    for req in reqs:
        if req.requester_id == user.id:
            return
        for s in req.steps:
            if user.id in (s.approver_id, s.decided_by_id) or user.id in (s.escalated_to_ids or []):
                return
    if engine.can_act_on_entity(db, user, entity_type, entity_id):
        return
    module_key = reqs[0].module_key
    subtabs = (MODULES.get(module_key) or {}).get("subtabs") or {}
    if any(can_view_tab(user, module_key, t) for t in subtabs if t != "me"):
        spec = next((sp for sp in scoped_models().values() if sp.entity_type == entity_type), None)
        record = db.get(spec.model, entity_id) if spec else None
        if record is not None:
            ensure_in_scope(db, user, record)
        return
    label = (MODULES.get(module_key) or {}).get("label", module_key)
    raise HTTPException(
        status_code=403,
        detail=f"You can't see the approval history of this document: you are not its "
               f"requester or one of its approvers, and you have no view access to the {label} module. Ask an admin to "
               "grant view on the relevant tab in Organization › Role & Permissions if you need it.",
    )


@approvals_router.get("/entity/{entity_type}/{entity_id}")
async def entity_approval_status(entity_type: str, entity_id: int, db: Session = Depends(get_db),
                                 user: User = Depends(get_current_user)):
    _ensure_can_see_entity_approvals(db, user, entity_type, entity_id)
    return engine.entity_status(db, entity_type, entity_id, user)


@approvals_router.post("/requests/{request_id}/decide")
async def decide_request(request_id: int, payload: DecisionPayload, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    req = engine.decide(db, request_id, user, payload.decision, payload.comment)
    db.commit()
    return engine.request_out(db, req, user)


@approvals_router.post("/requests/{request_id}/cancel")
async def cancel_request(request_id: int, payload: CancelPayload, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    req = engine.cancel(db, request_id, user, payload.reason)
    db.commit()
    return engine.request_out(db, req, user)
