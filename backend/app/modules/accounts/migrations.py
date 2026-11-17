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


# ── 2026-11-14: the role matrix decides, not the Finance Manager flag ────
# Stored workflows created before then still carry the old default stages
# (approver rule "user_flag" / is_finance_manager). This moves exactly those
# untouched default stages onto the matching Approve grant; a stage an admin
# renamed or re-pointed is a deliberate choice and is left alone.
FLAG_STAGE_DEFAULTS = {
    # workflow key: (old default stage name, new stage name, permission)
    "accounts.period_close": ("Finance Manager", "Period close approver", "accounts:period_close:approve"),
    "accounts.depreciation_run": ("Finance Manager", "Depreciation approver", "accounts:depreciation:approve"),
    "accounts.year_end_close": ("Finance Manager", "Year-end close approver", "accounts:year_end_close:approve"),
    "accounts.purchase_invoice": ("3-way-match variance (Finance Manager)", "3-way-match variance",
                                  "accounts:purchase_invoices.variance_approval:approve"),
}


def migrate_finance_flag_stages(bind) -> int:
    """Re-point the untouched Finance Manager default stages to the Approve
    grant holders. Idempotent; returns the number of stages changed. Wire it
    from an Alembic revision (upgrade only — the downgrade is a no-op)."""
    changed = 0
    for key, (old_name, new_name, perm) in FLAG_STAGE_DEFAULTS.items():
        rows = bind.execute(sa.text(
            "SELECT s.id, s.rule_config FROM approval_workflow_stages s "
            "JOIN approval_workflows w ON w.id = s.workflow_id "
            "WHERE w.key = :key AND s.approver_rule = 'user_flag' AND s.name = :name"
        ), {"key": key, "name": old_name}).fetchall()
        for stage_id, raw in rows:
            cfg = json.loads(raw) if isinstance(raw, str) else (raw or {})
            if cfg.get("flag") != "is_finance_manager":
                continue
            new_cfg = {k: v for k, v in cfg.items() if k != "flag"}
            new_cfg["permission"] = perm
            stmt = sa.text("UPDATE approval_workflow_stages SET name = :n, approver_rule = 'permission', rule_config = :c "
                           "WHERE id = :id").bindparams(sa.bindparam("c", type_=sa.JSON))
            bind.execute(stmt, {"n": new_name, "c": new_cfg, "id": stage_id})
            changed += 1
    return changed
