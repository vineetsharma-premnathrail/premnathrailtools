"""GRN attachments: the vendor's invoice / delivery challan file added when goods are received

Revision ID: a3d9f1c7e5b8
Revises: f5c1a9e3d7b2
Create Date: 2026-11-19
"""
import sqlalchemy as sa
from alembic import op

revision = "a3d9f1c7e5b8"
down_revision = "f5c1a9e3d7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "p2p_goods_receipt_attachments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("goods_receipt_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("doc_type", sa.String(20), nullable=False, server_default="other"),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("sharepoint_path", sa.String(1000), nullable=True),
        sa.Column("sharepoint_url", sa.String(1000), nullable=True),
        sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("ix_p2p_goods_receipt_attachments_goods_receipt_id", "p2p_goods_receipt_attachments", ["goods_receipt_id"])


def downgrade() -> None:
    op.drop_index("ix_p2p_goods_receipt_attachments_goods_receipt_id", table_name="p2p_goods_receipt_attachments")
    op.drop_table("p2p_goods_receipt_attachments")
