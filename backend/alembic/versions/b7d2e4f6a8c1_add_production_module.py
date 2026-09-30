"""add production module (workstations, BOM + routing, work orders, time logs)

New `production_*` tables — deliberately not reusing the `manufacturing_*`
names that e7a9c1b3d5f6 created and d1e3f5a7b9c2 dropped, since that old
migration's create_table calls are unguarded. Also registers the
"production" app in the admin's assignable-modules checklist.

Revision ID: b7d2e4f6a8c1
Revises: f3a5c7e9b1d4
Create Date: 2026-09-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b7d2e4f6a8c1'
down_revision = 'f3a5c7e9b1d4'
branch_labels = None
depends_on = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def _soft_delete() -> list[sa.Column]:
    return [
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = set(inspector.get_table_names())

    if "production_workstations" not in existing:
        op.create_table(
            "production_workstations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(length=30), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("workstation_type", sa.String(length=30), nullable=False, server_default="machine"),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            sa.Column("capacity_hours_per_day", sa.Float(), nullable=False, server_default="8"),
            sa.Column("hourly_rate", sa.Float(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="active"),
            sa.Column("description", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_production_workstations_code", "production_workstations", ["code"], unique=True)

    if "production_boms" not in existing:
        op.create_table(
            "production_boms",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bom_number", sa.String(length=50), nullable=False),
            sa.Column("product_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("base_quantity", sa.Float(), nullable=False, server_default="1"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("activated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_production_boms_bom_number", "production_boms", ["bom_number"], unique=True)
        op.create_index("ix_production_boms_product_item_id", "production_boms", ["product_item_id"])

    if "production_bom_items" not in existing:
        op.create_table(
            "production_bom_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("production_boms.id"), nullable=False),
            sa.Column("component_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("scrap_percent", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            *_timestamps(),
        )
        op.create_index("ix_production_bom_items_bom_id", "production_bom_items", ["bom_id"])

    if "production_bom_operations" not in existing:
        op.create_table(
            "production_bom_operations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("production_boms.id"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("operation_name", sa.String(length=150), nullable=False),
            sa.Column("workstation_id", sa.Integer(), sa.ForeignKey("production_workstations.id"), nullable=True),
            sa.Column("setup_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("run_hours_per_unit", sa.Float(), nullable=False, server_default="0"),
            sa.Column("requires_inspection", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("instructions", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_production_bom_operations_bom_id", "production_bom_operations", ["bom_id"])

    if "production_work_orders" not in existing:
        op.create_table(
            "production_work_orders",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("wo_number", sa.String(length=50), nullable=False),
            sa.Column("product_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("production_boms.id"), nullable=False),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("quantity_planned", sa.Float(), nullable=False),
            sa.Column("quantity_completed", sa.Float(), nullable=False, server_default="0"),
            sa.Column("quantity_scrapped", sa.Float(), nullable=False, server_default="0"),
            sa.Column("priority", sa.String(length=20), nullable=False, server_default="normal"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("source_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("target_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("planned_start_date", sa.Date(), nullable=True),
            sa.Column("planned_end_date", sa.Date(), nullable=True),
            sa.Column("actual_start_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("actual_end_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("supervisor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_production_work_orders_wo_number", "production_work_orders", ["wo_number"], unique=True)
        op.create_index("ix_production_work_orders_product_item_id", "production_work_orders", ["product_item_id"])
        op.create_index("ix_production_work_orders_erp_project_id", "production_work_orders", ["erp_project_id"])
        op.create_index("ix_production_work_orders_status", "production_work_orders", ["status"])

    if "production_work_order_materials" not in existing:
        op.create_table(
            "production_work_order_materials",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("required_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("issued_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("returned_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_production_work_order_materials_work_order_id", "production_work_order_materials", ["work_order_id"])

    if "production_work_order_operations" not in existing:
        op.create_table(
            "production_work_order_operations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("operation_name", sa.String(length=150), nullable=False),
            sa.Column("workstation_id", sa.Integer(), sa.ForeignKey("production_workstations.id"), nullable=True),
            sa.Column("planned_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("requires_inspection", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("qty_good", sa.Float(), nullable=False, server_default="0"),
            sa.Column("qty_scrap", sa.Float(), nullable=False, server_default="0"),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("quality_inspection_id", sa.Integer(), sa.ForeignKey("quality_inspections.id"), nullable=True),
            sa.Column("instructions", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_production_work_order_operations_work_order_id", "production_work_order_operations", ["work_order_id"])

    if "production_time_logs" not in existing:
        op.create_table(
            "production_time_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=False),
            sa.Column("operation_id", sa.Integer(), sa.ForeignKey("production_work_order_operations.id"), nullable=True),
            sa.Column("workstation_id", sa.Integer(), sa.ForeignKey("production_workstations.id"), nullable=True),
            sa.Column("operator_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("log_date", sa.Date(), nullable=False),
            sa.Column("hours", sa.Float(), nullable=False),
            sa.Column("qty_good", sa.Float(), nullable=False, server_default="0"),
            sa.Column("qty_scrap", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_production_time_logs_work_order_id", "production_time_logs", ["work_order_id"])
        op.create_index("ix_production_time_logs_operation_id", "production_time_logs", ["operation_id"])

    # Register the new app in the admin's assignable-modules checklist.
    conn = op.get_bind()
    if inspector.has_table("modules") and conn.execute(
        sa.text("SELECT 1 FROM modules WHERE key = :key"), {"key": "production"}
    ).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                "VALUES (:key, :label, :icon, :description, true, "
                "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
            ),
            {"key": "production", "label": "Production", "icon": "production",
             "description": "Workstations, BOM & routing, work orders, shop floor, planning and production reports."},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM modules WHERE key = 'production'"))
    op.drop_table("production_time_logs")
    op.drop_table("production_work_order_operations")
    op.drop_table("production_work_order_materials")
    op.drop_table("production_work_orders")
    op.drop_table("production_bom_operations")
    op.drop_table("production_bom_items")
    op.drop_table("production_boms")
    op.drop_table("production_workstations")
