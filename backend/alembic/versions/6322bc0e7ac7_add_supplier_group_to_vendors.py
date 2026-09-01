"""add supplier_group column to vendors

Revision ID: 6322bc0e7ac7
Revises: fa07f572e8d9
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '6322bc0e7ac7'
down_revision = 'fa07f572e8d9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("vendors")}
    if "supplier_group" not in columns:
        op.add_column("vendors", sa.Column("supplier_group", sa.String(length=30), nullable=True))


def downgrade() -> None:
    op.drop_column("vendors", "supplier_group")
