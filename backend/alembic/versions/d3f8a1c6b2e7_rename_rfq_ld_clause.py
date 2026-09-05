"""rename rfqs.ld_clause to late_delivery_clause

Revision ID: d3f8a1c6b2e7
Revises: c2a6e8f4b1d9
Create Date: 2026-09-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "d3f8a1c6b2e7"
down_revision = "c2a6e8f4b1d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("rfqs")}
    if "ld_clause" in columns and "late_delivery_clause" not in columns:
        op.alter_column("rfqs", "ld_clause", new_column_name="late_delivery_clause")


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("rfqs")}
    if "late_delivery_clause" in columns and "ld_clause" not in columns:
        op.alter_column("rfqs", "late_delivery_clause", new_column_name="ld_clause")
