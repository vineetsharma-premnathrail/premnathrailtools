"""Project Plan: milestone start date, colour and icon; task description,
collaborators, start date, priority, progress, dependencies and labels, and
room for the new task statuses (in_progress / on_hold).

Revision ID: a3d7f2c9e815
Revises: f5b1d8c3a926
"""
from alembic import op
import sqlalchemy as sa

revision = "a3d7f2c9e815"
down_revision = "f5b1d8c3a926"
branch_labels = None
depends_on = None

_MS = [
    ("start_date", lambda: sa.Column("start_date", sa.Date(), nullable=True)),
    ("color", lambda: sa.Column("color", sa.String(9), nullable=True)),
    ("icon", lambda: sa.Column("icon", sa.String(20), nullable=True)),
]
_SUB = [
    ("description", lambda: sa.Column("description", sa.Text(), nullable=True)),
    ("collaborator_ids", lambda: sa.Column("collaborator_ids", sa.JSON(), nullable=True)),
    ("start_date", lambda: sa.Column("start_date", sa.Date(), nullable=True)),
    ("priority", lambda: sa.Column("priority", sa.String(20), nullable=False, server_default="medium")),
    ("progress", lambda: sa.Column("progress", sa.Integer(), nullable=True)),
    ("depends_on_ids", lambda: sa.Column("depends_on_ids", sa.JSON(), nullable=True)),
    ("labels", lambda: sa.Column("labels", sa.JSON(), nullable=True)),
]


def _add(table, cols):
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    with op.batch_alter_table(table) as batch:
        for name, col in cols:
            if name not in existing:
                batch.add_column(col())


def upgrade() -> None:
    _add("pm_project_tasks", _MS)
    _add("pm_task_subtasks", _SUB)
    with op.batch_alter_table("pm_task_subtasks") as batch:
        batch.alter_column("status", existing_type=sa.String(10), type_=sa.String(20), existing_nullable=False)


def downgrade() -> None:
    op.execute("UPDATE pm_task_subtasks SET status = 'todo' WHERE status NOT IN ('todo', 'done')")
    with op.batch_alter_table("pm_task_subtasks") as batch:
        batch.alter_column("status", existing_type=sa.String(20), type_=sa.String(10), existing_nullable=False)
        for name, _ in reversed(_SUB):
            batch.drop_column(name)
    with op.batch_alter_table("pm_project_tasks") as batch:
        for name, _ in reversed(_MS):
            batch.drop_column(name)
