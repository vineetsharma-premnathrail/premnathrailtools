"""EAM wave 2: measuring points + measuring documents (IK01/IK11), counter-
based PM plans (IP42), work permits (WCM / LOTO), PRs raised from
maintenance work orders (IW32 external services), service visits (IW41
service confirmation) and the SR SLA clock.

Revision ID: 31f14474d1f5
Revises: cb6d3cd292f9
"""
from alembic import op
import sqlalchemy as sa

revision = "31f14474d1f5"
down_revision = "cb6d3cd292f9"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _add_columns(table: str, cols: list[sa.Column]) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    todo = [c for c in cols if c.name not in existing]
    if todo:
        with op.batch_alter_table(table) as batch:
            for c in todo:
                batch.add_column(c)


def _drop_columns(table: str, names: list[str]) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    todo = [n for n in names if n in existing]
    if todo:
        with op.batch_alter_table(table) as batch:
            for n in todo:
                batch.drop_column(n)


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "maintenance_measuring_points" not in existing:
        op.create_table(
            "maintenance_measuring_points",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("unit", sa.String(20), nullable=False),
            sa.Column("is_counter", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("lower_limit", sa.Float(), nullable=True),
            sa.Column("upper_limit", sa.Float(), nullable=True),
            sa.Column("target_value", sa.Float(), nullable=True),
            sa.Column("current_reading", sa.Float(), nullable=True),
            sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_maintenance_measuring_points_asset_id", "maintenance_measuring_points", ["asset_id"])

    if "maintenance_measurement_docs" not in existing:
        op.create_table(
            "maintenance_measurement_docs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("measuring_point_id", sa.Integer(), sa.ForeignKey("maintenance_measuring_points.id", ondelete="CASCADE"), nullable=True),
            sa.Column("reading", sa.Float(), nullable=False),
            sa.Column("previous_reading", sa.Float(), nullable=True),
            sa.Column("difference", sa.Float(), nullable=True),
            sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("read_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("maintenance_work_orders.id"), nullable=True),
            sa.Column("limit_breach", sa.String(10), nullable=True),
            sa.Column("request_id", sa.Integer(), sa.ForeignKey("maintenance_requests.id"), nullable=True),
            sa.Column("override_reason", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_ts(),
        )
        for col in ("asset_id", "measuring_point_id", "read_at"):
            op.create_index(f"ix_maintenance_measurement_docs_{col}", "maintenance_measurement_docs", [col])

    if "maintenance_work_permits" not in existing:
        op.create_table(
            "maintenance_work_permits",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("permit_number", sa.String(50), nullable=False),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("permit_type", sa.String(30), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="issued"),
            sa.Column("work_description", sa.Text(), nullable=True),
            sa.Column("hazards", sa.Text(), nullable=True),
            sa.Column("isolation_points", sa.Text(), nullable=True),
            sa.Column("precautions", sa.Text(), nullable=True),
            sa.Column("ppe_required", sa.Text(), nullable=True),
            sa.Column("issued_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True),
            sa.Column("valid_to", sa.DateTime(timezone=True), nullable=False),
            sa.Column("accepted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("isolation_removed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("close_remarks", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("document_revision", sa.Integer(), nullable=False, server_default="0"),
            *_ts(),
        )
        op.create_index("ix_maintenance_work_permits_permit_number", "maintenance_work_permits", ["permit_number"], unique=True)
        op.create_index("ix_maintenance_work_permits_work_order_id", "maintenance_work_permits", ["work_order_id"])

    if "maintenance_wo_purchase_requests" not in existing:
        op.create_table(
            "maintenance_wo_purchase_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("p2p_request_id", sa.Integer(), sa.ForeignKey("p2p_requests.id"), nullable=False),
            sa.Column("purpose", sa.String(20), nullable=False, server_default="spares"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("p2p_request_id", name="uq_maintenance_wo_pr_request"),
        )
        op.create_index("ix_maintenance_wo_purchase_requests_work_order_id", "maintenance_wo_purchase_requests", ["work_order_id"])

    if "erp_service_visits" not in existing:
        op.create_table(
            "erp_service_visits",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("service_request_id", sa.Integer(), sa.ForeignKey("erp_service_requests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("engineer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("visit_date", sa.Date(), nullable=False),
            sa.Column("travel_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("arrive_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("depart_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("work_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("travel_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("km", sa.Float(), nullable=False, server_default="0"),
            sa.Column("travel_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("stay_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("misc_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("work_done", sa.Text(), nullable=False),
            sa.Column("customer_sign_name", sa.String(255), nullable=True),
            sa.Column("customer_signed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("customer_remarks", sa.Text(), nullable=True),
            sa.Column("report_attachment_id", sa.Integer(),
                      sa.ForeignKey("erp_service_request_attachments.id", ondelete="SET NULL"), nullable=True),
            sa.Column("document_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_erp_service_visits_service_request_id", "erp_service_visits", ["service_request_id"])
        op.create_index("ix_erp_service_visits_engineer_id", "erp_service_visits", ["engineer_id"])

    _add_columns("maintenance_pm_plans", [
        sa.Column("last_done_meter", sa.Float(), nullable=True),
        sa.Column("next_due_meter", sa.Float(), nullable=True),
        sa.Column("lead_meter", sa.Float(), nullable=True),
    ])
    _add_columns("maintenance_work_orders", [
        sa.Column("procured_cost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("permit_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("meter_reading_at_completion", sa.Float(), nullable=True),
        sa.Column("pm_trigger", sa.String(10), nullable=True),
    ])
    _add_columns("erp_service_requests", [
        sa.Column("sla_profile", sa.String(30), nullable=True),
        sa.Column("sla_response_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sla_resolution_due_at", sa.DateTime(timezone=True), nullable=True),
    ])


def downgrade() -> None:
    _drop_columns("erp_service_requests", ["sla_profile", "sla_response_due_at", "sla_resolution_due_at"])
    _drop_columns("maintenance_work_orders", ["procured_cost", "permit_required", "meter_reading_at_completion", "pm_trigger"])
    _drop_columns("maintenance_pm_plans", ["last_done_meter", "next_due_meter", "lead_meter"])
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ("erp_service_visits", "maintenance_wo_purchase_requests", "maintenance_work_permits",
                  "maintenance_measurement_docs", "maintenance_measuring_points"):
        if table in existing:
            op.drop_table(table)
