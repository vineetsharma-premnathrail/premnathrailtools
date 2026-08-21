"""add HR profile fields to users (reporting_manager_id, date_of_joining) + seed hr module

Revision ID: b4d8e0f6a2c7
Revises: a3c7d9e5f1b6
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b4d8e0f6a2c7'
down_revision = 'a3c7d9e5f1b6'
branch_labels = None
depends_on = None

modules_table = sa.table(
    'modules',
    sa.column('key', sa.String),
    sa.column('label', sa.String),
    sa.column('icon', sa.String),
    sa.column('description', sa.String),
    sa.column('is_active', sa.Boolean),
    sa.column('sort_order', sa.Integer),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("users")}
    if "reporting_manager_id" not in columns:
        op.add_column("users", sa.Column("reporting_manager_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    if "date_of_joining" not in columns:
        op.add_column("users", sa.Column("date_of_joining", sa.Date(), nullable=True))

    op.bulk_insert(modules_table, [
        {'key': 'hr', 'label': 'HR', 'icon': 'hr', 'description': 'Employee directory and org chart.', 'is_active': True, 'sort_order': 7},
    ])


def downgrade() -> None:
    op.execute("DELETE FROM modules WHERE key = 'hr'")
    op.drop_column("users", "date_of_joining")
    op.drop_column("users", "reporting_manager_id")
