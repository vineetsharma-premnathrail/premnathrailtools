"""Item Master ERP fields: GST rate, preferred vendor (vendor master link),
purchase / sales ledger per item and per category, minimum order quantity.

- store_items.gst_rate, preferred_vendor_id, purchase_gl_account_id,
  sales_gl_account_id, min_order_qty
- store_item_categories.purchase_gl_account_id, sales_gl_account_id
- data: preferred_supplier text → preferred_vendor_id where the text equals
  exactly one vendor's name or code (case-insensitive); the text is kept.

Revision ID: e8b2f4c6a1d3
Revises: c7d1e9a3f5b2
Create Date: 2026-10-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "e8b2f4c6a1d3"
down_revision = "c7d1e9a3f5b2"
branch_labels = None
depends_on = None


def _cols(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "store_items" in tables:
        cols = _cols(inspector, "store_items")
        with op.batch_alter_table("store_items") as b:
            if "gst_rate" not in cols:
                b.add_column(sa.Column("gst_rate", sa.Numeric(7, 3), nullable=True))
            if "preferred_vendor_id" not in cols:
                b.add_column(sa.Column("preferred_vendor_id", sa.Integer(), sa.ForeignKey("vendors.id", ondelete="SET NULL", name="fk_store_items_preferred_vendor"), nullable=True))
            if "purchase_gl_account_id" not in cols:
                b.add_column(sa.Column("purchase_gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id", name="fk_store_items_purchase_gl"), nullable=True))
            if "sales_gl_account_id" not in cols:
                b.add_column(sa.Column("sales_gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id", name="fk_store_items_sales_gl"), nullable=True))
            if "min_order_qty" not in cols:
                b.add_column(sa.Column("min_order_qty", sa.Float(), nullable=True))

    if "store_item_categories" in tables:
        cols = _cols(inspector, "store_item_categories")
        with op.batch_alter_table("store_item_categories") as b:
            if "purchase_gl_account_id" not in cols:
                b.add_column(sa.Column("purchase_gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id", name="fk_store_item_categories_purchase_gl"), nullable=True))
            if "sales_gl_account_id" not in cols:
                b.add_column(sa.Column("sales_gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id", name="fk_store_item_categories_sales_gl"), nullable=True))

    # Link the old free-text preferred supplier to the vendor master when the
    # text names exactly one vendor. Ambiguous / unknown names stay unlinked.
    if "store_items" in tables and "vendors" in tables:
        op.execute(
            """
            UPDATE store_items SET preferred_vendor_id = (
                SELECT MIN(v.id) FROM vendors v
                WHERE lower(trim(v.name)) = lower(trim(store_items.preferred_supplier))
                   OR lower(trim(v.code)) = lower(trim(store_items.preferred_supplier))
            )
            WHERE preferred_vendor_id IS NULL
              AND preferred_supplier IS NOT NULL AND trim(preferred_supplier) <> ''
              AND (
                SELECT COUNT(*) FROM vendors v
                WHERE lower(trim(v.name)) = lower(trim(store_items.preferred_supplier))
                   OR lower(trim(v.code)) = lower(trim(store_items.preferred_supplier))
              ) = 1
            """
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "store_item_categories" in tables:
        cols = _cols(inspector, "store_item_categories")
        with op.batch_alter_table("store_item_categories") as b:
            for c in ("sales_gl_account_id", "purchase_gl_account_id"):
                if c in cols:
                    b.drop_column(c)
    if "store_items" in tables:
        cols = _cols(inspector, "store_items")
        with op.batch_alter_table("store_items") as b:
            for c in ("min_order_qty", "sales_gl_account_id", "purchase_gl_account_id", "preferred_vendor_id", "gst_rate"):
                if c in cols:
                    b.drop_column(c)
