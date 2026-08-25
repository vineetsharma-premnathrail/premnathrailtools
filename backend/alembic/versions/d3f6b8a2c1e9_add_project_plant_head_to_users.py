"""add is_project_head and is_plant_head to users

Revision ID: d3f6b8a2c1e9
Revises: c7e4a2f91b6d
Create Date: 2026-08-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd3f6b8a2c1e9'
down_revision = 'c7e4a2f91b6d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "is_project_head" not in columns:
        op.add_column("users", sa.Column("is_project_head", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "is_plant_head" not in columns:
        op.add_column("users", sa.Column("is_plant_head", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "is_plant_head" in columns:
        op.drop_column("users", "is_plant_head")
    if "is_project_head" in columns:
        op.drop_column("users", "is_project_head")
