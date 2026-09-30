"""add store-stock snapshot to P2P request items

Each PR line now carries an automatic store-stock check (matched via the
Item Master, availability summed across warehouses): taken when the PR is
created so approvers see what's already in store, and refreshed at final PR
approval, when lines with no stock are auto-routed to procurement (the RFQ
starts only for those) while available lines wait for the buyer to issue
them from stock.

Revision ID: b5d7f9a1c3e6
Revises: f1b3d5e7a9c2
Create Date: 2026-09-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b5d7f9a1c3e6'
down_revision = 'f1b3d5e7a9c2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_request_items")}
    with op.batch_alter_table("p2p_request_items") as batch_op:
        if "stock_status" not in columns:
            batch_op.add_column(sa.Column("stock_status", sa.String(length=20), nullable=True))
        if "stock_available_qty" not in columns:
            batch_op.add_column(sa.Column("stock_available_qty", sa.Float(), nullable=True))
        if "stock_checked_at" not in columns:
            batch_op.add_column(sa.Column("stock_checked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("p2p_request_items") as batch_op:
        batch_op.drop_column("stock_checked_at")
        batch_op.drop_column("stock_available_qty")
        batch_op.drop_column("stock_status")
