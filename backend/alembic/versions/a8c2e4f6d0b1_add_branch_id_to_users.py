"""add branch_id to users (auto-linked from Azure officeLocation)

Revision ID: a8c2e4f6d0b1
Revises: f6b8d0a2c4e6
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a8c2e4f6d0b1'
down_revision = 'f6b8d0a2c4e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "branch_id" not in columns:
        op.add_column("users", sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "branch_id")
