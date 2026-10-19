"""Store: physical inventory count documents (freeze → count → recount → adjustment).

Revision ID: c9e4a2b5d6f7
Revises: b8d3f1a2c4e5
Create Date: 2026-10-11
"""
from alembic import op
import sqlalchemy as sa

revision = "c9e4a2b5d6f7"
down_revision = "b8d3f1a2c4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "store_physical_counts" not in tables:
        op.create_table(
            "store_physical_counts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("count_number", sa.String(50), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("count_date", sa.Date(), nullable=False),
            sa.Column("scope", sa.String(255), nullable=True),
            sa.Column("blind", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("status", sa.String(20), nullable=False, server_default="counting"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("adjustment_id", sa.Integer(), sa.ForeignKey("store_stock_adjustments.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_store_physical_counts_count_number", "store_physical_counts", ["count_number"], unique=True)
        op.create_index("ix_store_physical_counts_location_id", "store_physical_counts", ["location_id"])
        op.create_index("ix_store_physical_counts_status", "store_physical_counts", ["status"])
    if "store_physical_count_items" not in tables:
        op.create_table(
            "store_physical_count_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("count_id", sa.Integer(), sa.ForeignKey("store_physical_counts.id"), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("book_quantity", sa.Float(), nullable=False),
            sa.Column("first_counted_quantity", sa.Float(), nullable=True),
            sa.Column("counted_quantity", sa.Float(), nullable=True),
            sa.Column("count_rounds", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("counted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_store_physical_count_items_count_id", "store_physical_count_items", ["count_id"])
        op.create_index("ix_store_physical_count_items_item_id", "store_physical_count_items", ["item_id"])


def downgrade() -> None:
    op.drop_table("store_physical_count_items")
    op.drop_table("store_physical_counts")
