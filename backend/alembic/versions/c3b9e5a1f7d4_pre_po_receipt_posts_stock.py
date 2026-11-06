"""Before-PO receipt posts stock (owner, 2026-11-06): goods booked before their PO go
into stock at once (Free, or Quality + inspection lot when the item is flagged), with an
optional gate rate; the PO's GRN settles that quantity instead of posting it again.

Revision ID: c3b9e5a1f7d4
Revises: f1a7c3e9b5d2
"""
from alembic import op
import sqlalchemy as sa

revision = "c3b9e5a1f7d4"
down_revision = "f1a7c3e9b5d2"
branch_labels = None
depends_on = None


def _cols(bind, table: str) -> set[str]:
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table)} if table in insp.get_table_names() else set()


def upgrade() -> None:
    bind = op.get_bind()
    head = _cols(bind, "store_pre_po_receipts")
    if head and "stock_posted" not in head:
        op.add_column("store_pre_po_receipts", sa.Column("stock_posted", sa.Boolean(), nullable=False, server_default=sa.false()))
    items = _cols(bind, "store_pre_po_receipt_items")
    if items:
        if "unit_rate" not in items:
            op.add_column("store_pre_po_receipt_items", sa.Column("unit_rate", sa.Float(), nullable=True))
        if "receipt_posting" not in items:
            op.add_column("store_pre_po_receipt_items", sa.Column("receipt_posting", sa.String(10), nullable=True))
        if "inspection_lot_id" not in items:
            op.add_column("store_pre_po_receipt_items", sa.Column("inspection_lot_id", sa.Integer(), nullable=True))
            op.create_foreign_key("fk_store_pre_po_receipt_items_lot", "store_pre_po_receipt_items", "quality_inspection_lots",
                                  ["inspection_lot_id"], ["id"], ondelete="SET NULL")
        if "settled_qty" not in items:
            op.add_column("store_pre_po_receipt_items", sa.Column("settled_qty", sa.Float(), nullable=False, server_default="0"))
    grn = _cols(bind, "p2p_goods_receipt_items")
    if grn and "pre_po_qty" not in grn:
        op.add_column("p2p_goods_receipt_items", sa.Column("pre_po_qty", sa.Float(), nullable=False, server_default="0"))


def downgrade() -> None:
    bind = op.get_bind()
    if "pre_po_qty" in _cols(bind, "p2p_goods_receipt_items"):
        op.drop_column("p2p_goods_receipt_items", "pre_po_qty")
    items = _cols(bind, "store_pre_po_receipt_items")
    fks = {fk.get("name") for fk in sa.inspect(bind).get_foreign_keys("store_pre_po_receipt_items")} if items else set()
    if "fk_store_pre_po_receipt_items_lot" in fks:
        op.drop_constraint("fk_store_pre_po_receipt_items_lot", "store_pre_po_receipt_items", type_="foreignkey")
    for col in ("settled_qty", "inspection_lot_id", "receipt_posting", "unit_rate"):
        if col in items:
            op.drop_column("store_pre_po_receipt_items", col)
    if "stock_posted" in _cols(bind, "store_pre_po_receipts"):
        op.drop_column("store_pre_po_receipts", "stock_posted")
