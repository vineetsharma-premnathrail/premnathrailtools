"""Before-PO receipt: vendor invoice date (owner, 2026-11-06) - the bill's date next to its number,
carried into the gate inward register.

Revision ID: d4e8a2c6b1f9
Revises: c3b9e5a1f7d4
"""
from alembic import op
import sqlalchemy as sa

revision = "d4e8a2c6b1f9"
down_revision = "c3b9e5a1f7d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_pre_po_receipts")}
    if "vendor_invoice_date" not in cols:
        op.add_column("store_pre_po_receipts", sa.Column("vendor_invoice_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("store_pre_po_receipts", "vendor_invoice_date")
