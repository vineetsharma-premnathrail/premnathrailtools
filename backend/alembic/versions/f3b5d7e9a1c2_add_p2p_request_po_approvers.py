"""add p2p_request_po_approvers (PO approvers picked per PR)

Revision ID: f3b5d7e9a1c2
Revises: e2a4c6e8f0b1
"""
from alembic import op
import sqlalchemy as sa

revision = "f3b5d7e9a1c2"
down_revision = "e2a4c6e8f0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "p2p_request_po_approvers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("p2p_request_id", sa.Integer(), sa.ForeignKey("p2p_requests.id"), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approver_name", sa.String(150), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_p2p_request_po_approvers_p2p_request_id", "p2p_request_po_approvers", ["p2p_request_id"])
    op.create_index("ix_p2p_request_po_approvers_approver_id", "p2p_request_po_approvers", ["approver_id"])


def downgrade() -> None:
    op.drop_index("ix_p2p_request_po_approvers_approver_id", table_name="p2p_request_po_approvers")
    op.drop_index("ix_p2p_request_po_approvers_p2p_request_id", table_name="p2p_request_po_approvers")
    op.drop_table("p2p_request_po_approvers")
