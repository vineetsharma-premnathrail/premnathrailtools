"""add accounts module phase 4 (accounts receivable)

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if "ar_transactions" not in inspector.get_table_names():
        op.create_table(
            "ar_transactions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("invoice_number", sa.String(length=50), nullable=False, unique=True),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=False),
            sa.Column("invoice_date", sa.Date(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("invoice_amount", sa.Float(), nullable=False),
            sa.Column("gst_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("discount_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_amount", sa.Float(), nullable=False),
            sa.Column("revenue_gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=False),
            sa.Column("reference_type", sa.String(length=30), nullable=True),
            sa.Column("reference_id", sa.Integer(), nullable=True),
            sa.Column("amount_received", sa.Float(), nullable=False, server_default="0"),
            sa.Column("amount_due", sa.Float(), nullable=False, server_default="0"),
            sa.Column("collection_status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("dunning_level", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    payment_columns = {c["name"] for c in inspector.get_columns("payment_transactions")}
    if "ar_transaction_id" not in payment_columns:
        with op.batch_alter_table("payment_transactions") as batch_op:
            batch_op.add_column(sa.Column("ar_transaction_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_payment_transactions_ar_transaction_id", "ar_transactions", ["ar_transaction_id"], ["id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    payment_columns = {c["name"] for c in inspector.get_columns("payment_transactions")}
    if "ar_transaction_id" in payment_columns:
        with op.batch_alter_table("payment_transactions") as batch_op:
            batch_op.drop_constraint("fk_payment_transactions_ar_transaction_id", type_="foreignkey")
            batch_op.drop_column("ar_transaction_id")

    if inspector.has_table("ar_transactions"):
        op.drop_table("ar_transactions")
