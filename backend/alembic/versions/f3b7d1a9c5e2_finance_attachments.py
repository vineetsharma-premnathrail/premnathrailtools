"""Finance: supporting documents (voucher proof) on purchase invoices, debit /
credit notes, sales invoices, journals and payment vouchers (2026-10-22).

Revision ID: f3b7d1a9c5e2
Revises: e5a1c9d3f7b2
"""
from alembic import op
import sqlalchemy as sa

revision = "f3b7d1a9c5e2"
down_revision = "e5a1c9d3f7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "accounts_attachments" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "accounts_attachments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_type", sa.String(length=20), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("doc_type", sa.String(length=20), nullable=False, server_default="other"),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
        sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_by_name", sa.String(length=150), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_accounts_attachments_entity_type", "accounts_attachments", ["entity_type"])
    op.create_index("ix_accounts_attachments_entity_id", "accounts_attachments", ["entity_id"])


def downgrade() -> None:
    op.drop_index("ix_accounts_attachments_entity_id", table_name="accounts_attachments")
    op.drop_index("ix_accounts_attachments_entity_type", table_name="accounts_attachments")
    op.drop_table("accounts_attachments")
