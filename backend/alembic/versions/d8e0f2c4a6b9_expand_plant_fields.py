"""expand branches (plants) with company link, status, manager, defaults

Revision ID: d8e0f2c4a6b9
Revises: c7d9e1b3f5a8
Create Date: 2026-09-22 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd8e0f2c4a6b9'
down_revision = 'c7d9e1b3f5a8'
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    ("company_id", sa.Integer(), {"sa.ForeignKey": "companies.id"}),
    ("status", sa.String(length=30), None),
    ("manager_user_id", sa.Integer(), {"sa.ForeignKey": "users.id"}),
    ("established_date", sa.Date(), None),
    ("default_warehouse_id", sa.Integer(), {"sa.ForeignKey": "store_locations.id"}),
    ("default_cost_center", sa.String(length=100), None),
    ("working_calendar", sa.String(length=100), None),
    ("timezone", sa.String(length=60), None),
    ("currency", sa.String(length=10), None),
    ("active_from", sa.Date(), None),
    ("remarks", sa.Text(), None),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("branches")}
    if "company_id" not in columns:
        op.add_column("branches", sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=True))
    if "status" not in columns:
        op.add_column("branches", sa.Column("status", sa.String(length=30), nullable=False, server_default="active"))
    if "manager_user_id" not in columns:
        op.add_column("branches", sa.Column("manager_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    if "established_date" not in columns:
        op.add_column("branches", sa.Column("established_date", sa.Date(), nullable=True))
    if "default_warehouse_id" not in columns:
        op.add_column("branches", sa.Column("default_warehouse_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True))
    if "default_cost_center" not in columns:
        op.add_column("branches", sa.Column("default_cost_center", sa.String(length=100), nullable=True))
    if "working_calendar" not in columns:
        op.add_column("branches", sa.Column("working_calendar", sa.String(length=100), nullable=True))
    if "timezone" not in columns:
        op.add_column("branches", sa.Column("timezone", sa.String(length=60), nullable=True))
    if "currency" not in columns:
        op.add_column("branches", sa.Column("currency", sa.String(length=10), nullable=True))
    if "active_from" not in columns:
        op.add_column("branches", sa.Column("active_from", sa.Date(), nullable=True))
    if "remarks" not in columns:
        op.add_column("branches", sa.Column("remarks", sa.Text(), nullable=True))


def downgrade() -> None:
    for name, _, _ in NEW_COLUMNS:
        op.drop_column("branches", name)
