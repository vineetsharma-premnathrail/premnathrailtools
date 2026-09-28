"""add accounts module phase 2 (ledger engine)

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "journal_entries" not in existing_tables:
        op.create_table(
            "journal_entries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entry_number", sa.String(length=50), nullable=False, unique=True),
            sa.Column("posting_date", sa.Date(), nullable=False),
            sa.Column("accounting_period", sa.String(length=7), nullable=False),
            sa.Column("posting_type", sa.String(length=30), nullable=False, server_default="adjustment"),
            sa.Column("reference_document_type", sa.String(length=50), nullable=True),
            sa.Column("reference_document_id", sa.Integer(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("total_debit", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_credit", sa.Float(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="posted"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("posted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reversal_date", sa.Date(), nullable=True),
            sa.Column("reversal_reason", sa.Text(), nullable=True),
            sa.Column("reversed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reverses_journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_journal_entries_accounting_period", "journal_entries", ["accounting_period"])

    if "journal_entry_lines" not in existing_tables:
        op.create_table(
            "journal_entry_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=False),
            sa.Column("line_number", sa.Integer(), nullable=False),
            sa.Column("gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=False),
            sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True),
            sa.Column("internal_order_id", sa.Integer(), sa.ForeignKey("internal_orders.id"), nullable=True),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=True),
            sa.Column("debit_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("credit_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "gl_balances" not in existing_tables:
        op.create_table(
            "gl_balances",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=False),
            sa.Column("accounting_period", sa.String(length=7), nullable=False),
            sa.Column("opening_balance", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_debits", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_credits", sa.Float(), nullable=False, server_default="0"),
            sa.Column("closing_balance", sa.Float(), nullable=False, server_default="0"),
            sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("gl_account_id", "accounting_period", name="uq_gl_balance_account_period"),
        )
        op.create_index("ix_gl_balances_gl_account_id", "gl_balances", ["gl_account_id"])
        op.create_index("ix_gl_balances_accounting_period", "gl_balances", ["accounting_period"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in ("gl_balances", "journal_entry_lines", "journal_entries"):
        if inspector.has_table(table):
            op.drop_table(table)
