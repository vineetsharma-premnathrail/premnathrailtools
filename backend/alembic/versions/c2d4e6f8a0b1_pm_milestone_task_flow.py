"""Project Management: drop the plan step — milestone → task flow

Adds the columns the simplified PM models now read (handover date, closure
note, cancel reasons, milestone original target / achieved time, task
started time and creator, document links to a milestone or task) and the
`pm_task_subtasks` table. Statuses left over from the plan-based workflow
are mapped onto the new sets. Old tables (pm_milestone_plans, phases,
budget, risks, ...) are left in place untouched — no data is dropped.

Revision ID: c2d4e6f8a0b1
Revises: b6e3d8f1a4c7
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "c2d4e6f8a0b1"
down_revision = "b6e3d8f1a4c7"
branch_labels = None
depends_on = None

COLS = {
    "pm_projects": [
        ("target_handover_date", lambda: sa.Column("target_handover_date", sa.Date(), nullable=True)),
        ("cancel_reason", lambda: sa.Column("cancel_reason", sa.Text(), nullable=True)),
        ("closure_note", lambda: sa.Column("closure_note", sa.Text(), nullable=True)),
    ],
    "pm_project_milestones": [
        ("original_target_date", lambda: sa.Column("original_target_date", sa.Date(), nullable=True)),
        ("achieved_at", lambda: sa.Column("achieved_at", sa.DateTime(timezone=True), nullable=True)),
        ("cancel_reason", lambda: sa.Column("cancel_reason", sa.Text(), nullable=True)),
    ],
    "pm_project_tasks": [
        ("created_by_id", lambda: sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)),
        ("started_at", lambda: sa.Column("started_at", sa.DateTime(timezone=True), nullable=True)),
        ("cancel_reason", lambda: sa.Column("cancel_reason", sa.Text(), nullable=True)),
    ],
    "pm_project_documents": [
        ("milestone_id", lambda: sa.Column("milestone_id", sa.Integer(), sa.ForeignKey("pm_project_milestones.id"), nullable=True)),
        ("task_id", lambda: sa.Column("task_id", sa.Integer(), sa.ForeignKey("pm_project_tasks.id"), nullable=True)),
    ],
}


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for table, cols in COLS.items():
        existing = _columns(table)
        missing = [make() for name, make in cols if name not in existing]
        if missing:
            with op.batch_alter_table(table) as batch:
                for col in missing:
                    batch.add_column(col)

    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("pm_project_documents")}
    if "ix_pm_project_documents_milestone_id" not in indexes:
        op.create_index("ix_pm_project_documents_milestone_id", "pm_project_documents", ["milestone_id"])
    if "ix_pm_project_documents_task_id" not in indexes:
        op.create_index("ix_pm_project_documents_task_id", "pm_project_documents", ["task_id"])

    if "pm_task_subtasks" not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(
            "pm_task_subtasks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("task_id", sa.Integer(), sa.ForeignKey("pm_project_tasks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=10), nullable=False, server_default="todo"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_pm_task_subtasks_task_id", "pm_task_subtasks", ["task_id"])

    # Plan-era statuses → the new sets.
    op.execute("UPDATE pm_projects SET status = 'planning' WHERE status = 'draft'")
    op.execute("UPDATE pm_projects SET status = 'active' WHERE status = 'released'")
    op.execute("UPDATE pm_project_milestones SET status = 'not_started' WHERE status IN ('assigned', 'accepted', 'pending', 'missed')")
    op.execute(
        "UPDATE pm_project_tasks SET status = 'todo' "
        "WHERE status NOT IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')"
    )
    op.execute("UPDATE pm_project_milestones SET original_target_date = target_date WHERE original_target_date IS NULL")


def downgrade() -> None:
    op.execute("UPDATE pm_projects SET status = 'draft' WHERE status = 'planning'")
    op.execute("UPDATE pm_projects SET status = 'released' WHERE status = 'active'")
    op.execute("UPDATE pm_project_milestones SET status = 'assigned' WHERE status = 'not_started'")

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "pm_task_subtasks" in tables:
        op.drop_index("ix_pm_task_subtasks_task_id", table_name="pm_task_subtasks")
        op.drop_table("pm_task_subtasks")

    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("pm_project_documents")}
    for name in ("ix_pm_project_documents_milestone_id", "ix_pm_project_documents_task_id"):
        if name in indexes:
            op.drop_index(name, table_name="pm_project_documents")

    for table, cols in COLS.items():
        existing = _columns(table)
        present = [name for name, _ in cols if name in existing]
        if present:
            with op.batch_alter_table(table) as batch:
                for name in present:
                    batch.drop_column(name)
