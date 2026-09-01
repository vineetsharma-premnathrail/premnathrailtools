"""drop is_active from branches (status column not needed)

Revision ID: d5f7b9c1e3a4
Revises: c4e6a8b0d2f3
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd5f7b9c1e3a4'
down_revision = 'c4e6a8b0d2f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("branches")}
    if "is_active" in columns:
        op.drop_column("branches", "is_active")


def downgrade() -> None:
    op.add_column("branches", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
