"""add discount, discount_type, quote_conditions to crm_quotations

Revision ID: c3d7e9a2f5b8
Revises: b2f5d8a1c6e3
Create Date: 2026-08-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c3d7e9a2f5b8'
down_revision = 'b2f5d8a1c6e3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_quotations")}
    if "discount" not in columns:
        op.add_column("crm_quotations", sa.Column("discount", sa.Float(), nullable=True))
    if "discount_type" not in columns:
        op.add_column("crm_quotations", sa.Column("discount_type", sa.String(20), nullable=True))
    if "quote_conditions" not in columns:
        op.add_column("crm_quotations", sa.Column("quote_conditions", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_quotations")}
    if "quote_conditions" in columns:
        op.drop_column("crm_quotations", "quote_conditions")
    if "discount_type" in columns:
        op.drop_column("crm_quotations", "discount_type")
    if "discount" in columns:
        op.drop_column("crm_quotations", "discount")
