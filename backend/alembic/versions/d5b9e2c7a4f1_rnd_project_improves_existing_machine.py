"""R&D 'Improvement of existing product' names the existing project (machine).

One nullable column rnd_projects.machine_id -> erp_projects.id (SET NULL): the
delivered / built machine (PEW project) being improved. product_id stays for
older projects and for 'Customer requirement'.

Revision ID: d5b9e2c7a4f1
Revises: a7e3c9d1f5b8
"""
from alembic import op
import sqlalchemy as sa

revision = "d5b9e2c7a4f1"
down_revision = "a7e3c9d1f5b8"
branch_labels = None
depends_on = None


def upgrade():
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("rnd_projects")}
    if "machine_id" not in cols:
        with op.batch_alter_table("rnd_projects") as batch:
            batch.add_column(sa.Column("machine_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_rnd_projects_machine_id", "erp_projects", ["machine_id"], ["id"], ondelete="SET NULL")


def downgrade():
    with op.batch_alter_table("rnd_projects") as batch:
        batch.drop_constraint("fk_rnd_projects_machine_id", type_="foreignkey")
        batch.drop_column("machine_id")
