"""R&D project milestones (Project Plan & Milestones, same as Project
Management) + rnd_project_tasks.milestone_id.

Revision ID: a3c7e9b1d5f2
Revises: e5a1c8d3f7b2
"""
from alembic import op
import sqlalchemy as sa

revision = "a3c7e9b1d5f2"
down_revision = "e5a1c8d3f7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "rnd_project_milestones" not in inspector.get_table_names():
        op.create_table(
            "rnd_project_milestones",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("co_owner_ids", sa.JSON(), nullable=True),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="todo"),
            sa.Column("blocker_reason", sa.Text(), nullable=True),
            sa.Column("reopen_reason", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("color", sa.String(length=9), nullable=True),
            sa.Column("icon", sa.String(length=20), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_rnd_project_milestones_project_id", "rnd_project_milestones", ["project_id"])
        op.create_index("ix_rnd_project_milestones_assignee_id", "rnd_project_milestones", ["assignee_id"])
    cols = {c["name"] for c in inspector.get_columns("rnd_project_tasks")}
    if "milestone_id" not in cols:
        with op.batch_alter_table("rnd_project_tasks") as batch:
            batch.add_column(sa.Column("milestone_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_rnd_project_tasks_milestone_id", "rnd_project_milestones", ["milestone_id"], ["id"], ondelete="SET NULL")
            batch.create_index("ix_rnd_project_tasks_milestone_id", ["milestone_id"])


def downgrade() -> None:
    with op.batch_alter_table("rnd_project_tasks") as batch:
        batch.drop_index("ix_rnd_project_tasks_milestone_id")
        batch.drop_constraint("fk_rnd_project_tasks_milestone_id", type_="foreignkey")
        batch.drop_column("milestone_id")
    op.drop_index("ix_rnd_project_milestones_assignee_id", table_name="rnd_project_milestones")
    op.drop_index("ix_rnd_project_milestones_project_id", table_name="rnd_project_milestones")
    op.drop_table("rnd_project_milestones")
