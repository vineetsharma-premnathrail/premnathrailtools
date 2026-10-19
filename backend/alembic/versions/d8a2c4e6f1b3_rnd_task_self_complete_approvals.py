"""R&D tasks: the assignee completes a task themselves; "ask for approval"
becomes a separate request on an open task (rnd_task_approvals).

Tasks that were waiting for "approve & close" (status 'submitted') were
finished by their assignee, so they become closed.

Revision ID: d8a2c4e6f1b3
Revises: c7f9a1b3d5e8
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "d8a2c4e6f1b3"
down_revision = "c7f9a1b3d5e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "rnd_task_approvals" not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(
            "rnd_task_approvals",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("task_kind", sa.String(20), nullable=False),
            sa.Column("task_id", sa.Integer(), nullable=False, index=True),
            sa.Column("request", sa.Text(), nullable=False),
            sa.Column("document_ids", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    for table in ("rnd_requirement_tasks", "rnd_project_tasks"):
        op.execute(f"UPDATE {table} SET status = 'closed', closed_at = COALESCE(closed_at, submitted_at) WHERE status = 'submitted'")


def downgrade() -> None:
    op.drop_table("rnd_task_approvals")
