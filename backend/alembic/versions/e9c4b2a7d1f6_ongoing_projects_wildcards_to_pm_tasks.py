"""Department "Ongoing Projects" rows removed (2026-11-03): a role (or user extra grants) that held a
whole-module wildcard on Design / R&D / Electrical / Hydraulic / Maintenance / Production / Store /
Quality ("design:*:*", "store:*:view" ...) reached the Project Management task screens through that
row. Explicit row grants alias at runtime (permission_registry.legacy_grant_aliases); wildcards can't,
so this adds the same actions on Project Management › My Tasks and Department Work to those lists —
nobody loses task access (owner decision 2026-11-03).

Revision ID: e9c4b2a7d1f6
Revises: d5f1b7a3c9e2
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "e9c4b2a7d1f6"
down_revision = "d5f1b7a3c9e2"
branch_labels = None
depends_on = None

DEPT_MODULES = ("design", "rnd", "electrical", "hydraulic", "maintenance", "production", "store", "quality")
ROW_ACTIONS = ("view", "edit")  # the Ongoing Projects row offered View / Edit
PM_TABS = ("my_tasks", "department_work")


def _load(v):
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else v


def _fill(grants):
    if not isinstance(grants, list):
        return grants, False
    strs = {g for g in grants if isinstance(g, str)}
    wanted: set[str] = set()
    for mk in DEPT_MODULES:
        for a in ("*",) + ROW_ACTIONS:
            if f"{mk}:*:{a}" in strs:
                wanted.update(ROW_ACTIONS if a == "*" else (a,))
    if "edit" in wanted:
        wanted.add("view")  # any action on a tab implies viewing it
    out, changed = list(grants), False
    for tab in PM_TABS:
        for a in ROW_ACTIONS:
            gid = f"projects:{tab}:{a}"
            if a in wanted and gid not in strs and f"projects:{tab}:*" not in strs and "projects:*:*" not in strs:
                out.append(gid)
                changed = True
    return out, changed


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    for name, col in (("roles", "permissions"), ("users", "granular_permissions")):
        if name not in tables or col not in {c["name"] for c in insp.get_columns(name)}:
            continue
        t = sa.table(name, sa.column("id", sa.Integer), sa.column(col, sa.JSON))
        for rid, val in bind.execute(sa.select(t.c.id, t.c[col])).fetchall():
            new, changed = _fill(_load(val))
            if changed:
                bind.execute(t.update().where(t.c.id == rid).values({col: new}))


def downgrade() -> None:
    # Not reversible: an added task grant can't be told apart from one an admin ticked later.
    pass
