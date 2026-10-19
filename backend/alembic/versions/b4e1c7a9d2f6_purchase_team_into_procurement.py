"""Purchase Team is not a module (2026-10-19).

The old "Purchase Team" permission module (`purchase:desk:view`) becomes the
Procurement › Purchase Desk tab (`p2p:purchase_desk:view`). Stored grants in
roles, users' extra grants and approval stage configs are renamed; any
`purchase:*` grant becomes the one desk grant. Holding it still gives the
internal "purchase" app (User.get_apps), so access does not change.

Revision ID: b4e1c7a9d2f6
Revises: a7d3e9c1b5f2
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "b4e1c7a9d2f6"
down_revision = "a7d3e9c1b5f2"
branch_labels = None
depends_on = None

OLD = "purchase:desk:view"
NEW = "p2p:purchase_desk:view"


def _load(v):
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else v


def _rename_list(grants, forward: bool):
    if not isinstance(grants, list):
        return grants, False
    out, changed = [], False
    for g in grants:
        if forward and isinstance(g, str) and g.startswith("purchase:"):
            g, changed = NEW, True
        elif not forward and g == NEW:
            g, changed = OLD, True
        if g not in out:
            out.append(g)
    return out, changed


def _rename_cfg(cfg, forward: bool):
    if not isinstance(cfg, dict) or "plus_permission" not in cfg:
        return cfg, False
    src, dst = (OLD, NEW) if forward else (NEW, OLD)
    plus = cfg["plus_permission"]
    if plus == src:
        return {**cfg, "plus_permission": dst}, True
    if isinstance(plus, list) and src in plus:
        return {**cfg, "plus_permission": [dst if p == src else p for p in plus]}, True
    return cfg, False


def _migrate(forward: bool) -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for name, col, fn in (("roles", "permissions", _rename_list), ("users", "granular_permissions", _rename_list),
                          ("approval_workflow_stages", "rule_config", _rename_cfg)):
        if name not in tables:
            continue
        t = sa.table(name, sa.column("id", sa.Integer), sa.column(col, sa.JSON))
        for rid, val in bind.execute(sa.select(t.c.id, t.c[col])).fetchall():
            new, changed = fn(_load(val), forward)
            if changed:
                bind.execute(t.update().where(t.c.id == rid).values({col: new}))


def upgrade() -> None:
    _migrate(True)


def downgrade() -> None:
    _migrate(False)
