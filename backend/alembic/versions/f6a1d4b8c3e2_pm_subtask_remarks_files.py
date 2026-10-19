"""Project Management: remarks and attachments on a sub-task
(pm_task_updates.subtask_id, pm_project_documents.subtask_id).

Revision ID: f6a1d4b8c3e2
Revises: e5f9c3a7b2d4
Create Date: 2026-10-10
"""
from alembic import op
import sqlalchemy as sa

revision = "f6a1d4b8c3e2"
down_revision = "e5f9c3a7b2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for table in ("pm_task_updates", "pm_project_documents"):
        if "subtask_id" not in {c["name"] for c in insp.get_columns(table)}:
            op.add_column(table, sa.Column("subtask_id", sa.Integer(), sa.ForeignKey("pm_task_subtasks.id", ondelete="CASCADE"), nullable=True))
            op.create_index(f"ix_{table}_subtask_id", table, ["subtask_id"])


def downgrade() -> None:
    for table in ("pm_project_documents", "pm_task_updates"):
        op.drop_index(f"ix_{table}_subtask_id", table_name=table)
        op.drop_column(table, "subtask_id")
