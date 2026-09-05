"""link p2p request/PO items to shared item master

Revision ID: c2a6e8f4b1d9
Revises: b7c3f9a1d2e4
Create Date: 2026-09-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "c2a6e8f4b1d9"
down_revision = "b7c3f9a1d2e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    request_item_columns = {c["name"] for c in inspector.get_columns("p2p_request_items")}
    if "item_id" not in request_item_columns:
        op.add_column("p2p_request_items", sa.Column("item_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_p2p_request_items_item_id_items", "p2p_request_items", "items", ["item_id"], ["id"],
        )

    po_item_columns = {c["name"] for c in inspector.get_columns("p2p_purchase_order_items")}
    if "item_id" not in po_item_columns:
        op.add_column("p2p_purchase_order_items", sa.Column("item_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_p2p_purchase_order_items_item_id_items", "p2p_purchase_order_items", "items", ["item_id"], ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("p2p_purchase_order_items") as batch_op:
        batch_op.drop_constraint("fk_p2p_purchase_order_items_item_id_items", type_="foreignkey")
        batch_op.drop_column("item_id")
    with op.batch_alter_table("p2p_request_items") as batch_op:
        batch_op.drop_constraint("fk_p2p_request_items_item_id_items", type_="foreignkey")
        batch_op.drop_column("item_id")
