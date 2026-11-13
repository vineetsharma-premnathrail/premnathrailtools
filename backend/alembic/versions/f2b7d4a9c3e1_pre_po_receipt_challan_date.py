"""Before-PO receipt: delivery challan date (owner, 2026-11-07) - the challan's date next to its number,
carried into the gate inward register.

Revision ID: f2b7d4a9c3e1
Revises: e6f1a3c8b2d5
"""
from alembic import op
import sqlalchemy as sa

revision = "f2b7d4a9c3e1"
down_revision = "e6f1a3c8b2d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_pre_po_receipts")}
    if "delivery_challan_date" not in cols:
        op.add_column("store_pre_po_receipts", sa.Column("delivery_challan_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("store_pre_po_receipts", "delivery_challan_date")
