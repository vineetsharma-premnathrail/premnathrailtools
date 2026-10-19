"""Project Management: milestone team + strict order, chat, time logs.

- pm_project_milestones.sequence (backfilled per project by target date),
  lead_user_id (backfilled from the department's first head),
  assistant_user_ids
- pm_task_updates.mention_user_ids
- pm_task_time_logs (new)
- pm_milestone_messages (new) + pm_project_documents.message_id

Revision ID: a7e3c5d9b1f4
Revises: e8b2f4c6a1d3
Create Date: 2026-10-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "a7e3c5d9b1f4"
down_revision = "e8b2f4c6a1d3"
branch_labels = None
depends_on = None


def _cols(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    ms_cols = _cols(inspector, "pm_project_milestones")
    with op.batch_alter_table("pm_project_milestones") as b:
        if "sequence" not in ms_cols:
            b.add_column(sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"))
        if "lead_user_id" not in ms_cols:
            b.add_column(sa.Column("lead_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
            b.create_index("ix_pm_project_milestones_lead_user_id", ["lead_user_id"])
        if "assistant_user_ids" not in ms_cols:
            b.add_column(sa.Column("assistant_user_ids", sa.JSON(), nullable=True))

    if "mention_user_ids" not in _cols(inspector, "pm_task_updates"):
        with op.batch_alter_table("pm_task_updates") as b:
            b.add_column(sa.Column("mention_user_ids", sa.JSON(), nullable=True))

    if "pm_task_time_logs" not in tables:
        op.create_table(
            "pm_task_time_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("task_id", sa.Integer(), sa.ForeignKey("pm_project_tasks.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("work_date", sa.Date(), nullable=False),
            sa.Column("hours", sa.Float(), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )

    if "pm_milestone_messages" not in tables:
        op.create_table(
            "pm_milestone_messages",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("milestone_id", sa.Integer(), sa.ForeignKey("pm_project_milestones.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("mention_user_ids", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )

    if "message_id" not in _cols(inspector, "pm_project_documents"):
        with op.batch_alter_table("pm_project_documents") as b:
            b.add_column(sa.Column("message_id", sa.Integer(), sa.ForeignKey("pm_milestone_messages.id"), nullable=True))
            b.create_index("ix_pm_project_documents_message_id", ["message_id"])

    # Backfill: order each project's milestones by target date; lead = the
    # department's primary head (or secondary, if only that is set).
    rows = bind.execute(sa.text(
        "SELECT m.id, m.project_id, d.head_user_id, d.secondary_head_user_id FROM pm_project_milestones m "
        "LEFT JOIN departments d ON d.id = m.department_id ORDER BY m.project_id, m.target_date, m.id"
    )).fetchall()
    pos: dict[int, int] = {}
    for mid, pid, head, second in rows:
        pos[pid] = pos.get(pid, 0) + 1
        bind.execute(sa.text("UPDATE pm_project_milestones SET sequence = :s WHERE id = :i"), {"s": pos[pid], "i": mid})
        lead = head or second
        if lead:
            bind.execute(sa.text("UPDATE pm_project_milestones SET lead_user_id = :l WHERE id = :i AND lead_user_id IS NULL"), {"l": lead, "i": mid})


def downgrade() -> None:
    with op.batch_alter_table("pm_project_documents") as b:
        b.drop_index("ix_pm_project_documents_message_id")
        b.drop_column("message_id")
    op.drop_table("pm_milestone_messages")
    op.drop_table("pm_task_time_logs")
    with op.batch_alter_table("pm_task_updates") as b:
        b.drop_column("mention_user_ids")
    with op.batch_alter_table("pm_project_milestones") as b:
        b.drop_index("ix_pm_project_milestones_lead_user_id")
        b.drop_column("assistant_user_ids")
        b.drop_column("lead_user_id")
        b.drop_column("sequence")
