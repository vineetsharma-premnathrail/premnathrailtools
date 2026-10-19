"""Store stock transfers: approval (central engine) + two-step dispatch /
receipt with the Stock Transfer Note.

Existing transfers moved stock the moment they were created, so they become
'received'.

Revision ID: e3b7d1f9a2c4
Revises: d8a2c4e6f1b3
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "e3b7d1f9a2c4"
down_revision = "d8a2c4e6f1b3"
branch_labels = None
depends_on = None

_COLS = [
    sa.Column("status", sa.String(20), nullable=False, server_default="received"),
    sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("rejected_reason", sa.Text(), nullable=True),
    sa.Column("dispatched_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("vehicle_number", sa.String(30), nullable=True),
    sa.Column("transporter_name", sa.String(150), nullable=True),
    sa.Column("driver_name", sa.String(100), nullable=True),
    sa.Column("driver_phone", sa.String(20), nullable=True),
    sa.Column("eway_bill_number", sa.String(30), nullable=True),
    sa.Column("received_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("receipt_remarks", sa.Text(), nullable=True),
]


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    have = {c["name"] for c in insp.get_columns("store_stock_transfers")}
    for col in _COLS:
        if col.name not in have:
            op.add_column("store_stock_transfers", col)
    if "dispatch_value" not in {c["name"] for c in insp.get_columns("store_stock_transfer_items")}:
        op.add_column("store_stock_transfer_items", sa.Column("dispatch_value", sa.Float(), nullable=True))
    op.create_index("ix_store_stock_transfers_status", "store_stock_transfers", ["status"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_store_stock_transfers_status", table_name="store_stock_transfers", if_exists=True)
    op.drop_column("store_stock_transfer_items", "dispatch_value")
    for col in reversed(_COLS):
        op.drop_column("store_stock_transfers", col.name)
