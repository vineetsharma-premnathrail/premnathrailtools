"""Sales order number typed on a Project Management project.

pm_projects gets sales_order_ref (nullable, no back-fill).

Revision ID: a4c9e1d7b2f6
Revises: f3b8d6c1a9e4
"""
from alembic import op
import sqlalchemy as sa

revision = "a4c9e1d7b2f6"
down_revision = "f3b8d6c1a9e4"
branch_labels = None
depends_on = None

TABLE = "pm_projects"
COL = "sales_order_ref"


def _cols() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade() -> None:
    if TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return
    if COL not in _cols():
        op.add_column(TABLE, sa.Column(COL, sa.String(100), nullable=True))


def downgrade() -> None:
    if TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return
    if COL in _cols():
        op.drop_column(TABLE, COL)
