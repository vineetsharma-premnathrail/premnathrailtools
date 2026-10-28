"""Applications become products of type 'application' (one master, one form).

Copies every product_applications row into products (code, name, description;
retired ones as 'discontinued'). A code already used by a product gets an
"APP-" prefix. The old table stays for history.

Revision ID: d2f4a6c8e0b1
Revises: c9e1f3a5b7d8
"""
from alembic import op
import sqlalchemy as sa

revision = "d2f4a6c8e0b1"
down_revision = "c9e1f3a5b7d8"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("product_applications"):
        return
    used = {r[0].upper() for r in bind.execute(sa.text("SELECT code FROM products")).fetchall()}
    apps = bind.execute(sa.text(
        "SELECT code, name, description, is_active, created_by_id FROM product_applications ORDER BY id")).fetchall()
    for code, name, description, is_active, created_by_id in apps:
        new_code = code if code.upper() not in used else f"APP-{code}"[:30]
        if new_code.upper() in used:
            continue  # already copied (re-run)
        used.add(new_code.upper())
        bind.execute(sa.text(
            "INSERT INTO products (code, name, product_type, status, description, uom, created_by_id, created_at, updated_at) "
            "VALUES (:code, :name, 'application', :status, :description, 'Nos', :by, now(), now())"),
            {"code": new_code, "name": name, "status": "active" if is_active else "discontinued",
             "description": description, "by": created_by_id})


def downgrade():
    op.execute("DELETE FROM products WHERE product_type = 'application'")
