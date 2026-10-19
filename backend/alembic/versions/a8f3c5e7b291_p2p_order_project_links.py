"""Purchase (P2P): Order Project links — PR header project, and the
vehicle / lot (element) on PR, PO and GRN lines (2026-10-17).

Revision ID: a8f3c5e7b291
Revises: d7a3c9e1f548
"""
from alembic import op
import sqlalchemy as sa

revision = "a8f3c5e7b291"
down_revision = "d7a3c9e1f548"
branch_labels = None
depends_on = None

_LINE_TABLES = ("p2p_request_items", "p2p_purchase_order_items", "p2p_goods_receipt_items")


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add_fk_col(table: str, col: str, target: str) -> None:
    if col in _cols(table):
        return
    with op.batch_alter_table(table) as b:
        b.add_column(sa.Column(col, sa.Integer(), nullable=True))
        b.create_foreign_key(f"fk_{table}_{col}", target, [col], ["id"], ondelete="SET NULL")
        b.create_index(f"ix_{table}_{col}", [col])


def _drop_col(table: str, col: str) -> None:
    if col not in _cols(table):
        return
    with op.batch_alter_table(table) as b:
        b.drop_index(f"ix_{table}_{col}")
        b.drop_constraint(f"fk_{table}_{col}", type_="foreignkey")
        b.drop_column(col)


def upgrade() -> None:
    _add_fk_col("p2p_requests", "order_project_id", "sales_order_projects")
    for t in _LINE_TABLES:
        _add_fk_col(t, "order_project_id", "sales_order_projects")
        _add_fk_col(t, "order_project_element_id", "sales_order_project_elements")


def downgrade() -> None:
    for t in reversed(_LINE_TABLES):
        _drop_col(t, "order_project_element_id")
        _drop_col(t, "order_project_id")
    _drop_col("p2p_requests", "order_project_id")
