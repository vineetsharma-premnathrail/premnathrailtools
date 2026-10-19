"""Controlling: account-assignment rules (OKB9-like) and internal orders on every voucher line (2026-10-13).

- gl_accounts.cost_object_required: a line on this ledger must carry a cost
  centre or an internal order (manual journals, purchase invoices, expense
  payments). Filled TRUE for existing overhead ledgers — posting, non-control
  expense ledgers whose group rolls into Schedule III "Other Expenses" or
  "Employee Benefits Expense", except ledgers a system role posts to
  (round off, disposal loss, ...). Purchases, stock change, depreciation,
  finance costs and tax stay FALSE.
- gl_accounts.default_cost_center_id: cost centre filled in when a line on
  this ledger has none (SAP OKB9 default account assignment).
- internal_order_id on vendor_invoice_lines, ar_transaction_lines,
  party_note_lines and payment_lines, so an order picked on the document
  reaches its journal line.
- p2p_purchase_orders.internal_order_id: the order a PO is bought for — its
  open (not yet invoiced) value is the order's commitment (KOB2-like).

Revision ID: 5750cffe0886
Revises: 80d6cf71a66d
"""
from alembic import op
import sqlalchemy as sa

revision = "5750cffe0886"
down_revision = "80d6cf71a66d"
branch_labels = None
depends_on = None

_IO_TABLES = ("vendor_invoice_lines", "ar_transaction_lines", "party_note_lines", "payment_lines", "p2p_purchase_orders")
# Schedule III heads whose ledgers are overheads that belong to a cost centre.
COST_OBJECT_HEADS = ("other_expenses", "employee_benefits")
# Default codes of ledgers the system posts to by role — never require a cost
# object on them (models/settings.py LEDGER_ROLES).
_ROLE_DEFAULT_CODES = ("5800", "5610", "5050", "5001", "5400")


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    cols = _columns("gl_accounts")
    with op.batch_alter_table("gl_accounts") as batch_op:
        if "cost_object_required" not in cols:
            batch_op.add_column(sa.Column("cost_object_required", sa.Boolean(), nullable=False, server_default=sa.false()))
        if "default_cost_center_id" not in cols:
            batch_op.add_column(sa.Column("default_cost_center_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_gl_accounts_default_cost_center", "cost_centers", ["default_cost_center_id"], ["id"])

    for table in _IO_TABLES:
        tcols = _columns(table)
        if not tcols or "internal_order_id" in tcols:
            continue
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(sa.Column("internal_order_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(f"fk_{table}_internal_order", "internal_orders", ["internal_order_id"], ["id"])
            batch_op.create_index(f"ix_{table}_internal_order_id", ["internal_order_id"])

    # Data fill: overhead ledgers need a cost object from now on.
    bind = op.get_bind()
    role_ids = {r[0] for r in bind.execute(sa.text("SELECT gl_account_id FROM account_determinations WHERE gl_account_id IS NOT NULL"))} \
        if "account_determinations" in sa.inspect(bind).get_table_names() else set()
    rows = bind.execute(sa.text(
        "SELECT a.id, a.code FROM gl_accounts a JOIN account_groups g ON g.id = a.group_id "
        "WHERE a.account_type = 'expense' AND a.is_posting_account = :t AND a.is_control_account = :f "
        "AND g.schedule_iii_head IN ('other_expenses', 'employee_benefits')"
    ), {"t": True, "f": False}).fetchall()
    ids = [r[0] for r in rows if r[0] not in role_ids and r[1] not in _ROLE_DEFAULT_CODES]
    for gl_id in ids:
        bind.execute(sa.text("UPDATE gl_accounts SET cost_object_required = :t WHERE id = :id"), {"t": True, "id": gl_id})


def downgrade() -> None:
    for table in _IO_TABLES:
        if "internal_order_id" not in _columns(table):
            continue
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_index(f"ix_{table}_internal_order_id")
            batch_op.drop_constraint(f"fk_{table}_internal_order", type_="foreignkey")
            batch_op.drop_column("internal_order_id")
    cols = _columns("gl_accounts")
    with op.batch_alter_table("gl_accounts") as batch_op:
        if "default_cost_center_id" in cols:
            batch_op.drop_constraint("fk_gl_accounts_default_cost_center", type_="foreignkey")
            batch_op.drop_column("default_cost_center_id")
        if "cost_object_required" in cols:
            batch_op.drop_column("cost_object_required")
