"""Data access scope — the "which records" half of authorization.

Permissions (core/permission_registry.py) answer *what* a user may do on a
tab; the data scope answers *which records* of a module they see:

    own           records they created / requested / own
    assigned      + records assigned to them (and anything they are an approver on)
    department    + records owned by people of their department (same plant)
    plant         + records of their plant
    multi_plant   + records of every plant they are assigned to (Organization › Branches › user assignments)
    organization  everything

Each role carries a scope per module (Role.data_scopes); a user's scope for a
module is the widest scope among their active roles that open that module,
unless the user has a personal override (User.data_access_scopes). Admins
are organization-wide; a role that sets no scope for a module gets
settings.DEFAULT_DATA_SCOPE (own + assigned), widened per role by an admin.

Modules opt their record tables in once:

    register_scoped(P2PRequest, "p2p", entity_type="p2p_request",
                    owner=("requester_id",), assigned=("buyer_id",), branch="branch_id")

and then use apply_scope(query, user, Model) on every list and
ensure_in_scope(db, user, record) on every record read/update.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy import false, func, or_, select
from sqlalchemy.orm import Query, Session, object_session

SCOPE_LEVELS = ("own", "assigned", "department", "plant", "multi_plant", "organization")
SCOPE_LABELS = {
    "own": "Own records",
    "assigned": "Own + assigned",
    "department": "Department",
    "plant": "Plant / branch",
    "multi_plant": "Multiple plants",
    "organization": "Entire organization",
}
_RANK = {s: i for i, s in enumerate(SCOPE_LEVELS)}


@dataclass
class ScopedModel:
    model: type
    module_key: str
    owner: tuple[str, ...] = ()
    # Column names holding a user id, or a callable(user) -> SQL expression
    # for many-to-many assignments (team members, assignees tables).
    assigned: tuple[str | Callable[[Any], Any], ...] = ()
    branch: str | None = None
    department: str | None = None  # free-text department column on the record, if any
    entity_type: str | None = None  # approval-engine entity_type, so approvers see what they approve
    label: str = "record"
    extra: dict = field(default_factory=dict)
    # Shared master data: visible to everyone who can open the module, whatever their scope.
    shared: bool = False


_REGISTRY: dict[type, ScopedModel] = {}


def register_scoped(model: type, module_key: str, *, owner=(), assigned=(), branch=None, department=None,
                    entity_type=None, label: str | None = None, shared: bool = False) -> None:
    """Declare how a module's record table maps onto data scopes. `owner`
    columns decide "own" (and department/plant through the owner's user row
    when the record has no plant column of its own)."""
    if isinstance(owner, str):
        owner = (owner,)
    if isinstance(assigned, str) or callable(assigned):
        assigned = (assigned,)
    _REGISTRY[model] = ScopedModel(
        model=model, module_key=module_key, owner=tuple(owner), assigned=tuple(assigned), branch=branch,
        department=department, entity_type=entity_type, label=label or model.__name__, shared=shared,
    )


def scoped_models() -> dict[type, ScopedModel]:
    return dict(_REGISTRY)


def _is_admin(user) -> bool:
    return user is not None and user.role == "admin"


def default_scope() -> str:
    """Scope for a module no role of the user sets one for (see module docstring)."""
    from app.core.config import settings

    level = settings.DEFAULT_DATA_SCOPE
    return level if level in _RANK else "assigned"


def wider(a: str, b: str) -> str:
    return a if _RANK.get(a, -1) >= _RANK.get(b, -1) else b


def user_scope(user, module_key: str) -> str:
    """The user's effective scope for one module (see module docstring)."""
    return _scope_for(user, module_key, module_key, None)


def edit_key(module_key: str) -> str:
    """Role.data_scopes key of a module's Edit scope ("crm:edit")."""
    return f"{module_key}:edit"


def user_edit_scope(user, module_key: str, default: str = "assigned") -> str:
    """Which records of a module the user may CHANGE (edit / stage / upload
    on someone else's record) — the role's Edit scope ("<module>:edit" in
    Role.data_scopes, Organization › Role & Permissions), owner decision
    2026-11-03: "see others' data, change only your own" is set per role,
    never coded. A role with no Edit scope gets `default` (each caller passes
    the level that matched the old behaviour). Never wider than the View scope."""
    if _is_admin(user):
        return "organization"
    level = _scope_for(user, module_key, edit_key(module_key), default if default in _RANK else "assigned")
    view = user_scope(user, module_key)
    return level if _RANK[level] <= _RANK[view] else view


def _scope_for(user, module_key: str, key: str, fallback: str | None) -> str:
    """Widest level stored under `key` among the user's roles that open
    `module_key` (personal override first); `fallback` (or default_scope())
    for a role that stores none."""
    if user is None:
        return "own"
    if _is_admin(user):
        return "organization"
    override = (getattr(user, "data_access_scopes", None) or {}).get(key)
    if override in _RANK:
        return override
    from app.core.permission_registry import expand_grants
    from app.modules.main.models.role import Role

    roles = [r for r in (getattr(user, "roles", None) or []) if r.is_active]
    session = object_session(user)
    if session is not None:
        roles += session.query(Role).filter(Role.is_default.is_(True), Role.is_active.is_(True)).all()
    best: str | None = None
    prefix = f"{module_key}:"
    for role in roles:
        if not any(g.startswith(prefix) for g in expand_grants(role.permissions or [])):
            continue
        level = (role.data_scopes or {}).get(key) or fallback or default_scope()
        if level not in _RANK:
            level = fallback or default_scope()
        best = level if best is None else wider(best, level)
    return best or fallback or default_scope()


def user_branch_ids(db: Session, user, level: str) -> set[int]:
    """Plants a plant / multi-plant scope covers for `user`."""
    ids: set[int] = {user.branch_id} if getattr(user, "branch_id", None) else set()
    if level == "multi_plant":
        from datetime import date

        from app.modules.organization.models.branch_user_assignment import BranchUserAssignment

        today = date.today()
        rows = (
            db.query(BranchUserAssignment)
            .filter(BranchUserAssignment.user_id == user.id, BranchUserAssignment.status == "active")
            .all()
        )
        for r in rows:
            if r.effective_from and r.effective_from > today:
                continue
            if r.effective_to and r.effective_to < today:
                continue
            ids.add(r.branch_id)
            for extra in r.additional_branch_access or []:
                if isinstance(extra, int):
                    ids.add(extra)
                elif isinstance(extra, dict) and isinstance(extra.get("branch_id"), int):
                    ids.add(extra["branch_id"])
    return ids


def _owner_expr(spec: ScopedModel, user_ids_select):
    cols = [getattr(spec.model, c) for c in spec.owner]
    return or_(*[c.in_(user_ids_select) for c in cols]) if cols else None


def _approver_expr(spec: ScopedModel, user):
    if not spec.entity_type:
        return None
    from app.modules.organization.models.approval import ApprovalRequest, ApprovalRequestStep

    sub = (
        select(ApprovalRequest.entity_id)
        .join(ApprovalRequestStep, ApprovalRequestStep.request_id == ApprovalRequest.id)
        .where(
            ApprovalRequest.entity_type == spec.entity_type,
            or_(ApprovalRequestStep.approver_id == user.id, ApprovalRequestStep.decided_by_id == user.id),
        )
    )
    return spec.model.id.in_(sub)


def scope_filter(db: Session, user, model: type, level: str | None = None):
    """SQL filter limiting `model` to the user's scope (or to `level`, e.g.
    their Edit scope); None = no restriction."""
    spec = _REGISTRY.get(model)
    if spec is None:
        raise RuntimeError(f"{model.__name__} is not registered with core.data_scope.register_scoped")
    if spec.shared and level is None:
        return None
    level = level or user_scope(user, spec.module_key)
    if level == "organization":
        return None
    from app.modules.main.models.user import User

    parts = []
    for c in spec.owner:
        parts.append(getattr(spec.model, c) == user.id)
    approver = _approver_expr(spec, user)
    if approver is not None:
        parts.append(approver)
    if _RANK[level] >= _RANK["assigned"]:
        for a in spec.assigned:
            parts.append(a(user) if callable(a) else getattr(spec.model, a) == user.id)
    if level == "department":
        from app.modules.organization.services.department_membership import peers_condition

        dept = (getattr(user, "department", None) or "").strip()
        same_dept = peers_condition(db, user)
        if same_dept is not None:
            peers = select(User.id).where(same_dept)
            owner = _owner_expr(spec, peers)
            if owner is not None:
                parts.append(owner)
            if spec.department and dept:
                parts.append(func.lower(getattr(spec.model, spec.department)) == dept.lower())
    if level in ("plant", "multi_plant"):
        branch_ids = user_branch_ids(db, user, level)
        if branch_ids:
            if spec.branch:
                parts.append(getattr(spec.model, spec.branch).in_(branch_ids))
            else:
                owner = _owner_expr(spec, select(User.id).where(User.branch_id.in_(branch_ids)))
                if owner is not None:
                    parts.append(owner)
    return or_(*parts) if parts else false()


def apply_scope(query: Query, user, model: type, db: Session | None = None) -> Query:
    """Limit a list query to the records the user's data scope covers."""
    expr = scope_filter(db or query.session, user, model)
    return query if expr is None else query.filter(expr)


def in_scope(db: Session, user, record) -> bool:
    model = type(record)
    expr = scope_filter(db, user, model)
    if expr is None:
        return True
    if db.query(model.id).filter(model.id == record.id, expr).first() is not None:
        return True
    # Delegates / escalation targets of a live approval step may open it too.
    spec = _REGISTRY[model]
    if spec.entity_type:
        from app.modules.organization.services.approval_engine import can_act_on_entity

        return can_act_on_entity(db, user, spec.entity_type, record.id)
    return False


def can_change(db: Session, user, record, default: str = "assigned") -> bool:
    """True if `record` is inside the user's Edit scope for its module (see
    user_edit_scope). The tab's Edit/feature grant is checked separately."""
    if record is None:
        return False
    spec = _REGISTRY[type(record)]
    level = user_edit_scope(user, spec.module_key, default)
    if level == "organization":
        return True
    expr = scope_filter(db, user, type(record), level=level)
    model = type(record)
    return expr is None or db.query(model.id).filter(model.id == record.id, expr).first() is not None


def ensure_can_change(db: Session, user, record, default: str = "assigned", action: str = "change") -> None:
    """403 with the reason when `record` is outside the user's Edit scope."""
    if record is None or can_change(db, user, record, default):
        return
    spec = _REGISTRY[type(record)]
    level = user_edit_scope(user, spec.module_key, default)
    raise HTTPException(
        status_code=403,
        detail=f"You can see this {spec.label} but can't {action} it — your Edit scope for this module is "
               f"'{SCOPE_LABELS[level]}'. Ask an admin to widen "
               "the Edit scope of your role in Organization › Role & Permissions (Data access › Edit).",
    )


def effective_scopes(user, module_keys) -> dict[str, str]:
    """{module: view level, "module:edit": edit level} for /auth/me, so
    screens can say why a list is narrowed and hide Edit on records outside
    the Edit scope. Edit levels use the generic default ("assigned")."""
    out: dict[str, str] = {}
    for mk in module_keys:
        out[mk] = user_scope(user, mk)
        out[edit_key(mk)] = user_edit_scope(user, mk)
    return out


def ensure_in_scope(db: Session, user, record) -> None:
    """403 with the reason when `record` is outside the user's data scope."""
    if record is None or in_scope(db, user, record):
        return
    spec = _REGISTRY[type(record)]
    level = user_scope(user, spec.module_key)
    raise HTTPException(
        status_code=403,
        detail=f"This {spec.label} is outside your data access — your scope for this module is "
               f"'{SCOPE_LABELS[level]}'. Ask an admin to widen it in Organization › Role & Permissions "
               "(Data access column of your role) if you need it.",
    )
