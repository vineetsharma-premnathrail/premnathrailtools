"""R&D requirement work: R&D team (head / member), per-requirement access
(view / download / upload / respond) and tasks with their event history.

Revision ID: f4b8d2c6a1e9
Revises: e7c3a9f1b2d4
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "f4b8d2c6a1e9"
down_revision = "e7c3a9f1b2d4"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "rnd_team_members" not in existing:
        op.create_table(
            "rnd_team_members",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("role", sa.String(20), nullable=False, server_default="member"),
            *_ts(),
            sa.UniqueConstraint("user_id", name="uq_rnd_team_member_user"),
        )
    if "rnd_requirement_access" not in existing:
        op.create_table(
            "rnd_requirement_access",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("record_id", sa.Integer(), nullable=False, index=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("can_view", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("can_download", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("can_upload", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("can_respond", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("granted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("source", "record_id", "user_id", name="uq_rnd_requirement_access"),
        )
    if "rnd_requirement_tasks" not in existing:
        op.create_table(
            "rnd_requirement_tasks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("record_id", sa.Integer(), nullable=False, index=True),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("original_due_date", sa.Date(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
    if "rnd_task_events" not in existing:
        op.create_table(
            "rnd_task_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("task_id", sa.Integer(), sa.ForeignKey("rnd_requirement_tasks.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("action", sa.String(20), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("old_due_date", sa.Date(), nullable=True),
            sa.Column("new_due_date", sa.Date(), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("rnd_task_events")
    op.drop_table("rnd_requirement_tasks")
    op.drop_table("rnd_requirement_access")
    op.drop_table("rnd_team_members")
