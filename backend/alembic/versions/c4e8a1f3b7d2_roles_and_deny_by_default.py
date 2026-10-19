"""Roles (named bundles of Permission Matrix grants) + user_roles, and the
switch to deny-by-default permissions without anyone losing access.

Before: a user saw a module if it was in `assigned_apps`; inside it, a user
with no Permission Matrix grants for that module was unrestricted (opt-in),
except for "authority" grants (settings edit, Quality head/engineer
decisions, PM management, approver lists) that always needed an explicit
grant. ERP create/edit/delete for machines/SRs came from `erp_permissions`.

After: access = roles + extra grants, nothing implied. To keep everyone's
day-one access identical, each non-admin user gets, per assigned module:
  * their existing grants for it, unchanged, if they had any (those already
    restricted them); else
  * the editable "<Module> – Standard access (migrated)" role: every grant
    of the module except the authority grants (AUTHORITY_GRANTS); for
    Service (erp) the machine/SR create/edit/delete come from their old
    erp_permissions instead, as extra grants.
Grants for modules the user wasn't assigned are dropped (they gave no
access before). Also seeds, per module, the built-in "Full Access" and
"View Only" presets, the four Quality roles, and an "Employee self-service"
role (not applied to everyone until an admin ticks it).

Revision ID: c4e8a1f3b7d2
Revises: d9f2b6a4c8e1
Create Date: 2026-10-08 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "c4e8a1f3b7d2"
down_revision = "d9f2b6a4c8e1"
branch_labels = None
depends_on = None

_roles = sa.table(
    "roles",
    sa.column("id", sa.Integer), sa.column("name", sa.String), sa.column("description", sa.Text),
    sa.column("permissions", sa.JSON), sa.column("is_system", sa.Boolean), sa.column("is_default", sa.Boolean),
    sa.column("is_active", sa.Boolean),
)
_users = sa.table(
    "users",
    sa.column("id", sa.Integer), sa.column("role", sa.String), sa.column("assigned_apps", sa.JSON),
    sa.column("erp_permissions", sa.JSON), sa.column("granular_permissions", sa.JSON),
)
_user_roles = sa.table("user_roles", sa.column("user_id", sa.Integer), sa.column("role_id", sa.Integer))

def upgrade() -> None:
    from app.core.permission_registry import (
        MODULES, NON_APP_MODULES, P2P_APPROVER_ROLE, legacy_access, standard_module_grants,
    )

    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "roles" not in tables:
        op.create_table(
            "roles",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(120), nullable=False, unique=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("permissions", sa.JSON(), nullable=False),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
    if "user_roles" not in tables:
        op.create_table(
            "user_roles",
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
        )

    existing = {name: rid for rid, name in bind.execute(sa.select(_roles.c.id, _roles.c.name)).all()}

    def ensure_role(name, permissions, description, *, system=False, default=False) -> int:
        if name in existing:
            return existing[name]
        bind.execute(_roles.insert().values(
            name=name, description=description, permissions=sorted(permissions),
            is_system=system, is_default=default, is_active=True,
        ))
        existing[name] = bind.execute(sa.select(_roles.c.id).where(_roles.c.name == name)).scalar_one()
        return existing[name]

    standard_role: dict[str, int] = {}
    for mk, m in MODULES.items():
        label = m["label"]
        ensure_role(f"{label} – Full Access", [f"{mk}:*:*"],
                    f"Everything in {label}: every tab and every action, including approvals and settings.", system=True)
        ensure_role(f"{label} – View Only", [f"{mk}:*:view"],
                    f"See every tab of {label}; cannot create, change, delete or approve anything.", system=True)
        if mk in NON_APP_MODULES:
            continue
        standard = sorted(standard_module_grants(mk))
        standard_role[mk] = ensure_role(
            f"{label} – Standard access (migrated)", standard,
            f"What every {label} user could do before roles existed: all tabs and actions except approver / "
            f"head / settings authority. Created by the roles migration — tighten or replace it.",
        )

    try:
        from app.modules.quality.services.access import QUALITY_ROLE_PERMISSION_SETS
    except Exception:  # pragma: no cover — Quality removed
        QUALITY_ROLE_PERMISSION_SETS = {}
    for spec in QUALITY_ROLE_PERMISSION_SETS.values():
        ensure_role(spec["label"], spec["grants"], f"{spec['label']} — Quality's standard permission set.")

    if "hr" in MODULES:
        ensure_role("Employee self-service", ["hr:me:view", "hr:me:create", "hr:me:edit"],
                    "My HR for every employee: own profile, leave, attendance, travel & claims. Tick 'Applies to "
                    "everyone' to give it to all users without assigning it one by one.")

    approver_role = ensure_role(P2P_APPROVER_ROLE[0], P2P_APPROVER_ROLE[1],
                                "Named PR / PO approvers from any department: open and decide the requisitions routed to "
                                "them. Who approves is still set in Procurement › Settings and on each PR.")
    approver_ids = _p2p_approver_ids(bind, tables)

    rows = bind.execute(sa.select(_users.c.id, _users.c.role, _users.c.assigned_apps, _users.c.erp_permissions,
                                  _users.c.granular_permissions)).all()
    held = {(u, r) for u, r in bind.execute(sa.select(_user_roles.c.user_id, _user_roles.c.role_id)).all()}
    for uid, role, apps, erp_perms, grants in rows:
        if role == "admin":
            continue
        keep, standard = legacy_access(apps, erp_perms, grants)
        new_roles = [standard_role[mk] for mk in standard if mk in standard_role]
        if uid in approver_ids:
            new_roles.append(approver_role)
        bind.execute(_users.update().where(_users.c.id == uid).values(granular_permissions=sorted(set(keep))))
        for rid in new_roles:
            if (uid, rid) not in held:
                bind.execute(_user_roles.insert().values(user_id=uid, role_id=rid))
                held.add((uid, rid))


def _p2p_approver_ids(bind, tables: set[str]) -> set[int]:
    """Users who approve requisitions today: Settings PR/PO approver lists,
    per-PR approvers, PO approvers, legacy PR approver columns and the
    PO-approval flags (Director, Partner, Purchase Head)."""
    ids: set[int] = set()
    if "module_settings" in tables:
        rows = bind.execute(sa.text("SELECT key, value FROM module_settings WHERE module_key = 'p2p'")).all()
        for key, value in rows:
            if "approver" not in (key or ""):
                continue
            if isinstance(value, str):
                import json
                try:
                    value = json.loads(value)
                except ValueError:
                    continue
            for v in value if isinstance(value, list) else [value]:
                if isinstance(v, int):
                    ids.add(v)
    for table in ("p2p_request_approvals", "p2p_request_po_approvers"):
        if table in tables:
            ids |= {r[0] for r in bind.execute(sa.text(f"SELECT DISTINCT approver_id FROM {table}")).all() if r[0]}
    if "p2p_requests" in tables:
        cols = {c["name"] for c in sa.inspect(bind).get_columns("p2p_requests")}
        for col in ("approver_id", "project_head_id", "plant_head_id", "purchase_head_id", "director_id"):
            if col in cols:
                ids |= {r[0] for r in bind.execute(sa.text(f"SELECT DISTINCT {col} FROM p2p_requests")).all() if r[0]}
    user_cols = {c["name"] for c in sa.inspect(bind).get_columns("users")}
    flags = [f for f in ("is_director", "is_partner", "is_purchase_head") if f in user_cols]
    if flags:
        cond = " OR ".join(f"{f} = :t" for f in flags)
        ids |= {r[0] for r in bind.execute(sa.text(f"SELECT id FROM users WHERE {cond}"), {"t": True}).all()}
    return ids


def downgrade() -> None:
    # Grants rewritten by upgrade() are not restored; roles are simply dropped.
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "user_roles" in tables:
        op.drop_table("user_roles")
    if "roles" in tables:
        op.drop_table("roles")
