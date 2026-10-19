"""One PEW number series for every project (2026-10-19).

Order Projects (sales_order_projects, were OP-YYYY-NNN) and Project Management
projects (pm_projects, were PRJ-YYYY-NNNN) are renumbered into ONE series,
PEW-YYYY-NNNN, in creation order per year (the year the record was created).
Element numbers follow their project (OP-2026-001/01 -> PEW-2026-0003/01).
Rows already numbered PEW-YYYY-NNNN keep their number.

Every change is written to pew_renumber_log (table, row, old, new) so the
downgrade can put the old numbers back. Text that quoted an old number (audit
summaries, mails, file names) is history and keeps it.

Revision ID: a7d3e9c1b5f2
Revises: f2c8a4d6b913
"""
import re

from alembic import op
import sqlalchemy as sa

revision = "a7d3e9c1b5f2"
down_revision = "f2c8a4d6b913"
branch_labels = None
depends_on = None

PEW_RE = re.compile(r"^PEW-(\d{4})-(\d+)$")


def _tables(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    tables = _tables(bind)
    if "pew_renumber_log" not in tables:
        op.create_table(
            "pew_renumber_log",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("table_name", sa.String(60), nullable=False),
            sa.Column("row_id", sa.Integer(), nullable=False),
            sa.Column("old_number", sa.String(60), nullable=False),
            sa.Column("new_number", sa.String(60), nullable=False),
        )

    op_table = "sales_order_projects" if "sales_order_projects" in tables else None
    rows = []  # (created_at, kind, id, number)
    if "pm_projects" in tables:
        rows += [(r.created_at, "pm_projects", r.id, r.number) for r in bind.execute(sa.text(
            "SELECT id, project_code AS number, created_at FROM pm_projects"))]
    if op_table:
        rows += [(r.created_at, op_table, r.id, r.number) for r in bind.execute(sa.text(
            f"SELECT id, op_number AS number, created_at FROM {op_table}"))]

    # Numbers already in the PEW series stay; the rest continue after them, per year.
    last: dict[int, int] = {}
    for _c, _k, _i, number in rows:
        m = PEW_RE.match(number or "")
        if m:
            y = int(m.group(1))
            last[y] = max(last.get(y, 0), int(m.group(2)))
    todo = sorted((r for r in rows if not PEW_RE.match(r[3] or "")), key=lambda r: (r[0] is None, r[0], r[1], r[2]))

    for created_at, kind, row_id, old in todo:
        year = created_at.year if created_at is not None else 2026
        last[year] = last.get(year, 0) + 1
        new = f"PEW-{year}-{last[year]:04d}"
        col = "project_code" if kind == "pm_projects" else "op_number"
        bind.execute(sa.text(f"UPDATE {kind} SET {col} = :new WHERE id = :id"), {"new": new, "id": row_id})
        bind.execute(sa.text("INSERT INTO pew_renumber_log (table_name, row_id, old_number, new_number) VALUES (:t, :i, :o, :n)"),
                     {"t": kind, "i": row_id, "o": old, "n": new})
        if kind == op_table and "sales_order_project_elements" in tables:
            for el in bind.execute(sa.text("SELECT id, element_no FROM sales_order_project_elements WHERE order_project_id = :p"), {"p": row_id}).fetchall():
                if el.element_no and el.element_no.startswith(f"{old}/"):
                    new_el = new + el.element_no[len(old):]
                    bind.execute(sa.text("UPDATE sales_order_project_elements SET element_no = :n WHERE id = :i"), {"n": new_el, "i": el.id})
                    bind.execute(sa.text("INSERT INTO pew_renumber_log (table_name, row_id, old_number, new_number) VALUES (:t, :i, :o, :n)"),
                                 {"t": "sales_order_project_elements", "i": el.id, "o": el.element_no, "n": new_el})


def downgrade() -> None:
    bind = op.get_bind()
    if "pew_renumber_log" not in _tables(bind):
        return
    cols = {"pm_projects": "project_code", "sales_order_projects": "op_number", "sales_order_project_elements": "element_no"}
    for r in bind.execute(sa.text("SELECT table_name, row_id, old_number FROM pew_renumber_log ORDER BY id DESC")).fetchall():
        col = cols.get(r.table_name)
        if col:
            bind.execute(sa.text(f"UPDATE {r.table_name} SET {col} = :o WHERE id = :i"), {"o": r.old_number, "i": r.row_id})
    op.drop_table("pew_renumber_log")
