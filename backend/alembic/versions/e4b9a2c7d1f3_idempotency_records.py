"""Idempotency keys for saves: a save retried after a network failure is not saved twice.

New table idempotency_records; nothing existing changes.

Revision ID: e4b9a2c7d1f3
Revises: c8d2f6a1e9b3
"""
from alembic import op
import sqlalchemy as sa

revision = "e4b9a2c7d1f3"
down_revision = "c8d2f6a1e9b3"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("idempotency_records"):
        return
    op.create_table(
        "idempotency_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_key", sa.String(80), nullable=False),
        sa.Column("idem_key", sa.String(100), nullable=False),
        sa.Column("method", sa.String(10), nullable=False),
        sa.Column("path", sa.String(500), nullable=False),
        sa.Column("state", sa.String(20), nullable=False, server_default="in_progress"),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_type", sa.String(150), nullable=True),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_key", "idem_key", name="uq_idempotency_user_key"),
    )
    op.create_index("ix_idempotency_records_created_at", "idempotency_records", ["created_at"])


def downgrade():
    op.drop_index("ix_idempotency_records_created_at", table_name="idempotency_records")
    op.drop_table("idempotency_records")
