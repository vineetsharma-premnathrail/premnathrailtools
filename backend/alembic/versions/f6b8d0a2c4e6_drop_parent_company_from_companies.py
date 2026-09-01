"""drop parent_company from companies

Revision ID: f6b8d0a2c4e6
Revises: e5a7c9b1f3d4
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f6b8d0a2c4e6'
down_revision = 'e5a7c9b1f3d4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("companies")}
    if "parent_company" in columns:
        op.drop_column("companies", "parent_company")


def downgrade() -> None:
    op.add_column("companies", sa.Column("parent_company", sa.String(length=150), nullable=True))
