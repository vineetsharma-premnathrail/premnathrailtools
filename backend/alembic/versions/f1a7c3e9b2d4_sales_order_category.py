"""Sales order category: New Project / Service / Rental, asked first on a new order.

New column sales_orders.order_category (not null, default 'new_project'); every
existing order becomes a New Project order, so their PM projects stay as they are.

Revision ID: f1a7c3e9b2d4
Revises: e4b9a2c7d1f3
"""
from alembic import op
import sqlalchemy as sa

revision = "f1a7c3e9b2d4"
down_revision = "e4b9a2c7d1f3"
branch_labels = None
depends_on = None


def upgrade():
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("sales_orders")}
    if "order_category" not in cols:
        op.add_column("sales_orders", sa.Column("order_category", sa.String(20), nullable=False, server_default="new_project"))


def downgrade():
    op.drop_column("sales_orders", "order_category")
