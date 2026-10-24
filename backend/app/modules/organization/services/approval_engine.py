"""Central approval engine — the one place approvals are routed and decided.

Modules declare their transaction types once (at import time):

    register_transaction(TransactionType(
        key="hr.leave", module_key="hr", subtab_key="leave", label="Leave request",
        entity_type="hr_leave_request", url="/dashboard/hr/leave/{id}",
        context_fields={"days": {"label": "Days", "type": "number"}},
        default_stages=[StageDef("Reporting manager", "reporting_manager")],
        require_permission=False, on_decided=_leave_decided,
    ))

and then call submit() when the record is submitted, decide() when someone
approves / rejects / returns it (or let the frontend use the central
/approvals endpoints), and cancel() when the requester withdraws it. The
engine resolves approvers from the workflow stages the admin configured in
Organization › Workflows (seeded from `default_stages`, i.e. today's
behaviour), applies delegation and escalation, enforces four-eyes and the
tab's approve/reject permission, notifies people, and calls the module's
`on_decided(db, request, outcome, actor)` when the request finishes
(outcome: approved | rejected | returned | cancelled). The engine flushes but
never commits — the calling route commits, so the module's own status change
and the approval land in one transaction.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.permission_registry import MODULES, can_feature, can_perform, holds_deliberately, is_admin_user
from app.core.permission_words import action_word, humanize, words as permission_words
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.role import user_roles
from app.modules.main.models.user import User
from app.modules.organization.models.approval import (
    APPROVER_FLAGS, APPROVER_RULES, CONDITION_OPS, ESCALATION_RULES,
    ApprovalDelegation, ApprovalRequest, ApprovalRequestStep, ApprovalWorkflow, ApprovalWorkflowStage,
)


# ── Transaction type registry ────────────────────────────────────────────

@dataclass
class StageDef:
    name: str
    approver_rule: str
    rule_config: dict = field(default_factory=dict)
    approval_mode: str = "any"
    conditions: list = field(default_factory=list)
    skip_if_no_approver: bool = False
    escalate_after_hours: int | None = None
    escalation_rule: str | None = None
    escalation_config: dict = field(default_factory=dict)


@dataclass
class TransactionType:
    key: str
    module_key: str
    subtab_key: str
    label: str
    entity_type: str
    url: str = ""
    description: str = ""
    # name -> {"label": str, "type": "number"|"text"|"bool"|"choice"|"user", "choices": [..]}
    context_fields: dict = field(default_factory=dict)
    default_stages: list[StageDef] = field(default_factory=list)
    on_decided: Callable[[Session, ApprovalRequest, str, User], None] | None = None
    # Module rule checked before every decision (e.g. segregation of duties):
    # validate_decision(db, request, step, user, decision) raises HTTPException to refuse.
    validate_decision: Callable[[Session, ApprovalRequest, ApprovalRequestStep, User, str], None] | None = None
    # Called when a stage is fully approved and the request moves on to the
    # next one (not on the final stage — that is on_decided). For modules with
    # an intermediate status, e.g. Design's "checked → in approval".
    on_stage_passed: Callable[[Session, ApprovalRequest, int, User], None] | None = None
    allow_self_approval: bool = False
    distinct_approvers: bool = False
    require_permission: bool = True
    # Approving (not only rejecting) needs a written comment.
    comment_required_on_approve: bool = False
    # When every stage that applies is skipped for want of an approver, the
    # document is refused (no silent bypass of approval). True only for
    # "approval if anyone is configured" types, where nobody configured means
    # no approval was ever intended (Service: new machine / SR closure).
    allow_all_skipped: bool = False
    # A feature of the tab that owns this approval (permission_registry
    # FEATURES), e.g. "quotations" on crm:inquiries_tenders. When set, the
    # decision permission is the feature's approve / reject (which inherits
    # the tab's until a role is customised) instead of the tab's own.
    feature_key: str | None = None


_TYPES: dict[str, TransactionType] = {}


def _can_decide(user: User, tt: TransactionType, action: str) -> bool:
    if tt.feature_key:
        f = MODULES[tt.module_key].get("features", {}).get(tt.subtab_key, {}).get(tt.feature_key)
        if f and action in f["actions"]:
            return can_feature(user, tt.module_key, tt.subtab_key, tt.feature_key, action)
    return can_perform(user, tt.module_key, tt.subtab_key, action)


def register_transaction(tt: TransactionType) -> None:
    if tt.module_key not in MODULES or tt.subtab_key not in MODULES[tt.module_key]["subtabs"]:
        raise RuntimeError(f"Approval type {tt.key}: {tt.module_key}:{tt.subtab_key} is not a registered tab")
    if tt.feature_key and tt.feature_key not in MODULES[tt.module_key].get("features", {}).get(tt.subtab_key, {}):
        raise RuntimeError(f"Approval type {tt.key}: feature {tt.module_key}:{tt.subtab_key}.{tt.feature_key} is not declared")
    fields = dict(tt.context_fields)
    fields.setdefault("amount", {"label": "Amount (₹)", "type": "number"})
    # Admins read choices in words, never codes: a module's own choice_labels,
    # else each code humanized ('machine_project' -> 'Machine project').
    for k, f in list(fields.items()):
        if f.get("choices"):
            fields[k] = {**f, "choice_labels": {**{str(c): humanize(c) for c in f["choices"]}, **(f.get("choice_labels") or {})}}
    tt.context_fields = fields
    for s in tt.default_stages:
        _validate_stage_def(s.__dict__, tt)
    _TYPES[tt.key] = tt


def transaction_types() -> dict[str, TransactionType]:
    return dict(_TYPES)


def get_type(key: str) -> TransactionType:
    tt = _TYPES.get(key)
    if tt is None:
        raise HTTPException(status_code=404, detail=f"Unknown approval type '{key}'. It may have been renamed — reload the page.")
    return tt


def _validate_stage_def(s: dict, tt: TransactionType) -> None:
    name = (s.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Every stage needs a name, e.g. 'Department head'.")
    rule = s.get("approver_rule")
    if rule not in APPROVER_RULES:
        raise HTTPException(status_code=422, detail=f"Stage '{name}': pick who approves — one of: {'; '.join(APPROVER_RULES.values())}.")
    cfg = s.get("rule_config") or {}
    if rule == "specific_users" and not cfg.get("user_ids"):
        raise HTTPException(status_code=422, detail=f"Stage '{name}': pick at least one user.")
    if rule == "role" and not cfg.get("role_id"):
        raise HTTPException(status_code=422, detail=f"Stage '{name}': pick the role whose holders approve.")
    if rule == "permission" and not cfg.get("permission"):
        raise HTTPException(status_code=422, detail=f"Stage '{name}': pick the permission whose holders approve.")
    if rule == "user_flag" and cfg.get("flag") not in APPROVER_FLAGS:
        raise HTTPException(status_code=422, detail=f"Stage '{name}': pick which approval flag (e.g. Finance manager).")
    if rule == "record_field":
        f = cfg.get("field")
        if f not in tt.context_fields or tt.context_fields[f].get("type") != "user":
            people = [v.get("label") or humanize(k) for k, v in tt.context_fields.items() if v.get("type") == "user"]
            raise HTTPException(
                status_code=422,
                detail=f"Stage '{name}': '{tt.label}' can name the approver only from: {', '.join(people) or 'no person fields'}.",
            )
    if s.get("approval_mode", "any") not in ("any", "all"):
        raise HTTPException(status_code=422, detail=f"Stage '{name}': mode must be 'any' (one of them) or 'all' (every one).")
    for c in s.get("conditions") or []:
        if c.get("field") not in tt.context_fields:
            raise HTTPException(status_code=422, detail=f"Stage '{name}': a condition uses '{humanize(c.get('field'))}', which {tt.label} "
                                                        "doesn't have — remove that condition and pick the field again.")
        if c.get("op") not in CONDITION_OPS:
            raise HTTPException(status_code=422, detail=f"Stage '{name}': pick how a condition compares — one of: {', '.join(CONDITION_OPS.values())}.")
        _validate_condition(name, c, tt.context_fields[c["field"]])
    hours = s.get("escalate_after_hours")
    if hours is not None:
        if not isinstance(hours, int) or hours < 1 or hours > 24 * 60:
            raise HTTPException(status_code=422, detail=f"Stage '{name}': escalate after must be 1–1440 hours, or empty for no escalation.")
        if s.get("escalation_rule") not in ESCALATION_RULES:
            raise HTTPException(status_code=422, detail=f"Stage '{name}': pick who the request escalates to.")
        if s.get("escalation_rule") == "specific_users" and not (s.get("escalation_config") or {}).get("user_ids"):
            raise HTTPException(status_code=422, detail=f"Stage '{name}': pick the users it escalates to.")


def _validate_condition(stage: str, c: dict, f: dict) -> None:
    """A condition that can never be evaluated would make its stage silently
    not apply (see _holds) — refuse it at save time instead."""
    label, op, value, ftype = f.get("label") or c["field"], c["op"], c.get("value"), f.get("type")
    where = f"Stage '{stage}', condition on {label}"
    if op in ("gt", "gte", "lt", "lte"):
        if ftype != "number":
            raise HTTPException(status_code=422, detail=f"{where}: '{CONDITION_OPS[op]}' only works on numbers — use '=', '≠' or 'is one of'.")
        try:
            float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"{where}: enter a number to compare with (got '{value}').")
    if op in ("true", "false") and ftype != "bool":
        raise HTTPException(status_code=422, detail=f"{where}: 'is yes / is no' only works on yes/no fields.")
    if op in ("eq", "ne", "in", "not_in"):
        values = value if isinstance(value, list) else [v for v in str(value if value is not None else "").split(",")] if op in ("in", "not_in") else [value]
        values = [str(v).strip() for v in values if str(v if v is not None else "").strip()]
        # An empty list set by a module's own defaults is deliberate (matches nothing).
        if not values and not isinstance(value, list):
            raise HTTPException(status_code=422, detail=f"{where}: enter the value to compare with.")
        choices = f.get("choices") or []
        bad = [v for v in values if choices and v.lower() not in {str(ch).lower() for ch in choices}]
        if bad:
            names = f.get("choice_labels") or {}
            raise HTTPException(status_code=422, detail=f"{where}: '{', '.join(bad)}' isn't a valid value — pick from "
                                                        f"{', '.join(names.get(str(c), humanize(c)) for c in choices)}.")


# ── Workflow definitions ─────────────────────────────────────────────────

def _stage_rows(tt: TransactionType, stages: list[dict]) -> list[ApprovalWorkflowStage]:
    rows = []
    for i, s in enumerate(stages):
        _validate_stage_def(s, tt)
        hours = s.get("escalate_after_hours")
        rows.append(ApprovalWorkflowStage(
            sequence=i + 1, name=s["name"].strip(), approver_rule=s["approver_rule"],
            rule_config=s.get("rule_config") or {}, approval_mode=s.get("approval_mode") or "any",
            conditions=s.get("conditions") or [], skip_if_no_approver=bool(s.get("skip_if_no_approver")),
            escalate_after_hours=hours, escalation_rule=s.get("escalation_rule") if hours else None,
            escalation_config=(s.get("escalation_config") or {}) if hours else {},
        ))
    return rows


def ensure_workflow(db: Session, key: str) -> ApprovalWorkflow:
    """The stored workflow for a type, created from the type's defaults on first use."""
    tt = get_type(key)
    wf = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == key).first()
    if wf is None:
        wf = ApprovalWorkflow(
            key=key, module_key=tt.module_key, name=tt.label, allow_self_approval=tt.allow_self_approval,
            distinct_approvers=tt.distinct_approvers, require_permission=tt.require_permission,
        )
        wf.stages = _stage_rows(tt, [s.__dict__ for s in tt.default_stages])
        db.add(wf)
        db.flush()
    return wf


def save_workflow(db: Session, key: str, payload: dict, actor: User) -> ApprovalWorkflow:
    tt = get_type(key)
    wf = ensure_workflow(db, key)
    old = workflow_out(wf)
    stages = payload.get("stages") or []
    wf.stages = _stage_rows(tt, stages)
    for flag in ("is_active", "allow_self_approval", "distinct_approvers", "require_permission"):
        if flag in payload and payload[flag] is not None:
            setattr(wf, flag, bool(payload[flag]))
    wf.updated_by_id = actor.id
    db.flush()
    db.add(AuditLog(
        entity_type="approval_workflow", entity_id=wf.id, action="updated", module_key="organization",
        subtab_key="workflows", performed_by_id=actor.id,
        summary=f"{actor.name} changed the approval workflow '{wf.name}' ({len(wf.stages)} stage(s))",
        old_value=json.dumps(old, default=str), new_value=json.dumps(workflow_out(wf), default=str),
    ))
    return wf


def reset_workflow(db: Session, key: str, actor: User) -> ApprovalWorkflow:
    tt = get_type(key)
    return save_workflow(db, key, {
        "stages": [s.__dict__ for s in tt.default_stages], "is_active": True,
        "allow_self_approval": tt.allow_self_approval, "distinct_approvers": tt.distinct_approvers,
        "require_permission": tt.require_permission,
    }, actor)


def workflow_out(wf: ApprovalWorkflow) -> dict:
    return {
        "key": wf.key, "module_key": wf.module_key, "name": wf.name, "is_active": wf.is_active,
        "allow_self_approval": wf.allow_self_approval, "distinct_approvers": wf.distinct_approvers,
        "require_permission": wf.require_permission, "updated_at": wf.updated_at,
        "stages": [{
            "sequence": s.sequence, "name": s.name, "approver_rule": s.approver_rule, "rule_config": s.rule_config or {},
            "approval_mode": s.approval_mode, "conditions": s.conditions or [], "skip_if_no_approver": s.skip_if_no_approver,
            "escalate_after_hours": s.escalate_after_hours, "escalation_rule": s.escalation_rule,
            "escalation_config": s.escalation_config or {},
        } for s in wf.stages],
    }


# ── Approver resolution ──────────────────────────────────────────────────

def _active(db: Session, ids) -> list[int]:
    ids = [i for i in dict.fromkeys(ids) if isinstance(i, int)]
    if not ids:
        return []
    found = {u.id for u in db.query(User.id).filter(User.id.in_(ids), User.is_active.is_(True)).all()}
    return [i for i in ids if i in found]


def _department_heads(db: Session, user: User | None) -> list[int]:
    from app.modules.organization.models.department import Department
    from app.modules.organization.services.department_membership import user_department

    if user is None:
        return []
    dept = user_department(db, user)
    if dept is None and (user.department or "").strip():
        # A name shared by several plants and none at the user's: keep the
        # old behaviour (first match) rather than finding no approver.
        dept = (db.query(Department).filter(func.lower(Department.name) == user.department.strip().lower())
                .order_by(Department.branch_id.is_(None).desc(), Department.id).first())
    if dept is None:
        return []
    ids = [dept.head_user_id, dept.secondary_head_user_id, *(dept.additional_head_user_ids or [])]
    return [i for i in ids if i]


def permission_holders(db: Session, perm: str) -> list[int]:
    """Active non-admin users holding `perm`: those who hold it deliberately
    (a real role or extra grant) — or, when nobody does, everyone who holds it
    at all (e.g. through a migrated "Standard access" role), which is exactly
    who could approve before the engine existed."""
    users = [u for u in db.query(User).filter(User.is_active.is_(True)).order_by(User.name).all() if not is_admin_user(u)]
    deliberate = [u.id for u in users if holds_deliberately(u, perm)]
    if deliberate:
        return deliberate
    mk, tk, action = (perm.split(":") + ["", "", ""])[:3]
    return [u.id for u in users if can_perform(u, mk, tk, action)]


def _resolve(db: Session, rule: str, cfg: dict, *, requester: User | None, branch_id: int | None, context: dict) -> list[int]:
    return _resolve_rule(db, rule, cfg, requester=requester, branch_id=branch_id, context=context)


def _also_ids(db: Session, cfg: dict) -> list[int]:
    """`plus_permission` (one id or a list): holders may ALSO decide the stage
    (e.g. HR staff alongside the reporting manager). They are not notified and
    don't become approver slots — they see it in My Approvals and can act —
    unless the main rule finds nobody, in which case they are the approvers."""
    perms = cfg.get("plus_permission") or []
    if isinstance(perms, str):
        perms = [perms]
    ids: list[int] = []
    for perm in perms:
        ids += permission_holders(db, perm)
    return list(dict.fromkeys(ids))


def _resolve_rule(db: Session, rule: str, cfg: dict, *, requester: User | None, branch_id: int | None, context: dict) -> list[int]:
    if rule == "reporting_manager":
        return _active(db, [getattr(requester, "reporting_manager_id", None)])
    if rule == "department_head":
        return _active(db, _department_heads(db, requester))
    if rule == "plant_head":
        from app.modules.organization.models.branch import Branch

        bid = branch_id or getattr(requester, "branch_id", None)
        branch = db.get(Branch, bid) if bid else None
        return _active(db, [branch.head_user_id] if branch else [])
    if rule in ("partner", "director", "user_flag"):
        flag = {"partner": "is_partner", "director": "is_director"}.get(rule) or cfg.get("flag")
        col = getattr(User, flag)
        return [u.id for u in db.query(User.id).filter(col.is_(True), User.is_active.is_(True)).order_by(User.name).all()]
    if rule == "specific_users":
        return _active(db, cfg.get("user_ids") or [])
    if rule == "role":
        rows = (
            db.query(User.id).join(user_roles, user_roles.c.user_id == User.id)
            .filter(user_roles.c.role_id == cfg.get("role_id"), User.is_active.is_(True)).order_by(User.name).all()
        )
        return [r.id for r in rows]
    if rule == "permission":
        return permission_holders(db, cfg.get("permission"))
    if rule == "record_field":
        v = context.get(cfg.get("field"))
        return _active(db, v if isinstance(v, list) else [v])
    return []


def _no_approver_reason(db: Session, stage: ApprovalWorkflowStage, requester: User | None, branch_id: int | None,
                        context: dict | None = None) -> str:
    rule, cfg = stage.approver_rule, stage.rule_config or {}
    who = requester.name if requester else "the requester"
    if rule == "reporting_manager":
        return f"{who} has no reporting manager — set one in Organization › Users ({who} › User Details)."
    if rule == "department_head":
        dept = (getattr(requester, "department", None) or "").strip()
        if not dept:
            return f"{who} has no department — set it in Organization › Users."
        return f"Department '{dept}' has no head at {who}'s plant — set one in Organization › Department."
    if rule == "plant_head":
        return "The plant has no head — set one in Organization › Branches."
    if rule == "partner":
        return "No active Partner is set — add partners in Organization › Info › Partners."
    if rule == "director":
        return "No active user is marked Director — set the Director flag in Organization › Users."
    if rule == "user_flag":
        return f"No active user has the '{APPROVER_FLAGS.get(cfg.get('flag'), cfg.get('flag'))}' flag — set it in Organization › Users."
    if rule == "role":
        return "Nobody active holds the approver role of this stage — assign it in Organization › Role & Permissions."
    if rule == "permission":
        return f"Nobody holds '{permission_words(cfg.get('permission'))}' — grant it through a role in Organization › Role & Permissions."
    if rule == "record_field":
        # The document type may say where that person is set ("missing": {ref} is
        # filled from the context key named by "missing_ref", e.g. the order project number).
        tt = _TYPES.get(stage.workflow.key) if getattr(stage, "workflow", None) is not None else None
        spec = (tt.context_fields.get(cfg.get("field")) or {}) if tt is not None else {}
        if spec.get("missing"):
            ref = (context or {}).get(spec.get("missing_ref") or "") or ""
            return spec["missing"].replace("{ref}", str(ref)).replace("  ", " ")
        if spec.get("label"):
            return f"{spec['label']} isn't set on this document — set it, then submit again."
        return "The approver wasn't chosen on the record — pick the approver before submitting."
    return "No approver could be found — check this stage in Organization › Workflows."


def _holds(conditions: list, context: dict) -> bool:
    for c in conditions or []:
        v, op, want = context.get(c.get("field")), c.get("op"), c.get("value")
        try:
            if op == "true" and not v:
                return False
            if op == "false" and v:
                return False
            if op in ("eq", "ne"):
                same = str(v).strip().lower() == str(want).strip().lower() if v is not None else want in (None, "")
                if same != (op == "eq"):
                    return False
            if op in ("in", "not_in"):
                options = [str(x).strip().lower() for x in (want if isinstance(want, list) else str(want).split(","))]
                inside = str(v).strip().lower() in options
                if inside != (op == "in"):
                    return False
            if op in ("gt", "gte", "lt", "lte"):
                if v is None:
                    return False
                a, b = float(v), float(want)
                if not {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]:
                    return False
        except (TypeError, ValueError):
            return False
    return True


def _decision_where(tt: TransactionType) -> str:
    """'Sales › Inquiries › Quotations' — where the Approve permission of a type lives, in words."""
    feat = MODULES[tt.module_key].get("features", {}).get(tt.subtab_key, {}).get(tt.feature_key or "")
    return (f"{MODULES[tt.module_key]['label']} › {MODULES[tt.module_key]['subtabs'][tt.subtab_key]}"
            f"{' › ' + feat['label'] if feat else ''}")


def _split_by_permission(db: Session, ids: list[int], tt: TransactionType | None, users: dict | None = None) -> tuple[list[int], list[int]]:
    """(who may approve, who may not): a workflow that requires the Approve
    permission can only be decided by holders, so a named approver without it
    would leave the document stuck. `users` is an optional id -> User cache."""
    if tt is None or not ids:
        return list(ids), []
    cache = users if users is not None else {}
    missing = [i for i in ids if i not in cache]
    if missing:
        cache.update({u.id: u for u in db.query(User).filter(User.id.in_(missing)).all()})
    ok, lacking = [], []
    for i in ids:
        u = cache.get(i)
        (ok if u is not None and _can_decide(u, tt, "approve") else lacking).append(i)
    return ok, lacking


def _lacking_permission_reason(db: Session, lacking: list[int], tt: TransactionType) -> str:
    names = sorted(n for (n,) in db.query(User.name).filter(User.id.in_(lacking)).all() if n)
    shown = ", ".join(names[:_SAMPLE_NAMES]) + (f" and {len(names) - _SAMPLE_NAMES} more" if len(names) > _SAMPLE_NAMES else "")
    who = shown or "The approver"
    sentence = (f"{who} is set as approver but doesn't hold Approve on {_decision_where(tt)}" if len(names) <= 1
                else f"{who} are set as approvers but don't hold Approve on {_decision_where(tt)}")
    return f"{sentence}; give the role that permission (Organization › Role & Permissions) or pick someone else."


def plan_stages(db: Session, wf: ApprovalWorkflow, *, requester: User | None, branch_id: int | None, context: dict,
                exclude_user_ids: list[int] | None = None, tt: TransactionType | None = None,
                require_permission: bool | None = None, users: dict | None = None) -> list[dict]:
    """Which stages apply and who approves each — used by submit and preview.
    Four-eyes (allow_self_approval off) removes the requester and everyone in
    `exclude_user_ids` (e.g. who prepared / owns the document). When the
    workflow requires the Approve permission, approvers without it are dropped
    from a stage that has someone who holds it (they could never decide). If
    NOBODY of the stage holds it the approvers stay (an admin can still stand
    in, and giving the role the permission unsticks it) but the entry carries a
    `warning` saying who lacks what — preview and the setup check show it."""
    barred = set(exclude_user_ids or [])
    if requester is not None:
        barred.add(requester.id)
    if tt is None:
        tt = _TYPES.get(getattr(wf, "key", None) or "")
    if require_permission is None:
        require_permission = bool(getattr(wf, "require_permission", True))
    if not require_permission:
        tt = None
    plan = []
    for st in wf.stages:
        if not _holds(st.conditions, context):
            continue
        cfg = st.rule_config or {}
        groups = [_resolve(db, st.approver_rule, cfg, requester=requester, branch_id=branch_id, context=context),
                  _also_ids(db, cfg)]
        # "Same plant only": keep approvers whose plant is the document's plant
        # (else the requester's) — e.g. each plant's maintenance planners.
        plant = branch_id or getattr(requester, "branch_id", None)
        stuck: list[int] = []  # approvers kept although they lack Approve, because nobody in their group has it
        for g, ids in enumerate(groups):
            if cfg.get("same_plant") and plant and ids:
                local = {u.id for u in db.query(User.id).filter(User.id.in_(ids), User.branch_id == plant).all()}
                # Nobody of that plant matches (or plants aren't filled in on
                # users yet) → keep everyone rather than block the document.
                ids = [i for i in ids if i in local] or ids
            before = ids
            if not wf.allow_self_approval:
                ids = [i for i in ids if i not in barred]
            if g == 0:
                only_barred = bool(before) and not ids
            holders, no_perm = _split_by_permission(db, ids, tt, users)
            if holders:
                ids = holders
            else:
                stuck += no_perm
            groups[g] = ids
        ids, also = groups
        if not ids:
            ids, also = also, []
        also = [i for i in also if i not in ids]
        warning = None
        if ids:
            problem = None
            if stuck and all(i in stuck for i in ids + also):
                warning = _lacking_permission_reason(db, list(dict.fromkeys(i for i in ids + also if i in stuck)), tt)
        elif only_barred:
            names = ", ".join(sorted(u.name for u in db.query(User.name).filter(User.id.in_(barred)).all())) or "the requester"
            problem = (f"the only person who matches this stage is {names}, who can't approve their own document "
                       "(four-eyes). Add another approver for this stage, or have someone else submit it.")
        else:
            problem = _no_approver_reason(db, st, requester, branch_id, context)
        plan.append({"stage": st, "approver_ids": ids, "also_ids": also, "problem": problem, "warning": warning})
    return plan


# ── Delegation ───────────────────────────────────────────────────────────

def _delegations_from(db: Session, delegator_id: int | None, wf_key: str, module_key: str, today: date | None = None):
    if not delegator_id:
        return []
    today = today or date.today()
    return (
        db.query(ApprovalDelegation)
        .filter(
            ApprovalDelegation.delegator_id == delegator_id, ApprovalDelegation.is_active.is_(True),
            ApprovalDelegation.start_date <= today, ApprovalDelegation.end_date >= today,
            or_(ApprovalDelegation.module_key.is_(None), ApprovalDelegation.module_key == module_key),
            or_(ApprovalDelegation.workflow_key.is_(None), ApprovalDelegation.workflow_key == wf_key),
        )
        .all()
    )


def _via(db: Session, user: User, step: ApprovalRequestStep, req: ApprovalRequest, cache: dict | None = None) -> str | None:
    """How `user` may act on `step`. `cache` (one per list call) remembers the
    delegations already looked up so a long inbox doesn't re-query per step."""
    if step.approver_id == user.id:
        return "direct"
    if user.id in (step.escalated_to_ids or []):
        # Before escalation, this list holds the stage's "also allowed" holders.
        return "escalation" if step.escalated_at else "authority"
    if cache is None:
        delegations = _delegations_from(db, step.approver_id, req.workflow_key, req.module_key)
    else:
        k = (step.approver_id, req.workflow_key, req.module_key)
        if k not in cache.setdefault("deleg", {}):
            cache["deleg"][k] = _delegations_from(db, step.approver_id, req.workflow_key, req.module_key)
        delegations = cache["deleg"][k]
    if any(d.delegate_id == user.id for d in delegations):
        return "delegation"
    return None


# ── Submit / decide / cancel ─────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def latest_request(db: Session, entity_type: str, entity_id: int) -> ApprovalRequest | None:
    return (
        db.query(ApprovalRequest)
        .filter(ApprovalRequest.entity_type == entity_type, ApprovalRequest.entity_id == entity_id)
        .order_by(ApprovalRequest.id.desc())
        .first()
    )


def _notify(db: Session, user_ids, title: str, message: str, req: ApprovalRequest, teams: bool) -> None:
    from app.utils.notifications import notify_user

    for uid in dict.fromkeys(i for i in user_ids if i):
        try:
            notify_user(db, uid, title, message, "approval", entity_type=req.entity_type, entity_id=req.entity_id, teams=teams)
        except Exception:  # a failed notification must never block the approval itself
            pass


def _activate(db: Session, req: ApprovalRequest, sequence: int, notify_approvers: bool = True) -> None:
    req.current_sequence = sequence
    now = _now()
    notify: list[int] = []
    for step in req.steps:
        if step.sequence == sequence and step.status == "waiting":
            step.status = "pending"
            step.activated_at = now
            if step.escalate_after_hours:
                step.due_at = now + timedelta(hours=step.escalate_after_hours)
            notify.append(step.approver_id)
            notify += [d.delegate_id for d in _delegations_from(db, step.approver_id, req.workflow_key, req.module_key)]
    if not notify_approvers:
        return
    stage = next((s.stage_name for s in req.steps if s.sequence == sequence), "")
    _notify(db, notify, f"Approval needed: {req.title}",
            f"{req.reference or req.title} is waiting for your approval ({stage}).", req, teams=True)


def _finish(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    req.status = outcome
    req.completed_at = _now()
    req.current_sequence = None
    for step in req.steps:
        if step.status in ("waiting", "pending"):
            step.status = "cancelled" if outcome != "approved" else "skipped"
    tt = _TYPES.get(req.workflow_key)
    if tt and tt.on_decided:
        tt.on_decided(db, req, outcome, actor)
    if req.requester_id and req.requester_id != actor.id:
        _notify(db, [req.requester_id], f"{req.reference or req.title} {outcome}",
                f"Your {tt.label if tt else 'request'} {req.reference or req.title} was {outcome} by {actor.name}.", req, teams=False)


def _audit(db: Session, req: ApprovalRequest, actor: User, action: str, summary: str) -> None:
    tt = _TYPES.get(req.workflow_key)
    db.add(AuditLog(
        entity_type=req.entity_type, entity_id=req.entity_id, action=action, module_key=req.module_key,
        subtab_key=tt.subtab_key if tt else None, performed_by_id=actor.id, summary=summary,
    ))


def submit(db: Session, key: str, *, entity_id: int, requester: User, title: str, reference: str | None = None,
           amount: float | None = None, context: dict | None = None, branch_id: int | None = None,
           notify: bool = True, exclude_user_ids: list[int] | None = None) -> ApprovalRequest:
    """Start approval of a record. If the workflow is switched off, or no
    stage applies, the request is approved at once (on_decided fires)."""
    tt = get_type(key)
    wf = ensure_workflow(db, key)
    pending = (
        db.query(ApprovalRequest)
        .filter(ApprovalRequest.entity_type == tt.entity_type, ApprovalRequest.entity_id == entity_id,
                ApprovalRequest.status == "pending")
        .first()
    )
    if pending:
        raise HTTPException(status_code=409, detail=f"{reference or title} is already waiting for approval — "
                                                    "cancel that request first if you need to change it.")
    ctx = {**(context or {}), "amount": amount}
    # Set BEFORE the request copies the context: decide() reads it back to stop
    # whoever prepared / owns the document from approving it (four-eyes).
    excluded = sorted({i for i in (exclude_user_ids or []) if i})
    if excluded:
        ctx["_excluded_user_ids"] = excluded
    revision = db.query(func.count(ApprovalRequest.id)).filter(
        ApprovalRequest.entity_type == tt.entity_type, ApprovalRequest.entity_id == entity_id).scalar() or 0
    req = ApprovalRequest(
        workflow_key=key, module_key=tt.module_key, entity_type=tt.entity_type, entity_id=entity_id,
        title=title[:300], reference=reference, amount=amount, context=json.loads(json.dumps(ctx, default=str)),
        requester_id=requester.id, branch_id=branch_id, status="pending", revision=revision + 1, submitted_at=_now(),
    )
    plan = plan_stages(db, wf, requester=requester, branch_id=branch_id, context=ctx,
                       exclude_user_ids=excluded) if wf.is_active else []
    problems = [f"Stage '{p['stage'].name}': {p['problem']}" for p in plan if p["problem"] and not p["stage"].skip_if_no_approver]
    if problems:
        raise HTTPException(status_code=422, detail="Can't submit for approval — " + " ".join(problems))
    if plan and not any(p["approver_ids"] for p in plan) and not tt.allow_all_skipped:
        # Every stage that applies was skipped: approving now would bypass approval.
        why = " ".join(f"Stage '{p['stage'].name}': {p['problem']}" for p in plan)
        raise HTTPException(status_code=422, detail="Can't submit for approval — nobody could be found to approve it, and a "
                                                    f"document is never approved without an approver. {why}")
    for p in plan:
        st = p["stage"]
        if not p["approver_ids"]:
            req.steps.append(ApprovalRequestStep(sequence=st.sequence, stage_name=st.name, approval_mode=st.approval_mode,
                                                 status="skipped", comment=f"Skipped — {p['problem']}"))
            continue
        for uid in p["approver_ids"]:
            req.steps.append(ApprovalRequestStep(
                sequence=st.sequence, stage_name=st.name, approval_mode=st.approval_mode, approver_id=uid, status="waiting",
                escalate_after_hours=st.escalate_after_hours, escalation_rule=st.escalation_rule,
                escalation_config=st.escalation_config or {}, escalated_to_ids=list(p.get("also_ids") or []),
            ))
    db.add(req)
    db.flush()
    _audit(db, req, requester, "submitted", f"{requester.name} submitted {reference or title} for approval")
    first = min((s.sequence for s in req.steps if s.status == "waiting"), default=None)
    if first is None:
        _finish(db, req, "approved", requester)
    else:
        # notify=False: the caller decides the first stage right away (a
        # one-click authority decision) — don't ping the whole stage first.
        _activate(db, req, first, notify_approvers=notify)
    db.flush()
    return req


def _get_request(db: Session, request_id: int, *, lock: bool = False) -> ApprovalRequest:
    """lock=True (decide / cancel): SELECT ... FOR UPDATE, re-reading the
    request and its steps, so two approvers clicking at the same moment are
    serialized — the second waits, then sees the first one's decision (409)
    instead of approving a stale 'pending' request and posting it twice."""
    if lock:
        req = (db.query(ApprovalRequest).filter(ApprovalRequest.id == request_id)
               .options(selectinload(ApprovalRequest.steps))
               .with_for_update().populate_existing().first())
    else:
        req = db.get(ApprovalRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail=f"Approval request #{request_id} not found — reload the page.")
    return req


def _tab_action(tt: TransactionType | None, decision: str) -> str:
    if tt is None:
        return "approve"
    acts = MODULES[tt.module_key]["actions"].get(tt.subtab_key, [])
    return "reject" if decision in ("reject", "return") and "reject" in acts else "approve"


def decide(db: Session, request_id: int, user: User, decision: str, comment: str | None = None) -> ApprovalRequest:
    if decision not in ("approve", "reject", "return"):
        raise HTTPException(status_code=422, detail="Decision must be approve, reject or return.")
    comment = (comment or "").strip() or None
    req = _get_request(db, request_id, lock=True)
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"This request is already {req.status} — nothing left to decide. Reload the page.")
    tt = _TYPES.get(req.workflow_key)
    wf = ensure_workflow(db, req.workflow_key)
    pending = [s for s in req.steps if s.sequence == req.current_sequence and s.status == "pending"]
    step, via = None, None
    for s in sorted(pending, key=lambda s: s.approver_id != user.id):
        via = _via(db, user, s, req)
        if via:
            step = s
            break
    if step is None and is_admin_user(user) and pending:
        if not comment:
            raise HTTPException(status_code=422, detail="You're not an approver of this stage — as an admin you can stand in, "
                                                        "but write a comment saying why.")
        step, via = pending[0], "admin"
    if step is None:
        names = ", ".join(sorted({s.approver.name for s in pending if s.approver}))
        stage = pending[0].stage_name if pending else ""
        raise HTTPException(status_code=403, detail=f"This request is waiting for {names or 'someone else'} at stage '{stage}' "
                                                    "— you're not an approver of it (nor their delegate).")
    # Different person per stage binds admin stand-ins too.
    if wf.distinct_approvers and any(
        s.decided_by_id == user.id and s.sequence != step.sequence and s.status == "approved" for s in req.steps
    ):
        raise HTTPException(status_code=403, detail="You already approved an earlier stage of this request — "
                                                    "each stage needs a different person.")
    # Four-eyes binds admin stand-ins too: nobody approves their own document.
    if decision == "approve" and not wf.allow_self_approval:
        if req.requester_id == user.id:
            raise HTTPException(status_code=403, detail="You can't approve your own request — someone else has to (four-eyes rule).")
        if user.id in ((req.context or {}).get("_excluded_user_ids") or []):
            raise HTTPException(status_code=403, detail="You prepared or own this document, so you can't approve it — "
                                                        "someone else has to (four-eyes rule).")
    if via != "admin":
        if wf.require_permission and tt is not None:
            action = _tab_action(tt, decision)
            if not _can_decide(user, tt, action):
                feat = MODULES[tt.module_key].get("features", {}).get(tt.subtab_key, {}).get(tt.feature_key or "")
                raise HTTPException(
                    status_code=403,
                    detail=f"You're the approver, but you don't hold the '{action_word(action)}' permission on "
                           f"{MODULES[tt.module_key]['label']} › {MODULES[tt.module_key]['subtabs'][tt.subtab_key]}"
                           f"{f' › ' + feat['label'] if feat else ''}. Ask an admin to add it to your role "
                           "(Organization › Role & Permissions).",
                )
    if tt is not None and tt.validate_decision is not None and via != "admin":
        tt.validate_decision(db, req, step, user, decision)
    if decision == "approve" and not comment and tt is not None and tt.comment_required_on_approve:
        raise HTTPException(status_code=422, detail=f"Write a comment with your approval — {tt.label} approvals need one "
                                                    "(e.g. what you checked).")
    if decision in ("reject", "return") and not comment:
        raise HTTPException(status_code=422, detail=f"Write a comment saying why you {decision} it — the requester needs it to fix the request.")

    step.status = {"approve": "approved", "reject": "rejected", "return": "returned"}[decision]
    step.decided_by_id, step.decided_at, step.comment, step.via = user.id, _now(), comment, via
    verb = {"approve": "approved", "reject": "rejected", "return": "returned for changes"}[decision]
    on_behalf = f" (on behalf of {step.approver.name})" if via in ("delegation", "escalation", "admin") and step.approver else ""
    _audit(db, req, user, f"approval_{step.status}",
           f"{user.name} {verb} {req.reference or req.title} at stage '{step.stage_name}'{on_behalf}" + (f": {comment}" if comment else ""))

    if decision != "approve":
        _finish(db, req, "rejected" if decision == "reject" else "returned", user)
        db.flush()
        return req
    same = [s for s in req.steps if s.sequence == step.sequence]
    if step.approval_mode == "any":
        for s in same:
            if s.status == "pending":
                s.status = "skipped"
    if all(s.status in ("approved", "skipped") for s in same):
        nxt = min((s.sequence for s in req.steps if s.status == "waiting"), default=None)
        if nxt is None:
            _finish(db, req, "approved", user)
        else:
            _activate(db, req, nxt)
            if tt is not None and tt.on_stage_passed is not None:
                tt.on_stage_passed(db, req, step.sequence, user)
    db.flush()
    return req


def cancel(db: Session, request_id: int, user: User, reason: str | None = None, *, force: bool = False) -> ApprovalRequest:
    """Withdraw a pending request. `force=True` is for the module itself when
    the record is deleted / cancelled by someone allowed to do THAT (the
    module already checked it) — then the approval goes with it."""
    req = _get_request(db, request_id, lock=True)
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"This request is already {req.status} — it can't be cancelled.")
    tt = _TYPES.get(req.workflow_key)
    allowed = force or req.requester_id == user.id or is_admin_user(user) or (
        tt is not None and can_perform(user, tt.module_key, tt.subtab_key, "cancel"))
    if not allowed:
        raise HTTPException(status_code=403, detail="Only the person who submitted it (or someone with the Cancel permission "
                                                    "on this tab) can cancel this approval request.")
    _audit(db, req, user, "approval_cancelled", f"{user.name} cancelled the approval of {req.reference or req.title}"
           + (f": {reason}" if reason else ""))
    _finish(db, req, "cancelled", user)
    db.flush()
    return req


def cancel_for_entity(db: Session, entity_type: str, entity_id: int, user: User, reason: str | None = None,
                      *, force: bool = True) -> None:
    """Cancel the live request of a record if there is one (the record itself
    was cancelled/deleted — the module already authorised that, so forced)."""
    req = latest_request(db, entity_type, entity_id)
    if req and req.status == "pending":
        cancel(db, req.id, user, reason, force=force)


def reassign_pending(db: Session, from_user_id: int, to_user_id: int, actor: User, reason: str = "") -> int:
    """Hand every open approval step of one person to another (HR exit /
    transfer handover). Returns how many steps moved. Does not commit."""
    steps = (
        db.query(ApprovalRequestStep).join(ApprovalRequest, ApprovalRequest.id == ApprovalRequestStep.request_id)
        .filter(ApprovalRequest.status == "pending", ApprovalRequestStep.approver_id == from_user_id,
                ApprovalRequestStep.status.in_(("waiting", "pending")),
                # Never hand someone the approval of their own request.
                or_(ApprovalRequest.requester_id.is_(None), ApprovalRequest.requester_id != to_user_id))
        .all()
    )
    for step in steps:
        step.approver_id = to_user_id
        req = step.request
        _audit(db, req, actor, "approval_reassigned",
               f"{actor.name} moved the '{step.stage_name}' approval of {req.reference or req.title} to user #{to_user_id}"
               + (f" ({reason})" if reason else ""))
        if step.status == "pending":
            _notify(db, [to_user_id], f"Approval needed: {req.title}",
                    f"{req.reference or req.title} was handed over to you for approval ({step.stage_name}).", req, teams=True)
    db.flush()
    return len(steps)


# ── Read side ────────────────────────────────────────────────────────────

def can_act_on_entity(db: Session, user: User, entity_type: str, entity_id: int) -> bool:
    req = latest_request(db, entity_type, entity_id)
    if not req or req.status != "pending":
        return False
    return any(_via(db, user, s, req) for s in req.steps if s.sequence == req.current_sequence and s.status == "pending")


def step_out(s: ApprovalRequestStep) -> dict:
    return {
        "id": s.id, "sequence": s.sequence, "stage_name": s.stage_name, "approval_mode": s.approval_mode,
        "approver_id": s.approver_id, "approver_name": s.approver.name if s.approver else None,
        "status": s.status, "decided_by_id": s.decided_by_id, "decided_by_name": s.decided_by.name if s.decided_by else None,
        "via": s.via, "decided_at": s.decided_at, "comment": s.comment, "activated_at": s.activated_at,
        "due_at": s.due_at, "escalated_at": s.escalated_at,
    }


def _holds_approve(db: Session, user: User, req: ApprovalRequest, tt: TransactionType | None, cache: dict | None) -> bool:
    """The permission half of `decide`: when the type's workflow requires it,
    the approver must hold Approve on the tab (else decide() answers 403)."""
    if tt is None:
        return True
    cache = cache if cache is not None else {}
    perm = cache.setdefault("perm", {})
    if req.workflow_key not in perm:
        wf = db.query(ApprovalWorkflow.require_permission).filter(ApprovalWorkflow.key == req.workflow_key).first()
        # No stored workflow yet = the type's own default, as ensure_workflow would create it.
        required = bool(wf[0]) if wf is not None else tt.require_permission
        perm[req.workflow_key] = (not required) or _can_decide(user, tt, "approve")
    return perm[req.workflow_key]


def request_out(db: Session, req: ApprovalRequest, user: User | None = None, cache: dict | None = None) -> dict:
    from app.core.record_ref import encode_ref

    tt = _TYPES.get(req.workflow_key)
    out = {
        "id": req.id, "workflow_key": req.workflow_key, "type_label": tt.label if tt else req.workflow_key,
        "module_key": req.module_key, "entity_type": req.entity_type, "entity_id": req.entity_id,
        "title": req.title, "reference": req.reference, "amount": req.amount, "status": req.status,
        "revision": req.revision, "current_sequence": req.current_sequence,
        "requester_id": req.requester_id, "requester_name": req.requester.name if req.requester else None,
        "submitted_at": req.submitted_at, "completed_at": req.completed_at,
        # Page URLs carry signed record links, never raw ids (core/record_ref.py).
        "url": tt.url.format(id=encode_ref(req.entity_id)) if tt and tt.url else None,
        "steps": [step_out(s) for s in req.steps],
        "can_decide": False, "can_cancel": False, "acting_for": None,
    }
    if user is not None and req.status == "pending":
        for s in req.steps:
            if s.sequence == req.current_sequence and s.status == "pending":
                via = _via(db, user, s, req, cache)
                if via and _holds_approve(db, user, req, tt, cache):
                    out["can_decide"] = True
                    out["acting_for"] = None if via == "direct" else (s.approver.name if s.approver else None)
                    break
        # Admin-ness and the per-type Cancel permission are the same for every
        # row of one user, so a list call asks once, not once per row.
        memo = cache.setdefault("user", {}) if cache is not None else {}
        if "admin" not in memo:
            memo["admin"] = is_admin_user(user)
        out["can_stand_in"] = memo["admin"] and not out["can_decide"]
        can_cancel_type = False
        if tt is not None:
            k = ("cancel", tt.module_key, tt.subtab_key)
            if k not in memo:
                memo[k] = can_perform(user, tt.module_key, tt.subtab_key, "cancel")
            can_cancel_type = memo[k]
        out["can_cancel"] = req.requester_id == user.id or memo["admin"] or can_cancel_type
    return out


def entity_status(db: Session, entity_type: str, entity_id: int, user: User | None = None) -> dict:
    reqs = (
        db.query(ApprovalRequest).options(*_load())
        .filter(ApprovalRequest.entity_type == entity_type, ApprovalRequest.entity_id == entity_id)
        .order_by(ApprovalRequest.id.desc())
        .all()
    )
    cache: dict = {}
    return {
        "current": request_out(db, reqs[0], user, cache) if reqs else None,
        "history": [request_out(db, r, None, cache) for r in reqs[1:]],
    }


# Everything request_out touches, loaded in a fixed number of queries.
def _load():
    # A function, not a module constant: building the options at import would
    # configure every mapper before all models are imported.
    return (
        selectinload(ApprovalRequest.requester),
        selectinload(ApprovalRequest.steps).selectinload(ApprovalRequestStep.approver),
        selectinload(ApprovalRequest.steps).selectinload(ApprovalRequestStep.decided_by),
    )


def inbox(db: Session, user: User) -> list[dict]:
    """Every pending request the user can act on now — as approver, delegate or
    escalation target (and, where the workflow requires it, holding Approve)."""
    today = date.today()
    delegators = {
        d.delegator_id: d for d in db.query(ApprovalDelegation).filter(
            ApprovalDelegation.delegate_id == user.id, ApprovalDelegation.is_active.is_(True),
            ApprovalDelegation.start_date <= today, ApprovalDelegation.end_date >= today,
        ).all()
    }
    # Same three doors as _via(): approver, a delegator's slot, or listed in the
    # step's also-allowed / escalation list. That list is JSON, so match the id
    # in its text — a superset (id 1 also matches 12) that _via() then settles exactly.
    listed = cast(ApprovalRequestStep.escalated_to_ids, String).like(f"%{user.id}%")
    # De-duplicate on the id only: Postgres can't DISTINCT whole rows that
    # hold JSON columns (context, escalation_config).
    candidate_ids = (
        db.query(ApprovalRequest.id)
        .join(ApprovalRequestStep, ApprovalRequestStep.request_id == ApprovalRequest.id)
        .filter(
            ApprovalRequest.status == "pending", ApprovalRequestStep.status == "pending",
            ApprovalRequestStep.sequence == ApprovalRequest.current_sequence,
        )
        .filter(or_(
            ApprovalRequestStep.approver_id == user.id,
            ApprovalRequestStep.approver_id.in_(list(delegators) or [-1]),
            listed,
        ))
        .distinct()
    )
    candidates = (
        db.query(ApprovalRequest).options(*_load()).filter(ApprovalRequest.id.in_(candidate_ids))
        .order_by(ApprovalRequest.submitted_at)
        .all()
    )
    cache: dict = {}
    out = []
    for req in candidates:
        row = request_out(db, req, user, cache)
        if row["can_decide"]:
            out.append(row)
    return out


def my_requests(db: Session, user: User, limit: int = 100) -> list[dict]:
    rows = (
        db.query(ApprovalRequest).options(*_load()).filter(ApprovalRequest.requester_id == user.id)
        .order_by(ApprovalRequest.id.desc()).limit(limit).all()
    )
    cache: dict = {}
    return [request_out(db, r, user, cache) for r in rows]


def decided_by_me(db: Session, user: User, limit: int = 100) -> list[dict]:
    ids = [r[0] for r in db.query(ApprovalRequestStep.request_id).filter(ApprovalRequestStep.decided_by_id == user.id)
           .order_by(ApprovalRequestStep.decided_at.desc()).limit(limit).all()]
    rows = db.query(ApprovalRequest).options(*_load()).filter(ApprovalRequest.id.in_(ids or [-1])).order_by(ApprovalRequest.id.desc()).all()
    cache: dict = {}
    return [request_out(db, r, user, cache) for r in rows]


def preview(db: Session, key: str, *, requester: User, context: dict, branch_id: int | None,
            draft: dict | None = None) -> list[dict]:
    """Who would approve one document. `draft` = the workflow as edited on
    screen (not yet saved); without it the saved workflow is used."""
    if draft is None:
        wf = ensure_workflow(db, key)
    else:
        if draft.get("is_active") is False:
            return []
        rows = _stage_rows(get_type(key), draft.get("stages") or [])  # validates; never added to the session
        saved = ensure_workflow(db, key)
        req_perm = draft.get("require_permission")
        wf = SimpleNamespace(stages=rows, allow_self_approval=bool(draft.get("allow_self_approval")), key=key,
                             require_permission=saved.require_permission if req_perm is None else bool(req_perm))
    names = {u.id: u.name for u in db.query(User.id, User.name).all()}
    return [{
        "sequence": p["stage"].sequence, "name": p["stage"].name, "approval_mode": p["stage"].approval_mode,
        "approvers": [{"id": i, "name": names.get(i)} for i in p["approver_ids"]],
        "also": [{"id": i, "name": names.get(i)} for i in p.get("also_ids") or []],
        "problem": p["problem"], "warning": p.get("warning"),
        "skipped": not p["approver_ids"] and p["stage"].skip_if_no_approver,
    } for p in plan_stages(db, wf, requester=requester, branch_id=branch_id, context=context)]


# ── Setup check (before a workflow is saved / switched on) ───────────────

_SAMPLE_NAMES = 3


def check_workflow(db: Session, key: str, payload: dict) -> dict:
    """Dry-run a (possibly unsaved) workflow against every active user who can
    raise this document, without changing anything. Returns issues ranked
    error > warning > info, each tied to a stage (index) or the whole flow:
      error   — some people's documents would be refused (nobody to approve);
      warning — a control is weak (self-approval, a stage everyone skips, a
                big 'every one must approve' group, no stage always applies);
      info    — good practice not in use (escalation, distinct approvers)."""
    tt = get_type(key)
    rows = _stage_rows(tt, payload.get("stages") or [])  # validates; never added to the session
    allow_self = bool(payload.get("allow_self_approval"))
    active = payload.get("is_active", True) is not False
    issues: list[dict] = []

    def add(level: str, message: str, stage: int | None = None):
        issues.append({"level": level, "stage": stage, "message": message})

    if not active:
        add("warning", "Approval is switched off — every document is approved the moment it is submitted.")
    if not rows:
        if active:
            add("error", "There are no stages. Add one, or switch 'Approval required' off.")
        return {"issues": issues, "checked_users": 0, "stages": []}

    users = [u for u in db.query(User).filter(User.is_active.is_(True)).order_by(User.name).all()
             if is_admin_user(u) or tt.module_key in (u.get_apps() or [])]
    req_perm = payload.get("require_permission")
    if req_perm is None:
        req_perm = ensure_workflow(db, key).require_permission
    perm_tt = tt if req_perm else None
    people: dict[int, User] = {u.id: u for u in users}  # id -> User, grown on demand by _split_by_permission
    stage_out = []
    for idx, st in enumerate(rows):
        cfg = st.rule_config or {}
        refused: dict[str, list[str]] = {}
        stuck_people: dict[str, list[str]] = {}
        approver_counts: list[int] = []
        if st.approver_rule != "record_field":  # chosen on each document — nothing to check up front
            for u in users:
                resolved = _resolve(db, st.approver_rule, cfg, requester=u, branch_id=None, context={})
                ids = resolved + _also_ids(db, cfg)
                if not allow_self:
                    ids = [i for i in ids if i != u.id]
                ids = list(dict.fromkeys(ids))
                holders, no_perm = _split_by_permission(db, ids, perm_tt, people)
                if ids:
                    approver_counts.append(len(set(holders or ids)))
                    if not holders:
                        # Approvers exist but none may approve: the document would wait on them.
                        stuck_people.setdefault(_lacking_permission_reason(db, no_perm, tt), []).append(u.name or u.email)
                    continue
                reason = _no_approver_reason(db, st, u, None)
                if not allow_self and resolved == [u.id]:
                    reason = "They are the only approver of this stage for their own documents (four-eyes) — add a second approver."
                refused.setdefault(reason, []).append(u.name or u.email)
        label = f"Stage {idx + 1} '{st.name}'"
        for reason, names in sorted(refused.items(), key=lambda kv: -len(kv[1])):
            sample = ", ".join(names[:_SAMPLE_NAMES]) + (f" and {len(names) - _SAMPLE_NAMES} more" if len(names) > _SAMPLE_NAMES else "")
            if st.skip_if_no_approver:
                add("warning", f"{label} is skipped for {len(names)} people ({sample}) — their documents get one approval "
                               f"less. Reason: {reason}", idx)
            else:
                add("error", f"{label}: {len(names)} people ({sample}) couldn't submit — {reason}", idx)
        for reason, names in sorted(stuck_people.items(), key=lambda kv: -len(kv[1])):
            sample = ", ".join(names[:_SAMPLE_NAMES]) + (f" and {len(names) - _SAMPLE_NAMES} more" if len(names) > _SAMPLE_NAMES else "")
            add("error", f"{label}: documents of {len(names)} people ({sample}) would get stuck — {reason}", idx)
        if st.approval_mode == "all" and approver_counts and max(approver_counts) > 3:
            add("warning", f"{label}: up to {max(approver_counts)} people must ALL approve. One absence holds every "
                           "document — use 'Any one of them approves' unless each person checks something different.", idx)
        if st.approval_mode == "all" and st.approver_rule in ("partner", "director") and approver_counts and max(approver_counts) > 1:
            add("info", f"{label}: every {'Partner' if st.approver_rule == 'partner' else 'Director'} must approve — usually any one is enough.", idx)
        if not st.escalate_after_hours:
            add("info", f"{label} has no escalation — a document can wait on an absent approver indefinitely "
                        "(approvers can also set a delegate in Organization › Delegations).", idx)
        stage_out.append({"index": idx, "name": st.name, "refused": sum(len(v) for v in refused.values()),
                          "skipped_for": sum(len(v) for v in refused.values()) if st.skip_if_no_approver else 0,
                          "max_approvers": max(approver_counts) if approver_counts else 0})

    if allow_self:
        add("warning", "The requester may approve their own document — that removes the four-eyes check. Switch it off "
                       "unless the business has accepted that risk.")
    if all(st.conditions for st in rows):
        add("warning", "Every stage has a condition, so a document that matches none of them is approved straight away. "
                       "Add one stage that always applies if every document must be checked.")
    if all(st.skip_if_no_approver for st in rows) and not tt.allow_all_skipped:
        add("info", "Every stage may be skipped; a document whose stages are all skipped is refused, never approved without an approver.")
    if len(rows) > 1 and not payload.get("distinct_approvers"):
        add("info", "One person may approve more than one stage of the same document — switch on 'Different person per "
                    "stage' so each stage is a separate check.")
    order = {"error": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: order[i["level"]])
    return {"issues": issues, "checked_users": len(users), "stages": stage_out}


# ── "Approves in" (read-only view for the Role and User screens) ──────────
# Derived from the workflows on every call, so it can never disagree with
# them: workflows are the only place approvals are configured.

def _all_stages(db: Session) -> list[tuple[TransactionType, bool, list]]:
    """(type, workflow active, stages) for every approval type — the stored
    workflow, or the module default when nobody has customised it yet."""
    stored = {w.key: w for w in db.query(ApprovalWorkflow).options(selectinload(ApprovalWorkflow.stages)).all()}
    out = []
    for key, tt in sorted(_TYPES.items(), key=lambda kv: (MODULES[kv[1].module_key]["label"], kv[1].label)):
        wf = stored.get(key)
        stages = list(wf.stages) if wf else [SimpleNamespace(sequence=i + 1, **s.__dict__) for i, s in enumerate(tt.default_stages)]
        out.append((tt, wf.is_active if wf else True, stages))
    return out


def _condition_text(tt: TransactionType, conditions: list) -> str:
    if not conditions:
        return "Every document"
    parts = []
    for c in conditions:
        spec = tt.context_fields.get(c.get("field")) or {}
        label = spec.get("label") or c.get("field")
        op, v = c.get("op"), c.get("value")
        names = spec.get("choice_labels") or {}
        shown = [names.get(str(x), x) for x in (v if isinstance(v, list) else [v])]
        value = "" if op in ("true", "false") else f" {', '.join(map(str, shown))}"
        parts.append(f"{label} {CONDITION_OPS.get(op, op)}{value}")
    return " and ".join(parts)


def _approves_row(tt: TransactionType, active: bool, st, how: str, kind: str = "approver", sole: bool | None = None) -> dict:
    return {
        "workflow_key": tt.key, "module_label": MODULES[tt.module_key]["label"], "document": tt.label,
        "workflow_active": active, "stage_sequence": st.sequence, "stage_name": st.name,
        "applies_when": _condition_text(tt, st.conditions or []), "how": how, "kind": kind, "sole": sole,
    }


def _role_grants(role) -> set[str]:
    from app.core.permission_registry import expand_grants
    return expand_grants(role.permissions or [])


def approves_in_role(db: Session, role) -> list[dict]:
    """Stages whose approvers come from this role — named directly, or through
    a permission the role grants."""
    grants = _role_grants(role)
    holders = [r.user_id for r in db.query(user_roles.c.user_id).filter(user_roles.c.role_id == role.id).all()]
    active_holders = _active(db, holders)
    out = []
    for tt, active, stages in _all_stages(db):
        for st in stages:
            cfg = st.rule_config or {}
            plus = cfg.get("plus_permission") or []
            plus = [plus] if isinstance(plus, str) else plus
            if st.approver_rule == "role" and cfg.get("role_id") == role.id:
                out.append(_approves_row(tt, active, st, "Holders of this role approve", sole=len(active_holders) <= 1))
            elif st.approver_rule == "permission" and cfg.get("permission") in grants:
                out.append(_approves_row(tt, active, st, f"This role grants {permission_words(cfg['permission'])}, whose holders approve"))
            elif any(p in grants for p in plus):
                out.append(_approves_row(tt, active, st, "This role's holders may also decide (alongside the main approver)", kind="also"))
    return out


def approves_in_user(db: Session, user: User) -> dict:
    """Every stage this person can approve, how they qualify, whether they are
    its only approver, and how many approvals are waiting on them now."""
    from app.modules.organization.models.branch import Branch
    from app.modules.organization.models.department import Department

    role_ids = {r.id for r in (user.roles or []) if r.is_active}
    heads = [d for d in db.query(Department).all()
             if user.id in (d.head_user_id, d.secondary_head_user_id, *(d.additional_head_user_ids or []))]
    plants = db.query(Branch).filter(Branch.head_user_id == user.id).all()
    reports = db.query(func.count(User.id)).filter(User.reporting_manager_id == user.id, User.is_active.is_(True)).scalar() or 0
    perm_cache: dict[str, list[int]] = {}

    def holders(perm: str) -> list[int]:
        if perm not in perm_cache:
            perm_cache[perm] = permission_holders(db, perm)
        return perm_cache[perm]

    out = []
    for tt, active, stages in _all_stages(db):
        for st in stages:
            rule, cfg = st.approver_rule, st.rule_config or {}
            how = None
            if rule == "role" and cfg.get("role_id") in role_ids:
                how = "Holds the stage's role"
            elif rule in ("partner", "director", "user_flag"):
                flag = {"partner": "is_partner", "director": "is_director"}.get(rule) or cfg.get("flag")
                if flag and getattr(user, flag, False):
                    how = {"is_partner": "Is a Partner", "is_director": "Is a Director"}.get(flag) or f"Has the '{APPROVER_FLAGS.get(flag) or humanize(flag.removeprefix('is_'))}' flag"
            elif rule == "specific_users" and user.id in (cfg.get("user_ids") or []):
                how = "Named on the stage"
            elif rule == "permission" and cfg.get("permission") and user.id in holders(cfg["permission"]):
                how = f"Holds {permission_words(cfg['permission'])}"
            elif rule == "department_head" and heads:
                how = "Department head of " + ", ".join(sorted({d.name for d in heads})) + " — for documents raised by its people"
            elif rule == "plant_head" and plants:
                how = "Plant head of " + ", ".join(sorted({b.name for b in plants}))
            elif rule == "reporting_manager" and reports:
                how = f"Reporting manager of {reports} person(s) — for their documents"
            if how:
                sole = None
                if rule in ("role", "partner", "director", "user_flag", "specific_users", "permission"):
                    sole = _resolve_rule(db, rule, cfg, requester=None, branch_id=None, context={}) == [user.id]
                elif rule == "department_head":
                    sole = any(len(_active(db, [d.head_user_id, d.secondary_head_user_id, *(d.additional_head_user_ids or [])])) <= 1 for d in heads)
                elif rule == "plant_head":
                    sole = True
                out.append(_approves_row(tt, active, st, how, sole=sole))
                continue
            plus = cfg.get("plus_permission") or []
            plus = [plus] if isinstance(plus, str) else plus
            if any(user.id in holders(p) for p in plus):
                out.append(_approves_row(tt, active, st, "May also decide (holds " + ", ".join(map(permission_words, plus)) + ")", kind="also"))
            if st.escalate_after_hours:
                er, ecfg = st.escalation_rule, st.escalation_config or {}
                if (er == "specific_users" and user.id in (ecfg.get("user_ids") or [])) \
                        or (er == "partner" and user.is_partner) or (er == "director" and getattr(user, "is_director", False)):
                    out.append(_approves_row(tt, active, st, f"Receives it if not decided within {st.escalate_after_hours}h", kind="escalation"))
    pending = (
        db.query(func.count(ApprovalRequestStep.id)).join(ApprovalRequest, ApprovalRequest.id == ApprovalRequestStep.request_id)
        .filter(ApprovalRequest.status == "pending", ApprovalRequestStep.approver_id == user.id,
                ApprovalRequestStep.status.in_(("waiting", "pending"))).scalar() or 0
    )
    return {"stages": out, "pending_steps": pending}


def workflow_history(db: Session, key: str, limit: int = 50) -> list[dict]:
    wf = ensure_workflow(db, key)
    logs = (db.query(AuditLog).filter(AuditLog.entity_type == "approval_workflow", AuditLog.entity_id == wf.id)
            .order_by(AuditLog.id.desc()).limit(limit).all())
    names = {u.id: u.name for u in db.query(User.id, User.name).filter(User.id.in_({l.performed_by_id for l in logs} - {None})).all()}
    return [{"id": l.id, "summary": l.summary, "performed_by": names.get(l.performed_by_id, "System"),
             "performed_at": l.performed_at.isoformat() if l.performed_at else None} for l in logs]


# ── Escalation (scheduler) ───────────────────────────────────────────────

def _escalation_targets(db: Session, step: ApprovalRequestStep, req: ApprovalRequest) -> list[int]:
    rule, cfg = step.escalation_rule, step.escalation_config or {}
    if rule == "approver_manager":
        approver = db.get(User, step.approver_id) if step.approver_id else None
        return _active(db, [getattr(approver, "reporting_manager_id", None)])
    if rule == "department_head":
        return _active(db, _department_heads(db, req.requester))
    if rule in ("partner", "director"):
        return _resolve(db, rule, {}, requester=None, branch_id=None, context={})
    if rule == "specific_users":
        return _active(db, cfg.get("user_ids") or [])
    return []


def escalate_overdue(db: Session) -> int:
    """Escalate every pending step past its due time once. Returns how many."""
    now = _now()
    steps = (
        db.query(ApprovalRequestStep).join(ApprovalRequest, ApprovalRequest.id == ApprovalRequestStep.request_id)
        .filter(ApprovalRequest.status == "pending", ApprovalRequestStep.status == "pending",
                ApprovalRequestStep.due_at.isnot(None), ApprovalRequestStep.due_at <= now,
                ApprovalRequestStep.escalated_at.is_(None))
        .all()
    )
    for step in steps:
        req = step.request
        targets = [t for t in _escalation_targets(db, step, req) if t not in (step.approver_id, req.requester_id)]
        step.escalated_at = now
        step.escalated_to_ids = sorted(set(step.escalated_to_ids or []) | set(targets))
        late = step.approver.name if step.approver else "the approver"
        _notify(db, targets, f"Escalated: {req.title}",
                f"{req.reference or req.title} has waited {step.escalate_after_hours}h for {late} ({step.stage_name}). "
                "You can now decide it.", req, teams=True)
        _notify(db, [step.approver_id], f"Overdue approval: {req.title}",
                f"{req.reference or req.title} is overdue and was escalated.", req, teams=True)
    db.flush()
    return len(steps)


def run_escalations() -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        escalate_overdue(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
