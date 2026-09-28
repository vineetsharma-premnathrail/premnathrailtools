"""add store stock ledger and balances

Revision ID: 101e320829cb
Revises: 180186fddf01
Create Date: 2026-09-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "101e320829cb"
down_revision = "180186fddf01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "store_stock_balances" not in tables:
        op.create_table(
            "store_stock_balances",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("on_hand_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("reserved_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("item_id", "location_id", name="uq_store_stock_balance_item_location"),
        )
        op.create_index("ix_store_stock_balances_item_id", "store_stock_balances", ["item_id"])
        op.create_index("ix_store_stock_balances_location_id", "store_stock_balances", ["location_id"])

    if "store_stock_transactions" not in tables:
        op.create_table(
            "store_stock_transactions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("bin_id", sa.Integer(), sa.ForeignKey("store_bins.id"), nullable=True),
            sa.Column("transaction_type", sa.String(length=20), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("batch_number", sa.String(length=100), nullable=True),
            sa.Column("reference_type", sa.String(length=30), nullable=True),
            sa.Column("reference_number", sa.String(length=100), nullable=True),
            sa.Column("transaction_date", sa.Date(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_store_stock_transactions_item_id", "store_stock_transactions", ["item_id"])
        op.create_index("ix_store_stock_transactions_location_id", "store_stock_transactions", ["location_id"])


def downgrade() -> None:
    op.drop_table("store_stock_transactions")
    op.drop_table("store_stock_balances")
