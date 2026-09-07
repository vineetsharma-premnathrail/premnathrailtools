"""expand stock_items table fields

Revision ID: c6d8f1a3b5e7
Revises: b8e2f4a6c1d9
Create Date: 2026-09-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "c6d8f1a3b5e7"
down_revision = "b8e2f4a6c1d9"
branch_labels = None
depends_on = None


NEW_COLUMNS = [
    ("item_type", sa.Column("item_type", sa.String(length=50), nullable=True)),
    ("purchase_uom", sa.Column("purchase_uom", sa.String(length=20), nullable=True)),
    ("item_specification", sa.Column("item_specification", sa.Text(), nullable=True)),
    ("manufacturer_part_number", sa.Column("manufacturer_part_number", sa.String(length=100), nullable=True)),
    ("make_or_buy", sa.Column("make_or_buy", sa.String(length=10), nullable=True)),
    ("default_warehouse_id", sa.Column("default_warehouse_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True)),
    ("minimum_stock", sa.Column("minimum_stock", sa.Float(), nullable=True)),
    ("maximum_stock", sa.Column("maximum_stock", sa.Float(), nullable=True)),
    ("hsn_sac", sa.Column("hsn_sac", sa.String(length=20), nullable=True)),
    ("gst_tax", sa.Column("gst_tax", sa.String(length=20), nullable=True)),
    ("quality_inspection_required", sa.Column("quality_inspection_required", sa.Boolean(), nullable=False, server_default=sa.false())),
    ("batch_serial_tracking", sa.Column("batch_serial_tracking", sa.String(length=20), nullable=True)),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("stock_items")}
    with op.batch_alter_table("stock_items") as batch_op:
        for name, column in NEW_COLUMNS:
            if name not in columns:
                batch_op.add_column(column)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("stock_items")}
    with op.batch_alter_table("stock_items") as batch_op:
        for name, _ in reversed(NEW_COLUMNS):
            if name in columns:
                batch_op.drop_column(name)
