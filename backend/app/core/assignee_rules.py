"""Assignee rules: per role, WHO a person may pick in an "Assign to" field.

A feature grant (R&D › Requirements › Tasks › Create) says whether someone
may give a task at all. An assignee rule narrows the people they may give it
to — the "value restriction" of SAP authorization fields. It is set per role,
on the feature row of the Permission Matrix, and stored on
Role.assignee_rules as  "<module>:<tab>.<feature>" -> rule:

    {"mode": "self"}                      only themselves
    {"mode": "team"}                      themselves + everyone reporting to them (any depth)
    {"mode": "department"}                people of their own department
    {"mode": "custom", "departments": [dept ids], "roles": [role ids], "users": [user ids]}

No rule = everyone the screen already allows (its own record rules — the
requirement's departments, the project team — always apply on top).

Several roles: only roles that open the feature count; the user may pick
anyone ANY of them allows, and one of them with no rule means no restriction
(roles add access, never take it away). Admins are never restricted."""
from fastapi import HTTPException
from sqlalchemy.orm import Session, object_session

# Pickers that take a rule: "<module>:<tab>.<feature>" -> (label, hint).
# Each module declares its own in core/features/<module>.py with
# register_pickers(), next to the feature the picker belongs to (the feature
# must exist — test_assignee_rules checks). The Permission Matrix shows an
# "Assign to" chip on that feature's row.
PICKERS: dict[str, tuple[str, str]] = {}


def register_pickers(module_key: str, tab_key: str, *pickers: tuple[str, str, str]) -> None:
    """Declare the "Assign to"-style fields of one tab: (feature key, label, hint)."""
    for feature_key, label, hint in pickers:
        PICKERS[f"{module_key}:{tab_key}.{feature_key}"] = (label, hint)

MODES = {
    "self": "Only themselves",
    "team": "Their team (people reporting to them)",
    "department": "Their own department",
    "custom": "Selected departments / roles / people",
}


def catalog() -> dict:
    return {"pickers": {k: {"label": l, "hint": h} for k, (l, h) in PICKERS.items()}, "modes": MODES}


def clean_rules(value) -> dict[str, dict]:
    """Validate a role's rules; drop empty ones. Raises ValueError with a
    user-facing message."""
    out: dict[str, dict] = {}
    for key, rule in (value or {}).items():
        if not rule:
            continue
        if key not in PICKERS:
            raise ValueError(f"'{key}' isn't an assign-to field that takes a rule — reload the page to get the current matrix.")
        mode = (rule or {}).get("mode")
        if mode not in MODES:
            raise ValueError(f"Assign-to rule must be one of: {', '.join(MODES.values())}.")
        if mode != "custom":
            out[key] = {"mode": mode}
            continue
        picked = {k: sorted({int(x) for x in (rule.get(k) or [])}) for k in ("departments", "roles", "users")}
        if not any(picked.values()):
            raise ValueError(f"'{PICKERS[key][0]}' is set to selected departments / roles / people but none are picked — "
                             "pick at least one, or choose another option.")
        out[key] = {"mode": "custom", **picked}
    return out


def _relevant_rules(user, key: str) -> list[dict | None]:
    """The rule of every role of `user` that opens the picker's feature
    (None = that role sets no rule)."""
    from app.core.permission_registry import expand_grants
    from app.modules.main.models.role import Role

    module, tabfeat = key.split(":", 1)
    needle = f"{module}:{tabfeat}:view"
    roles = [r for r in (getattr(user, "roles", None) or []) if r.is_active]
    session = object_session(user)
    if session is not None:
        roles += session.query(Role).filter(Role.is_default.is_(True), Role.is_active.is_(True)).all()
    out: list[dict | None] = []
    for role in roles:
        if needle in expand_grants(role.permissions or []):
            out.append((role.assignee_rules or {}).get(key))
    return out


def _team_ids(db: Session, user) -> set[int]:
    from app.modules.main.models.user import User

    ids, frontier = {user.id}, {user.id}
    while frontier:
        frontier = {i for (i,) in db.query(User.id).filter(User.reporting_manager_id.in_(frontier)).all()} - ids
        ids |= frontier
    return ids


def allowed_ids(db: Session, user, key: str) -> set[int] | None:
    """User ids `user` may pick in this field, or None = no restriction."""
    from app.core.permission_registry import is_admin_user
    from app.modules.main.models.role import user_roles
    from app.modules.main.models.user import User

    if is_admin_user(user):
        return None
    rules = _relevant_rules(user, key)
    if not rules or any(r is None for r in rules):
        return None
    ids: set[int] = set()
    for r in rules:
        mode = r.get("mode")
        if mode == "self":
            ids.add(user.id)
        elif mode == "team":
            ids |= _team_ids(db, user)
        elif mode == "department":
            ids.add(user.id)
            if user.department_id:
                ids |= {i for (i,) in db.query(User.id).filter(User.department_id == user.department_id).all()}
        elif mode == "custom":
            if r.get("users"):
                ids |= set(r["users"])
            if r.get("departments"):
                ids |= {i for (i,) in db.query(User.id).filter(User.department_id.in_(r["departments"])).all()}
            if r.get("roles"):
                ids |= {i for (i,) in db.query(user_roles.c.user_id).filter(user_roles.c.role_id.in_(r["roles"])).all()}
    return ids


def allowed_payload(db: Session, user, key: str) -> dict:
    """For pickers fed by a generic user list (the frontend filters it):
    {"restricted": False} or {"restricted": True, "user_ids": [...]}."""
    if key not in PICKERS:
        raise HTTPException(status_code=404, detail=f"'{key}' isn't an assign-to field that takes a rule — reload the page.")
    allowed = allowed_ids(db, user, key)
    return {"restricted": False} if allowed is None else {"restricted": True, "user_ids": sorted(allowed)}


def filter_people(db: Session, user, key: str, rows: list, id_of=lambda r: r["id"]) -> list:
    """Keep only the rows (people offered in a picker) `user` may pick."""
    allowed = allowed_ids(db, user, key)
    return rows if allowed is None else [r for r in rows if id_of(r) in allowed]


def ensure_allowed(db: Session, user, key: str, assignee) -> None:
    """403 when `assignee` is outside what `user`'s roles let them pick."""
    allowed = allowed_ids(db, user, key)
    if allowed is None or assignee.id in allowed:
        return
    name = getattr(assignee, "name", None) or getattr(assignee, "email", None) or f"user #{assignee.id}"
    raise HTTPException(
        status_code=403,
        detail=f"Your role doesn't let you assign this to {name}. Pick someone from the list, or ask an admin to widen "
               f"'{PICKERS[key][0]}' for your role (Organization › Role & Permissions › the feature's row).")
