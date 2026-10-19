"""Data migrations for Finance & Accounting's move onto the central
authorization framework. Called from an Alembic revision (the module does not
create revisions itself):

    from app.modules.accounts.migrations import migrate_accounts_submit_cancel_grants
    def upgrade():
        migrate_accounts_submit_cancel_grants(op.get_bind())
"""
from __future__ import annotations

import json

import sqlalchemy as sa

# Tabs whose submit / withdraw now go through the approval engine.
ENGINE_TABS = ("journal_vouchers", "purchase_invoices", "debit_notes", "sales_invoices", "credit_notes")


def _with_submit_cancel(grants: list[str]) -> list[str] | None:
    """Every `accounts:<tab>:create` grant gains `submit` and `cancel` on the
    same tab — whoever could record the document can still send it for
    approval and withdraw it. Returns None when nothing changes."""
    have = set(grants)
    extra = []
    for tab in ENGINE_TABS:
        if f"accounts:{tab}:create" in have:
            for action in ("submit", "cancel"):
                g = f"accounts:{tab}:{action}"
                if g not in have:
                    extra.append(g)
    return grants + extra if extra else None


def _load(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = json.loads(value or "[]")
    return [g for g in value if isinstance(g, str)]


def migrate_accounts_submit_cancel_grants(bind) -> int:
    """Grant accounts submit+cancel to every role and user extra-grant list
    that holds create on an engine-backed Finance tab. Idempotent; returns the
    number of rows changed."""
    changed = 0
    for table, column in (("roles", "permissions"), ("users", "granular_permissions")):
        rows = bind.execute(sa.text(f"SELECT id, {column} FROM {table}")).fetchall()
        for row_id, raw in rows:
            new = _with_submit_cancel(_load(raw))
            if new is None:
                continue
            stmt = sa.text(f"UPDATE {table} SET {column} = :v WHERE id = :id").bindparams(sa.bindparam("v", type_=sa.JSON))
            bind.execute(stmt, {"v": new, "id": row_id})
            changed += 1
    return changed
