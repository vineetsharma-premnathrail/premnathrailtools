"""Item names on vendor bills (owner, 2026-11-13): vendor + "Name on invoice" -> Item Master item, learnt
from goods receipts so the next bill with the same name fills the item by itself.

Revision ID: c7e2a9d4b1f8
Revises: b5d1e8a2c7f6
"""
from alembic import op
import sqlalchemy as sa

revision = "c7e2a9d4b1f8"
down_revision = "b5d1e8a2c7f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("store_item_vendor_names"):
        return
    op.create_table(
        "store_item_vendor_names",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_name", sa.String(255), nullable=False),
        sa.Column("name_key", sa.String(255), nullable=False),
        sa.Column("times_used", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_used_on", sa.Date(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("vendor_id", "name_key", name="uq_store_item_vendor_names_vendor_key"),
    )
    op.create_index("ix_store_item_vendor_names_store_item_id", "store_item_vendor_names", ["store_item_id"])


def downgrade() -> None:
    op.drop_index("ix_store_item_vendor_names_store_item_id", table_name="store_item_vendor_names")
    op.drop_table("store_item_vendor_names")
