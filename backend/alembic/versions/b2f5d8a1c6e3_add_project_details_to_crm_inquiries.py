"""add project_details to crm_inquiries

Revision ID: b2f5d8a1c6e3
Revises: a7c9e2f4b6d1
Create Date: 2026-08-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b2f5d8a1c6e3'
down_revision = 'a7c9e2f4b6d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}
    if "project_details" not in columns:
        op.add_column("crm_inquiries", sa.Column("project_details", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}
    if "project_details" in columns:
        op.drop_column("crm_inquiries", "project_details")
