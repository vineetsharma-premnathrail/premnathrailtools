"""add quality module phase1

Revision ID: 1da47fa70f0e
Revises: d1f9f0541e2a
Create Date: 2026-09-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "1da47fa70f0e"
down_revision = "d1f9f0541e2a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "quality_standards" not in tables:
        op.create_table(
            "quality_standards",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("standard_code", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("effective_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("standard_code", name="uq_quality_standards_standard_code"),
        )
        op.create_index("ix_quality_standards_standard_code", "quality_standards", ["standard_code"])

    if "quality_checklists" not in tables:
        op.create_table(
            "quality_checklists",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "quality_checklist_items" not in tables:
        op.create_table(
            "quality_checklist_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("checklist_id", sa.Integer(), sa.ForeignKey("quality_checklists.id"), nullable=False),
            sa.Column("parameter", sa.String(length=255), nullable=False),
            sa.Column("method", sa.String(length=255), nullable=True),
            sa.Column("acceptance_criteria", sa.Text(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_quality_checklist_items_checklist_id", "quality_checklist_items", ["checklist_id"])

    if "quality_inspection_plans" not in tables:
        op.create_table(
            "quality_inspection_plans",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("plan_number", sa.String(length=50), nullable=False),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("item_code", sa.String(length=100), nullable=True),
            sa.Column("inspection_type", sa.String(length=20), nullable=False),
            sa.Column("checklist_id", sa.Integer(), sa.ForeignKey("quality_checklists.id"), nullable=True),
            sa.Column("standard_id", sa.Integer(), sa.ForeignKey("quality_standards.id"), nullable=True),
            sa.Column("sampling_plan", sa.String(length=255), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("plan_number", name="uq_quality_inspection_plans_plan_number"),
        )
        op.create_index("ix_quality_inspection_plans_plan_number", "quality_inspection_plans", ["plan_number"])

    if "quality_inspections" not in tables:
        op.create_table(
            "quality_inspections",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("inspection_number", sa.String(length=50), nullable=False),
            sa.Column("inspection_type", sa.String(length=20), nullable=False),
            sa.Column("inspection_plan_id", sa.Integer(), sa.ForeignKey("quality_inspection_plans.id"), nullable=True),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("item_code", sa.String(length=100), nullable=True),
            sa.Column("batch_number", sa.String(length=100), nullable=True),
            sa.Column("quantity_inspected", sa.Float(), nullable=True),
            sa.Column("quantity_accepted", sa.Float(), nullable=True),
            sa.Column("quantity_rejected", sa.Float(), nullable=True),
            sa.Column("vendor_id", sa.Integer(), nullable=True),
            sa.Column("vendor_name", sa.String(length=255), nullable=True),
            sa.Column("p2p_request_id", sa.Integer(), sa.ForeignKey("p2p_requests.id"), nullable=True),
            sa.Column("project_label", sa.String(length=255), nullable=True),
            sa.Column("inspected_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("inspection_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("inspection_number", name="uq_quality_inspections_inspection_number"),
        )
        op.create_index("ix_quality_inspections_inspection_number", "quality_inspections", ["inspection_number"])

    if "quality_inspection_results" not in tables:
        op.create_table(
            "quality_inspection_results",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("inspection_id", sa.Integer(), sa.ForeignKey("quality_inspections.id"), nullable=False),
            sa.Column("parameter", sa.String(length=255), nullable=False),
            sa.Column("method", sa.String(length=255), nullable=True),
            sa.Column("acceptance_criteria", sa.Text(), nullable=True),
            sa.Column("observed_value", sa.String(length=255), nullable=True),
            sa.Column("result", sa.String(length=10), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_quality_inspection_results_inspection_id", "quality_inspection_results", ["inspection_id"])

    if "quality_inspection_attachments" not in tables:
        op.create_table(
            "quality_inspection_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("inspection_id", sa.Integer(), sa.ForeignKey("quality_inspections.id"), nullable=False),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("file_path", sa.String(length=500), nullable=False),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_quality_inspection_attachments_inspection_id", "quality_inspection_attachments", ["inspection_id"])


def downgrade() -> None:
    op.drop_table("quality_inspection_attachments")
    op.drop_table("quality_inspection_results")
    op.drop_table("quality_inspections")
    op.drop_table("quality_inspection_plans")
    op.drop_table("quality_checklist_items")
    op.drop_table("quality_checklists")
    op.drop_table("quality_standards")
