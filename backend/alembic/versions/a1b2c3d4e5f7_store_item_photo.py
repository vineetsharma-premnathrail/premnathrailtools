"""Add photo to store items

Revision ID: a1b2c3d4e5f7
Revises: f0a1b2c3d4e5
Create Date: 2026-10-03

"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f7"
down_revision = "f0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("store_items", sa.Column("photo_path", sa.String(500), nullable=True))
    op.add_column("store_items", sa.Column("photo_content_type", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("store_items", "photo_content_type")
    op.drop_column("store_items", "photo_path")
