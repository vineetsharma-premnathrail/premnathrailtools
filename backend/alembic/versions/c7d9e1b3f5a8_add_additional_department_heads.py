"""add additional_head_user_ids to departments (support more than 2 heads)

Revision ID: c7d9e1b3f5a8
Revises: b3c9f1d47e20
Create Date: 2026-09-22 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = 'c7d9e1b3f5a8'
down_revision = 'b3c9f1d47e20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("departments")}
    if "additional_head_user_ids" not in columns:
        op.add_column("departments", sa.Column("additional_head_user_ids", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("departments", "additional_head_user_ids")
