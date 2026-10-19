"""R&D requirement tasks: sub-tasks (parent_task_id).

Revision ID: c7f9a1b3d5e8
Revises: b4e6c8d0a2f3
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "c7f9a1b3d5e8"
down_revision = "b4e6c8d0a2f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("rnd_requirement_tasks")}
    if "parent_task_id" not in cols:
        op.add_column("rnd_requirement_tasks", sa.Column(
            "parent_task_id", sa.Integer(), sa.ForeignKey("rnd_requirement_tasks.id", ondelete="CASCADE"), nullable=True,
        ))
        op.create_index("ix_rnd_requirement_tasks_parent_task_id", "rnd_requirement_tasks", ["parent_task_id"])


def downgrade() -> None:
    op.drop_index("ix_rnd_requirement_tasks_parent_task_id", table_name="rnd_requirement_tasks")
    op.drop_column("rnd_requirement_tasks", "parent_task_id")
