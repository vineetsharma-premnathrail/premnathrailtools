"""Sales orders link CRM documents of their source inquiry / tender (link only, no copy).

New table sales_order_crm_documents; nothing existing changes.

Revision ID: c8d2f6a1e9b3
Revises: a3e7c1f9d4b6
"""
from alembic import op
import sqlalchemy as sa

revision = "c8d2f6a1e9b3"
down_revision = "a3e7c1f9d4b6"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("sales_order_crm_documents"):
        return
    op.create_table(
        "sales_order_crm_documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("crm_document_id", sa.Integer(), sa.ForeignKey("crm_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("linked_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("sales_order_id", "crm_document_id", name="uq_sales_order_crm_document"),
    )
    op.create_index("ix_sales_order_crm_documents_sales_order_id", "sales_order_crm_documents", ["sales_order_id"])
    op.create_index("ix_sales_order_crm_documents_crm_document_id", "sales_order_crm_documents", ["crm_document_id"])


def downgrade():
    op.drop_index("ix_sales_order_crm_documents_crm_document_id", table_name="sales_order_crm_documents")
    op.drop_index("ix_sales_order_crm_documents_sales_order_id", table_name="sales_order_crm_documents")
    op.drop_table("sales_order_crm_documents")
