"""add office_location to users (Azure AD officeLocation)

Revision ID: c1e3a5f7d9b2
Revises: b6f1c8a3d5e7
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c1e3a5f7d9b2'
down_revision = 'b6f1c8a3d5e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "office_location" not in columns:
        op.add_column("users", sa.Column("office_location", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "office_location")
