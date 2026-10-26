"""Milestones on an R&D requirement.

New table rnd_requirement_milestones (addressed by source + record_id) and
rnd_requirement_tasks.milestone_id (nullable, no back-fill: existing tasks
stay "No milestone").

Revision ID: e2a7c5b9d1f3
Revises: d1f6b4a8c3e5
"""
from alembic import op
import sqlalchemy as sa

revision = "e2a7c5b9d1f3"
down_revision = "d1f6b4a8c3e5"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    if "rnd_requirement_milestones" not in _tables():
        op.create_table(
            "rnd_requirement_milestones",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("record_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("co_owner_ids", sa.JSON(), nullable=True),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="todo"),
            sa.Column("blocker_reason", sa.Text(), nullable=True),
            sa.Column("reopen_reason", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("color", sa.String(9), nullable=True),
            sa.Column("icon", sa.String(20), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("source IN ('inquiry','tender')", name="ck_rnd_requirement_milestones_source"),
        )
    idx = _indexes("rnd_requirement_milestones")
    if "ix_rnd_requirement_milestones_source_record" not in idx:
        op.create_index("ix_rnd_requirement_milestones_source_record", "rnd_requirement_milestones", ["source", "record_id"])
    if "ix_rnd_requirement_milestones_assignee_id" not in idx:
        op.create_index("ix_rnd_requirement_milestones_assignee_id", "rnd_requirement_milestones", ["assignee_id"])

    if "milestone_id" not in _cols("rnd_requirement_tasks"):
        op.add_column("rnd_requirement_tasks", sa.Column("milestone_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_rnd_requirement_tasks_milestone_id", "rnd_requirement_tasks", "rnd_requirement_milestones",
            ["milestone_id"], ["id"], ondelete="SET NULL")
    if "ix_rnd_requirement_tasks_milestone_id" not in _indexes("rnd_requirement_tasks"):
        op.create_index("ix_rnd_requirement_tasks_milestone_id", "rnd_requirement_tasks", ["milestone_id"])


def downgrade() -> None:
    if "ix_rnd_requirement_tasks_milestone_id" in _indexes("rnd_requirement_tasks"):
        op.drop_index("ix_rnd_requirement_tasks_milestone_id", table_name="rnd_requirement_tasks")
    if "milestone_id" in _cols("rnd_requirement_tasks"):
        op.drop_constraint("fk_rnd_requirement_tasks_milestone_id", "rnd_requirement_tasks", type_="foreignkey")
        op.drop_column("rnd_requirement_tasks", "milestone_id")
    if "rnd_requirement_milestones" in _tables():
        op.drop_table("rnd_requirement_milestones")
