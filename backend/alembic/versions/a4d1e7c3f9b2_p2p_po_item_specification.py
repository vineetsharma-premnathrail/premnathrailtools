"""P2P purchase order line specification: free-text lines printed under the item
in the PO's "Description of Goods" (e.g. "Hose Pipe: 3/4\" 450 mm",
"Pressure: 350 Bar") — the official Tally-style PO prints these per line.

Revision ID: a4d1e7c3f9b2
Revises: f3c9d5a2b7e1
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "a4d1e7c3f9b2"
down_revision = "f3c9d5a2b7e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("p2p_purchase_order_items")}
    if "specification" not in cols:
        op.add_column("p2p_purchase_order_items", sa.Column("specification", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("p2p_purchase_order_items")}
    if "specification" in cols:
        with op.batch_alter_table("p2p_purchase_order_items") as batch:
            batch.drop_column("specification")
