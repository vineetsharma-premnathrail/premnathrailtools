"""add secondary_head_user_id to departments

Revision ID: b3d5f7a9c1e2
Revises: a8c2e4f6d0b1
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b3d5f7a9c1e2'
down_revision = 'a8c2e4f6d0b1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("departments")}
    if "secondary_head_user_id" not in columns:
        op.add_column("departments", sa.Column("secondary_head_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("departments", "secondary_head_user_id")
