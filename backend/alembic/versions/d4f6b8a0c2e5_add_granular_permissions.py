"""add granular_permissions and data_access_scopes to users

Revision ID: d4f6b8a0c2e5
Revises: c3e5a7b9d1f4
Create Date: 2026-09-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd4f6b8a0c2e5'
down_revision = 'c3e5a7b9d1f4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "granular_permissions" not in columns:
        op.add_column("users", sa.Column("granular_permissions", sa.JSON(), nullable=False, server_default="[]"))
    if "data_access_scopes" not in columns:
        op.add_column("users", sa.Column("data_access_scopes", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("users", "data_access_scopes")
    op.drop_column("users", "granular_permissions")
