"""Requirement Discussion: crm_requirement_comments — the shared CRM ↔ R&D
message thread on an Inquiry / Tender sent to R&D (attachments reuse
crm_documents).

Revision ID: b4e7d2a9c6f1
Revises: a6c2e8f4b1d9
Create Date: 2026-10-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "b4e7d2a9c6f1"
down_revision = "a6c2e8f4b1d9"
branch_labels = None
depends_on = None

_TABLE = "crm_requirement_comments"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE in set(inspector.get_table_names()):
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("author_side", sa.String(length=10), nullable=False, server_default="crm"),
        sa.Column("mentioned_user_ids", sa.JSON(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
    )
    op.create_index("ix_crm_requirement_comments_record", _TABLE, ["source", "record_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE in set(inspector.get_table_names()):
        op.drop_index("ix_crm_requirement_comments_record", table_name=_TABLE)
        op.drop_table(_TABLE)
