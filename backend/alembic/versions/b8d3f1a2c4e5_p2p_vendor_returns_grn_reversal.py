"""P2P: Return to Vendor documents + GRN reversal.

- p2p_vendor_returns / p2p_vendor_return_items: goods sent back against a GRN
  (stock out at the PO rate, pending debit note for Finance when already
  invoiced);
- p2p_goods_receipts: reversed_by_id / reversed_at / reversal_reason (status
  'reversed' — a wrongly entered GRN cancelled as a whole);
- p2p_goods_receipt_items: returned_quantity / rejected_returned_quantity.

Revision ID: b8d3f1a2c4e5
Revises: a7c2e9f41b3d
Create Date: 2026-10-11
"""
from alembic import op
import sqlalchemy as sa

revision = "b8d3f1a2c4e5"
down_revision = "a7c2e9f41b3d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = set(insp.get_table_names())

    grn_cols = {c["name"] for c in insp.get_columns("p2p_goods_receipts")}
    with op.batch_alter_table("p2p_goods_receipts") as batch:
        if "reversed_by_id" not in grn_cols:
            batch.add_column(sa.Column("reversed_by_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_p2p_goods_receipts_reversed_by_id", "users", ["reversed_by_id"], ["id"])
        if "reversed_at" not in grn_cols:
            batch.add_column(sa.Column("reversed_at", sa.DateTime(), nullable=True))
        if "reversal_reason" not in grn_cols:
            batch.add_column(sa.Column("reversal_reason", sa.Text(), nullable=True))

    item_cols = {c["name"] for c in insp.get_columns("p2p_goods_receipt_items")}
    with op.batch_alter_table("p2p_goods_receipt_items") as batch:
        if "returned_quantity" not in item_cols:
            batch.add_column(sa.Column("returned_quantity", sa.Float(), nullable=False, server_default="0"))
        if "rejected_returned_quantity" not in item_cols:
            batch.add_column(sa.Column("rejected_returned_quantity", sa.Float(), nullable=False, server_default="0"))

    if "p2p_vendor_returns" not in tables:
        op.create_table(
            "p2p_vendor_returns",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("rtv_number", sa.String(50), nullable=False),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=False),
            sa.Column("goods_receipt_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipts.id"), nullable=False),
            sa.Column("vendor_id", sa.Integer(), nullable=True),
            sa.Column("vendor_name", sa.String(255), nullable=True),
            sa.Column("store_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("return_date", sa.Date(), nullable=False),
            sa.Column("reason", sa.String(30), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("vehicle_number", sa.String(50), nullable=True),
            sa.Column("ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id"), nullable=True),
            sa.Column("stock_posted", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("debit_note_id", sa.Integer(), sa.ForeignKey("accounts_party_notes.id"), nullable=True),
            sa.Column("debit_note_message", sa.Text(), nullable=True),
            sa.Column("total_value", sa.Float(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_p2p_vendor_returns_rtv_number", "p2p_vendor_returns", ["rtv_number"], unique=True)
        op.create_index("ix_p2p_vendor_returns_purchase_order_id", "p2p_vendor_returns", ["purchase_order_id"])
        op.create_index("ix_p2p_vendor_returns_goods_receipt_id", "p2p_vendor_returns", ["goods_receipt_id"])

    if "p2p_vendor_return_items" not in tables:
        op.create_table(
            "p2p_vendor_return_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("vendor_return_id", sa.Integer(), sa.ForeignKey("p2p_vendor_returns.id"), nullable=False),
            sa.Column("grn_item_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipt_items.id"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("item_name", sa.String(255), nullable=False),
            sa.Column("unit", sa.String(20), nullable=True),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("unit_rate", sa.Float(), nullable=True),
            sa.Column("tax_rate", sa.Float(), nullable=True),
            sa.Column("value", sa.Float(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_p2p_vendor_return_items_vendor_return_id", "p2p_vendor_return_items", ["vendor_return_id"])
        op.create_index("ix_p2p_vendor_return_items_grn_item_id", "p2p_vendor_return_items", ["grn_item_id"])


def downgrade() -> None:
    op.drop_table("p2p_vendor_return_items")
    op.drop_table("p2p_vendor_returns")
    with op.batch_alter_table("p2p_goods_receipt_items") as batch:
        batch.drop_column("rejected_returned_quantity")
        batch.drop_column("returned_quantity")
    with op.batch_alter_table("p2p_goods_receipts") as batch:
        batch.drop_constraint("fk_p2p_goods_receipts_reversed_by_id", type_="foreignkey")
        batch.drop_column("reversal_reason")
        batch.drop_column("reversed_at")
        batch.drop_column("reversed_by_id")
