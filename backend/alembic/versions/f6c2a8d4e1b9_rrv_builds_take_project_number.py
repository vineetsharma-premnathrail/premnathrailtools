"""Vehicle builds take their Order Project vehicle number (PEW-80/01).

Owner decision 2026-10-27: a vehicle is known by its project number everywhere,
never by a separate RRV-YYYY-NNNN. Builds already linked to an Order Project
vehicle are renamed to that vehicle's number (skipped if the number is somehow
taken). Unlinked builds raised before keep their RRV-... number. Data only, no
schema change.

Revision ID: f6c2a8d4e1b9
Revises: e3a9c1f7b2d4
"""
from alembic import op
import sqlalchemy as sa

revision = "f6c2a8d4e1b9"
down_revision = "e3a9c1f7b2d4"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not (insp.has_table("production_rrv_builds") and insp.has_table("sales_order_project_elements")):
        return
    cols = {c["name"] for c in insp.get_columns("production_rrv_builds")}
    if "order_project_element_id" not in cols:
        return
    bind.execute(sa.text("""
        UPDATE production_rrv_builds b
           SET build_number = e.element_no
          FROM sales_order_project_elements e
         WHERE b.order_project_element_id = e.id
           AND b.build_number LIKE 'RRV-%'
           AND NOT EXISTS (SELECT 1 FROM production_rrv_builds x WHERE x.build_number = e.element_no)
    """))


def downgrade():
    # The old RRV-... numbers are not kept; nothing to restore.
    pass
