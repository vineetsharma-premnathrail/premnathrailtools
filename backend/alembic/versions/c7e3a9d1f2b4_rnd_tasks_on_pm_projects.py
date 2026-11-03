"""R&D tasks on Project Management projects: rnd_project_tasks and rnd_documents
get a nullable pm_project_id; their project_id (Prototype / Research project)
becomes nullable; a task has exactly one parent.

Revision ID: c7e3a9d1f2b4
Revises: a4e7c1b9d306
"""
from alembic import op
import sqlalchemy as sa

revision = "c7e3a9d1f2b4"
down_revision = "a4e7c1b9d306"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "pm_project_id" not in _cols("rnd_project_tasks"):
        with op.batch_alter_table("rnd_project_tasks") as batch:
            batch.add_column(sa.Column("pm_project_id", sa.Integer(), nullable=True))
            batch.alter_column("project_id", existing_type=sa.Integer(), nullable=True)
            batch.create_foreign_key("fk_rnd_project_tasks_pm_project", "pm_projects", ["pm_project_id"], ["id"])
            batch.create_index("ix_rnd_project_tasks_pm_project_id", ["pm_project_id"])
            batch.create_check_constraint("ck_rnd_proj_task_one_parent", "(project_id IS NULL) <> (pm_project_id IS NULL)")
    if "pm_project_id" not in _cols("rnd_documents"):
        with op.batch_alter_table("rnd_documents") as batch:
            batch.add_column(sa.Column("pm_project_id", sa.Integer(), nullable=True))
            batch.alter_column("project_id", existing_type=sa.Integer(), nullable=True)
            batch.create_foreign_key("fk_rnd_documents_pm_project", "pm_projects", ["pm_project_id"], ["id"])
            batch.create_index("ix_rnd_documents_pm_project_id", ["pm_project_id"])
            batch.create_check_constraint("ck_rnd_documents_parent", "project_id IS NOT NULL OR pm_project_id IS NOT NULL")


def downgrade() -> None:
    # Tasks given on PM projects can't survive the downgrade (no column to hold them);
    # their SharePoint files are left in place. Approvals point at tasks without an FK.
    op.execute("DELETE FROM rnd_documents WHERE pm_project_id IS NOT NULL")
    op.execute("DELETE FROM rnd_task_approvals WHERE task_kind = 'project' AND task_id IN (SELECT id FROM rnd_project_tasks WHERE pm_project_id IS NOT NULL)")
    op.execute("DELETE FROM rnd_project_task_events WHERE task_id IN (SELECT id FROM rnd_project_tasks WHERE pm_project_id IS NOT NULL)")
    op.execute("DELETE FROM rnd_project_tasks WHERE pm_project_id IS NOT NULL")
    with op.batch_alter_table("rnd_documents") as batch:
        batch.drop_constraint("ck_rnd_documents_parent", type_="check")
        batch.drop_index("ix_rnd_documents_pm_project_id")
        batch.drop_constraint("fk_rnd_documents_pm_project", type_="foreignkey")
        batch.drop_column("pm_project_id")
        batch.alter_column("project_id", existing_type=sa.Integer(), nullable=False)
    with op.batch_alter_table("rnd_project_tasks") as batch:
        batch.drop_constraint("ck_rnd_proj_task_one_parent", type_="check")
        batch.drop_index("ix_rnd_project_tasks_pm_project_id")
        batch.drop_constraint("fk_rnd_project_tasks_pm_project", type_="foreignkey")
        batch.drop_column("pm_project_id")
        batch.alter_column("project_id", existing_type=sa.Integer(), nullable=False)
