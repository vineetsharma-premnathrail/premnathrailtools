"""Design / Electrical / Hydraulic: link engineering work to the Order Project
(Sales › Order Projects, 2026-10-17).

  * design_requests: order_project_id / order_project_element_id — the request
    Design opens automatically for a new RRV model when an order is confirmed
    (design/order_project_links.py), or one linked by hand.
  * design_boms: order_project_id / order_project_element_id — a project BOM
    (element = a vehicle-specific variant).
  * electrical_jobs, hyd_systems: order_project_id / order_project_element_id.

All nullable, FKs ON DELETE SET NULL. The older erp_project_id / pm_project_id
links stay as they are.

Revision ID: c3d9e7a1b452
Revises: b4e8d2f6a915
"""
from alembic import op
import sqlalchemy as sa

revision = "c3d9e7a1b452"
down_revision = 'b4e8d2f6a915'
branch_labels = None
depends_on = None

_COLS = [
    ("order_project_id", "sales_order_projects.id"),
    ("order_project_element_id", "sales_order_project_elements.id"),
]
TABLES = ("design_requests", "design_boms", "electrical_jobs", "hyd_systems")


def _columns(table: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    for table in TABLES:
        have = _columns(table)
        if not have:
            continue
        for name, fk in _COLS:
            if name not in have:
                op.add_column(table, sa.Column(name, sa.Integer(), sa.ForeignKey(fk, ondelete="SET NULL"), nullable=True))
        idx = _indexes(table)
        for name, _fk in _COLS:
            ix = f"ix_{table}_{name}"
            if ix not in idx:
                op.create_index(ix, table, [name])


def downgrade() -> None:
    for table in TABLES:
        have = _columns(table)
        if not have:
            continue
        idx = _indexes(table)
        for name, _fk in reversed(_COLS):
            ix = f"ix_{table}_{name}"
            if ix in idx:
                op.drop_index(ix, table_name=table)
            if name in have:
                op.drop_column(table, name)
