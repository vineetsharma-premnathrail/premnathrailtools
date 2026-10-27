"""Finance budget linked to a Project Management project.

One nullable column pm_projects.internal_order_id (unique: one budget belongs
to one project, so spend is never counted twice). R&D projects already carry
rnd_projects.internal_order_id. Nothing existing is rewritten.

Revision ID: e3a9c1f7b2d4
Revises: d7f2a4c8e1b5
"""
from alembic import op
import sqlalchemy as sa

revision = "e3a9c1f7b2d4"
down_revision = "d7f2a4c8e1b5"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("pm_projects")}
    if "internal_order_id" not in cols:
        with op.batch_alter_table("pm_projects") as batch:
            batch.add_column(sa.Column("internal_order_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_pm_projects_internal_order_id", "internal_orders", ["internal_order_id"], ["id"], ondelete="SET NULL")
            batch.create_unique_constraint("uq_pm_projects_internal_order_id", ["internal_order_id"])


def downgrade():
    with op.batch_alter_table("pm_projects") as batch:
        batch.drop_constraint("uq_pm_projects_internal_order_id", type_="unique")
        batch.drop_constraint("fk_pm_projects_internal_order_id", type_="foreignkey")
        batch.drop_column("internal_order_id")
