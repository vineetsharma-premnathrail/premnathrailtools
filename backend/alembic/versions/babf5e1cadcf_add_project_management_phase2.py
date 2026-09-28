"""add project management phase2

Revision ID: babf5e1cadcf
Revises: 2d964a9b3fa4
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "babf5e1cadcf"
down_revision = "2d964a9b3fa4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "pm_project_phases" not in existing_tables:
        op.create_table(
            "pm_project_phases",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("planned_start", sa.Date(), nullable=True),
            sa.Column("planned_end", sa.Date(), nullable=True),
            sa.Column("actual_start", sa.Date(), nullable=True),
            sa.Column("actual_end", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="not_started"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_phases_project_id", "pm_project_phases", ["project_id"])

    if "pm_project_tasks" not in existing_tables:
        op.create_table(
            "pm_project_tasks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("phase_id", sa.Integer(), sa.ForeignKey("pm_project_phases.id"), nullable=True),
            sa.Column("parent_task_id", sa.Integer(), sa.ForeignKey("pm_project_tasks.id"), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="not_started"),
            sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("percent_complete", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_tasks_project_id", "pm_project_tasks", ["project_id"])

    if "pm_project_milestones" not in existing_tables:
        op.create_table(
            "pm_project_milestones",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("phase_id", sa.Integer(), sa.ForeignKey("pm_project_phases.id"), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("target_date", sa.Date(), nullable=False),
            sa.Column("actual_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_milestones_project_id", "pm_project_milestones", ["project_id"])

    if "pm_project_resources" not in existing_tables:
        op.create_table(
            "pm_project_resources",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("role", sa.String(length=150), nullable=True),
            sa.Column("allocation_percent", sa.Integer(), nullable=True),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_resources_project_id", "pm_project_resources", ["project_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    # Dependency-safe order: tasks references phases, so drop tasks first.
    if "pm_project_resources" in existing_tables:
        op.drop_index("ix_pm_project_resources_project_id", table_name="pm_project_resources")
        op.drop_table("pm_project_resources")
    if "pm_project_milestones" in existing_tables:
        op.drop_index("ix_pm_project_milestones_project_id", table_name="pm_project_milestones")
        op.drop_table("pm_project_milestones")
    if "pm_project_tasks" in existing_tables:
        op.drop_index("ix_pm_project_tasks_project_id", table_name="pm_project_tasks")
        op.drop_table("pm_project_tasks")
    if "pm_project_phases" in existing_tables:
        op.drop_index("ix_pm_project_phases_project_id", table_name="pm_project_phases")
        op.drop_table("pm_project_phases")
