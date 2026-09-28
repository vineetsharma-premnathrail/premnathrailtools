"""add store item master, categories, and bins

Revision ID: 180186fddf01
Revises: f7b9d1e3a5c8
Create Date: 2026-09-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "180186fddf01"
down_revision = "f7b9d1e3a5c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "store_item_categories" not in tables:
        op.create_table(
            "store_item_categories",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("code", sa.String(length=30), nullable=False, unique=True),
            sa.Column("parent_id", sa.Integer(), sa.ForeignKey("store_item_categories.id"), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "store_items" not in tables:
        # Column set matches a store_items table already present in this
        # environment from earlier (lost) work on this module — reproduced
        # here rather than a slimmer shape so a fresh database ends up with
        # the same schema this one already has.
        op.create_table(
            "store_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_code", sa.String(length=50), nullable=False, unique=True),
            sa.Column("item_name", sa.String(length=200), nullable=False),
            sa.Column("item_type", sa.String(length=50), nullable=True),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("subcategory", sa.String(length=100), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("uom", sa.String(length=20), nullable=True),
            sa.Column("secondary_uom", sa.String(length=20), nullable=True),
            sa.Column("conversion_factor", sa.Numeric(14, 4), nullable=True),
            sa.Column("manufacturer", sa.String(length=150), nullable=True),
            sa.Column("manufacturer_part_number", sa.String(length=100), nullable=True),
            sa.Column("part_number", sa.String(length=100), nullable=True),
            sa.Column("hsn_sac_code", sa.String(length=20), nullable=True),
            sa.Column("material_grade", sa.String(length=100), nullable=True),
            sa.Column("specification", sa.Text(), nullable=True),
            sa.Column("make", sa.String(length=100), nullable=True),
            sa.Column("model", sa.String(length=100), nullable=True),
            sa.Column("batch_controlled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("serial_controlled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("expiry_controlled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("shelf_life_days", sa.Integer(), nullable=True),
            sa.Column("minimum_stock", sa.Numeric(14, 2), nullable=True),
            sa.Column("maximum_stock", sa.Numeric(14, 2), nullable=True),
            sa.Column("reorder_level", sa.Numeric(14, 2), nullable=True),
            sa.Column("safety_stock", sa.Numeric(14, 2), nullable=True),
            sa.Column("reorder_quantity", sa.Numeric(14, 2), nullable=True),
            sa.Column("standard_cost", sa.Numeric(14, 2), nullable=True),
            sa.Column("moving_average_cost", sa.Numeric(14, 2), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("plant", sa.String(length=100), nullable=True),
            sa.Column("preferred_warehouse_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("preferred_supplier", sa.String(length=150), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "store_bins" not in tables:
        op.create_table(
            "store_bins",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("parent_id", sa.Integer(), sa.ForeignKey("store_bins.id"), nullable=True),
            sa.Column("bin_type", sa.String(length=10), nullable=False),
            sa.Column("code", sa.String(length=30), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_store_bins_location_id", "store_bins", ["location_id"])


def downgrade() -> None:
    op.drop_table("store_bins")
    op.drop_table("store_items")
    op.drop_table("store_item_categories")
