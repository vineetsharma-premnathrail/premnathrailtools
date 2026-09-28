"""add accounts module phase 5 (period closing)

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "period_close" not in inspector.get_table_names():
        op.create_table(
            "period_close",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("accounting_period", sa.String(length=7), nullable=False, unique=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("close_notes", sa.Text(), nullable=True),
            sa.Column("reopened_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reopened_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reopen_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("period_close"):
        op.drop_table("period_close")
