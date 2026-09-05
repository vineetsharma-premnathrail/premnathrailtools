"""add asset management module tables: asset_categories, asset_locations, assets, asset_events

Revision ID: a9c2e5f8d1b3
Revises: d3f8a1c6b2e7
Create Date: 2026-09-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "a9c2e5f8d1b3"
down_revision = "d3f8a1c6b2e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_categories",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("code", sa.String(length=30), nullable=False),
        sa.Column("asset_account", sa.String(length=150), nullable=False),
        sa.Column("accumulated_depreciation_account", sa.String(length=150), nullable=False),
        sa.Column("expense_account", sa.String(length=150), nullable=False),
        sa.Column("cwip_account", sa.String(length=150), nullable=False),
        sa.Column("depreciation_method", sa.String(length=30), nullable=False, server_default="straight_line"),
        sa.Column("useful_life_years", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_asset_categories_code", "asset_categories", ["code"], unique=True)

    op.create_table(
        "asset_locations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("asset_locations.id"), nullable=True),
        sa.Column("full_path", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "assets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("asset_code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("asset_categories.id"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("asset_locations.id"), nullable=True),
        sa.Column("custodian_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="cwip"),
        sa.Column("acquisition_date", sa.Date(), nullable=False),
        sa.Column("purchase_cost", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("source_reference", sa.String(length=150), nullable=True),
        sa.Column("vendor", sa.String(length=255), nullable=True),
        sa.Column("serial_number", sa.String(length=150), nullable=True),
        sa.Column("current_book_value", sa.Float(), nullable=True),
        sa.Column("depreciation_start_date", sa.Date(), nullable=True),
        sa.Column("disposed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disposal_type", sa.String(length=20), nullable=True),
        sa.Column("disposal_value", sa.Float(), nullable=True),
        sa.Column("disposal_reason", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_assets_asset_code", "assets", ["asset_code"], unique=True)
    op.create_index("ix_assets_category_id", "assets", ["category_id"])
    op.create_index("ix_assets_location_id", "assets", ["location_id"])

    op.create_table(
        "asset_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("asset_id", sa.Integer(), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("from_location_id", sa.Integer(), sa.ForeignKey("asset_locations.id"), nullable=True),
        sa.Column("to_location_id", sa.Integer(), sa.ForeignKey("asset_locations.id"), nullable=True),
        sa.Column("from_custodian_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("to_custodian_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("cost", sa.Float(), nullable=True),
        sa.Column("value_adjustment_amount", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_asset_events_asset_id", "asset_events", ["asset_id"])


def downgrade() -> None:
    op.drop_index("ix_asset_events_asset_id", table_name="asset_events")
    op.drop_table("asset_events")
    op.drop_index("ix_assets_location_id", table_name="assets")
    op.drop_index("ix_assets_category_id", table_name="assets")
    op.drop_index("ix_assets_asset_code", table_name="assets")
    op.drop_table("assets")
    op.drop_table("asset_locations")
    op.drop_index("ix_asset_categories_code", table_name="asset_categories")
    op.drop_table("asset_categories")
