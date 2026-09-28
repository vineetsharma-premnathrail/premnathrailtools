"""add store stock reservation

Revision ID: d1f9f0541e2a
Revises: 4e0a5e85cfb5
Create Date: 2026-09-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "d1f9f0541e2a"
down_revision = "4e0a5e85cfb5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "store_stock_reservations" not in tables:
        op.create_table(
            "store_stock_reservations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("reservation_number", sa.String(length=50), nullable=False, unique=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("project", sa.String(length=150), nullable=True),
            sa.Column("production_order", sa.String(length=150), nullable=True),
            sa.Column("reserved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("required_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_store_stock_reservations_reservation_number", "store_stock_reservations", ["reservation_number"], unique=True)
        op.create_index("ix_store_stock_reservations_item_id", "store_stock_reservations", ["item_id"])
        op.create_index("ix_store_stock_reservations_location_id", "store_stock_reservations", ["location_id"])


def downgrade() -> None:
    op.drop_table("store_stock_reservations")
