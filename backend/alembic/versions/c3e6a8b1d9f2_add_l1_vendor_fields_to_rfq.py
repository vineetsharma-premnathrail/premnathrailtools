"""add l1_vendor_name/l1_vendor_contact to rfqs

Revision ID: c3e6a8b1d9f2
Revises: b1d4f7a9e2c5
Create Date: 2026-09-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "c3e6a8b1d9f2"
down_revision = "b1d4f7a9e2c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("rfqs")}
    if "l1_vendor_name" not in columns:
        op.add_column("rfqs", sa.Column("l1_vendor_name", sa.String(length=255), nullable=True))
    if "l1_vendor_contact" not in columns:
        op.add_column("rfqs", sa.Column("l1_vendor_contact", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("rfqs", "l1_vendor_contact")
    op.drop_column("rfqs", "l1_vendor_name")
