"""add production RRV builds (vehicle build record, stages, vehicle tests, rework orders, timeline)

One `production_rrv_builds` row per Rail-cum-Road Vehicle, plus its seeded
stage checklist, vehicle tests, rework orders and event timeline; and
`production_work_orders.rrv_build_id` / `build_role` so a build's main and
sub-assembly work orders hang off it. See docs/02-modules/production/rrv-build.md.

Revision ID: f1b3d5e7a9c2
Revises: a7c9e1b3d5f0
Create Date: 2026-09-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f1b3d5e7a9c2'
down_revision = 'a7c9e1b3d5f0'
branch_labels = None
depends_on = None

RRV_TABLES = (
    "production_rrv_builds",
    "production_rrv_build_stages",
    "production_rrv_tests",
    "production_rework_orders",
    "production_rrv_events",
)


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


def _user(name: str) -> sa.Column:
    return sa.Column(name, sa.Integer(), sa.ForeignKey("users.id"), nullable=True)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = set(inspector.get_table_names())

    if "production_rrv_builds" not in existing:
        op.create_table(
            "production_rrv_builds",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("build_number", sa.String(length=50), nullable=False),
            sa.Column("rrv_model", sa.String(length=200), nullable=False),
            sa.Column("customer_name", sa.String(length=255), nullable=True),
            sa.Column("customer_po_number", sa.String(length=100), nullable=True),
            sa.Column("customer_po_date", sa.Date(), nullable=True),
            sa.Column("order_reference", sa.String(length=150), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("vehicle_serial_number", sa.String(length=100), nullable=True),
            sa.Column("chassis_number", sa.String(length=100), nullable=True),
            sa.Column("engine_number", sa.String(length=100), nullable=True),
            sa.Column("year_of_manufacture", sa.String(length=10), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            _user("build_manager_id"),
            sa.Column("priority", sa.String(length=20), nullable=False, server_default="normal"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="planned"),
            sa.Column("planned_start_date", sa.Date(), nullable=True),
            sa.Column("target_completion_date", sa.Date(), nullable=True),
            sa.Column("target_handover_date", sa.Date(), nullable=True),
            sa.Column("actual_start_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            _user("completed_by_id"),
            sa.Column("required_tests", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("final_inspection_id", sa.Integer(), sa.ForeignKey("quality_inspections.id"), nullable=True),
            sa.Column("handover_date", sa.Date(), nullable=True),
            sa.Column("commissioning_date", sa.Date(), nullable=True),
            sa.Column("handed_over_to_name", sa.String(length=200), nullable=True),
            sa.Column("handed_over_to_organization", sa.String(length=255), nullable=True),
            sa.Column("handover_location", sa.String(length=255), nullable=True),
            sa.Column("customer_acceptance_ref", sa.String(length=150), nullable=True),
            sa.Column("warranty_months", sa.Integer(), nullable=False, server_default="12"),
            sa.Column("handover_remarks", sa.Text(), nullable=True),
            sa.Column("handed_over_at", sa.DateTime(timezone=True), nullable=True),
            _user("handed_over_by_id"),
            sa.Column("hold_reason", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            _user("created_by_id"),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_production_rrv_builds_build_number", "production_rrv_builds", ["build_number"], unique=True)
        op.create_index("ix_production_rrv_builds_erp_project_id", "production_rrv_builds", ["erp_project_id"])
        op.create_index("ix_production_rrv_builds_build_manager_id", "production_rrv_builds", ["build_manager_id"])
        op.create_index("ix_production_rrv_builds_status", "production_rrv_builds", ["status"])

    if "production_rrv_build_stages" not in existing:
        op.create_table(
            "production_rrv_build_stages",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("build_id", sa.Integer(), sa.ForeignKey("production_rrv_builds.id"), nullable=False),
            sa.Column("stage_key", sa.String(length=40), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="not_started"),
            _user("assignee_id"),
            sa.Column("planned_start_date", sa.Date(), nullable=True),
            sa.Column("planned_end_date", sa.Date(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            _user("completed_by_id"),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint("build_id", "stage_key", name="uq_production_rrv_build_stage"),
        )
        op.create_index("ix_production_rrv_build_stages_build_id", "production_rrv_build_stages", ["build_id"])

    if "production_rrv_tests" not in existing:
        op.create_table(
            "production_rrv_tests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("build_id", sa.Integer(), sa.ForeignKey("production_rrv_builds.id"), nullable=False),
            sa.Column("test_type", sa.String(length=40), nullable=False),
            sa.Column("test_date", sa.Date(), nullable=False),
            sa.Column("result", sa.String(length=10), nullable=False),
            sa.Column("expected", sa.Text(), nullable=True),
            sa.Column("observed", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            _user("tested_by_id"),
            sa.Column("witnessed_by", sa.String(length=255), nullable=True),
            sa.Column("retest_of_id", sa.Integer(), sa.ForeignKey("production_rrv_tests.id"), nullable=True),
            _user("created_by_id"),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_production_rrv_tests_build_id", "production_rrv_tests", ["build_id"])

    if "production_rework_orders" not in existing:
        op.create_table(
            "production_rework_orders",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("rework_number", sa.String(length=50), nullable=False),
            sa.Column("build_id", sa.Integer(), sa.ForeignKey("production_rrv_builds.id"), nullable=False),
            sa.Column("source", sa.String(length=30), nullable=False, server_default="internal"),
            sa.Column("source_test_id", sa.Integer(), sa.ForeignKey("production_rrv_tests.id"), nullable=True),
            sa.Column("quality_inspection_id", sa.Integer(), sa.ForeignKey("quality_inspections.id"), nullable=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=True),
            sa.Column("quality_ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id"), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("defect_description", sa.Text(), nullable=True),
            sa.Column("root_cause", sa.Text(), nullable=True),
            sa.Column("corrective_action", sa.Text(), nullable=True),
            _user("assigned_to_id"),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("hours_spent", sa.Float(), nullable=False, server_default="0"),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
            _user("done_by_id"),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            _user("verified_by_id"),
            sa.Column("verification_remarks", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            _user("created_by_id"),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_production_rework_orders_rework_number", "production_rework_orders", ["rework_number"], unique=True)
        op.create_index("ix_production_rework_orders_build_id", "production_rework_orders", ["build_id"])
        op.create_index("ix_production_rework_orders_quality_inspection_id", "production_rework_orders", ["quality_inspection_id"])
        op.create_index("ix_production_rework_orders_status", "production_rework_orders", ["status"])

    if "production_rrv_events" not in existing:
        op.create_table(
            "production_rrv_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("build_id", sa.Integer(), sa.ForeignKey("production_rrv_builds.id"), nullable=False),
            sa.Column("action", sa.String(length=40), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            _user("actor_id"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_production_rrv_events_build_id", "production_rrv_events", ["build_id"])

    wo_columns = {c["name"] for c in inspector.get_columns("production_work_orders")}
    with op.batch_alter_table("production_work_orders") as batch:
        if "rrv_build_id" not in wo_columns:
            batch.add_column(sa.Column("rrv_build_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_production_work_orders_rrv_build_id", "production_rrv_builds", ["rrv_build_id"], ["id"])
            batch.create_index("ix_production_work_orders_rrv_build_id", ["rrv_build_id"])
        if "build_role" not in wo_columns:
            batch.add_column(sa.Column("build_role", sa.String(length=20), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    wo_columns = {c["name"] for c in inspector.get_columns("production_work_orders")}
    with op.batch_alter_table("production_work_orders") as batch:
        if "rrv_build_id" in wo_columns:
            batch.drop_index("ix_production_work_orders_rrv_build_id")
            batch.drop_constraint("fk_production_work_orders_rrv_build_id", type_="foreignkey")
            batch.drop_column("rrv_build_id")
        if "build_role" in wo_columns:
            batch.drop_column("build_role")
    existing = set(inspector.get_table_names())
    # Children first: events/rework/tests/stages reference the build; rework references tests.
    for name in ("production_rrv_events", "production_rework_orders", "production_rrv_tests", "production_rrv_build_stages", "production_rrv_builds"):
        if name in existing:
            op.drop_table(name)
