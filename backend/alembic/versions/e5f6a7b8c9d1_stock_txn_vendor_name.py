"""Store stock transactions: vendor_name

Revision ID: e5f6a7b8c9d1
Revises: d4e5f6a7b8c0
Create Date: 2026-10-05

"""
from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8c9d1"
down_revision = "d4e5f6a7b8c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("store_stock_transactions", sa.Column("vendor_name", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("store_stock_transactions", "vendor_name")
