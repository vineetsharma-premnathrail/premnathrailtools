"""Quality roles as Permission Matrix permission sets, and the authority
checks the workflows use.

Roles are not a new mechanism: each role is a set of `quality:<subtab>:<action>`
grants an admin applies to a user (Quality → Settings → Quality roles, or
Users → Permission Matrix). Ordinary actions (view, record results, raise
an NCR, draft a plan) follow the app-wide opt-in matrix rule (a user with
no Quality grants at all is unrestricted). *Authority* actions — usage
decisions, plan approval, NCR disposition approvals, settings — need an
explicit grant (or admin), so nobody becomes a Quality head by default."""
from sqlalchemy.orm import Session

from app.core.permission_registry import has_grant, permission_id
from app.modules.main.models.user import User


def _grants(*pairs: tuple[str, str]) -> list[str]:
    return [permission_id("quality", tab, action) for tab, actions in pairs for action in actions.split(",")]


_INSPECTOR = _grants(
    ("dashboard", "view"), ("my_inspections", "view,edit"), ("inspection_lots", "view,edit"),
    ("ncr", "view,create"), ("inspection_plans", "view"), ("masters", "view"),
    ("in_process_inspection", "view,edit"), ("final_inspection", "view,edit"),
    ("first_article", "view,edit"), ("inspection_calls", "view"),
    ("capa", "view"), ("complaints", "view"), ("supplier_quality", "view"),
)
_ENGINEER = sorted(set(_INSPECTOR + _grants(
    ("inspection_lots", "create,approve"), ("ncr", "edit"), ("inspection_plans", "create,edit,submit,cancel"),
    ("masters", "create,edit"), ("settings", "view"), ("capa", "view,create,edit"), ("reports", "view"),
    ("standards", "view"), ("documents", "view"),
    ("first_article", "create,approve"), ("inspection_calls", "create,edit"),
    ("complaints", "view,create,edit"), ("supplier_quality", "view,create,edit"),
)))
_HEAD = sorted(set(_ENGINEER + _grants(
    ("ncr", "approve"), ("inspection_plans", "approve"), ("settings", "edit"), ("capa", "approve"),
    ("complaints", "approve"), ("supplier_quality", "approve"), ("standards", "create,edit"),
    ("documents", "create,edit"), ("project_work", "view"), ("inspection_calls", "approve"),
)))
_CALIBRATION = _grants(("dashboard", "view"), ("masters", "view"), ("reports", "view"))

QUALITY_ROLE_PERMISSION_SETS: dict[str, dict] = {
    "inspector": {"label": "Quality inspector", "grants": sorted(set(_INSPECTOR))},
    "engineer": {"label": "Quality engineer", "grants": _ENGINEER},
    "head": {"label": "Quality head", "grants": _HEAD},
    "calibration_incharge": {"label": "Calibration in-charge", "grants": sorted(set(_CALIBRATION))},
}


def _explicit(user: User, tab: str, action: str) -> bool:
    return has_grant(user, permission_id("quality", tab, action))


def is_quality_head(user: User) -> bool:
    return _explicit(user, "ncr", "approve")


def is_quality_engineer(user: User) -> bool:
    """Engineer authority (heads hold it too)."""
    return _explicit(user, "ncr", "edit") or is_quality_head(user)


def can_decide_lot(user: User) -> bool:
    return _explicit(user, "inspection_lots", "approve")


def can_approve_fai(user: User) -> bool:
    """First article approval releases an item / revision / vendor for
    regular use (rule 9) — a Quality engineer's authority."""
    return _explicit(user, "first_article", "approve")


def can_record_call_result(user: User) -> bool:
    """Recording a third-party inspection result (it releases dispatch)."""
    return _explicit(user, "inspection_calls", "edit")


def can_approve_plan(user: User) -> bool:
    return _explicit(user, "inspection_plans", "approve")


def can_close_capa(user: User) -> bool:
    """D8 effectiveness verdict / closure / reopen of a CAPA — Quality head."""
    return _explicit(user, "capa", "approve")


def can_edit_capa(user: User) -> bool:
    """Working a CAPA's 8D steps (Quality engineer or head)."""
    return _explicit(user, "capa", "edit") or can_close_capa(user)


def can_close_complaint(user: User) -> bool:
    """Reject (not valid) / close a customer complaint — Quality head."""
    return _explicit(user, "complaints", "approve")


def can_approve_vendor(user: User) -> bool:
    """Approve a vendor for an item, request a block, recompute ratings —
    Quality head (Blocked itself needs a Partner)."""
    return _explicit(user, "supplier_quality", "approve")


def can_edit_settings(user: User) -> bool:
    return _explicit(user, "settings", "edit")


def is_design_authority(user: User) -> bool:
    return user.role == "admin" or "design" in user.get_apps()


def is_purchase_authority(user: User) -> bool:
    return user.role == "admin" or bool(getattr(user, "is_purchase_head", False)) or "purchase" in user.get_apps()


def is_partner(user: User) -> bool:
    # is_partner is set only in Company Info → Partners (Partners are the top
    # approval authority — there is no MD / plant head role).
    return bool(getattr(user, "is_partner", False))


def users_with_grant(db: Session, tab: str, action: str) -> list[User]:
    """Active users holding an explicit quality grant (JSON column, so
    filtered in Python — the user table is small)."""
    pid = permission_id("quality", tab, action)
    return [u for u in db.query(User).filter(User.is_active.is_(True)).all() if pid in u.effective_permissions]


def quality_heads(db: Session) -> list[User]:
    return users_with_grant(db, "ncr", "approve")


def quality_engineers(db: Session) -> list[User]:
    seen = {u.id: u for u in users_with_grant(db, "ncr", "edit")}
    for u in quality_heads(db):
        seen.setdefault(u.id, u)
    return list(seen.values())


def partners(db: Session) -> list[User]:
    if not hasattr(User, "is_partner"):
        return []
    return db.query(User).filter(User.is_partner.is_(True), User.is_active.is_(True)).all()


def purchase_contacts(db: Session) -> list[User]:
    """Purchase heads (User.is_purchase_head); when nobody is flagged, every
    active non-admin user of the Purchase module."""
    users = db.query(User).filter(User.is_active.is_(True)).all()
    heads = [u for u in users if getattr(u, "is_purchase_head", False)]
    return heads or [u for u in users if u.role != "admin" and "purchase" in u.get_apps()]


def apply_role(user: User, role: str, db: Session | None = None) -> list[str]:
    """Give `user` the Quality role — the matching Role row (seeded as e.g.
    "Quality Inspector", editable in Organization › Role & Permissions) when
    it exists, else the code-defined grants as extra grants. Returns the ids
    the user newly holds."""
    from sqlalchemy.orm import object_session
    from app.modules.main.models.role import Role

    db = db or object_session(user)
    if role not in QUALITY_ROLE_PERMISSION_SETS:
        raise ValueError(f"Unknown Quality role '{role}' — use one of: {', '.join(QUALITY_ROLE_PERMISSION_SETS)}.")
    before = set(user.effective_permissions)
    row = None if db is None else db.query(Role).filter(Role.name == QUALITY_ROLE_PERMISSION_SETS[role]["label"], Role.is_active.is_(True)).first()
    if row is not None:
        if row not in user.roles:
            user.roles.append(row)
    else:
        current = list(user.granular_permissions or [])
        user.granular_permissions = current + [g for g in QUALITY_ROLE_PERMISSION_SETS[role]["grants"] if g not in current]
    user.invalidate_permissions()
    return sorted(user.effective_permissions - before)


def user_quality_roles(user: User) -> list[str]:
    held = {r.name for r in user.roles or [] if r.is_active}
    grants = user.effective_permissions
    return [k for k, v in QUALITY_ROLE_PERMISSION_SETS.items() if v["label"] in held or set(v["grants"]) <= grants]


# Registers Quality's data scopes and approval transaction types (core.data_scope,
# approval engine) whenever any Quality code is loaded.
from app.modules.quality.services import authz  # noqa: E402,F401
