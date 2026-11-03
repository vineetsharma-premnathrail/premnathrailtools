"""Matrix cleanup (2026-11-03): screens that rode on another tab's permission became their own features
(Store Batches / Serial Nos. / Reorder / Before PO, Maintenance AMC & Warranty / PM Plans, Finance
Advances / Billing Due, HR Time evaluation, Project Units, R&D Settings). A tab's features follow the tab
until a role customises that tab; this gives roles (and user extra grants) that ARE customised on the
parent tab the same access to the new feature they had through the tab, so nobody loses a screen.

Revision ID: d5f1b7a3c9e2
Revises: c7e3a9d1f2b4
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "d5f1b7a3c9e2"
down_revision = "c7e3a9d1f2b4"
branch_labels = None
depends_on = None

# (module, tab, feature, {feature action: tab action it follows}) — copied from core/features/*.py.
NEW_FEATURES = (
    ("projects", "overview", "units", {"view": "view"}),
    ("accounts", "payments", "advances", {"view": "view"}),
    ("accounts", "sales_invoices", "billing_due", {"view": "view"}),
    ("hr", "attendance", "time_evaluation", {"view": "view"}),
    ("store", "stock", "batches", {"view": "view"}),
    ("store", "stock", "serials", {"view": "view"}),
    ("store", "stock", "reorder", {"view": "view"}),
    ("store", "grn", "before_po", {"view": "view", "create": "create"}),
    ("maintenance", "assets", "contracts", {"view": "view", "export": "export"}),
    ("maintenance", "assets", "pm_plans", {"view": "view"}),
    ("rnd", "requirements", "settings", {"view": "view"}),
)


def _load(v):
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else v


def _holds(grants: list[str], mk: str, tk: str, action: str) -> bool:
    if f"{mk}:{tk}:{action}" in grants or f"{mk}:*:{action}" in grants or f"{mk}:*:*" in grants:
        return True
    # Any action on a tab implies viewing it.
    return action == "view" and any(g.startswith(f"{mk}:{tk}:") for g in grants)


def _fill(grants):
    if not isinstance(grants, list):
        return grants, False
    strs = [g for g in grants if isinstance(g, str)]
    out, changed = list(grants), False
    for mk, tk, fk, inherit in NEW_FEATURES:
        if not any(g.startswith(f"{mk}:{tk}.") for g in strs):
            continue  # not customised on this tab: the feature already follows the tab
        if any(g.startswith(f"{mk}:{tk}.{fk}:") for g in strs):
            continue  # already decided for this feature
        for fa, ta in inherit.items():
            if _holds(strs, mk, tk, ta):
                gid = f"{mk}:{tk}.{fk}:{fa}"
                if gid not in out:
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
    # Not reversible: an added feature grant can't be told apart from one an admin ticked later.
    pass
