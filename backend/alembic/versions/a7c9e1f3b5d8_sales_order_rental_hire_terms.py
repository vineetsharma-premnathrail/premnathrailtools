"""Rental sales orders get their own hire terms (owner, 2026-10-28).

hire_start_date / hire_end_date (hire period), hire_rate_basis (per month / day /
shift / hour / lump sum), hire_site (where the machine works) and security_deposit.
All nullable: New Project and Service orders leave them empty.

Revision ID: a7c9e1f3b5d8
Revises: 41292e2c20ef
"""
import sqlalchemy as sa
from alembic import op

revision = "a7c9e1f3b5d8"
down_revision = "41292e2c20ef"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sales_orders", sa.Column("hire_start_date", sa.Date(), nullable=True))
    op.add_column("sales_orders", sa.Column("hire_end_date", sa.Date(), nullable=True))
    op.add_column("sales_orders", sa.Column("hire_rate_basis", sa.String(20), nullable=True))
    op.add_column("sales_orders", sa.Column("hire_site", sa.Text(), nullable=True))
    op.add_column("sales_orders", sa.Column("security_deposit", sa.Numeric(18, 2), nullable=True))


def downgrade():
    for col in ("security_deposit", "hire_site", "hire_rate_basis", "hire_end_date", "hire_start_date"):
        op.drop_column("sales_orders", col)
