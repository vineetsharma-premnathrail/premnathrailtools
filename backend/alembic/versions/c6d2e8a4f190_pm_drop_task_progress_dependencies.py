"""Project Plan: tasks lose the manual progress % and dependencies (depends on
/ blocks) — progress comes from the checklist, and dependencies were dropped
from the design.

Revision ID: c6d2e8a4f190
Revises: e3b9f2a6c814
"""
from alembic import op
import sqlalchemy as sa

revision = "c6d2e8a4f190"
down_revision = "e3b9f2a6c814"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("pm_task_subtasks")}
    with op.batch_alter_table("pm_task_subtasks") as batch:
        for name in ("progress", "depends_on_ids"):
            if name in existing:
                batch.drop_column(name)


def downgrade() -> None:
    with op.batch_alter_table("pm_task_subtasks") as batch:
        batch.add_column(sa.Column("progress", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("depends_on_ids", sa.JSON(), nullable=True))
