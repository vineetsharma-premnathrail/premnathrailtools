"""add accounts module phase 6 (cash management)

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e7f8a9b0c1d2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if "bank_reconciliations" not in inspector.get_table_names():
        op.create_table(
            "bank_reconciliations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id"), nullable=False),
            sa.Column("statement_date", sa.Date(), nullable=False),
            sa.Column("statement_balance", sa.Float(), nullable=False),
            sa.Column("book_balance", sa.Float(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="in_progress"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    payment_columns = {c["name"] for c in inspector.get_columns("payment_transactions")}
    with op.batch_alter_table("payment_transactions") as batch_op:
        if "reconciliation_status" not in payment_columns:
            batch_op.add_column(sa.Column("reconciliation_status", sa.String(length=20), nullable=False, server_default="pending"))
        if "bank_reconciliation_id" not in payment_columns:
            batch_op.add_column(sa.Column("bank_reconciliation_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_payment_transactions_bank_reconciliation_id", "bank_reconciliations", ["bank_reconciliation_id"], ["id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    payment_columns = {c["name"] for c in inspector.get_columns("payment_transactions")}
    with op.batch_alter_table("payment_transactions") as batch_op:
        if "bank_reconciliation_id" in payment_columns:
            batch_op.drop_constraint("fk_payment_transactions_bank_reconciliation_id", type_="foreignkey")
            batch_op.drop_column("bank_reconciliation_id")
        if "reconciliation_status" in payment_columns:
            batch_op.drop_column("reconciliation_status")

    if inspector.has_table("bank_reconciliations"):
        op.drop_table("bank_reconciliations")
