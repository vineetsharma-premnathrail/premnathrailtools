"""add bulk_import_ref to crm inquiries

Revision ID: a4c8f1d3b7e2
Revises: e7f8a9b0c1d2
Create Date: 2026-09-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a4c8f1d3b7e2'
down_revision = 'e7f8a9b0c1d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}
    if "bulk_import_ref" not in columns:
        op.add_column("crm_inquiries", sa.Column("bulk_import_ref", sa.String(length=100), nullable=True))
        op.create_index("ix_crm_inquiries_bulk_import_ref", "crm_inquiries", ["bulk_import_ref"])


def downgrade() -> None:
    op.drop_index("ix_crm_inquiries_bulk_import_ref", table_name="crm_inquiries")
    op.drop_column("crm_inquiries", "bulk_import_ref")
