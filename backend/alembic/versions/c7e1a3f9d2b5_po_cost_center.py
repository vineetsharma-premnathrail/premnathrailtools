"""Procurement: cost centre on the purchase order — picked by Purchase, not on
the requisition (2026-10-23).

Revision ID: c7e1a3f9d2b5
Revises: b4d8e2f6a1c3
"""
from alembic import op
import sqlalchemy as sa

revision = "c7e1a3f9d2b5"
down_revision = "b4d8e2f6a1c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("p2p_purchase_orders")}
    if "cost_center_id" not in cols:
        with op.batch_alter_table("p2p_purchase_orders") as t:
            t.add_column(sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True))
            t.create_index("ix_p2p_purchase_orders_cost_center_id", ["cost_center_id"])


def downgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("p2p_purchase_orders")}
    if "cost_center_id" in cols:
        with op.batch_alter_table("p2p_purchase_orders") as t:
            t.drop_index("ix_p2p_purchase_orders_cost_center_id")
            t.drop_column("cost_center_id")
