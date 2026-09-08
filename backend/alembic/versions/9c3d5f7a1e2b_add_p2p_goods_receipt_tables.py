"""add p2p goods receipt tables

Revision ID: 9c3d5f7a1e2b
Revises: 7a2f9c4e1b6d
Create Date: 2026-09-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '9c3d5f7a1e2b'
down_revision = '7a2f9c4e1b6d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "p2p_goods_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("grn_number", sa.String(length=50), nullable=False),
        sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=False),
        sa.Column("store_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("received_date", sa.Date(), nullable=False),
        sa.Column("received_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("inspected_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("inspected_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_p2p_goods_receipts_grn_number", "p2p_goods_receipts", ["grn_number"], unique=True)
    op.create_index("ix_p2p_goods_receipts_purchase_order_id", "p2p_goods_receipts", ["purchase_order_id"])

    op.create_table(
        "p2p_goods_receipt_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("goods_receipt_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipts.id"), nullable=False),
        sa.Column("po_item_id", sa.Integer(), sa.ForeignKey("p2p_purchase_order_items.id"), nullable=False),
        sa.Column("item_name", sa.String(length=255), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("ordered_quantity", sa.Float(), nullable=False),
        sa.Column("received_quantity", sa.Float(), nullable=False),
        sa.Column("accepted_quantity", sa.Float(), nullable=True),
        sa.Column("rejected_quantity", sa.Float(), nullable=True),
        sa.Column("quality_status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("p2p_goods_receipt_items")
    op.drop_index("ix_p2p_goods_receipts_purchase_order_id", table_name="p2p_goods_receipts")
    op.drop_index("ix_p2p_goods_receipts_grn_number", table_name="p2p_goods_receipts")
    op.drop_table("p2p_goods_receipts")
