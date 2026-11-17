"""Drop the R&D tables of features the owner removed on 2026-10-30.

Owner asked on 2026-11-17 to delete the leftovers (earlier notes said "tables
stay as history"; that is overridden):
  * rnd_requirement_milestones  (+ rnd_requirement_tasks.milestone_id)
  * rnd_project_milestones      (+ rnd_project_tasks.milestone_id)
  * rnd_requirement_shares      (Share with department)

NOT dropped: rnd_requirement_doc_visibility. Its `category` column is still
read and written by the live requirement Documents routes; only its
department / shared_with_all switch is dead.

Both Timelines read audit_logs and task events, not these tables, so nothing
live reads the dropped data.

DATA IS NOT RECOVERABLE: upgrade deletes every row. downgrade only recreates
the tables and columns EMPTY (best effort, same shape as the original create
migrations a3c7e9b1d5f2, e2a7c5b9d1f3, c4e9a2f7d3b8).

Safe on a fresh or partly built DB: every step checks with sa.inspect first.

Revision ID: a8d3f5b7c9e1
Revises: f3a7c9e1b5d2
"""
from alembic import op
import sqlalchemy as sa

revision = "a8d3f5b7c9e1"
down_revision = "f3a7c9e1b5d2"
branch_labels = None
depends_on = None

# (task table, milestone table, FK name used by the original migrations)
TASK_LINKS = (
    ("rnd_requirement_tasks", "rnd_requirement_milestones", "fk_rnd_requirement_tasks_milestone_id"),
    ("rnd_project_tasks", "rnd_project_milestones", "fk_rnd_project_tasks_milestone_id"),
)


def _insp():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in set(_insp().get_table_names())


def _drop_task_link(task_table: str, ms_table: str) -> None:
    insp = _insp()
    if task_table not in set(insp.get_table_names()):
        return
    cols = {c["name"] for c in insp.get_columns(task_table)}
    if "milestone_id" not in cols:
        return
    for fk in insp.get_foreign_keys(task_table):
        if fk.get("constrained_columns") == ["milestone_id"] and fk.get("name"):
            op.drop_constraint(fk["name"], task_table, type_="foreignkey")
    for ix in _insp().get_indexes(task_table):
        if ix.get("column_names") == ["milestone_id"] and ix.get("name"):
            op.drop_index(ix["name"], table_name=task_table)
    op.drop_column(task_table, "milestone_id")


def upgrade() -> None:
    for task_table, ms_table, _fk in TASK_LINKS:
        _drop_task_link(task_table, ms_table)
    for table in ("rnd_requirement_milestones", "rnd_project_milestones", "rnd_requirement_shares"):
        if _has_table(table):
            op.drop_table(table)


def _milestone_columns() -> list[sa.Column]:
    return [
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
    ]


def downgrade() -> None:
    # Empty tables only: the rows deleted by upgrade() cannot be restored.
    if not _has_table("rnd_requirement_shares"):
        op.create_table(
            "rnd_requirement_shares",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("record_id", sa.Integer(), nullable=False, index=True),
            sa.Column("department", sa.String(20), nullable=False, index=True),
            sa.Column("note", sa.Text(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("shared_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("response", sa.String(30), nullable=True),
            sa.Column("response_remarks", sa.Text(), nullable=True),
            sa.Column("responded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("replaced_by_id", sa.Integer(), sa.ForeignKey("rnd_requirement_shares.id"), nullable=True),
            sa.Column("replaced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    if not _has_table("rnd_requirement_milestones"):
        op.create_table(
            "rnd_requirement_milestones",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("record_id", sa.Integer(), nullable=False),
            *_milestone_columns(),
            sa.CheckConstraint("source IN ('inquiry','tender')", name="ck_rnd_requirement_milestones_source"),
        )
        op.create_index("ix_rnd_requirement_milestones_source_record", "rnd_requirement_milestones", ["source", "record_id"])
        op.create_index("ix_rnd_requirement_milestones_assignee_id", "rnd_requirement_milestones", ["assignee_id"])

    if not _has_table("rnd_project_milestones"):
        op.create_table(
            "rnd_project_milestones",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            *_milestone_columns(),
        )
        op.create_index("ix_rnd_project_milestones_project_id", "rnd_project_milestones", ["project_id"])
        op.create_index("ix_rnd_project_milestones_assignee_id", "rnd_project_milestones", ["assignee_id"])

    for task_table, ms_table, fk_name in TASK_LINKS:
        insp = _insp()
        if task_table not in set(insp.get_table_names()):
            continue
        if "milestone_id" in {c["name"] for c in insp.get_columns(task_table)}:
            continue
        op.add_column(task_table, sa.Column("milestone_id", sa.Integer(), nullable=True))
        op.create_foreign_key(fk_name, task_table, ms_table, ["milestone_id"], ["id"], ondelete="SET NULL")
        op.create_index(f"ix_{task_table}_milestone_id", task_table, ["milestone_id"])
