"""Quality: link inspection calls and inspection lots to the Order Project
(Sales › Order Projects) — the vehicle / lot element of a confirmed Sales
Order the inspection is for (2026-10-17). Nullable, ON DELETE SET NULL.

Revision ID: e5b1f7c3a924
Revises: c3d9e7a1b452
"""
from alembic import op
import sqlalchemy as sa

revision = "e5b1f7c3a924"
down_revision = 'c3d9e7a1b452'
branch_labels = None
depends_on = None

TABLES = ("quality_inspection_calls", "quality_inspection_lots")


def _columns(table: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    for table in TABLES:
        cols = _columns(table)
        if not cols:
            continue
        if "order_project_id" not in cols:
            op.add_column(table, sa.Column("order_project_id", sa.Integer(),
                                           sa.ForeignKey("sales_order_projects.id", ondelete="SET NULL"), nullable=True))
        if "order_project_element_id" not in cols:
            op.add_column(table, sa.Column("order_project_element_id", sa.Integer(),
                                           sa.ForeignKey("sales_order_project_elements.id", ondelete="SET NULL"), nullable=True))
        idx = _indexes(table)
        for col in ("order_project_id", "order_project_element_id"):
            name = f"ix_{table}_{col}"
            if name not in idx:
                op.create_index(name, table, [col])


def downgrade() -> None:
    for table in TABLES:
        cols = _columns(table)
        idx = _indexes(table) if cols else set()
        for col in ("order_project_element_id", "order_project_id"):
            name = f"ix_{table}_{col}"
            if name in idx:
                op.drop_index(name, table_name=table)
            if col in cols:
                op.drop_column(table, col)
