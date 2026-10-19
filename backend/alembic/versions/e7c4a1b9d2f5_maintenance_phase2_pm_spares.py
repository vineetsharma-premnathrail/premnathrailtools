"""maintenance phase 2: PM plans (+ checklist / spares kit), asset bill of
spares, and the PM link on work orders

Phase 2 of docs/02-modules/maintenance/plan.md — preventive maintenance and
spares.

Revision ID: e7c4a1b9d2f5
Revises: 4f7b2c9e1d58
Create Date: 2026-10-06 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "e7c4a1b9d2f5"
down_revision = "4f7b2c9e1d58"
branch_labels = None
depends_on = None


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    ]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "maintenance_pm_plans" not in tables:
        op.create_table(
            "maintenance_pm_plans",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("plan_code", sa.String(length=50), nullable=False),
            sa.Column("asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id"), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("wo_type", sa.String(length=20), nullable=False, server_default="preventive"),
            sa.Column("trigger_type", sa.String(length=20), nullable=False, server_default="calendar"),
            sa.Column("frequency_unit", sa.String(length=10), nullable=False, server_default="month"),
            sa.Column("frequency_value", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("meter_interval", sa.Float(), nullable=True),
            sa.Column("schedule_basis", sa.String(length=10), nullable=False, server_default="fixed"),
            sa.Column("lead_days", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("next_due_date", sa.Date(), nullable=False),
            sa.Column("last_done_date", sa.Date(), nullable=True),
            sa.Column("last_work_order_id", sa.Integer(), sa.ForeignKey("maintenance_work_orders.id"), nullable=True),
            sa.Column("estimated_hours", sa.Float(), nullable=True),
            sa.Column("default_assignee_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("requires_shutdown", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_maintenance_pm_plans_plan_code", "maintenance_pm_plans", ["plan_code"], unique=True)
        op.create_index("ix_maintenance_pm_plans_asset_id", "maintenance_pm_plans", ["asset_id"])
        op.create_index("ix_maintenance_pm_plans_next_due_date", "maintenance_pm_plans", ["next_due_date"])

    if "maintenance_pm_plan_tasks" not in tables:
        op.create_table(
            "maintenance_pm_plan_tasks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("plan_id", sa.Integer(), sa.ForeignKey("maintenance_pm_plans.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("expected_value", sa.String(length=200), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_maintenance_pm_plan_tasks_plan_id", "maintenance_pm_plan_tasks", ["plan_id"])

    if "maintenance_pm_plan_spares" not in tables:
        op.create_table(
            "maintenance_pm_plan_spares",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("plan_id", sa.Integer(), sa.ForeignKey("maintenance_pm_plans.id", ondelete="CASCADE"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("qty", sa.Float(), nullable=False, server_default="1"),
            sa.Column("remarks", sa.String(length=255), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_maintenance_pm_plan_spares_plan_id", "maintenance_pm_plan_spares", ["plan_id"])

    if "maintenance_asset_spares" not in tables:
        op.create_table(
            "maintenance_asset_spares",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("qty_per_replacement", sa.Float(), nullable=False, server_default="1"),
            sa.Column("is_critical", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("remarks", sa.String(length=255), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_maintenance_asset_spares_asset_id", "maintenance_asset_spares", ["asset_id"])
        op.create_index("ix_maintenance_asset_spares_store_item_id", "maintenance_asset_spares", ["store_item_id"])

    wo_cols = {c["name"] for c in inspector.get_columns("maintenance_work_orders")}
    if "pm_plan_id" not in wo_cols:
        op.add_column("maintenance_work_orders", sa.Column("pm_plan_id", sa.Integer(), sa.ForeignKey("maintenance_pm_plans.id"), nullable=True))
        op.create_index("ix_maintenance_work_orders_pm_plan_id", "maintenance_work_orders", ["pm_plan_id"])
    if "pm_due_date" not in wo_cols:
        op.add_column("maintenance_work_orders", sa.Column("pm_due_date", sa.Date(), nullable=True))
    # One work order per PM occurrence (plan + due date) — the DB backstop for
    # two users / the scheduler generating the same job at the same moment.
    wo_uniques = {u["name"] for u in inspector.get_unique_constraints("maintenance_work_orders")}
    if "uq_maintenance_wo_pm_occurrence" not in wo_uniques:
        op.create_unique_constraint("uq_maintenance_wo_pm_occurrence", "maintenance_work_orders", ["pm_plan_id", "pm_due_date"])


def downgrade() -> None:
    op.drop_constraint("uq_maintenance_wo_pm_occurrence", "maintenance_work_orders", type_="unique")
    op.drop_index("ix_maintenance_work_orders_pm_plan_id", table_name="maintenance_work_orders")
    op.drop_column("maintenance_work_orders", "pm_due_date")
    op.drop_column("maintenance_work_orders", "pm_plan_id")
    op.drop_table("maintenance_asset_spares")
    op.drop_table("maintenance_pm_plan_spares")
    op.drop_table("maintenance_pm_plan_tasks")
    op.drop_table("maintenance_pm_plans")
