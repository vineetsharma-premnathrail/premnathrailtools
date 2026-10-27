"""Project numbers continue the old machine series: PEW-78, PEW-79 ... (2026-10-26).

Order Projects and Project Management projects that carry the interim number
PEW-YYYY-NNNN are renumbered, in creation order, to PEW-<N> starting after the
highest number used anywhere (machine serials in erp_projects, pm_projects,
sales_order_projects). Element numbers follow their project (PEW-2026-0003/01 ->
PEW-80/01). A record that already has any other number is never touched.

Every change is written to pew_series_log (table, row, old, new) so the
downgrade puts the old numbers back.

Revision ID: c4e8b2a6d9f1
Revises: f7c3a9e1d5b2
"""
import re

from alembic import op
import sqlalchemy as sa

revision = "c4e8b2a6d9f1"
down_revision = "f7c3a9e1d5b2"
branch_labels = None
depends_on = None

OLD_RE = re.compile(r"^PEW-\d{4}-\d{4}$")
BASE_RE = re.compile(r"^PEW-(\d+)")


def _base(number):
    n = (number or "").strip().upper()
    if OLD_RE.match(n):
        return 0
    m = BASE_RE.match(n)
    return int(m.group(1)) if m else 0


def _log(bind, table, row_id, old, new):
    bind.execute(sa.text("INSERT INTO pew_series_log (table_name, row_id, old_number, new_number) VALUES (:t, :i, :o, :n)"),
                 {"t": table, "i": row_id, "o": old, "n": new})


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "pew_series_log" not in tables:
        op.create_table(
            "pew_series_log",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("table_name", sa.String(60), nullable=False),
            sa.Column("row_id", sa.Integer(), nullable=False),
            sa.Column("old_number", sa.String(60), nullable=False),
            sa.Column("new_number", sa.String(60), nullable=False),
        )

    rows = []  # (created_at, table, id, number)
    if "pm_projects" in tables:
        rows += [(r.created_at, "pm_projects", r.id, r.number) for r in bind.execute(sa.text(
            "SELECT id, project_code AS number, created_at FROM pm_projects"))]
    if "sales_order_projects" in tables:
        rows += [(r.created_at, "sales_order_projects", r.id, r.number) for r in bind.execute(sa.text(
            "SELECT id, op_number AS number, created_at FROM sales_order_projects"))]
    highest = max((_base(r[3]) for r in rows), default=0)
    if "erp_projects" in tables:
        for r in bind.execute(sa.text("SELECT serial_number FROM erp_projects")):
            highest = max(highest, _base(r.serial_number))

    todo = sorted((r for r in rows if OLD_RE.match((r[3] or "").strip())),
                  key=lambda r: (r[0] is None, r[0], r[1], r[2]))
    for _created, table, row_id, old in todo:
        highest += 1
        new = f"PEW-{highest}"
        col = "project_code" if table == "pm_projects" else "op_number"
        bind.execute(sa.text(f"UPDATE {table} SET {col} = :new WHERE id = :id"), {"new": new, "id": row_id})
        _log(bind, table, row_id, old, new)
        if table == "sales_order_projects" and "sales_order_project_elements" in tables:
            for el in bind.execute(sa.text("SELECT id, element_no FROM sales_order_project_elements WHERE order_project_id = :p"), {"p": row_id}).fetchall():
                if el.element_no and el.element_no.startswith(f"{old}/"):
                    new_el = new + el.element_no[len(old):]
                    bind.execute(sa.text("UPDATE sales_order_project_elements SET element_no = :n WHERE id = :i"), {"n": new_el, "i": el.id})
                    _log(bind, "sales_order_project_elements", el.id, el.element_no, new_el)


def downgrade() -> None:
    bind = op.get_bind()
    if "pew_series_log" not in set(sa.inspect(bind).get_table_names()):
        return
    cols = {"pm_projects": "project_code", "sales_order_projects": "op_number", "sales_order_project_elements": "element_no"}
    for r in bind.execute(sa.text("SELECT table_name, row_id, old_number FROM pew_series_log ORDER BY id DESC")).fetchall():
        col = cols.get(r.table_name)
        if col:
            bind.execute(sa.text(f"UPDATE {r.table_name} SET {col} = :o WHERE id = :i"), {"o": r.old_number, "i": r.row_id})
    op.drop_table("pew_series_log")
