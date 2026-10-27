"""Purchase requisition lines carry their own buyer.

One nullable column (p2p_request_items.buyer_id -> users.id) with an index.
Existing lines stay NULL and keep using the requisition's assigned buyer, so it
is safe on a live database.

Revision ID: e5b1d7c3a9f2
Revises: a9d3f5b7c1e2
"""
from alembic import op
import sqlalchemy as sa

revision = "e5b1d7c3a9f2"
down_revision = "a9d3f5b7c1e2"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("p2p_request_items")}
    if "buyer_id" not in cols:
        op.add_column("p2p_request_items", sa.Column("buyer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
        op.create_index("ix_p2p_request_items_buyer_id", "p2p_request_items", ["buyer_id"])


def downgrade():
    op.drop_index("ix_p2p_request_items_buyer_id", table_name="p2p_request_items")
    op.drop_column("p2p_request_items", "buyer_id")
