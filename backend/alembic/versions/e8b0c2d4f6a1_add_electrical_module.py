"""add electrical module (RRV electrical jobs, stages, BOM, panels, cables,
drawings + revisions, tests, issues, documents)

New `electrical_*` tables for the RRV electrical creation scope. The old
`electrical_work_orders` table (d6f0a2b8c4e9) was dropped by ae88c635814e
and the "electrical" modules-registry row by d8a1c3e5f7b9 — neither name is
reused here except the registry key, which is re-registered so admins can
assign the app again.

Revision ID: e8b0c2d4f6a1
Revises: d4f6a8c0e2b5
Create Date: 2026-09-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e8b0c2d4f6a1'
down_revision = 'd4f6a8c0e2b5'
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


def _file_columns() -> list[sa.Column]:
    return [
        sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
        sa.Column("sharepoint_url", sa.String(length=2000), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("mime_type", sa.String(length=150), nullable=True),
    ]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = set(inspector.get_table_names())

    if "electrical_jobs" not in existing:
        op.create_table(
            "electrical_jobs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_number", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("rrv_model", sa.String(length=150), nullable=True),
            sa.Column("vehicle_number", sa.String(length=100), nullable=True),
            sa.Column("customer_name", sa.String(length=255), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("lead_engineer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("priority", sa.String(length=20), nullable=False, server_default="normal"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("planned_start_date", sa.Date(), nullable=True),
            sa.Column("target_handover_date", sa.Date(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("system_voltage", sa.String(length=50), nullable=True),
            sa.Column("battery_spec", sa.String(length=255), nullable=True),
            sa.Column("alternator_spec", sa.String(length=255), nullable=True),
            sa.Column("applicable_standards", sa.String(length=500), nullable=True),
            sa.Column("customer_spec_ref", sa.String(length=255), nullable=True),
            sa.Column("requirement_notes", sa.Text(), nullable=True),
            sa.Column("quality_inspection_id", sa.Integer(), sa.ForeignKey("quality_inspections.id"), nullable=True),
            sa.Column("commissioning_location", sa.String(length=255), nullable=True),
            sa.Column("commissioned_on", sa.Date(), nullable=True),
            sa.Column("handover_to_name", sa.String(length=150), nullable=True),
            sa.Column("handover_to_organization", sa.String(length=255), nullable=True),
            sa.Column("handover_date", sa.Date(), nullable=True),
            sa.Column("handover_remarks", sa.Text(), nullable=True),
            sa.Column("handed_over_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("hold_reason", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_jobs_job_number", "electrical_jobs", ["job_number"], unique=True)
        op.create_index("ix_electrical_jobs_erp_project_id", "electrical_jobs", ["erp_project_id"])
        op.create_index("ix_electrical_jobs_lead_engineer_id", "electrical_jobs", ["lead_engineer_id"])
        op.create_index("ix_electrical_jobs_status", "electrical_jobs", ["status"])

    if "electrical_job_stages" not in existing:
        op.create_table(
            "electrical_job_stages",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.Integer(), sa.ForeignKey("electrical_jobs.id"), nullable=False),
            sa.Column("stage_key", sa.String(length=40), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="not_started"),
            sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("planned_start_date", sa.Date(), nullable=True),
            sa.Column("planned_end_date", sa.Date(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint("job_id", "stage_key", name="uq_electrical_job_stage"),
        )
        op.create_index("ix_electrical_job_stages_job_id", "electrical_job_stages", ["job_id"])
        op.create_index("ix_electrical_job_stages_assignee_id", "electrical_job_stages", ["assignee_id"])

    if "electrical_panels" not in existing:
        op.create_table(
            "electrical_panels",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.Integer(), sa.ForeignKey("electrical_jobs.id"), nullable=False),
            sa.Column("panel_tag", sa.String(length=50), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("panel_type", sa.String(length=30), nullable=False, server_default="control"),
            sa.Column("location_on_vehicle", sa.String(length=150), nullable=True),
            sa.Column("enclosure_material", sa.String(length=100), nullable=True),
            sa.Column("ip_rating", sa.String(length=20), nullable=True),
            sa.Column("dimensions", sa.String(length=100), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="designed"),
            sa.Column("assembled_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("assembled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_panels_job_id", "electrical_panels", ["job_id"])

    if "electrical_bom_items" not in existing:
        op.create_table(
            "electrical_bom_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.Integer(), sa.ForeignKey("electrical_jobs.id"), nullable=False),
            sa.Column("line_no", sa.Integer(), nullable=False),
            sa.Column("category", sa.String(length=30), nullable=False, server_default="other"),
            sa.Column("description", sa.String(length=255), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("make", sa.String(length=150), nullable=True),
            sa.Column("part_number", sa.String(length=150), nullable=True),
            sa.Column("rating", sa.String(length=150), nullable=True),
            sa.Column("specification", sa.Text(), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="1"),
            sa.Column("uom", sa.String(length=20), nullable=False, server_default="NOS"),
            sa.Column("estimated_unit_cost", sa.Float(), nullable=True),
            sa.Column("panel_id", sa.Integer(), sa.ForeignKey("electrical_panels.id"), nullable=True),
            sa.Column("selection_status", sa.String(length=20), nullable=False, server_default="proposed"),
            sa.Column("procurement_status", sa.String(length=20), nullable=False, server_default="required"),
            sa.Column("p2p_request_id", sa.Integer(), sa.ForeignKey("p2p_requests.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_bom_items_job_id", "electrical_bom_items", ["job_id"])
        op.create_index("ix_electrical_bom_items_p2p_request_id", "electrical_bom_items", ["p2p_request_id"])

    if "electrical_cables" not in existing:
        op.create_table(
            "electrical_cables",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.Integer(), sa.ForeignKey("electrical_jobs.id"), nullable=False),
            sa.Column("cable_tag", sa.String(length=50), nullable=False),
            sa.Column("circuit", sa.String(length=150), nullable=True),
            sa.Column("from_point", sa.String(length=150), nullable=False),
            sa.Column("to_point", sa.String(length=150), nullable=False),
            sa.Column("cable_type", sa.String(length=100), nullable=True),
            sa.Column("cores", sa.Integer(), nullable=True),
            sa.Column("size_sqmm", sa.Float(), nullable=True),
            sa.Column("length_m", sa.Float(), nullable=True),
            sa.Column("voltage_rating", sa.String(length=50), nullable=True),
            sa.Column("color_code", sa.String(length=50), nullable=True),
            sa.Column("harness_ref", sa.String(length=50), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="designed"),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_cables_job_id", "electrical_cables", ["job_id"])

    if "electrical_drawings" not in existing:
        op.create_table(
            "electrical_drawings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.Integer(), sa.ForeignKey("electrical_jobs.id"), nullable=False),
            sa.Column("drawing_number", sa.String(length=80), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("drawing_type", sa.String(length=30), nullable=False, server_default="schematic"),
            sa.Column("is_as_built", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_drawings_job_id", "electrical_drawings", ["job_id"])
        op.create_index("ix_electrical_drawings_drawing_number", "electrical_drawings", ["drawing_number"])

    if "electrical_drawing_revisions" not in existing:
        op.create_table(
            "electrical_drawing_revisions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("drawing_id", sa.Integer(), sa.ForeignKey("electrical_drawings.id"), nullable=False),
            sa.Column("revision_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("revision_label", sa.String(length=10), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("change_summary", sa.Text(), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=True),
            *_file_columns(),
            sa.Column("prepared_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_comment", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_drawing_revisions_drawing_id", "electrical_drawing_revisions", ["drawing_id"])
        op.create_index("ix_electrical_drawing_revisions_status", "electrical_drawing_revisions", ["status"])

    if "electrical_tests" not in existing:
        op.create_table(
            "electrical_tests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.Integer(), sa.ForeignKey("electrical_jobs.id"), nullable=False),
            sa.Column("test_number", sa.String(length=30), nullable=False),
            sa.Column("phase", sa.String(length=20), nullable=False, server_default="factory"),
            sa.Column("test_type", sa.String(length=30), nullable=False),
            sa.Column("circuit", sa.String(length=150), nullable=True),
            sa.Column("panel_id", sa.Integer(), sa.ForeignKey("electrical_panels.id"), nullable=True),
            sa.Column("cable_id", sa.Integer(), sa.ForeignKey("electrical_cables.id"), nullable=True),
            sa.Column("instrument", sa.String(length=150), nullable=True),
            sa.Column("expected_value", sa.String(length=100), nullable=True),
            sa.Column("measured_value", sa.String(length=100), nullable=True),
            sa.Column("unit", sa.String(length=20), nullable=True),
            sa.Column("result", sa.String(length=10), nullable=False),
            sa.Column("test_date", sa.Date(), nullable=False),
            sa.Column("tested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("retest_of_id", sa.Integer(), sa.ForeignKey("electrical_tests.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_tests_job_id", "electrical_tests", ["job_id"])
        op.create_index("ix_electrical_tests_retest_of_id", "electrical_tests", ["retest_of_id"])

    if "electrical_issues" not in existing:
        op.create_table(
            "electrical_issues",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.Integer(), sa.ForeignKey("electrical_jobs.id"), nullable=False),
            sa.Column("issue_number", sa.String(length=30), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("symptom", sa.Text(), nullable=True),
            sa.Column("severity", sa.String(length=20), nullable=False, server_default="major"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("test_id", sa.Integer(), sa.ForeignKey("electrical_tests.id"), nullable=True),
            sa.Column("panel_id", sa.Integer(), sa.ForeignKey("electrical_panels.id"), nullable=True),
            sa.Column("cable_id", sa.Integer(), sa.ForeignKey("electrical_cables.id"), nullable=True),
            sa.Column("root_cause", sa.Text(), nullable=True),
            sa.Column("corrective_action", sa.Text(), nullable=True),
            sa.Column("reported_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("resolved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_issues_job_id", "electrical_issues", ["job_id"])
        op.create_index("ix_electrical_issues_status", "electrical_issues", ["status"])
        op.create_index("ix_electrical_issues_assigned_to_id", "electrical_issues", ["assigned_to_id"])

    if "electrical_documents" not in existing:
        op.create_table(
            "electrical_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.Integer(), sa.ForeignKey("electrical_jobs.id"), nullable=False),
            sa.Column("stage_key", sa.String(length=40), nullable=True),
            sa.Column("category", sa.String(length=30), nullable=False, server_default="other"),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            *_file_columns(),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_electrical_documents_job_id", "electrical_documents", ["job_id"])

    # Register the app in the admin's assignable-modules checklist.
    conn = op.get_bind()
    if inspector.has_table("modules") and conn.execute(
        sa.text("SELECT 1 FROM modules WHERE key = :key"), {"key": "electrical"}
    ).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                "VALUES (:key, :label, :icon, :description, true, "
                "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
            ),
            {"key": "electrical", "label": "Electrical", "icon": "electrical",
             "description": "RRV electrical creation: requirement, design, BOM, wiring, panels, testing, QC, commissioning and handover."},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM modules WHERE key = 'electrical'"))
    op.drop_table("electrical_documents")
    op.drop_table("electrical_issues")
    op.drop_table("electrical_tests")
    op.drop_table("electrical_drawing_revisions")
    op.drop_table("electrical_drawings")
    op.drop_table("electrical_cables")
    op.drop_table("electrical_bom_items")
    op.drop_table("electrical_panels")
    op.drop_table("electrical_job_stages")
    op.drop_table("electrical_jobs")
