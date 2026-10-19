"""design module phases 1-4: requests, BOMs, customer submissions, ECR,
ECN effectivity/acknowledgements, library, checklists, settings

Adds the tables for the rest of the Design Department Module Plan
(2026-10-06) on top of d4f6a8c0e2b5's document control, plus new columns
on design_documents / design_document_revisions / design_change_notices /
design_events. Every create/add is guarded so a partially-applied run can
be re-run.

Revision ID: 3b7d9e1f5a2c
Revises: e4a7c1d9b2f3
Create Date: 2026-10-06 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "3b7d9e1f5a2c"
down_revision = "e4a7c1d9b2f3"
branch_labels = None
depends_on = None

JSONList = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

NEW_TABLES = (
    "design_settings", "design_team_members", "design_standards", "design_requests", "design_requirement_revisions",
    "design_checklists", "design_checklist_items", "design_boms", "design_bom_revisions", "design_bom_lines",
    "design_item_approved_makes", "design_standard_parts", "design_templates", "design_customer_submissions",
    "design_submission_lines", "design_submission_comments", "design_change_requests", "design_change_request_items",
    "design_ecr_votes", "design_change_notice_boms", "design_ecn_acknowledgements", "design_task_deliverables",
    "design_review_results",
)

# (table, column, indexed) added to existing tables, after the new tables they point at.
NEW_COLUMNS = (
    ("design_documents", sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=True), True),
    ("design_documents", sa.Column("customer_approval_required", sa.Boolean(), nullable=False, server_default=sa.false()), False),
    ("design_documents", sa.Column("standard_id", sa.Integer(), sa.ForeignKey("design_standards.id"), nullable=True), False),
    ("design_documents", sa.Column("design_request_id", sa.Integer(), sa.ForeignKey("design_requests.id"), nullable=True), True),
    ("design_documents", sa.Column("legacy_number", sa.String(length=100), nullable=True), True),
    ("design_document_revisions", sa.Column("released_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), False),
    ("design_change_notices", sa.Column("ecr_id", sa.Integer(), sa.ForeignKey("design_change_requests.id"), nullable=True), True),
    ("design_change_notices", sa.Column("effectivity_type", sa.String(length=20), nullable=False, server_default="immediate"), False),
    ("design_change_notices", sa.Column("effectivity_date", sa.Date(), nullable=True), False),
    ("design_change_notices", sa.Column("effectivity_serial", sa.String(length=100), nullable=True), False),
    ("design_change_notices", sa.Column("effectivity_note", sa.Text(), nullable=True), False),
    ("design_change_notices", sa.Column("stock_disposition", sa.String(length=20), nullable=False, server_default="not_applicable"), False),
    ("design_change_notices", sa.Column("wip_disposition", sa.String(length=20), nullable=False, server_default="not_applicable"), False),
    ("design_change_notices", sa.Column("disposition_note", sa.Text(), nullable=True), False),
    ("design_change_notices", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True), False),
    ("design_events", sa.Column("bom_id", sa.Integer(), sa.ForeignKey("design_boms.id"), nullable=True), True),
    ("design_events", sa.Column("bom_revision_id", sa.Integer(), sa.ForeignKey("design_bom_revisions.id"), nullable=True), False),
    ("design_events", sa.Column("ecr_id", sa.Integer(), sa.ForeignKey("design_change_requests.id"), nullable=True), True),
    ("design_events", sa.Column("submission_id", sa.Integer(), sa.ForeignKey("design_customer_submissions.id"), nullable=True), True),
    ("design_events", sa.Column("request_id", sa.Integer(), sa.ForeignKey("design_requests.id"), nullable=True), True),
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


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if "design_settings" not in existing:
        op.create_table(
            "design_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("customer_response_days", sa.Integer(), nullable=False, server_default="14"),
            sa.Column("review_overdue_days", sa.Integer(), nullable=False, server_default="7"),
            sa.Column("default_approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("change_board_member_ids", JSONList, nullable=True),
            sa.Column("ecn_acknowledger_ids", JSONList, nullable=True),
            sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
    if "design_team_members" not in existing:
        op.create_table(
            "design_team_members",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("role", sa.String(length=20), nullable=False, server_default="designer"),
            *_timestamps(), sa.UniqueConstraint("user_id", name="uq_design_team_member_user"),
        )
    if "design_standards" not in existing:
        op.create_table(
            "design_standards",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("body", sa.String(length=20), nullable=False),
            sa.Column("code", sa.String(length=100), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("version", sa.String(length=50), nullable=True),
            sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=True),
            sa.Column("file_size", sa.BigInteger(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_standards_code", "design_standards", ["code"], unique=False)
    if "design_requests" not in existing:
        op.create_table(
            "design_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("request_number", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("source", sa.String(length=20), nullable=False, server_default="internal"),
            sa.Column("crm_source", sa.String(length=20), nullable=True),
            sa.Column("crm_record_id", sa.Integer(), nullable=True),
            sa.Column("crm_reference", sa.String(length=255), nullable=True),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=True),
            sa.Column("pm_project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=True),
            sa.Column("pm_milestone_id", sa.Integer(), sa.ForeignKey("pm_project_milestones.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("requirement", sa.Text(), nullable=False),
            sa.Column("requirement_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("requirement_revised_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reviewed_revision", sa.Integer(), nullable=False, server_default="-1"),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("waiting_on", sa.String(length=20), nullable=False, server_default="design"),
            sa.Column("waiting_note", sa.Text(), nullable=True),
            sa.Column("lead_designer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("close_reason", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_requests_status", "design_requests", ["status"], unique=False)
        op.create_index("ix_design_requests_lead_designer_id", "design_requests", ["lead_designer_id"], unique=False)
        op.create_index("ix_design_requests_request_number", "design_requests", ["request_number"], unique=True)
        op.create_index("ix_design_requests_pm_project_id", "design_requests", ["pm_project_id"], unique=False)
        op.create_index("ix_design_requests_pm_milestone_id", "design_requests", ["pm_milestone_id"], unique=False)
    if "design_requirement_revisions" not in existing:
        op.create_table(
            "design_requirement_revisions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("request_id", sa.Integer(), sa.ForeignKey("design_requests.id"), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("requirement", sa.Text(), nullable=False),
            sa.Column("change_note", sa.Text(), nullable=True),
            sa.Column("revised_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_design_requirement_revisions_request_id", "design_requirement_revisions", ["request_id"], unique=False)
    if "design_checklists" not in existing:
        op.create_table(
            "design_checklists",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("document_type", sa.String(length=30), nullable=False),
            sa.Column("discipline", sa.String(length=30), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_checklists_document_type", "design_checklists", ["document_type"], unique=False)
    if "design_checklist_items" not in existing:
        op.create_table(
            "design_checklist_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("checklist_id", sa.Integer(), sa.ForeignKey("design_checklists.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("text", sa.String(length=500), nullable=False),
            *_timestamps(),
        )
        op.create_index("ix_design_checklist_items_checklist_id", "design_checklist_items", ["checklist_id"], unique=False)
    if "design_boms" not in existing:
        op.create_table(
            "design_boms",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bom_number", sa.String(length=50), nullable=False),
            sa.Column("product_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=True),
            sa.Column("pm_project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("design_request_id", sa.Integer(), sa.ForeignKey("design_requests.id"), nullable=True),
            sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("obsoleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("obsolete_reason", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_boms_erp_project_id", "design_boms", ["erp_project_id"], unique=False)
        op.create_index("ix_design_boms_status", "design_boms", ["status"], unique=False)
        op.create_index("ix_design_boms_product_item_id", "design_boms", ["product_item_id"], unique=False)
        op.create_index("ix_design_boms_pm_project_id", "design_boms", ["pm_project_id"], unique=False)
        op.create_index("ix_design_boms_bom_number", "design_boms", ["bom_number"], unique=True)
        op.create_index("ix_design_boms_owner_id", "design_boms", ["owner_id"], unique=False)
    if "design_bom_revisions" not in existing:
        op.create_table(
            "design_bom_revisions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("design_boms.id"), nullable=False),
            sa.Column("revision_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("revision_label", sa.String(length=10), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("change_summary", sa.Text(), nullable=True),
            sa.Column("ecn_id", sa.Integer(), sa.ForeignKey("design_change_notices.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reviewer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reviewed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("review_comment", sa.Text(), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("approval_comment", sa.Text(), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("returned_count", sa.Integer(), nullable=False, server_default="0"),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_bom_revisions_approver_id", "design_bom_revisions", ["approver_id"], unique=False)
        op.create_index("ix_design_bom_revisions_bom_id", "design_bom_revisions", ["bom_id"], unique=False)
        op.create_index("ix_design_bom_revisions_status", "design_bom_revisions", ["status"], unique=False)
        op.create_index("ix_design_bom_revisions_reviewer_id", "design_bom_revisions", ["reviewer_id"], unique=False)
        op.create_index("uq_design_bom_revision_index", "design_bom_revisions", ["bom_id", "revision_index"], unique=True, postgresql_where=sa.text("is_deleted = false"), sqlite_where=sa.text("is_deleted = 0"))
        op.create_index("ix_design_bom_revisions_ecn_id", "design_bom_revisions", ["ecn_id"], unique=False)
    if "design_bom_lines" not in existing:
        op.create_table(
            "design_bom_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("revision_id", sa.Integer(), sa.ForeignKey("design_bom_revisions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("new_item_name", sa.String(length=255), nullable=True),
            sa.Column("new_item_spec", sa.Text(), nullable=True),
            sa.Column("new_item_requested_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="1"),
            sa.Column("uom", sa.String(length=20), nullable=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=True),
            sa.Column("document_revision_label", sa.String(length=10), nullable=True),
            sa.Column("make_buy", sa.String(length=10), nullable=False, server_default="buy"),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_design_bom_lines_document_id", "design_bom_lines", ["document_id"], unique=False)
        op.create_index("ix_design_bom_lines_store_item_id", "design_bom_lines", ["store_item_id"], unique=False)
        op.create_index("ix_design_bom_lines_revision_id", "design_bom_lines", ["revision_id"], unique=False)
    if "design_item_approved_makes" not in existing:
        op.create_table(
            "design_item_approved_makes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("make", sa.String(length=150), nullable=False),
            sa.Column("part_number", sa.String(length=150), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="approved"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_design_item_approved_makes_store_item_id", "design_item_approved_makes", ["store_item_id"], unique=False)
    if "design_standard_parts" not in existing:
        op.create_table(
            "design_standard_parts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=True),
            sa.Column("standard_id", sa.Integer(), sa.ForeignKey("design_standards.id"), nullable=True),
            sa.Column("discipline", sa.String(length=30), nullable=False, server_default="mechanical"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(), *_soft_delete(), sa.UniqueConstraint("store_item_id", name="uq_design_standard_part_item"),
        )
    if "design_templates" not in existing:
        op.create_table(
            "design_templates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("kind", sa.String(length=30), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=False),
            sa.Column("file_size", sa.BigInteger(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
    if "design_customer_submissions" not in existing:
        op.create_table(
            "design_customer_submissions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("submission_number", sa.String(length=50), nullable=False),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=True),
            sa.Column("customer_name", sa.String(length=255), nullable=False),
            sa.Column("contact_name", sa.String(length=255), nullable=True),
            sa.Column("contact_email", sa.String(length=255), nullable=True),
            sa.Column("pm_project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("cover_note", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("sent_date", sa.Date(), nullable=True),
            sa.Column("response_due_date", sa.Date(), nullable=True),
            sa.Column("response_date", sa.Date(), nullable=True),
            sa.Column("response_remarks", sa.Text(), nullable=True),
            sa.Column("letter_file_name", sa.String(length=255), nullable=True),
            sa.Column("letter_path", sa.String(length=1000), nullable=True),
            sa.Column("letter_size", sa.BigInteger(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("sent_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("recorded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_customer_submissions_status", "design_customer_submissions", ["status"], unique=False)
        op.create_index("ix_design_customer_submissions_submission_number", "design_customer_submissions", ["submission_number"], unique=True)
        op.create_index("ix_design_customer_submissions_customer_id", "design_customer_submissions", ["customer_id"], unique=False)
        op.create_index("ix_design_customer_submissions_pm_project_id", "design_customer_submissions", ["pm_project_id"], unique=False)
    if "design_submission_lines" not in existing:
        op.create_table(
            "design_submission_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("submission_id", sa.Integer(), sa.ForeignKey("design_customer_submissions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=False),
            sa.Column("revision_id", sa.Integer(), sa.ForeignKey("design_document_revisions.id"), nullable=False),
            sa.Column("response", sa.String(length=30), nullable=False, server_default="pending"),
            sa.Column("response_comment", sa.Text(), nullable=True),
            *_timestamps(), sa.UniqueConstraint("submission_id", "revision_id", name="uq_design_submission_revision"),
        )
        op.create_index("ix_design_submission_lines_document_id", "design_submission_lines", ["document_id"], unique=False)
        op.create_index("ix_design_submission_lines_revision_id", "design_submission_lines", ["revision_id"], unique=False)
        op.create_index("ix_design_submission_lines_submission_id", "design_submission_lines", ["submission_id"], unique=False)
    if "design_submission_comments" not in existing:
        op.create_table(
            "design_submission_comments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("submission_id", sa.Integer(), sa.ForeignKey("design_customer_submissions.id"), nullable=False),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=True),
            sa.Column("comment", sa.Text(), nullable=False),
            sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("status", sa.String(length=10), nullable=False, server_default="open"),
            sa.Column("resolution", sa.Text(), nullable=True),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_design_submission_comments_document_id", "design_submission_comments", ["document_id"], unique=False)
        op.create_index("ix_design_submission_comments_assigned_to_id", "design_submission_comments", ["assigned_to_id"], unique=False)
        op.create_index("ix_design_submission_comments_submission_id", "design_submission_comments", ["submission_id"], unique=False)
    if "design_change_requests" not in existing:
        op.create_table(
            "design_change_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ecr_number", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("source", sa.String(length=20), nullable=False, server_default="design"),
            sa.Column("quality_ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id"), nullable=True),
            sa.Column("quality_capa_id", sa.Integer(), sa.ForeignKey("quality_capas.id"), nullable=True),
            sa.Column("source_reference", sa.String(length=255), nullable=True),
            sa.Column("urgency", sa.String(length=20), nullable=False, server_default="normal"),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("proposed_change", sa.Text(), nullable=False),
            sa.Column("pm_project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("impact_summary", sa.Text(), nullable=True),
            sa.Column("impact_stock", sa.Text(), nullable=True),
            sa.Column("impact_open_orders", sa.Text(), nullable=True),
            sa.Column("impact_cost", sa.Float(), nullable=True),
            sa.Column("impact_delivery_days", sa.Integer(), nullable=True),
            sa.Column("impact_checked_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("impact_checked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("board_member_ids", JSONList, nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_comment", sa.Text(), nullable=True),
            sa.Column("raised_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_change_requests_status", "design_change_requests", ["status"], unique=False)
        op.create_index("ix_design_change_requests_raised_by_id", "design_change_requests", ["raised_by_id"], unique=False)
        op.create_index("ix_design_change_requests_ecr_number", "design_change_requests", ["ecr_number"], unique=True)
    if "design_change_request_items" not in existing:
        op.create_table(
            "design_change_request_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ecr_id", sa.Integer(), sa.ForeignKey("design_change_requests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=True),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("design_boms.id"), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_design_change_request_items_document_id", "design_change_request_items", ["document_id"], unique=False)
        op.create_index("ix_design_change_request_items_ecr_id", "design_change_request_items", ["ecr_id"], unique=False)
        op.create_index("ix_design_change_request_items_bom_id", "design_change_request_items", ["bom_id"], unique=False)
    if "design_ecr_votes" not in existing:
        op.create_table(
            "design_ecr_votes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ecr_id", sa.Integer(), sa.ForeignKey("design_change_requests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("vote", sa.String(length=10), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            *_timestamps(), sa.UniqueConstraint("ecr_id", "user_id", name="uq_design_ecr_vote_user"),
        )
        op.create_index("ix_design_ecr_votes_ecr_id", "design_ecr_votes", ["ecr_id"], unique=False)
    if "design_change_notice_boms" not in existing:
        op.create_table(
            "design_change_notice_boms",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ecn_id", sa.Integer(), sa.ForeignKey("design_change_notices.id"), nullable=False),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("design_boms.id"), nullable=False),
            sa.Column("change_description", sa.Text(), nullable=True),
            *_timestamps(), sa.UniqueConstraint("ecn_id", "bom_id", name="uq_design_ecn_bom"),
        )
        op.create_index("ix_design_change_notice_boms_ecn_id", "design_change_notice_boms", ["ecn_id"], unique=False)
        op.create_index("ix_design_change_notice_boms_bom_id", "design_change_notice_boms", ["bom_id"], unique=False)
    if "design_ecn_acknowledgements" not in existing:
        op.create_table(
            "design_ecn_acknowledgements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ecn_id", sa.Integer(), sa.ForeignKey("design_change_notices.id"), nullable=False),
            sa.Column("department", sa.String(length=20), nullable=False),
            sa.Column("acknowledged_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(), sa.UniqueConstraint("ecn_id", "department", name="uq_design_ecn_ack_department"),
        )
        op.create_index("ix_design_ecn_acknowledgements_ecn_id", "design_ecn_acknowledgements", ["ecn_id"], unique=False)
    if "design_task_deliverables" not in existing:
        op.create_table(
            "design_task_deliverables",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pm_task_id", sa.Integer(), sa.ForeignKey("pm_project_tasks.id"), nullable=False),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=True),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("design_boms.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_design_task_deliverables_pm_task_id", "design_task_deliverables", ["pm_task_id"], unique=False)
        op.create_index("ix_design_task_deliverables_document_id", "design_task_deliverables", ["document_id"], unique=False)
        op.create_index("ix_design_task_deliverables_bom_id", "design_task_deliverables", ["bom_id"], unique=False)
    if "design_review_results" not in existing:
        op.create_table(
            "design_review_results",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("revision_id", sa.Integer(), sa.ForeignKey("design_document_revisions.id"), nullable=True),
            sa.Column("bom_revision_id", sa.Integer(), sa.ForeignKey("design_bom_revisions.id"), nullable=True),
            sa.Column("cycle", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("checklist_item_id", sa.Integer(), sa.ForeignKey("design_checklist_items.id", ondelete="SET NULL"), nullable=True),
            sa.Column("item_text", sa.String(length=500), nullable=False),
            sa.Column("result", sa.String(length=10), nullable=False),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("reviewer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_design_review_results_revision_id", "design_review_results", ["revision_id"], unique=False)
        op.create_index("ix_design_review_results_bom_revision_id", "design_review_results", ["bom_revision_id"], unique=False)

    inspector = sa.inspect(bind)
    for table, column, indexed in NEW_COLUMNS:
        if column.name in {c["name"] for c in inspector.get_columns(table)}:
            continue
        with op.batch_alter_table(table) as batch:
            batch.add_column(column.copy())
        if indexed:
            op.create_index(f"ix_{table}_{column.name}", table, [column.name], unique=False)

    op.execute(
        "INSERT INTO design_settings (id, customer_response_days, review_overdue_days) "
        "SELECT 1, 14, 7 WHERE NOT EXISTS (SELECT 1 FROM design_settings WHERE id = 1)"
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, indexed in reversed(NEW_COLUMNS):
        if column.name not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        if indexed:
            op.drop_index(f"ix_{table}_{column.name}", table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_column(column.name)
    existing = set(inspector.get_table_names())
    for table in reversed(NEW_TABLES):
        if table in existing:
            op.drop_table(table)
