"""Central authorization cut-over (data only).

1. Seed each module's approval workflow from the settings it used to keep
   (P2P approver lists, Sales limits, Quality scrap limit, Service approvers,
   Store return / adjustment routing) — before any admin opens Organization ›
   Approval Workflows, so nothing falls back to code defaults.
2. Store › Plant Access → per-user data-scope overrides (users.data_access_scopes["store"]).
3. Submit / Cancel became real actions on the tabs that enforce them: give
   them to every role and every user's extra grants that already hold Create
   on that tab, so nobody loses the ability to submit (wildcard grants like
   `p2p:*:*` already cover them).

Every step is idempotent (safe to run twice).

Revision ID: d2f6a9c4e1b7
Revises: b8e4d1a6c3f9
Create Date: 2026-10-08
"""
import json
import logging

from alembic import op
import sqlalchemy as sa

revision = "d2f6a9c4e1b7"
down_revision = "b8e4d1a6c3f9"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

MODULE_STEPS = [
    ("app.modules.p2p.approvals", "migrate_p2p_approval_workflows"),
    ("app.modules.sales.approvals", "migrate_sales_approval_limits"),
    ("app.modules.quality.services.authz", "migrate_quality_ncr_workflow"),
    ("app.modules.erp.access", "migrate_erp_approval_workflows"),
    ("app.modules.store.services.approvals", "migrate_store_approval_workflows"),
    ("app.modules.store.services.plant_access", "migrate_store_plant_access"),
]


def _load(value):
    if value is None:
        return []
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return []
    return list(value)


def _with_submit_cancel(grants: list[str], tabs: dict[str, set[str]]) -> list[str] | None:
    """grants + module:tab:submit/cancel for each tab where Create is held. None = unchanged."""
    have = set(grants)
    add = set()
    for g in grants:
        parts = g.split(":")
        if len(parts) != 3 or parts[2] != "create":
            continue
        mk, tk = parts[0], parts[1]
        for action in tabs.get(f"{mk}:{tk}", ()):
            gid = f"{mk}:{tk}:{action}"
            if gid not in have:
                add.add(gid)
    return sorted(have | add) if add else None


def grant_submit_cancel(bind) -> int:
    from app.core.permission_registry import MODULES

    tabs = {
        f"{mk}:{tk}": {a for a in acts if a in ("submit", "cancel")}
        for mk, m in MODULES.items() for tk, acts in m["actions"].items()
        if "submit" in acts or "cancel" in acts
    }
    changed = 0
    for table, col in (("roles", "permissions"), ("users", "granular_permissions")):
        t = sa.table(table, sa.column("id", sa.Integer), sa.column(col, sa.JSON))
        for row in bind.execute(sa.select(t.c.id, t.c[col])).all():
            new = _with_submit_cancel(_load(row[1]), tabs)
            if new is not None:
                bind.execute(t.update().where(t.c.id == row[0]).values({col: new}))
                changed += 1
    return changed


def upgrade() -> None:
    bind = op.get_bind()
    import importlib

    import app.main  # noqa: F401 — registers every module's transaction types and scoped models

    for module, fn in MODULE_STEPS:
        result = getattr(importlib.import_module(module), fn)(bind)
        log.info("central authorization: %s.%s -> %s", module, fn, result)
    log.info("central authorization: submit/cancel granted on %s role/user row(s)", grant_submit_cancel(bind))


def downgrade() -> None:
    # Data-only cut-over; the old settings are not restored. Submit/Cancel
    # grants are harmless without the enforcing code.
    pass
