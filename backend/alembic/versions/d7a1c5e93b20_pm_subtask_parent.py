"""PM: sub-tasks inside a milestone task — pm_task_subtasks.parent_id.

A milestone's tasks are rows with parent_id NULL; the person a task is
assigned to can split it into sub-tasks (rows pointing at the task).

Revision ID: d7a1c5e93b20
Revises: b4e8d2f61c97
"""
from alembic import op
import sqlalchemy as sa

revision = "d7a1c5e93b20"
down_revision = "b4e8d2f61c97"
branch_labels = None
depends_on = None

_TABLE = "pm_task_subtasks"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_columns(_TABLE)}
    if "parent_id" in existing:
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_pm_task_subtasks_parent", _TABLE, ["parent_id"], ["id"], ondelete="CASCADE")
        batch.create_index("ix_pm_task_subtasks_parent_id", ["parent_id"])


def downgrade() -> None:
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_index("ix_pm_task_subtasks_parent_id")
        batch.drop_constraint("fk_pm_task_subtasks_parent", type_="foreignkey")
        batch.drop_column("parent_id")
