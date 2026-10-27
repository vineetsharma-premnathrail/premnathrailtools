"""Store Before-PO receipts: goods that arrive before their purchase order exists.

Two new tables (store_pre_po_receipts, store_pre_po_receipt_items). Nothing is
altered on existing tables, so it is safe on a live database.

Revision ID: a9d3f5b7c1e2
Revises: c4e8b2a6d9f1
"""
from alembic import op
import sqlalchemy as sa

revision = "a9d3f5b7c1e2"
down_revision = "c4e8b2a6d9f1"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("store_pre_po_receipts"):
        op.create_table(
            "store_pre_po_receipts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("receipt_number", sa.String(50), nullable=False),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("vendor_name", sa.String(255), nullable=False),
            sa.Column("received_date", sa.Date(), nullable=False),
            sa.Column("store_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("delivery_challan_number", sa.String(100), nullable=True),
            sa.Column("vendor_invoice_number", sa.String(100), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending_po"),
            sa.Column("p2p_request_id", sa.Integer(), sa.ForeignKey("p2p_requests.id"), nullable=True),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("cancelled_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_store_pre_po_receipts_receipt_number", "store_pre_po_receipts", ["receipt_number"], unique=True)
        op.create_index("ix_store_pre_po_receipts_vendor_id", "store_pre_po_receipts", ["vendor_id"])
        op.create_index("ix_store_pre_po_receipts_p2p_request_id", "store_pre_po_receipts", ["p2p_request_id"])
        op.create_index("ix_store_pre_po_receipts_purchase_order_id", "store_pre_po_receipts", ["purchase_order_id"])
    if not insp.has_table("store_pre_po_receipt_items"):
        op.create_table(
            "store_pre_po_receipt_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("receipt_id", sa.Integer(), sa.ForeignKey("store_pre_po_receipts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("item_name", sa.String(255), nullable=False),
            sa.Column("unit", sa.String(20), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.CheckConstraint("quantity > 0", name="ck_store_pre_po_receipt_items_qty_pos"),
        )
        op.create_index("ix_store_pre_po_receipt_items_receipt_id", "store_pre_po_receipt_items", ["receipt_id"])
        op.create_index("ix_store_pre_po_receipt_items_store_item_id", "store_pre_po_receipt_items", ["store_item_id"])


def downgrade():
    insp = sa.inspect(op.get_bind())
    if insp.has_table("store_pre_po_receipt_items"):
        op.drop_table("store_pre_po_receipt_items")
    if insp.has_table("store_pre_po_receipts"):
        op.drop_table("store_pre_po_receipts")
