"""add vendor pan

Revision ID: ae4ebdb39302
Revises: 9baa7b342e68
Create Date: 2026-09-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "ae4ebdb39302"
down_revision = "9baa7b342e68"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("vendors")}
    if "pan" not in columns:
        op.add_column("vendors", sa.Column("pan", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("vendors", "pan")
