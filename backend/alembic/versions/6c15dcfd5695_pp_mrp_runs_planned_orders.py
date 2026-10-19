"""PP-MRP: MRP runs (run log + MD05 MRP list), planned orders (MD11-MD13)
and exception messages (MD06) — production/models/mrp.py (2026-10-14).

Revision ID: 6c15dcfd5695
Revises: e46e81bc28ca
"""
from alembic import op
import sqlalchemy as sa

revision = "6c15dcfd5695"
down_revision = "e46e81bc28ca"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "production_mrp_runs" not in existing:
        op.create_table(
            "production_mrp_runs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_number", sa.String(50), nullable=False),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("include_unassigned", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("status", sa.String(20), nullable=False, server_default="running"),
            sa.Column("parameters", sa.JSON(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("run_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("items_planned", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("planned_orders_created", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("make_orders", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("buy_orders", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("planned_orders_deleted", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("exceptions_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("item_results", sa.JSON(), nullable=False),
            sa.Column("log", sa.JSON(), nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
            *_ts(),
        )
        op.create_index("ix_production_mrp_runs_run_number", "production_mrp_runs", ["run_number"], unique=True)
        op.create_index("ix_production_mrp_runs_branch_id", "production_mrp_runs", ["branch_id"])

    if "production_planned_orders" not in existing:
        op.create_table(
            "production_planned_orders",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("order_number", sa.String(50), nullable=False),
            sa.Column("run_id", sa.Integer(), sa.ForeignKey("production_mrp_runs.id"), nullable=True),
            sa.Column("source", sa.String(10), nullable=False, server_default="mrp"),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("procurement", sa.String(10), nullable=False),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("production_boms.id"), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("finish_date", sa.Date(), nullable=False),
            sa.Column("firmed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("demand_type", sa.String(30), nullable=True),
            sa.Column("demand_ref_id", sa.Integer(), nullable=True),
            sa.Column("demand_label", sa.String(200), nullable=True),
            sa.Column("parent_planned_order_id", sa.Integer(), sa.ForeignKey("production_planned_orders.id"), nullable=True),
            sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=True),
            sa.Column("sales_schedule_id", sa.Integer(), sa.ForeignKey("sales_order_schedules.id"), nullable=True),
            sa.Column("rrv_build_id", sa.Integer(), sa.ForeignKey("production_rrv_builds.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=True),
            sa.Column("converted_type", sa.String(30), nullable=True),
            sa.Column("converted_ref_id", sa.Integer(), nullable=True),
            sa.Column("converted_number", sa.String(50), nullable=True),
            sa.Column("converted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("converted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("changed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_ts(),
        )
        op.create_index("ix_production_planned_orders_order_number", "production_planned_orders", ["order_number"], unique=True)
        for col in ("run_id", "branch_id", "item_id", "finish_date", "status", "sales_order_id", "rrv_build_id"):
            op.create_index(f"ix_production_planned_orders_{col}", "production_planned_orders", [col])

    if "production_mrp_exceptions" not in existing:
        op.create_table(
            "production_mrp_exceptions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_id", sa.Integer(), sa.ForeignKey("production_mrp_runs.id"), nullable=False),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("code", sa.String(30), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("element_type", sa.String(30), nullable=True),
            sa.Column("element_ref", sa.String(200), nullable=True),
            sa.Column("element_date", sa.Date(), nullable=True),
            sa.Column("suggested_date", sa.Date(), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=True),
            *_ts(),
        )
        for col in ("run_id", "item_id", "code"):
            op.create_index(f"ix_production_mrp_exceptions_{col}", "production_mrp_exceptions", [col])


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ("production_mrp_exceptions", "production_planned_orders", "production_mrp_runs"):
        if table in existing:
            op.drop_table(table)
