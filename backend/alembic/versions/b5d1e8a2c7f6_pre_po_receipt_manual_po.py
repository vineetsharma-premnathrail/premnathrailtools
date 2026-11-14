"""Goods receipt with a PO that is not in the portal's PO list (owner, 2026-11-13): the store types the
PO number and PO date (the PO made in Tally / by the vendor) and may attach the PO file.

Revision ID: b5d1e8a2c7f6
Revises: 14846051039c
"""
from alembic import op
import sqlalchemy as sa

revision = "b5d1e8a2c7f6"
down_revision = "14846051039c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_pre_po_receipts")}
    if "manual_po_number" not in cols:
        op.add_column("store_pre_po_receipts", sa.Column("manual_po_number", sa.String(100), nullable=True))
    if "manual_po_date" not in cols:
        op.add_column("store_pre_po_receipts", sa.Column("manual_po_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("store_pre_po_receipts", "manual_po_date")
    op.drop_column("store_pre_po_receipts", "manual_po_number")
