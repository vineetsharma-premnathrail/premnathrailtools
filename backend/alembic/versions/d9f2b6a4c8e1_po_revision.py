"""p2p_purchase_orders.revision — bumped on each draft edit so the managed
Word Purchase Order knows when it is out of date.

Revision ID: d9f2b6a4c8e1
Revises: a7e3c5d9b1f4
Create Date: 2026-10-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "d9f2b6a4c8e1"
down_revision = "a7e3c5d9b1f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "p2p_purchase_orders" in inspector.get_table_names() and \
            "revision" not in {c["name"] for c in inspector.get_columns("p2p_purchase_orders")}:
        with op.batch_alter_table("p2p_purchase_orders") as b:
            b.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "p2p_purchase_orders" in inspector.get_table_names() and \
            "revision" in {c["name"] for c in inspector.get_columns("p2p_purchase_orders")}:
        with op.batch_alter_table("p2p_purchase_orders") as b:
            b.drop_column("revision")
