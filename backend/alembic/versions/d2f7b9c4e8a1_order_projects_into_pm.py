"""Order Projects move from Sales to Project Management (2026-10-23).

The tab `sales:order_projects:*` becomes `projects:order_projects:*`. Stored
grants in roles, users' extra grants and approval stage configs are renamed.
A Sales wildcard (`sales:*:view` / `sales:*:*`) used to cover the tab, so it
gets the matching explicit Project Management grant — nobody loses access.
Holding the grant gives the "projects" app (User.get_apps).

Revision ID: d2f7b9c4e8a1
Revises: c7e1a3f9d2b5
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "d2f7b9c4e8a1"
down_revision = "c7e1a3f9d2b5"
branch_labels = None
depends_on = None

OLD, NEW = "sales:order_projects:", "projects:order_projects:"
ACTIONS = ("view", "edit")


def _load(v):
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else v


def _rename_list(grants, forward: bool):
    if not isinstance(grants, list):
        return grants, False
    src, dst = (OLD, NEW) if forward else (NEW, OLD)
    out, changed = [], False
    for g in grants:
        if isinstance(g, str) and g.startswith(src):
            g, changed = dst + g[len(src):], True
        if g not in out:
            out.append(g)
    if forward:
        for g in list(out):
            if isinstance(g, str) and g.startswith("sales:*:"):
                a = g.split(":")[2]
                for x in ACTIONS:
                    if a in ("*", x) and NEW + x not in out:
                        out.append(NEW + x)
                        changed = True
    return out, changed


def _rename_cfg(cfg, forward: bool):
    if not isinstance(cfg, dict) or "plus_permission" not in cfg:
        return cfg, False
    src, dst = (OLD, NEW) if forward else (NEW, OLD)
    plus = cfg["plus_permission"]
    if isinstance(plus, str) and plus.startswith(src):
        return {**cfg, "plus_permission": dst + plus[len(src):]}, True
    if isinstance(plus, list) and any(isinstance(p, str) and p.startswith(src) for p in plus):
        return {**cfg, "plus_permission": [dst + p[len(src):] if isinstance(p, str) and p.startswith(src) else p for p in plus]}, True
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
