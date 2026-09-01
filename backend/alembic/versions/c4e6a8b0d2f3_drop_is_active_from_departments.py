"""drop is_active from departments (status column not needed)

Revision ID: c4e6a8b0d2f3
Revises: b3d5f7a9c1e2
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c4e6a8b0d2f3'
down_revision = 'b3d5f7a9c1e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("departments")}
    if "is_active" in columns:
        op.drop_column("departments", "is_active")


def downgrade() -> None:
    op.add_column("departments", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
