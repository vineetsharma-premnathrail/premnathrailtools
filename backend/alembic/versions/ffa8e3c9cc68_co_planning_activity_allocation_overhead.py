"""CO: KP06 cost-centre plan versions + lines, KL01/KP26 activity rates,
KSU5/KSV5 assessment & distribution cycles + runs, KGI2/KGI4 costing sheet
+ overhead runs; production workstation cost centre and time-log activity
type (2026-10-14).

Revision ID: ffa8e3c9cc68
Revises: cfbe9f919704
"""
from alembic import op
import sqlalchemy as sa

revision = "ffa8e3c9cc68"
down_revision = "cfbe9f919704"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)
RATE = sa.Numeric(18, 4)
PCT = sa.Numeric(7, 3)


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if not _has_table("co_plan_versions"):
        op.create_table(
            "co_plan_versions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(20), nullable=False),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("financial_year", sa.String(10), nullable=False, index=True),
            sa.Column("version_type", sa.String(20), nullable=False, server_default="original"),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("copied_from_version_id", sa.Integer(), sa.ForeignKey("co_plan_versions.id"), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("locked_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
            sa.UniqueConstraint("financial_year", "code", name="uq_co_plan_version_fy_code"),
        )
    if not _has_table("co_plan_lines"):
        op.create_table(
            "co_plan_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("version_id", sa.Integer(), sa.ForeignKey("co_plan_versions.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=False, index=True),
            sa.Column("gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=False),
            sa.Column("accounting_period", sa.String(7), nullable=False),
            sa.Column("amount", MONEY, nullable=False, server_default="0"),
            *_ts(),
            sa.UniqueConstraint("version_id", "cost_center_id", "gl_account_id", "accounting_period", name="uq_co_plan_line_cell"),
        )
    if not _has_table("co_activity_rates"):
        op.create_table(
            "co_activity_rates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("activity_type", sa.String(10), nullable=False, index=True),
            sa.Column("workstation_id", sa.Integer(), sa.ForeignKey("production_workstations.id"), nullable=True, index=True),
            sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True, index=True),
            sa.Column("financial_year", sa.String(10), nullable=False),
            sa.Column("valid_from", sa.Date(), nullable=False),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("fixed_rate", RATE, nullable=False, server_default="0"),
            sa.Column("variable_rate", RATE, nullable=False, server_default="0"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
    if not _has_table("co_allocation_cycles"):
        op.create_table(
            "co_allocation_cycles",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(30), nullable=False, unique=True),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("method", sa.String(20), nullable=False, server_default="distribution"),
            sa.Column("assessment_gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=True),
            sa.Column("valid_from", sa.Date(), nullable=True),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
    if not _has_table("co_allocation_segments"):
        op.create_table(
            "co_allocation_segments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("cycle_id", sa.Integer(), sa.ForeignKey("co_allocation_cycles.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("sender_cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=False),
            sa.Column("sender_gl_account_ids", sa.JSON(), nullable=True),
            sa.Column("basis", sa.String(20), nullable=False, server_default="fixed_percent"),
            sa.Column("activity_type", sa.String(10), nullable=True),
            sa.Column("receivers", sa.JSON(), nullable=False),
            *_ts(),
        )
    if not _has_table("co_allocation_runs"):
        op.create_table(
            "co_allocation_runs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("cycle_id", sa.Integer(), sa.ForeignKey("co_allocation_cycles.id"), nullable=False, index=True),
            sa.Column("accounting_period", sa.String(7), nullable=False, index=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="posted"),
            sa.Column("total_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("reversal_journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("result", sa.JSON(), nullable=True),
            sa.Column("run_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reversed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reversal_reason", sa.Text(), nullable=True),
            *_ts(),
        )
    if not _has_table("co_costing_sheet_rates"):
        op.create_table(
            "co_costing_sheet_rates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True, index=True),
            sa.Column("valid_from", sa.Date(), nullable=False),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("material_overhead_pct", PCT, nullable=False, server_default="0"),
            sa.Column("labour_overhead_pct", PCT, nullable=False, server_default="0"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
    if not _has_table("co_overhead_runs"):
        op.create_table(
            "co_overhead_runs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("accounting_period", sa.String(7), nullable=False, index=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="posted"),
            sa.Column("total_overhead", MONEY, nullable=False, server_default="0"),
            sa.Column("run_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reversed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reversal_reason", sa.Text(), nullable=True),
            *_ts(),
        )
    if not _has_table("co_overhead_run_lines"):
        op.create_table(
            "co_overhead_run_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_id", sa.Integer(), sa.ForeignKey("co_overhead_runs.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=False, index=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("costing_sheet_rate_id", sa.Integer(), sa.ForeignKey("co_costing_sheet_rates.id"), nullable=True),
            sa.Column("material_base", MONEY, nullable=False, server_default="0"),
            sa.Column("labour_base", MONEY, nullable=False, server_default="0"),
            sa.Column("material_overhead_pct", PCT, nullable=False, server_default="0"),
            sa.Column("labour_overhead_pct", PCT, nullable=False, server_default="0"),
            sa.Column("material_overhead", MONEY, nullable=False, server_default="0"),
            sa.Column("labour_overhead", MONEY, nullable=False, server_default="0"),
            sa.Column("amount", MONEY, nullable=False, server_default="0"),
            sa.Column("cost_posting_id", sa.Integer(), sa.ForeignKey("production_order_cost_postings.id"), nullable=True),
            sa.Column("reversal_posting_id", sa.Integer(), sa.ForeignKey("production_order_cost_postings.id"), nullable=True),
            *_ts(),
        )

    if "cost_center_id" not in _columns("production_workstations"):
        with op.batch_alter_table("production_workstations") as b:
            b.add_column(sa.Column("cost_center_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_production_workstations_cost_center", "cost_centers", ["cost_center_id"], ["id"])
    if "activity_type" not in _columns("production_time_logs"):
        with op.batch_alter_table("production_time_logs") as b:
            b.add_column(sa.Column("activity_type", sa.String(10), nullable=True))


def downgrade() -> None:
    if "activity_type" in _columns("production_time_logs"):
        with op.batch_alter_table("production_time_logs") as b:
            b.drop_column("activity_type")
    if "cost_center_id" in _columns("production_workstations"):
        with op.batch_alter_table("production_workstations") as b:
            b.drop_constraint("fk_production_workstations_cost_center", type_="foreignkey")
            b.drop_column("cost_center_id")
    for t in ("co_overhead_run_lines", "co_overhead_runs", "co_costing_sheet_rates", "co_allocation_runs",
              "co_allocation_segments", "co_allocation_cycles", "co_activity_rates", "co_plan_lines", "co_plan_versions"):
        if _has_table(t):
            op.drop_table(t)
