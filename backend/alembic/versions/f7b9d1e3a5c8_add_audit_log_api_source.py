"""add api_source to audit_logs

Revision ID: f7b9d1e3a5c8
Revises: e6a8c0d2f4b7
Create Date: 2026-09-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f7b9d1e3a5c8'
down_revision = 'e6a8c0d2f4b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("audit_logs")}
    if "api_source" not in columns:
        op.add_column("audit_logs", sa.Column("api_source", sa.String(length=30), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_logs", "api_source")
