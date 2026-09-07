"""drop unit from crm_inquiries

Revision ID: bfa7f72cc784
Revises: 3827c9b60917
Create Date: 2026-09-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'bfa7f72cc784'
down_revision = '3827c9b60917'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}

    with op.batch_alter_table("crm_inquiries") as batch_op:
        if "unit" in columns:
            batch_op.drop_column("unit")


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}

    with op.batch_alter_table("crm_inquiries") as batch_op:
        if "unit" not in columns:
            batch_op.add_column(sa.Column("unit", sa.String(length=50), nullable=True))
