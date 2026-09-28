"""add store stock transfer and adjustment

Revision ID: 4e0a5e85cfb5
Revises: 3efe4570e8bf
Create Date: 2026-09-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "4e0a5e85cfb5"
down_revision = "3efe4570e8bf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "store_stock_transfers" not in tables:
        op.create_table(
            "store_stock_transfers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("transfer_number", sa.String(length=50), nullable=False, unique=True),
            sa.Column("from_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("to_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("transfer_date", sa.Date(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("transferred_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_store_stock_transfers_transfer_number", "store_stock_transfers", ["transfer_number"], unique=True)

    if "store_stock_transfer_items" not in tables:
        op.create_table(
            "store_stock_transfer_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("transfer_id", sa.Integer(), sa.ForeignKey("store_stock_transfers.id"), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("batch_number", sa.String(length=100), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "store_stock_adjustments" not in tables:
        op.create_table(
            "store_stock_adjustments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("adjustment_number", sa.String(length=50), nullable=False, unique=True),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("adjustment_date", sa.Date(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_store_stock_adjustments_adjustment_number", "store_stock_adjustments", ["adjustment_number"], unique=True)

    if "store_stock_adjustment_items" not in tables:
        op.create_table(
            "store_stock_adjustment_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("adjustment_id", sa.Integer(), sa.ForeignKey("store_stock_adjustments.id"), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("existing_quantity", sa.Float(), nullable=False),
            sa.Column("actual_quantity", sa.Float(), nullable=False),
            sa.Column("difference", sa.Float(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table("store_stock_adjustment_items")
    op.drop_table("store_stock_adjustments")
    op.drop_table("store_stock_transfer_items")
    op.drop_table("store_stock_transfers")
