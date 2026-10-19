"""Managed documents: generated Word drafts edited in Word Online

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "a7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "managed_documents" not in tables:
        op.create_table(
            "managed_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entity_type", sa.String(length=50), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("source_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("docx_item_id", sa.String(length=200), nullable=False),
            sa.Column("docx_path", sa.String(length=1000), nullable=False),
            sa.Column("docx_web_url", sa.String(length=1000), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_managed_documents_entity", "managed_documents", ["entity_type", "entity_id"])
    if "managed_document_events" not in tables:
        op.create_table(
            "managed_document_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("managed_documents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("action", sa.String(length=40), nullable=False),
            sa.Column("sharepoint_version", sa.String(length=20), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_managed_document_events_document_id", "managed_document_events", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_managed_document_events_document_id", table_name="managed_document_events")
    op.drop_table("managed_document_events")
    op.drop_index("ix_managed_documents_entity", table_name="managed_documents")
    op.drop_table("managed_documents")
