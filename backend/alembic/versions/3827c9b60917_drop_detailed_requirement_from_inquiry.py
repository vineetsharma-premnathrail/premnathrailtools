"""drop detailed_requirement from crm_inquiries

Revision ID: 3827c9b60917
Revises: 053a62eb41e3
Create Date: 2026-09-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '3827c9b60917'
down_revision = '053a62eb41e3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}

    with op.batch_alter_table("crm_inquiries") as batch_op:
        if "detailed_requirement" in columns:
            batch_op.drop_column("detailed_requirement")


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}

    with op.batch_alter_table("crm_inquiries") as batch_op:
        if "detailed_requirement" not in columns:
            batch_op.add_column(sa.Column("detailed_requirement", sa.Text(), nullable=True))
