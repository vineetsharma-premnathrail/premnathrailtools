"""Past Projects (machines) tab merged into All Projects (2026-11-02).

The separate Project Management tab `projects:service_projects:*` no longer exists: the machine
register is shown inside All Projects, so its grants become `projects:all_projects:*` and its
feature grants `projects:service_projects.<f>:*` become `projects:all_projects.<f>:*` (roles,
users' extra grants, approval stage configs). All Projects now also has print / import.

Side effects, on purpose (owner decision): a role that only opened the machine register now
opens All Projects too (one tab), and a Project Management wildcard (projects:*:*) covers
machines, which the old explicit-only tab did not.

Revision ID: b8d2f6a1c3e5
Revises: e7a1c3d5b9f2
Create Date: 2026-11-02
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "b8d2f6a1c3e5"
down_revision = "e7a1c3d5b9f2"
branch_labels = None
depends_on = None

OLD, NEW = "projects:service_projects", "projects:all_projects"


def _load(v):
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else v


def _moved(g: str) -> str | None:
    for sep in (":", "."):
        if g.startswith(OLD + sep):
            return NEW + g[len(OLD):]
    return None


def _rename_list(grants):
    if not isinstance(grants, list):
        return grants, False
    out, changed = [], False
    for g in grants:
        if isinstance(g, str):
            m = _moved(g)
            if m:
                g, changed = m, True
        if g not in out:
            out.append(g)
    return out, changed


def _rename_cfg(cfg):
    if not isinstance(cfg, dict) or "plus_permission" not in cfg:
        return cfg, False
    plus = cfg["plus_permission"]
    if isinstance(plus, str) and _moved(plus):
        return {**cfg, "plus_permission": _moved(plus)}, True
    if isinstance(plus, list) and any(isinstance(p, str) and _moved(p) for p in plus):
        return {**cfg, "plus_permission": [(_moved(p) or p) if isinstance(p, str) else p for p in plus]}, True
    return cfg, False


def _table(name, col):
    return sa.table(name, sa.column("id", sa.Integer), sa.column(col, sa.JSON))


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    for name, col, fn in (("roles", "permissions", _rename_list), ("users", "granular_permissions", _rename_list),
                          ("approval_workflow_stages", "rule_config", _rename_cfg)):
        if name not in tables or col not in {c["name"] for c in insp.get_columns(name)}:
            continue
        t = _table(name, col)
        for rid, val in bind.execute(sa.select(t.c.id, t.c[col])).fetchall():
            new, changed = fn(_load(val))
            if changed:
                bind.execute(t.update().where(t.c.id == rid).values({col: new}))


def downgrade() -> None:
    # Not reversible: an All Projects grant can no longer be told apart from a machine-register one.
    pass
