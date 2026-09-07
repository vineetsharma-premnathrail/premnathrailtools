"""drop item master and stock ledger tables

Revision ID: d1e3f5a7b9c2
Revises: c6d8f1a3b5e7
Create Date: 2026-09-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "d1e3f5a7b9c2"
down_revision = "c6d8f1a3b5e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    pr_item_columns = {c["name"] for c in inspector.get_columns("p2p_request_items")}
    with op.batch_alter_table("p2p_request_items") as batch_op:
        if "stock_item_id" in pr_item_columns:
            batch_op.drop_column("stock_item_id")
        if "item_id" in pr_item_columns:
            batch_op.drop_column("item_id")

    po_item_columns = {c["name"] for c in inspector.get_columns("p2p_purchase_order_items")}
    with op.batch_alter_table("p2p_purchase_order_items") as batch_op:
        if "item_id" in po_item_columns:
            batch_op.drop_column("item_id")

    existing_tables = set(inspector.get_table_names())
    for table in (
        "stock_balances", "stock_transactions", "stock_items",
        # Orphaned tables from the already-removed Manufacturing module — no
        # code references them, but they still hold FKs into `items` that
        # block dropping it.
        "manufacturing_bom_items", "manufacturing_stock_entries", "manufacturing_work_orders", "manufacturing_boms",
        "items",
    ):
        if table in existing_tables:
            op.drop_table(table)


def downgrade() -> None:
    op.create_table(
        "items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("item_code", sa.String(length=100), nullable=False, unique=True),
        sa.Column("item_name", sa.String(length=255), nullable=False),
        sa.Column("item_type", sa.String(length=50), nullable=True),
        sa.Column("item_group", sa.String(length=100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("unit_of_measure", sa.String(length=20), nullable=True),
        sa.Column("purchase_uom", sa.String(length=20), nullable=True),
        sa.Column("item_specification", sa.Text(), nullable=True),
        sa.Column("manufacturer_part_number", sa.String(length=100), nullable=True),
        sa.Column("make_or_buy", sa.String(length=10), nullable=True),
        sa.Column("default_warehouse_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
        sa.Column("minimum_stock", sa.Numeric(14, 2), nullable=True),
        sa.Column("maximum_stock", sa.Numeric(14, 2), nullable=True),
        sa.Column("hsn_sac", sa.String(length=20), nullable=True),
        sa.Column("gst_tax", sa.String(length=20), nullable=True),
        sa.Column("quality_inspection_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("batch_serial_tracking", sa.String(length=20), nullable=True),
        sa.Column("item_status", sa.String(length=20), nullable=False, server_default="Active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "stock_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("part_code", sa.String(length=100), nullable=False, unique=True),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("item_type", sa.String(length=50), nullable=True),
        sa.Column("make", sa.String(length=100), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("purchase_uom", sa.String(length=20), nullable=True),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("item_specification", sa.Text(), nullable=True),
        sa.Column("manufacturer_part_number", sa.String(length=100), nullable=True),
        sa.Column("make_or_buy", sa.String(length=10), nullable=True),
        sa.Column("default_warehouse_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
        sa.Column("reorder_point", sa.Float(), nullable=False, server_default="0"),
        sa.Column("reorder_quantity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("minimum_stock", sa.Float(), nullable=True),
        sa.Column("maximum_stock", sa.Float(), nullable=True),
        sa.Column("standard_cost", sa.Float(), nullable=True),
        sa.Column("hsn_sac", sa.String(length=20), nullable=True),
        sa.Column("gst_tax", sa.String(length=20), nullable=True),
        sa.Column("quality_inspection_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("batch_serial_tracking", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "stock_transactions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("stock_item_id", sa.Integer(), sa.ForeignKey("stock_items.id"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("reference_type", sa.String(length=50), nullable=True),
        sa.Column("reference_id", sa.Integer(), nullable=True),
        sa.Column("performed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "stock_balances",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("stock_item_id", sa.Integer(), sa.ForeignKey("stock_items.id"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
        sa.Column("quantity_on_hand", sa.Float(), nullable=False, server_default="0"),
        sa.UniqueConstraint("stock_item_id", "location_id", name="uq_stock_balance_item_location"),
    )

    with op.batch_alter_table("p2p_purchase_order_items") as batch_op:
        batch_op.add_column(sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id"), nullable=True))

    with op.batch_alter_table("p2p_request_items") as batch_op:
        batch_op.add_column(sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id"), nullable=True))
        batch_op.add_column(sa.Column("stock_item_id", sa.Integer(), sa.ForeignKey("stock_items.id"), nullable=True))
