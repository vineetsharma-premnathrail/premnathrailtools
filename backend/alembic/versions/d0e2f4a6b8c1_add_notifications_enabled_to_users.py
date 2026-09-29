"""add notifications_enabled to users

Revision ID: d0e2f4a6b8c1
Revises: c9d1e3f5a7b8
Create Date: 2026-09-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd0e2f4a6b8c1'
down_revision = 'c9d1e3f5a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "notifications_enabled" not in columns:
        op.add_column("users", sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    op.drop_column("users", "notifications_enabled")
