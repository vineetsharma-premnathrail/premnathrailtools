"""Machine linked to its Project Management project.

"Add New Project" now registers the machine and the PM project in one form, so
erp_projects gets a nullable pm_project_id (past machines keep NULL). Adding a
nullable column is safe on a live database.

Revision ID: b6e2d8f4a1c7
Revises: e5b1d7c3a9f2
"""
from alembic import op
import sqlalchemy as sa

revision = "b6e2d8f4a1c7"
down_revision = "e5b1d7c3a9f2"
branch_labels = None
depends_on = None


def upgrade():
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("erp_projects")}
    if "pm_project_id" not in cols:
        op.add_column("erp_projects", sa.Column("pm_project_id", sa.Integer(), nullable=True))
        op.create_foreign_key("fk_erp_projects_pm_project_id", "erp_projects", "pm_projects", ["pm_project_id"], ["id"], ondelete="SET NULL")
        op.create_index("ix_erp_projects_pm_project_id", "erp_projects", ["pm_project_id"])
    # Link the machines already in the table to the project with the same
    # number: serial PEW-34 or PEW-34-A1 -> project PEW-34. PEW-34A is its own
    # project number, so only an exact match or "<code>-..." counts.
    op.execute(
        """
        UPDATE erp_projects SET pm_project_id = (
            SELECT p.id FROM pm_projects p
            WHERE UPPER(TRIM(erp_projects.serial_number)) = UPPER(TRIM(p.project_code))
               OR UPPER(TRIM(erp_projects.serial_number)) LIKE
                  REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.project_code)), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '-%' ESCAPE '\\'
            ORDER BY LENGTH(p.project_code) DESC LIMIT 1
        )
        WHERE pm_project_id IS NULL
        """
    )


def downgrade():
    op.drop_index("ix_erp_projects_pm_project_id", table_name="erp_projects")
    op.drop_constraint("fk_erp_projects_pm_project_id", "erp_projects", type_="foreignkey")
    op.drop_column("erp_projects", "pm_project_id")
