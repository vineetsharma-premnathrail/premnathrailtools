"""Project Management Tasks tab: department tasks (pm_project_tasks.department_id)
and sub-tasks given to a person by the department head (pm_task_subtasks.assignee_id).

Revision ID: e5f9c3a7b2d4
Revises: c3f7a9d1e5b8
Create Date: 2026-10-10
"""
from alembic import op
import sqlalchemy as sa

revision = "e5f9c3a7b2d4"
down_revision = "c3f7a9d1e5b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "department_id" not in {c["name"] for c in insp.get_columns("pm_project_tasks")}:
        op.add_column("pm_project_tasks", sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True))
        op.create_index("ix_pm_project_tasks_department_id", "pm_project_tasks", ["department_id"])
    if "assignee_id" not in {c["name"] for c in insp.get_columns("pm_task_subtasks")}:
        op.add_column("pm_task_subtasks", sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
        op.create_index("ix_pm_task_subtasks_assignee_id", "pm_task_subtasks", ["assignee_id"])


def downgrade() -> None:
    op.drop_index("ix_pm_task_subtasks_assignee_id", table_name="pm_task_subtasks")
    op.drop_column("pm_task_subtasks", "assignee_id")
    op.drop_index("ix_pm_project_tasks_department_id", table_name="pm_project_tasks")
    op.drop_column("pm_project_tasks", "department_id")
