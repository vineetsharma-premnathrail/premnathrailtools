"""add accounts module phase 3 (accounts payable)

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b4c5d6e7f8a9"
down_revision = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "vendor_invoices" not in existing_tables:
        op.create_table(
            "vendor_invoices",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=False),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=False),
            sa.Column("invoice_number", sa.String(length=100), nullable=False),
            sa.Column("invoice_date", sa.Date(), nullable=False),
            sa.Column("invoice_amount", sa.Float(), nullable=False),
            sa.Column("invoice_gst", sa.Float(), nullable=False, server_default="0"),
            sa.Column("invoice_total", sa.Float(), nullable=False),
            sa.Column("expense_gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=False),
            sa.Column("qty_po", sa.Float(), nullable=True),
            sa.Column("qty_gr", sa.Float(), nullable=True),
            sa.Column("qty_invoice", sa.Float(), nullable=True),
            sa.Column("matching_status", sa.String(length=20), nullable=False, server_default="matched"),
            sa.Column("payment_status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("amount_paid", sa.Float(), nullable=False, server_default="0"),
            sa.Column("amount_due", sa.Float(), nullable=False, server_default="0"),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("variance_approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("variance_approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("variance_note", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("vendor_id", "invoice_number", name="uq_vendor_invoice_number"),
        )

    if "payment_transactions" not in existing_tables:
        op.create_table(
            "payment_transactions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("payment_number", sa.String(length=50), nullable=False, unique=True),
            sa.Column("payment_type", sa.String(length=20), nullable=False, server_default="vendor"),
            sa.Column("payment_mode", sa.String(length=20), nullable=False),
            sa.Column("payment_date", sa.Date(), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id"), nullable=False),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("vendor_invoice_id", sa.Integer(), sa.ForeignKey("vendor_invoices.id"), nullable=True),
            sa.Column("cheque_number", sa.String(length=50), nullable=True),
            sa.Column("cheque_date", sa.Date(), nullable=True),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in ("payment_transactions", "vendor_invoices"):
        if inspector.has_table(table):
            op.drop_table(table)
