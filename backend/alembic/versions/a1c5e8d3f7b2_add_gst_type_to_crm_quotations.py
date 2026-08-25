"""add gst_type to crm_quotations

Revision ID: a1c5e8d3f7b2
Revises: f4b7d2e8a9c1
Create Date: 2026-08-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1c5e8d3f7b2'
down_revision = 'f4b7d2e8a9c1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_quotations")}
    if "gst_type" not in columns:
        op.add_column("crm_quotations", sa.Column("gst_type", sa.String(20), nullable=False, server_default="CGST_SGST"))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_quotations")}
    if "gst_type" in columns:
        op.drop_column("crm_quotations", "gst_type")
