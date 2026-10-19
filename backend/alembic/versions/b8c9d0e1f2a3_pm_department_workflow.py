"""Project Management: department milestones → plans → tasks workflow

Projects get the standard lifecycle (draft/released/on_hold/
technically_complete/closed/cancelled); milestones are owned by one
department and move assigned → accepted → in_progress → submitted →
achieved; each milestone gets one department plan; tasks belong to a plan,
carry a baseline, hours and a per-task review flag, and log every update.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None

_TS = lambda: [  # noqa: E731
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
]

PROJECT_COLS = [
    ("customer_po_ref", lambda: sa.Column("customer_po_ref", sa.String(length=100), nullable=True)),
    ("released_by_id", lambda: sa.Column("released_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)),
    ("released_at", lambda: sa.Column("released_at", sa.DateTime(timezone=True), nullable=True)),
    ("hold_reason", lambda: sa.Column("hold_reason", sa.Text(), nullable=True)),
]
MILESTONE_COLS = [
    ("department_id", lambda: sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True)),
    ("deliverable", lambda: sa.Column("deliverable", sa.Text(), nullable=True)),
    ("depends_on_milestone_id", lambda: sa.Column("depends_on_milestone_id", sa.Integer(), sa.ForeignKey("pm_project_milestones.id"), nullable=True)),
    ("accepted_by_id", lambda: sa.Column("accepted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)),
    ("accepted_at", lambda: sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True)),
    ("submitted_by_id", lambda: sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)),
    ("submitted_at", lambda: sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True)),
    ("submission_note", lambda: sa.Column("submission_note", sa.Text(), nullable=True)),
    ("achieved_by_id", lambda: sa.Column("achieved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)),
    ("return_reason", lambda: sa.Column("return_reason", sa.Text(), nullable=True)),
]
TASK_COLS = [
    ("milestone_id", lambda: sa.Column("milestone_id", sa.Integer(), sa.ForeignKey("pm_project_milestones.id"), nullable=True)),
    ("plan_id", lambda: sa.Column("plan_id", sa.Integer(), sa.ForeignKey("pm_milestone_plans.id"), nullable=True)),
    ("depends_on_task_id", lambda: sa.Column("depends_on_task_id", sa.Integer(), sa.ForeignKey("pm_project_tasks.id"), nullable=True)),
    ("baseline_start", lambda: sa.Column("baseline_start", sa.Date(), nullable=True)),
    ("baseline_due", lambda: sa.Column("baseline_due", sa.Date(), nullable=True)),
    ("estimated_hours", lambda: sa.Column("estimated_hours", sa.Float(), nullable=True)),
    ("actual_hours", lambda: sa.Column("actual_hours", sa.Float(), nullable=False, server_default="0")),
    ("review_required", lambda: sa.Column("review_required", sa.Boolean(), nullable=False, server_default=sa.true())),
    ("released_at", lambda: sa.Column("released_at", sa.DateTime(timezone=True), nullable=True)),
    ("blocker_reason", lambda: sa.Column("blocker_reason", sa.Text(), nullable=True)),
    ("reopen_reason", lambda: sa.Column("reopen_reason", sa.Text(), nullable=True)),
    ("submitted_at", lambda: sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True)),
    ("completed_at", lambda: sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True)),
    ("reviewed_by_id", lambda: sa.Column("reviewed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)),
]
CHANGE_COLS = [
    ("milestone_id", lambda: sa.Column("milestone_id", sa.Integer(), sa.ForeignKey("pm_project_milestones.id"), nullable=True)),
    ("current_target_date", lambda: sa.Column("current_target_date", sa.Date(), nullable=True)),
    ("proposed_target_date", lambda: sa.Column("proposed_target_date", sa.Date(), nullable=True)),
    ("decision_note", lambda: sa.Column("decision_note", sa.Text(), nullable=True)),
]


def _add_missing(table: str, cols) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    missing = [make() for name, make in cols if name not in existing]
    if missing:
        with op.batch_alter_table(table) as batch:
            for col in missing:
                batch.add_column(col)


def _drop_present(table: str, cols) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    present = [name for name, _ in cols if name in existing]
    if present:
        with op.batch_alter_table(table) as batch:
            for name in present:
                batch.drop_column(name)


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "pm_milestone_plans" not in tables:
        op.create_table(
            "pm_milestone_plans",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("milestone_id", sa.Integer(), sa.ForeignKey("pm_project_milestones.id"), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("revision_no", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("planned_start", sa.Date(), nullable=True),
            sa.Column("planned_finish", sa.Date(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("return_reason", sa.Text(), nullable=True),
            *_TS(),
        )
        op.create_index("ix_pm_milestone_plans_milestone_id", "pm_milestone_plans", ["milestone_id"], unique=True)

    _add_missing("pm_projects", PROJECT_COLS)
    with op.batch_alter_table("pm_projects") as batch:
        batch.alter_column("status", type_=sa.String(length=30), existing_type=sa.String(length=20), existing_nullable=False)
    op.execute("UPDATE pm_projects SET status = 'draft' WHERE status = 'planning'")
    op.execute("UPDATE pm_projects SET status = 'released' WHERE status = 'active'")
    op.execute("UPDATE pm_projects SET status = 'closed' WHERE status = 'completed'")

    _add_missing("pm_project_milestones", MILESTONE_COLS)
    # "missed" was a hand-set flag; overdue is now computed from the date.
    op.execute("UPDATE pm_project_milestones SET status = 'assigned' WHERE status IN ('pending', 'missed')")
    op.create_index("ix_pm_project_milestones_department_id", "pm_project_milestones", ["department_id"])

    _add_missing("pm_project_tasks", TASK_COLS)
    op.execute("UPDATE pm_project_tasks SET status = 'done' WHERE status = 'completed'")
    op.create_index("ix_pm_project_tasks_milestone_id", "pm_project_tasks", ["milestone_id"])
    op.create_index("ix_pm_project_tasks_plan_id", "pm_project_tasks", ["plan_id"])
    op.create_index("ix_pm_project_tasks_assignee_id", "pm_project_tasks", ["assignee_id"])

    _add_missing("pm_project_change_requests", CHANGE_COLS)
    op.create_index("ix_pm_project_change_requests_milestone_id", "pm_project_change_requests", ["milestone_id"])

    if "pm_task_updates" not in tables:
        op.create_table(
            "pm_task_updates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("task_id", sa.Integer(), sa.ForeignKey("pm_project_tasks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("kind", sa.String(length=20), nullable=False, server_default="update"),
            sa.Column("from_status", sa.String(length=20), nullable=True),
            sa.Column("to_status", sa.String(length=20), nullable=True),
            sa.Column("progress_percent", sa.Integer(), nullable=True),
            sa.Column("hours", sa.Float(), nullable=True),
            sa.Column("comment", sa.Text(), nullable=True),
            *_TS(),
        )
        op.create_index("ix_pm_task_updates_task_id", "pm_task_updates", ["task_id"])

    if "pm_department_settings" not in tables:
        op.create_table(
            "pm_department_settings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=False, unique=True),
            sa.Column("review_required_default", sa.Boolean(), nullable=False, server_default=sa.true()),
            *_TS(),
        )


def downgrade() -> None:
    op.drop_table("pm_department_settings")
    op.drop_index("ix_pm_task_updates_task_id", table_name="pm_task_updates")
    op.drop_table("pm_task_updates")

    op.drop_index("ix_pm_project_change_requests_milestone_id", table_name="pm_project_change_requests")
    _drop_present("pm_project_change_requests", CHANGE_COLS)

    op.execute("UPDATE pm_project_tasks SET status = 'completed' WHERE status = 'done'")
    op.execute("UPDATE pm_project_tasks SET status = 'in_progress' WHERE status IN ('submitted', 'reopened')")
    op.drop_index("ix_pm_project_tasks_assignee_id", table_name="pm_project_tasks")
    op.drop_index("ix_pm_project_tasks_plan_id", table_name="pm_project_tasks")
    op.drop_index("ix_pm_project_tasks_milestone_id", table_name="pm_project_tasks")
    _drop_present("pm_project_tasks", TASK_COLS)

    op.execute("UPDATE pm_project_milestones SET status = 'pending' WHERE status <> 'achieved'")
    op.drop_index("ix_pm_project_milestones_department_id", table_name="pm_project_milestones")
    _drop_present("pm_project_milestones", MILESTONE_COLS)

    op.execute("UPDATE pm_projects SET status = 'planning' WHERE status = 'draft'")
    op.execute("UPDATE pm_projects SET status = 'active' WHERE status IN ('released', 'technically_complete')")
    op.execute("UPDATE pm_projects SET status = 'completed' WHERE status = 'closed'")
    _drop_present("pm_projects", PROJECT_COLS)
    with op.batch_alter_table("pm_projects") as batch:
        batch.alter_column("status", type_=sa.String(length=20), existing_type=sa.String(length=30), existing_nullable=False)

    op.drop_index("ix_pm_milestone_plans_milestone_id", table_name="pm_milestone_plans")
    op.drop_table("pm_milestone_plans")
