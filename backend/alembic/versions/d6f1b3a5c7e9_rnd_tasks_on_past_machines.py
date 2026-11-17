"""R&D tasks on past machines of All Projects (owner, 2026-11-17: every project shows
in R&D › Create Task › Project): rnd_project_tasks and rnd_documents get a nullable
machine_id (erp_projects); a task still has exactly one parent.

Revision ID: d6f1b3a5c7e9
Revises: b7e2d4f6a8c1
"""
from alembic import op
import sqlalchemy as sa

revision = "d6f1b3a5c7e9"
down_revision = "b7e2d4f6a8c1"
branch_labels = None
depends_on = None

_TASK_ONE_PARENT = (
    "(CASE WHEN project_id IS NULL THEN 0 ELSE 1 END + CASE WHEN pm_project_id IS NULL THEN 0 ELSE 1 END"
    " + CASE WHEN machine_id IS NULL THEN 0 ELSE 1 END) = 1"
)


def _insp():
    return sa.inspect(op.get_bind())


def _cols(table: str) -> set[str]:
    return {c["name"] for c in _insp().get_columns(table)}


def _checks(table: str) -> set[str]:
    return {c["name"] for c in _insp().get_check_constraints(table)}


def upgrade() -> None:
    if "machine_id" not in _cols("rnd_project_tasks"):
        with op.batch_alter_table("rnd_project_tasks") as batch:
            batch.add_column(sa.Column("machine_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_rnd_project_tasks_machine", "erp_projects", ["machine_id"], ["id"])
            batch.create_index("ix_rnd_project_tasks_machine_id", ["machine_id"])
            if "ck_rnd_proj_task_one_parent" in _checks("rnd_project_tasks"):
                batch.drop_constraint("ck_rnd_proj_task_one_parent", type_="check")
            batch.create_check_constraint("ck_rnd_proj_task_one_parent", _TASK_ONE_PARENT)
    if "machine_id" not in _cols("rnd_documents"):
        with op.batch_alter_table("rnd_documents") as batch:
            batch.add_column(sa.Column("machine_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_rnd_documents_machine", "erp_projects", ["machine_id"], ["id"])
            batch.create_index("ix_rnd_documents_machine_id", ["machine_id"])
            if "ck_rnd_documents_parent" in _checks("rnd_documents"):
                batch.drop_constraint("ck_rnd_documents_parent", type_="check")
            batch.create_check_constraint(
                "ck_rnd_documents_parent", "project_id IS NOT NULL OR pm_project_id IS NOT NULL OR machine_id IS NOT NULL")


def downgrade() -> None:
    # Tasks given on past machines can't survive the downgrade (no column to hold them);
    # their SharePoint files are left in place. Approvals point at tasks without an FK.
    op.execute("DELETE FROM rnd_documents WHERE machine_id IS NOT NULL")
    op.execute("DELETE FROM rnd_task_approvals WHERE task_kind = 'project' AND task_id IN (SELECT id FROM rnd_project_tasks WHERE machine_id IS NOT NULL)")
    op.execute("DELETE FROM rnd_project_task_events WHERE task_id IN (SELECT id FROM rnd_project_tasks WHERE machine_id IS NOT NULL)")
    op.execute("DELETE FROM rnd_project_tasks WHERE machine_id IS NOT NULL")
    with op.batch_alter_table("rnd_documents") as batch:
        batch.drop_constraint("ck_rnd_documents_parent", type_="check")
        batch.drop_index("ix_rnd_documents_machine_id")
        batch.drop_constraint("fk_rnd_documents_machine", type_="foreignkey")
        batch.drop_column("machine_id")
        batch.create_check_constraint("ck_rnd_documents_parent", "project_id IS NOT NULL OR pm_project_id IS NOT NULL")
    with op.batch_alter_table("rnd_project_tasks") as batch:
        batch.drop_constraint("ck_rnd_proj_task_one_parent", type_="check")
        batch.drop_index("ix_rnd_project_tasks_machine_id")
        batch.drop_constraint("fk_rnd_project_tasks_machine", type_="foreignkey")
        batch.drop_column("machine_id")
        batch.create_check_constraint("ck_rnd_proj_task_one_parent", "(project_id IS NULL) <> (pm_project_id IS NULL)")
