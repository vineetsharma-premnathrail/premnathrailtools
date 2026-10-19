"""Product Management is not a module; it lives inside Sales (2026-10-19).

The old "products" permission module's tabs become Sales tabs with the same
keys: products:<tab>:<action> -> sales:<tab>:<action>, and a products
wildcard (products:*:<a>) becomes the three product tabs only
(sales:products / applications / product_mapping), never the rest of Sales.
Renamed in roles, users' extra grants, role assignee rules and approval stage
configs. A role's / user's "products" data scope moves to "sales" when it has
no Sales scope of its own. Holding a product tab still gives the internal
"products" app (User.get_apps), so access does not change.

Revision ID: c8f2a5d3e7b1
Revises: b4e1c7a9d2f6
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "c8f2a5d3e7b1"
down_revision = "b4e1c7a9d2f6"
branch_labels = None
depends_on = None

# tab -> its actions (permission_registry, Sales › Products group)
PRODUCT_TABS = {
    "applications": ("view", "create", "edit"),
    "product_mapping": ("view", "edit"),
    "products": ("view", "create", "edit", "delete"),
}


def _load(v):
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else v


def _fwd(g: str) -> list[str]:
    if not (isinstance(g, str) and g.startswith("products:")):
        return [g]
    parts = g.split(":")
    if len(parts) != 3:
        return []
    _, tk, a = parts
    if tk != "*":
        return [f"sales:{tk}:{a}"]
    return [f"sales:{t}:{x}" for t, acts in PRODUCT_TABS.items() for x in acts if a in ("*", x)]


def _back(g: str) -> list[str]:
    if isinstance(g, str) and g.startswith("sales:"):
        tab = g.split(":")[1].split(".", 1)[0]
        if tab in PRODUCT_TABS:
            return ["products:" + g[len("sales:"):]]
    return [g]


def _grants(val, forward: bool):
    if not isinstance(val, list):
        return val, False
    fn = _fwd if forward else _back
    out = []
    for g in val:
        for n in fn(g):
            if n not in out:
                out.append(n)
    return out, out != val


def _scopes(val, forward: bool):
    if not isinstance(val, dict):
        return val, False
    src, dst = ("products", "sales") if forward else ("sales", "products")
    if src not in val:
        return val, False
    new = dict(val)
    level = new.pop(src) if forward else new[src]
    new.setdefault(dst, level)
    return new, new != val


def _rule_keys(val, forward: bool):
    if not isinstance(val, dict):
        return val, False
    new = {}
    for k, v in val.items():
        mapped = (_fwd if forward else _back)(k)
        new[mapped[0] if mapped else k] = v
    return new, new != val


def _stage_cfg(val, forward: bool):
    if not isinstance(val, dict):
        return val, False
    new = dict(val)
    for key in ("permission", "plus_permission"):
        v = new.get(key)
        if isinstance(v, str):
            m = (_fwd if forward else _back)(v)
            new[key] = m[0] if m else v
        elif isinstance(v, list):
            new[key], _ = _grants(v, forward)
    return new, new != val


def _migrate(forward: bool) -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    work = {
        "roles": (("permissions", _grants), ("data_scopes", _scopes), ("assignee_rules", _rule_keys)),
        "users": (("granular_permissions", _grants), ("data_access_scopes", _scopes)),
        "approval_workflow_stages": (("rule_config", _stage_cfg),),
    }
    for name, cols in work.items():
        if name not in tables:
            continue
        present = {c["name"] for c in sa.inspect(bind).get_columns(name)}
        cols = tuple((c, fn) for c, fn in cols if c in present)
        if not cols:
            continue
        t = sa.table(name, sa.column("id", sa.Integer), *(sa.column(c, sa.JSON) for c, _ in cols))
        for row in bind.execute(sa.select(t.c.id, *(t.c[c] for c, _ in cols))).fetchall():
            values = {}
            for i, (c, fn) in enumerate(cols, start=1):
                new, changed = fn(_load(row[i]), forward)
                if changed:
                    values[c] = new
            if values:
                bind.execute(t.update().where(t.c.id == row[0]).values(values))


def upgrade() -> None:
    _migrate(True)


def downgrade() -> None:
    _migrate(False)
