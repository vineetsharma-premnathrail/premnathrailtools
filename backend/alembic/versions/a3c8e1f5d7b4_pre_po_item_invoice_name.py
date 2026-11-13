"""Before-PO receipt line: the item's name as printed on the vendor's invoice / challan (owner, 2026-11-07).

Revision ID: a3c8e1f5d7b4
Revises: f2b7d4a9c3e1
"""
from alembic import op
import sqlalchemy as sa

revision = "a3c8e1f5d7b4"
down_revision = "f2b7d4a9c3e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_pre_po_receipt_items")}
    if "invoice_item_name" not in cols:
        op.add_column("store_pre_po_receipt_items", sa.Column("invoice_item_name", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("store_pre_po_receipt_items", "invoice_item_name")
