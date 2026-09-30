"""add maintenance module (assets, requests, work orders + tasks / spares /
labour, attachments)

Phase 1 of docs/02-modules/maintenance/plan.md — breakdown maintenance.
Also registers the "maintenance" app in the admin's assignable-modules
checklist.

Revision ID: 9b88b67d6fcb
Revises: b8e2d4f6a1c3
Create Date: 2026-09-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "9b88b67d6fcb"
down_revision = "b8e2d4f6a1c3"
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

    if "maintenance_assets" not in tables:
        op.create_table(
            "maintenance_assets",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("asset_code", sa.String(length=50), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("category", sa.String(length=30), nullable=False, server_default="production_machine"),
            sa.Column("parent_asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id"), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=False),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            sa.Column("location_text", sa.String(length=200), nullable=True),
            sa.Column("workstation_id", sa.Integer(), sa.ForeignKey("production_workstations.id"), nullable=True),
            sa.Column("make", sa.String(length=100), nullable=True),
            sa.Column("model", sa.String(length=100), nullable=True),
            sa.Column("serial_number", sa.String(length=100), nullable=True),
            sa.Column("year_of_manufacture", sa.Integer(), nullable=True),
            sa.Column("supplier_vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("purchase_date", sa.Date(), nullable=True),
            sa.Column("purchase_cost", sa.Float(), nullable=True),
            sa.Column("warranty_expiry", sa.Date(), nullable=True),
            sa.Column("amc_vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("amc_expiry", sa.Date(), nullable=True),
            sa.Column("criticality", sa.String(length=1), nullable=False, server_default="B"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="operational"),
            sa.Column("meter_unit", sa.String(length=20), nullable=True),
            sa.Column("current_meter_reading", sa.Float(), nullable=True),
            sa.Column("meter_updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("commissioned_on", sa.Date(), nullable=True),
            sa.Column("decommissioned_on", sa.Date(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("asset_code", name="uq_maintenance_assets_asset_code"),
            sa.UniqueConstraint("workstation_id", name="uq_maintenance_assets_workstation_id"),
        )
        op.create_index("ix_maintenance_assets_asset_code", "maintenance_assets", ["asset_code"])
        op.create_index("ix_maintenance_assets_branch_id", "maintenance_assets", ["branch_id"])

    if "maintenance_requests" not in tables:
        op.create_table(
            "maintenance_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("request_number", sa.String(length=50), nullable=False),
            sa.Column("asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id"), nullable=False),
            sa.Column("request_type", sa.String(length=20), nullable=False, server_default="breakdown"),
            sa.Column("machine_down", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("problem_description", sa.Text(), nullable=False),
            sa.Column("priority", sa.String(length=10), nullable=False, server_default="normal"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("raised_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("acknowledged_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rejection_reason", sa.Text(), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint("request_number", name="uq_maintenance_requests_request_number"),
        )
        op.create_index("ix_maintenance_requests_request_number", "maintenance_requests", ["request_number"])
        op.create_index("ix_maintenance_requests_asset_id", "maintenance_requests", ["asset_id"])

    if "maintenance_work_orders" not in tables:
        op.create_table(
            "maintenance_work_orders",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("wo_number", sa.String(length=50), nullable=False),
            sa.Column("asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id"), nullable=False),
            sa.Column("request_id", sa.Integer(), sa.ForeignKey("maintenance_requests.id"), nullable=True),
            sa.Column("wo_type", sa.String(length=20), nullable=False, server_default="breakdown"),
            sa.Column("priority", sa.String(length=10), nullable=False, server_default="normal"),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("machine_down", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("planned_start", sa.Date(), nullable=True),
            sa.Column("planned_end", sa.Date(), nullable=True),
            sa.Column("estimated_hours", sa.Float(), nullable=True),
            sa.Column("actual_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("actual_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("downtime_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("downtime_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("downtime_minutes", sa.Integer(), nullable=True),
            sa.Column("failure_category", sa.String(length=30), nullable=True),
            sa.Column("root_cause", sa.Text(), nullable=True),
            sa.Column("action_taken", sa.Text(), nullable=True),
            sa.Column("hold_reason", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("external_vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("external_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("labour_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("spares_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("requester_confirmed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("requester_comment", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("verified_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint("wo_number", name="uq_maintenance_work_orders_wo_number"),
        )
        op.create_index("ix_maintenance_work_orders_wo_number", "maintenance_work_orders", ["wo_number"])
        op.create_index("ix_maintenance_work_orders_asset_id", "maintenance_work_orders", ["asset_id"])

    if "maintenance_work_order_tasks" not in tables:
        op.create_table(
            "maintenance_work_order_tasks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("description", sa.String(length=500), nullable=False),
            sa.Column("expected_value", sa.String(length=100), nullable=True),
            sa.Column("result", sa.String(length=10), nullable=True),
            sa.Column("measured_value", sa.String(length=100), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("done_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_maintenance_work_order_tasks_work_order_id", "maintenance_work_order_tasks", ["work_order_id"])

    if "maintenance_work_order_spares" not in tables:
        op.create_table(
            "maintenance_work_order_spares",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("qty_planned", sa.Float(), nullable=False, server_default="0"),
            sa.Column("qty_issued", sa.Float(), nullable=False, server_default="0"),
            sa.Column("qty_returned", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_maintenance_work_order_spares_work_order_id", "maintenance_work_order_spares", ["work_order_id"])

    if "maintenance_labour_logs" not in tables:
        op.create_table(
            "maintenance_labour_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("technician_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
            sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
            sa.Column("hours", sa.Float(), nullable=False),
            sa.Column("hourly_rate", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_maintenance_labour_logs_work_order_id", "maintenance_labour_logs", ["work_order_id"])

    if "maintenance_attachments" not in tables:
        op.create_table(
            "maintenance_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entity_type", sa.String(length=20), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("doc_type", sa.String(length=20), nullable=False, server_default="other"),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=True),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_name", sa.String(length=150), nullable=True),
            *_timestamps(),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_maintenance_attachments_entity_type", "maintenance_attachments", ["entity_type"])
        op.create_index("ix_maintenance_attachments_entity_id", "maintenance_attachments", ["entity_id"])

    # Register the new app in the admin's assignable-modules checklist.
    conn = op.get_bind()
    if inspector.has_table("modules") and conn.execute(
        sa.text("SELECT 1 FROM modules WHERE key = :key"), {"key": "maintenance"}
    ).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                "VALUES (:key, :label, :icon, :description, true, "
                "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
            ),
            {"key": "maintenance", "label": "Maintenance", "icon": "maintenance",
             "description": "Plant equipment register, breakdown requests, maintenance work orders, spares and downtime."},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM modules WHERE key = 'maintenance'"))
    op.drop_table("maintenance_attachments")
    op.drop_table("maintenance_labour_logs")
    op.drop_table("maintenance_work_order_spares")
    op.drop_table("maintenance_work_order_tasks")
    op.drop_table("maintenance_work_orders")
    op.drop_table("maintenance_requests")
    op.drop_table("maintenance_assets")
