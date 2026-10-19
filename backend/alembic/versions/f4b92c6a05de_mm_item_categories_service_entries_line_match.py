"""MM standards (2026-10-13): PO item categories, service entry sheets, GRN
receipt posting mode and line-level 3-way match results.

- p2p_purchase_order_items.item_category (stock / service / asset), back-filled
  from the linked Item Master item's type.
- p2p_service_entries — service entry sheets (SAP ML81N) for service PO lines.
- p2p_goods_receipt_items.receipt_posting — how the line reached the stock
  ledger (quality / lot / none); NULL on existing rows keeps their old
  "post accepted quantity at inspection" behaviour.
- vendor_invoice_lines.match_status / qty_variance / price_variance.

Revision ID: f4b92c6a05de
Revises: 5750cffe0886
"""
from alembic import op
import sqlalchemy as sa

revision = "f4b92c6a05de"
down_revision = "5750cffe0886"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "item_category" not in _columns("p2p_purchase_order_items"):
        with op.batch_alter_table("p2p_purchase_order_items") as batch:
            batch.add_column(sa.Column("item_category", sa.String(length=10), nullable=True))
    # Back-fill from the Item Master item type (service / asset; all else stock).
    op.execute(
        "UPDATE p2p_purchase_order_items SET item_category = CASE "
        "WHEN (SELECT LOWER(TRIM(si.item_type)) FROM store_items si WHERE si.id = p2p_purchase_order_items.store_item_id) = 'service' THEN 'service' "
        "WHEN (SELECT LOWER(TRIM(si.item_type)) FROM store_items si WHERE si.id = p2p_purchase_order_items.store_item_id) = 'asset' THEN 'asset' "
        "ELSE 'stock' END WHERE item_category IS NULL"
    )

    if "receipt_posting" not in _columns("p2p_goods_receipt_items"):
        with op.batch_alter_table("p2p_goods_receipt_items") as batch:
            batch.add_column(sa.Column("receipt_posting", sa.String(length=10), nullable=True))
    # Lines already sitting under a Quality inspection lot.
    if "quality_inspection_lots" in inspector.get_table_names():
        op.execute(
            "UPDATE p2p_goods_receipt_items SET receipt_posting = 'lot' WHERE receipt_posting IS NULL AND id IN "
            "(SELECT grn_item_id FROM quality_inspection_lots WHERE grn_item_id IS NOT NULL)"
        )

    cols = _columns("vendor_invoice_lines")
    with op.batch_alter_table("vendor_invoice_lines") as batch:
        if "match_status" not in cols:
            batch.add_column(sa.Column("match_status", sa.String(length=20), nullable=True))
        if "qty_variance" not in cols:
            batch.add_column(sa.Column("qty_variance", sa.Numeric(18, 4), nullable=True))
        if "price_variance" not in cols:
            batch.add_column(sa.Column("price_variance", sa.Numeric(18, 2), nullable=True))

    if "p2p_service_entries" not in inspector.get_table_names():
        op.create_table(
            "p2p_service_entries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ses_number", sa.String(length=50), nullable=False),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=False),
            sa.Column("po_item_id", sa.Integer(), sa.ForeignKey("p2p_purchase_order_items.id"), nullable=False),
            sa.Column("period_from", sa.Date(), nullable=True),
            sa.Column("period_to", sa.Date(), nullable=True),
            sa.Column("service_date", sa.Date(), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("accepted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("accepted_at", sa.DateTime(), nullable=True),
            sa.Column("cancelled_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_p2p_service_entries_ses_number", "p2p_service_entries", ["ses_number"], unique=True)
        op.create_index("ix_p2p_service_entries_purchase_order_id", "p2p_service_entries", ["purchase_order_id"])
        op.create_index("ix_p2p_service_entries_po_item_id", "p2p_service_entries", ["po_item_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "p2p_service_entries" in inspector.get_table_names():
        op.drop_index("ix_p2p_service_entries_po_item_id", table_name="p2p_service_entries")
        op.drop_index("ix_p2p_service_entries_purchase_order_id", table_name="p2p_service_entries")
        op.drop_index("ix_p2p_service_entries_ses_number", table_name="p2p_service_entries")
        op.drop_table("p2p_service_entries")
    cols = _columns("vendor_invoice_lines")
    with op.batch_alter_table("vendor_invoice_lines") as batch:
        for c in ("price_variance", "qty_variance", "match_status"):
            if c in cols:
                batch.drop_column(c)
    if "receipt_posting" in _columns("p2p_goods_receipt_items"):
        with op.batch_alter_table("p2p_goods_receipt_items") as batch:
            batch.drop_column("receipt_posting")
    if "item_category" in _columns("p2p_purchase_order_items"):
        with op.batch_alter_table("p2p_purchase_order_items") as batch:
            batch.drop_column("item_category")
