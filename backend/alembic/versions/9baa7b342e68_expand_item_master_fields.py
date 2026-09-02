"""expand item master fields

Revision ID: 9baa7b342e68
Revises: 5ff1b53842a1
Create Date: 2026-09-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "9baa7b342e68"
down_revision = "5ff1b53842a1"
branch_labels = None
depends_on = None


NEW_COLUMNS = [
    ("item_type", sa.Column("item_type", sa.String(length=50), nullable=True)),
    ("description", sa.Column("description", sa.Text(), nullable=True)),
    ("purchase_uom", sa.Column("purchase_uom", sa.String(length=20), nullable=True)),
    ("item_specification", sa.Column("item_specification", sa.Text(), nullable=True)),
    ("manufacturer_part_number", sa.Column("manufacturer_part_number", sa.String(length=100), nullable=True)),
    ("make_or_buy", sa.Column("make_or_buy", sa.String(length=10), nullable=True)),
    ("default_warehouse_id", sa.Column("default_warehouse_id", sa.Integer(), nullable=True)),
    ("minimum_stock", sa.Column("minimum_stock", sa.Numeric(14, 2), nullable=True)),
    ("maximum_stock", sa.Column("maximum_stock", sa.Numeric(14, 2), nullable=True)),
    ("gst_tax", sa.Column("gst_tax", sa.String(length=20), nullable=True)),
    ("quality_inspection_required", sa.Column("quality_inspection_required", sa.Boolean(), nullable=False, server_default=sa.false())),
    ("batch_serial_tracking", sa.Column("batch_serial_tracking", sa.String(length=20), nullable=True)),
    ("item_status", sa.Column("item_status", sa.String(length=20), nullable=False, server_default="Active")),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("items")}
    with op.batch_alter_table("items") as batch_op:
        for name, column in NEW_COLUMNS:
            if name not in columns:
                batch_op.add_column(column)
        if "default_warehouse_id" not in columns:
            batch_op.create_foreign_key(
                "fk_items_default_warehouse_id_store_locations",
                "store_locations",
                ["default_warehouse_id"],
                ["id"],
            )


def downgrade() -> None:
    with op.batch_alter_table("items") as batch_op:
        batch_op.drop_constraint("fk_items_default_warehouse_id_store_locations", type_="foreignkey")
        for name, _ in NEW_COLUMNS:
            batch_op.drop_column(name)
