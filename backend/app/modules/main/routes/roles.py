"""Organization › Role & Permissions: roles (named bundles of Permission
Matrix grants) and who holds them. See core/permission_registry.py for the
grant format and models/role.py for the model."""
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permission_registry import (
    ACTION_LABELS, ACTIONS, MODULES, expand_grants, is_admin_user, is_valid_grant,
)
from app.core.data_scope import SCOPE_LABELS, SCOPE_LEVELS, default_scope
from app.core.permissions import ensure_can_delete, ensure_feature_action, require_feature_action, require_tab_action
from app.core.permission_registry import can_feature
from app.core.notification_events import notify_event
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.role import Role, user_roles
from app.modules.main.models.user import User

router = APIRouter(prefix="/roles", tags=["Role & Permissions"])

_can_view = require_tab_action("organization", "roles", "view")
_can_create = require_tab_action("organization", "roles", "create")
_can_edit = require_tab_action("organization", "roles", "edit")


class RolePayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    permissions: list[str] = []
    # module_key -> data scope level; a module left out gets default_scope().
    data_scopes: dict[str, str] = {}
    is_default: bool = False
    is_active: bool = True
    # "<module>.<event>" -> channels (core/notification_events.py). None = leave unchanged.
    notification_events: dict[str, list[str]] | None = None
    # "<module>:<tab>.<feature>" -> assign-to rule (core/assignee_rules.py). None = leave unchanged.
    assignee_rules: dict[str, dict] | None = None


def _clean_assignee_rules(value) -> dict[str, dict]:
    from app.core.assignee_rules import clean_rules
    try:
        return clean_rules(value)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _clean_events(value) -> dict[str, list[str]]:
    from app.core.notification_events import clean_subscriptions
    try:
        return clean_subscriptions(value)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


class RoleMembersPayload(BaseModel):
    user_ids: list[int]
    # GRC: required when the change adds a high-risk SoD conflict (core/sod_rules.py)
    sod_mitigation_reason: str | None = None


class RoleCopyPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)


def _role_out(role: Role, user_count: int) -> dict:
    return {
        "id": role.id, "name": role.name, "description": role.description,
        "permissions": sorted(role.permissions or []), "data_scopes": role.data_scopes or {}, "is_system": role.is_system,
        "notification_events": role.notification_events or {},
        "assignee_rules": role.assignee_rules or {},
        "is_default": role.is_default, "is_active": role.is_active, "user_count": user_count,
        "created_at": role.created_at, "updated_at": role.updated_at,
    }


def _user_counts(db: Session) -> dict[int, int]:
    rows = db.query(user_roles.c.role_id, func.count(user_roles.c.user_id)).group_by(user_roles.c.role_id).all()
    return {rid: n for rid, n in rows}


def _get_role(db: Session, role_id: int) -> Role:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail=f"Role #{role_id} not found — it may have been deleted. Reload the list.")
    return role


def validate_grants(grants: list[str], actor: User) -> list[str]:
    """Reject unknown ids, and stop a non-admin role manager from handing out
    access they don't hold themselves (no privilege escalation)."""
    bad = [g for g in grants if not is_valid_grant(g)]
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown permission(s): {', '.join(sorted(bad)[:5])}. The tab or action may have been renamed — "
                   "reload the page to get the current matrix.",
        )
    if not is_admin_user(actor):
        beyond = expand_grants(grants) - actor.effective_permissions
        if beyond:
            raise HTTPException(
                status_code=403,
                detail=f"You can't grant permissions you don't hold yourself ({len(beyond)} of them, e.g. "
                       f"{', '.join(sorted(beyond)[:3])}). Ask an admin to make this change.",
            )
    return sorted(set(grants))


def validate_scopes(scopes: dict[str, str]) -> dict[str, str]:
    """Keep the scopes set for real modules. A module left blank gets
    default_scope(); "organization" is stored so a role can grant every record."""
    out: dict[str, str] = {}
    for mk, level in (scopes or {}).items():
        if not level:
            continue
        if mk not in MODULES or mk == "organization":
            raise HTTPException(status_code=400, detail=f"Unknown module '{mk}' in data access — reload the page.")
        if level not in SCOPE_LABELS:
            raise HTTPException(status_code=400, detail=f"Data access must be one of: {', '.join(SCOPE_LABELS.values())}.")
        out[mk] = level
    return out


def validate_scope_escalation(scopes: dict[str, str], actor: User, old: dict[str, str] | None = None) -> None:
    """No privilege escalation through data access either: a non-admin may
    only set (or widen to) a level no wider than their own scope for that
    module. Levels left as they were (`old`) are not re-checked."""
    if is_admin_user(actor):
        return
    from app.core.data_scope import user_scope

    rank = {s: i for i, s in enumerate(SCOPE_LEVELS)}
    for mk, level in (scopes or {}).items():
        if not level or (old is not None and (old or {}).get(mk) == level):
            continue
        mine = user_scope(actor, mk)
        if rank.get(level, -1) > rank.get(mine, -1):
            label = MODULES[mk]["label"] if mk in MODULES else mk
            raise HTTPException(
                status_code=403,
                detail=f"You can't give '{SCOPE_LABELS.get(level, level)}' data access for {label} — your own access there "
                       f"is '{SCOPE_LABELS.get(mine, mine)}', and you can't grant wider access than you hold. Pick "
                       f"'{SCOPE_LABELS.get(mine, mine)}' or narrower, or ask an admin to make this change.",
            )


def _ensure_unique_name(db: Session, name: str, exclude_id: int | None = None) -> str:
    name = name.strip()
    q = db.query(Role).filter(func.lower(Role.name) == name.lower())
    if exclude_id:
        q = q.filter(Role.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=409, detail=f"A role named '{name}' already exists — pick a different name.")
    return name


def _ensure_editable(role: Role) -> None:
    if role.is_system:
        raise HTTPException(
            status_code=400,
            detail=f"'{role.name}' is a built-in preset and can't be changed. Use 'Copy' to make an editable role from it.",
        )


def _audit(db: Session, actor: User, role: Role, action: str, summary: str, old=None, new=None) -> None:
    db.add(AuditLog(
        entity_type="role", entity_id=role.id, action=action, module_key="organization", subtab_key="roles",
        summary=summary, performed_by_id=actor.id,
        old_value=json.dumps(old, default=str) if old is not None else None,
        new_value=json.dumps(new, default=str) if new is not None else None,
    ))


@router.get("/catalog")
async def get_catalog(_user: User = Depends(_can_view)):
    """Every module, its tabs (with group headings) and the actions each tab
    has — what the role editor renders."""
    return {"modules": MODULES, "actions": ACTIONS, "action_labels": ACTION_LABELS,
            "scope_levels": list(SCOPE_LEVELS), "scope_labels": SCOPE_LABELS,
            "default_scope": default_scope(), "assignee_rules": _assignee_catalog()}


def _assignee_catalog() -> dict:
    from app.core.assignee_rules import catalog
    return catalog()


@router.get("/notification-events")
async def notification_event_catalog(_user: User = Depends(_can_view)):
    """Every notifiable event per module (label, trigger, permission needed to
    receive it) and the channels — what the role editor's Notifications tab renders."""
    from app.core.notification_events import catalog
    return catalog()


@router.get("")
async def list_roles(db: Session = Depends(get_db), _user: User = Depends(_can_view)):
    counts = _user_counts(db)
    roles = db.query(Role).order_by(Role.is_system, Role.name).all()
    return [_role_out(r, counts.get(r.id, 0)) for r in roles]


@router.get("/{role_id}")
async def get_role(role_id: int, db: Session = Depends(get_db), _user: User = Depends(_can_view)):
    role = _get_role(db, role_id)
    members = (
        db.query(User).join(user_roles, user_roles.c.user_id == User.id)
        .filter(user_roles.c.role_id == role.id).order_by(User.name).all()
    )
    out = _role_out(role, len(members))
    # Role › Users (core/features/organization.py): the holder list needs members:view.
    out["users"] = [] if not can_feature(_user, "organization", "roles", "members", "view") else [
        {"id": u.id, "name": u.name, "email": u.email, "department": u.department,
                     "is_active": u.is_active} for u in members]
    return out


@router.post("")
async def create_role(payload: RolePayload, db: Session = Depends(get_db), actor: User = Depends(_can_create)):
    # Data access / Notifications tabs (features): setting them needs their Edit.
    if validate_scopes(payload.data_scopes):
        ensure_feature_action(actor, "organization", "roles", "data_access", "edit")
    if payload.notification_events and _clean_events(payload.notification_events):
        ensure_feature_action(actor, "organization", "roles", "notifications", "edit")
    role = Role(
        name=_ensure_unique_name(db, payload.name), description=payload.description,
        permissions=validate_grants(payload.permissions, actor), is_default=payload.is_default,
        is_active=payload.is_active, created_by_id=actor.id, data_scopes=validate_scopes(payload.data_scopes),
        notification_events=_clean_events(payload.notification_events),
        assignee_rules=_clean_assignee_rules(payload.assignee_rules),
    )
    validate_scope_escalation(role.data_scopes, actor)
    db.add(role)
    db.flush()
    _audit(db, actor, role, "created", f"{actor.name} created role '{role.name}' ({len(role.permissions)} grant(s))",
           new={"permissions": role.permissions, "is_default": role.is_default})
    db.commit()
    db.refresh(role)
    return _role_out(role, 0)


@router.patch("/{role_id}")
async def update_role(role_id: int, payload: RolePayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                      actor: User = Depends(_can_edit)):
    role = _get_role(db, role_id)
    _ensure_editable(role)
    old = {"name": role.name, "description": role.description, "permissions": sorted(role.permissions or []),
           "data_scopes": dict(role.data_scopes or {}), "is_default": role.is_default, "is_active": role.is_active,
           "notification_events": dict(role.notification_events or {}),
           "assignee_rules": dict(role.assignee_rules or {})}
    # Data access / Notifications tabs (features): changing them needs their Edit;
    # sending them back unchanged (the editor always sends everything) is fine.
    if validate_scopes(payload.data_scopes) != old["data_scopes"]:
        ensure_feature_action(actor, "organization", "roles", "data_access", "edit")
    if payload.notification_events is not None and _clean_events(payload.notification_events) != old["notification_events"]:
        ensure_feature_action(actor, "organization", "roles", "notifications", "edit")
    role.name = _ensure_unique_name(db, payload.name, exclude_id=role.id)
    role.description = payload.description
    role.permissions = validate_grants(payload.permissions, actor)
    role.data_scopes = validate_scopes(payload.data_scopes)
    validate_scope_escalation(role.data_scopes, actor, old["data_scopes"])
    role.is_default = payload.is_default
    role.is_active = payload.is_active
    if payload.notification_events is not None:
        role.notification_events = _clean_events(payload.notification_events)
    if payload.assignee_rules is not None:
        role.assignee_rules = _clean_assignee_rules(payload.assignee_rules)
    new = {"name": role.name, "description": role.description, "permissions": role.permissions,
           "data_scopes": role.data_scopes, "is_default": role.is_default, "is_active": role.is_active,
           "notification_events": dict(role.notification_events or {}),
           "assignee_rules": dict(role.assignee_rules or {})}
    added = sorted(set(new["permissions"]) - set(old["permissions"]))
    removed = sorted(set(old["permissions"]) - set(new["permissions"]))
    changed = [k for k in new if new[k] != old[k]]
    access_changed = [k for k in ("permissions", "data_scopes", "assignee_rules", "is_default", "is_active") if new[k] != old[k]]
    if access_changed:
        what = (f"+{len(added)} / -{len(removed)} permission(s)" if added or removed else "") or ", ".join(
            {"data_scopes": "data access", "assignee_rules": "assign-to rules", "is_default": "'applies to everyone'", "is_active": "active flag"}.get(k, k) for k in access_changed)
        notify_event(db, background_tasks, "organization", "role_changed", title=f"Role '{role.name}' changed",
                     message=f"{actor.name} changed role '{role.name}' ({what}). Its holders get the new access on their next page load.",
                     entity_type="role", entity_id=role.id, actor=actor)
    if changed:
        _audit(db, actor, role, "updated",
               f"{actor.name} updated role '{role.name}'" + (f" (+{len(added)}/-{len(removed)} grants)" if added or removed else
                                                           f" ({', '.join(changed)})"),
               old={k: old[k] for k in changed}, new={k: new[k] for k in changed})
    db.commit()
    return await get_role(role.id, db, actor)


@router.post("/{role_id}/copy")
async def copy_role(role_id: int, payload: RoleCopyPayload, db: Session = Depends(get_db), actor: User = Depends(_can_create)):
    source = _get_role(db, role_id)
    role = Role(
        name=_ensure_unique_name(db, payload.name), description=source.description,
        permissions=validate_grants(list(source.permissions or []), actor), created_by_id=actor.id,
        data_scopes=dict(source.data_scopes or {}),
        notification_events=dict(source.notification_events or {}),
        assignee_rules=dict(source.assignee_rules or {}),
    )
    validate_scope_escalation(role.data_scopes, actor)
    db.add(role)
    db.flush()
    _audit(db, actor, role, "created", f"{actor.name} created role '{role.name}' as a copy of '{source.name}'",
           new={"permissions": role.permissions})
    db.commit()
    db.refresh(role)
    return _role_out(role, 0)


@router.delete("/{role_id}")
async def delete_role(role_id: int, db: Session = Depends(get_db), actor: User = Depends(_can_view)):
    role = _get_role(db, role_id)
    _ensure_editable(role)
    ensure_can_delete(actor, role, "organization", "roles", what="role")
    holders = _user_counts(db).get(role.id, 0)
    if holders:
        raise HTTPException(
            status_code=409,
            detail=f"'{role.name}' is still assigned to {holders} user(s). Remove it from them first (Users tab of "
                   "this role), or mark the role inactive instead.",
        )
    _audit(db, actor, role, "deleted", f"{actor.name} deleted role '{role.name}'", old={"permissions": role.permissions})
    db.delete(role)
    db.commit()
    return {"ok": True}


@router.put("/{role_id}/users")
async def set_role_members(role_id: int, payload: RoleMembersPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                           actor: User = Depends(require_feature_action("organization", "roles", "members", "edit"))):
    """Replace who holds this role."""
    role = _get_role(db, role_id)
    if not is_admin_user(actor):
        validate_grants(list(role.permissions or []), actor)
    wanted = set(payload.user_ids)
    users = db.query(User).filter(User.id.in_(wanted)).all() if wanted else []
    missing = wanted - {u.id for u in users}
    if missing:
        raise HTTPException(status_code=404, detail=f"User(s) not found: {', '.join(map(str, sorted(missing)))}")
    current = db.query(User).join(user_roles, user_roles.c.user_id == User.id).filter(user_roles.c.role_id == role.id).all()
    added = [u for u in users if u not in current]
    removed = [u for u in current if u.id not in wanted]
    if not is_admin_user(actor) and (added or removed):
        # Same authority rules as Users › Roles: a non-admin can't change their
        # own roles (self-promotion) or an admin's, and can't hand out a role
        # whose data access is wider than their own.
        for u in added + removed:
            if u.id == actor.id:
                raise HTTPException(
                    status_code=403,
                    detail=f"You can't add yourself to or remove yourself from '{role.name}'. Ask an admin (or another "
                           "user with Organization › Role & Permissions 'Edit') to change your roles.",
                )
            if is_admin_user(u):
                raise HTTPException(
                    status_code=403,
                    detail=f"{u.name or u.email} is an admin — only another admin can change an admin's roles. "
                           "Leave them out of this change.",
                )
        if added:
            validate_scope_escalation(dict(role.data_scopes or {}), actor)
    from app.modules.main.services.grc import check_assignment, permissions_after
    for u in added:
        check_assignment(db, u, actor, permissions_after(db, [r.id for r in u.roles] + [role.id], None, u),
                         payload.sod_mitigation_reason)
    for u in added:
        u.roles.append(role)
    for u in removed:
        u.roles.remove(role)
    if added or removed:
        _audit(db, actor, role, "members_updated",
               f"{actor.name} changed holders of '{role.name}': +{', '.join(u.name for u in added) or '—'} "
               f"/ -{', '.join(u.name for u in removed) or '—'}")
        for u in added + removed:
            db.add(AuditLog(
                entity_type="user_permissions", entity_id=u.id, action="update", module_key="organization",
                summary=f"{actor.name} {'gave' if u in added else 'removed'} role '{role.name}' "
                        f"{'to' if u in added else 'from'} {u.name}",
                performed_by_id=actor.id,
            ))
        notify_event(db, background_tasks, "organization", "role_members_changed", title=f"Holders of '{role.name}' changed",
                     message=f"{actor.name} changed who holds role '{role.name}': added {', '.join(u.name or u.email for u in added) or 'nobody'}; "
                             f"removed {', '.join(u.name or u.email for u in removed) or 'nobody'}.",
                     entity_type="role", entity_id=role.id, actor=actor)
    db.commit()
    return await get_role(role.id, db, actor)
