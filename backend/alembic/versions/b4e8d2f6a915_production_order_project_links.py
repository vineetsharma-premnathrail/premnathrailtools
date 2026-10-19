"""Production ↔ Order Project links: order_project_id + order_project_element_id
on RRV builds, work orders and MRP planned orders.

Revision ID: b4e8d2f6a915
Revises: a8f3c5e7b291
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa

revision = "b4e8d2f6a915"
down_revision = 'a8f3c5e7b291'
branch_labels = None
depends_on = None

_TABLES = ("production_rrv_builds", "production_work_orders", "production_planned_orders")
_COLUMNS = (
    ("order_project_id", "sales_order_projects"),
    ("order_project_element_id", "sales_order_project_elements"),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in _TABLES:
        existing = {c["name"] for c in inspector.get_columns(table)}
        indexes = {i["name"] for i in inspector.get_indexes(table)}
        for col, target in _COLUMNS:
            if col not in existing:
                with op.batch_alter_table(table) as batch:
                    batch.add_column(sa.Column(col, sa.Integer(), nullable=True))
                    batch.create_foreign_key(f"fk_{table}_{col}", target, [col], ["id"], ondelete="SET NULL")
            ix = f"ix_{table}_{col}"
            if ix not in indexes:
                op.create_index(ix, table, [col])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in _TABLES:
        existing = {c["name"] for c in inspector.get_columns(table)}
        indexes = {i["name"] for i in inspector.get_indexes(table)}
        fks = {fk["name"] for fk in inspector.get_foreign_keys(table)}
        for col, _target in reversed(_COLUMNS):
            ix = f"ix_{table}_{col}"
            if ix in indexes:
                op.drop_index(ix, table_name=table)
            if col in existing:
                with op.batch_alter_table(table) as batch:
                    if f"fk_{table}_{col}" in fks:
                        batch.drop_constraint(f"fk_{table}_{col}", type_="foreignkey")
                    batch.drop_column(col)
