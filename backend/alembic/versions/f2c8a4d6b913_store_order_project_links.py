"""Store: link stock reservations and material issues to the Order Project
(Sales › Order Projects) — project stock through reservations (SAP special
stock via reservation), never a project dimension on the stock balance
(2026-10-17).

  * store_stock_reservations: order_project_id / order_project_element_id,
    plus where an automatic hold came from (source_type / source_id /
    source_reference — e.g. the GRN line of a project PO) and original_qty
    (what was first held; quantity is what is still held).
  * store_material_issues: order_project_id / order_project_element_id and
    project_stock_override_reason (a Store Manager issuing stock another
    element holds).
  * store_material_issue_items: order_project_element_id (a dispatch can ship
    several vehicles).

All nullable, FKs ON DELETE SET NULL.

Revision ID: f2c8a4d6b913
Revises: e5b1f7c3a924
"""
from alembic import op
import sqlalchemy as sa

revision = "f2c8a4d6b913"
down_revision = 'e5b1f7c3a924'
branch_labels = None
depends_on = None

_PROJECT = ("order_project_id", "sales_order_projects.id")
_ELEMENT = ("order_project_element_id", "sales_order_project_elements.id")

# table -> [(column, fk target or None, type)]
COLUMNS = {
    "store_stock_reservations": [
        (_PROJECT[0], _PROJECT[1], sa.Integer()),
        (_ELEMENT[0], _ELEMENT[1], sa.Integer()),
        ("source_type", None, sa.String(30)),
        ("source_id", None, sa.Integer()),
        ("source_reference", None, sa.String(100)),
        ("original_qty", None, sa.Float()),
    ],
    "store_material_issues": [
        (_PROJECT[0], _PROJECT[1], sa.Integer()),
        (_ELEMENT[0], _ELEMENT[1], sa.Integer()),
        ("project_stock_override_reason", None, sa.Text()),
    ],
    "store_material_issue_items": [
        (_ELEMENT[0], _ELEMENT[1], sa.Integer()),
    ],
}
INDEXED = {"order_project_id", "order_project_element_id", "source_id"}


def _columns(table: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    for table, cols in COLUMNS.items():
        have = _columns(table)
        if not have:
            continue
        for name, fk, typ in cols:
            if name in have:
                continue
            args = [sa.ForeignKey(fk, ondelete="SET NULL")] if fk else []
            op.add_column(table, sa.Column(name, typ, *args, nullable=True))
        idx = _indexes(table)
        for name, _fk, _typ in cols:
            ix = f"ix_{table}_{name}"
            if name in INDEXED and ix not in idx:
                op.create_index(ix, table, [name])


def downgrade() -> None:
    for table, cols in COLUMNS.items():
        have = _columns(table)
        if not have:
            continue
        idx = _indexes(table)
        for name, _fk, _typ in reversed(cols):
            ix = f"ix_{table}_{name}"
            if ix in idx:
                op.drop_index(ix, table_name=table)
            if name in have:
                op.drop_column(table, name)
