"""Product technical specifications as one free-text field.

New column products.technical_specification (Text). Existing parameter / value /
unit rows are copied into it, one "Parameter: Value Unit" line each, in their
order; the rows themselves are kept.

Revision ID: c9e1f3a5b7d8
Revises: b6c8d0e2f4a7
"""
from alembic import op
import sqlalchemy as sa

revision = "c9e1f3a5b7d8"
down_revision = "b6c8d0e2f4a7"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "technical_specification" in {c["name"] for c in insp.get_columns("products")}:
        return
    op.add_column("products", sa.Column("technical_specification", sa.Text(), nullable=True))
    if not insp.has_table("product_specifications"):
        return
    rows = bind.execute(sa.text(
        "SELECT product_id, parameter, value, unit FROM product_specifications ORDER BY product_id, sort_order, id")).fetchall()
    text_by_product: dict[int, list[str]] = {}
    for product_id, parameter, value, unit in rows:
        line = f"{parameter}: {value}" + (f" {unit}" if unit else "")
        text_by_product.setdefault(product_id, []).append(line)
    for product_id, lines in text_by_product.items():
        bind.execute(sa.text("UPDATE products SET technical_specification = :t WHERE id = :id"),
                     {"t": "\n".join(lines), "id": product_id})


def downgrade():
    op.drop_column("products", "technical_specification")
