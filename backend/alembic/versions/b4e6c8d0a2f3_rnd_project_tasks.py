"""R&D project tasks: leads assign work to project team members (assignees
can split it into sub-tasks), with an event history; task files are rnd_documents rows with task_id / task_doc_role.

Revision ID: b4e6c8d0a2f3
Revises: a9d3e5f7b1c2
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "b4e6c8d0a2f3"
down_revision = "a9d3e5f7b1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    existing = set(insp.get_table_names())
    if "rnd_project_tasks" not in existing:
        op.create_table(
            "rnd_project_tasks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            sa.Column("parent_task_id", sa.Integer(), sa.ForeignKey("rnd_project_tasks.id", ondelete="CASCADE"), nullable=True),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("original_due_date", sa.Date(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_rnd_project_tasks_project_id", "rnd_project_tasks", ["project_id"])
        op.create_index("ix_rnd_project_tasks_assigned_to_id", "rnd_project_tasks", ["assigned_to_id"])
        op.create_index("ix_rnd_project_tasks_parent_task_id", "rnd_project_tasks", ["parent_task_id"])
    if "rnd_project_task_events" not in existing:
        op.create_table(
            "rnd_project_task_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("task_id", sa.Integer(), sa.ForeignKey("rnd_project_tasks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("action", sa.String(20), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("old_due_date", sa.Date(), nullable=True),
            sa.Column("new_due_date", sa.Date(), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_rnd_project_task_events_task_id", "rnd_project_task_events", ["task_id"])
    cols = {c["name"] for c in insp.get_columns("rnd_documents")}
    if "task_id" not in cols:
        op.add_column("rnd_documents", sa.Column("task_id", sa.Integer(), sa.ForeignKey("rnd_project_tasks.id"), nullable=True))
        op.create_index("ix_rnd_documents_task_id", "rnd_documents", ["task_id"])
    if "task_doc_role" not in cols:
        op.add_column("rnd_documents", sa.Column("task_doc_role", sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_index("ix_rnd_documents_task_id", table_name="rnd_documents")
    op.drop_column("rnd_documents", "task_doc_role")
    op.drop_column("rnd_documents", "task_id")
    op.drop_table("rnd_project_task_events")
    op.drop_table("rnd_project_tasks")
