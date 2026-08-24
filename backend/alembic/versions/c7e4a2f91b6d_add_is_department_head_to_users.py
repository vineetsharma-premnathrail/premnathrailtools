"""add is_department_head to users

Revision ID: c7e4a2f91b6d
Revises: a1c3d9f7e2b4
Create Date: 2026-08-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c7e4a2f91b6d'
down_revision = 'a1c3d9f7e2b4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "is_department_head" not in columns:
        op.add_column("users", sa.Column("is_department_head", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "is_department_head" in columns:
        op.drop_column("users", "is_department_head")
