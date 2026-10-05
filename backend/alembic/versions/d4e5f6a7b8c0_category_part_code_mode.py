"""Store category: part_code_mode (off / optional / required)

Revision ID: d4e5f6a7b8c0
Revises: c3d4e5f6a7b9
Create Date: 2026-10-05

"""
from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7b8c0"
down_revision = "c3d4e5f6a7b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("store_item_categories",
                  sa.Column("part_code_mode", sa.String(20), nullable=False, server_default="off"))


def downgrade() -> None:
    op.drop_column("store_item_categories", "part_code_mode")
