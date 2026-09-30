"""add design module (engineering document control: documents, revisions, files, ECNs, events)

New `design_*` tables — deliberately not reviving `engineering_documents`
(created by c5e9f1a7b3d8, dropped by ae88c635814e), whose unguarded
create_table would collide on a downgrade/upgrade cycle. Also re-registers
the "design" app in the admin's assignable-modules checklist, which
d8a1c3e5f7b9 removed while nothing was built on it — the module is real now.

Revision ID: d4f6a8c0e2b5
Revises: c5d7e9f1a3b6
Create Date: 2026-09-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd4f6a8c0e2b5'
down_revision = 'c5d7e9f1a3b6'
branch_labels = None
depends_on = None

DESIGN_TABLES = (
    "design_documents",
    "design_change_notices",
    "design_document_revisions",
    "design_revision_files",
    "design_change_notice_documents",
    "design_events",
)
DESIGN_MODULE_LABEL = "Design"
DESIGN_MODULE_DESCRIPTION = "Engineering drawings and documents with revision control, check/approval workflow and change notices (ECN)."


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


def _user_fk(name: str) -> sa.Column:
    return sa.Column(name, sa.Integer(), sa.ForeignKey("users.id"), nullable=True)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if "design_documents" not in existing:
        op.create_table(
            "design_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("doc_number", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("document_type", sa.String(length=30), nullable=False),
            sa.Column("discipline", sa.String(length=30), nullable=False, server_default="mechanical"),
            sa.Column("pm_project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            _user_fk("owner_id"),
            _user_fk("created_by_id"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("obsoleted_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("obsoleted_by_id"),
            sa.Column("obsolete_reason", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_documents_doc_number", "design_documents", ["doc_number"], unique=True)
        for col in ("document_type", "discipline", "pm_project_id", "erp_project_id", "store_item_id", "owner_id", "status"):
            op.create_index(f"ix_design_documents_{col}", "design_documents", [col])

    if "design_change_notices" not in existing:
        op.create_table(
            "design_change_notices",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ecn_number", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("reason", sa.String(length=30), nullable=False, server_default="design_improvement"),
            sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("impact_assessment", sa.Text(), nullable=True),
            sa.Column("target_date", sa.Date(), nullable=True),
            sa.Column("pm_project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            _user_fk("created_by_id"),
            _user_fk("approver_id"),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("decided_by_id"),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_comment", sa.Text(), nullable=True),
            _user_fk("implemented_by_id"),
            sa.Column("implemented_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_change_notices_ecn_number", "design_change_notices", ["ecn_number"], unique=True)
        op.create_index("ix_design_change_notices_status", "design_change_notices", ["status"])
        op.create_index("ix_design_change_notices_approver_id", "design_change_notices", ["approver_id"])

    if "design_document_revisions" not in existing:
        op.create_table(
            "design_document_revisions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=False),
            sa.Column("revision_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("revision_label", sa.String(length=10), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("change_summary", sa.Text(), nullable=True),
            sa.Column("ecn_id", sa.Integer(), sa.ForeignKey("design_change_notices.id"), nullable=True),
            _user_fk("created_by_id"),
            _user_fk("reviewer_id"),
            _user_fk("approver_id"),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("reviewed_by_id"),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("review_comment", sa.Text(), nullable=True),
            _user_fk("approved_by_id"),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("approval_comment", sa.Text(), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("returned_count", sa.Integer(), nullable=False, server_default="0"),
            *_timestamps(), *_soft_delete(),
        )
        for col in ("document_id", "status", "ecn_id", "reviewer_id", "approver_id"):
            op.create_index(f"ix_design_document_revisions_{col}", "design_document_revisions", [col])
        # Unique among live rows only — a discarded draft frees its label.
        op.create_index(
            "uq_design_revision_document_index", "design_document_revisions", ["document_id", "revision_index"],
            unique=True, postgresql_where=sa.text("is_deleted = false"), sqlite_where=sa.text("is_deleted = 0"),
        )

    if "design_revision_files" not in existing:
        op.create_table(
            "design_revision_files",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("revision_id", sa.Integer(), sa.ForeignKey("design_document_revisions.id"), nullable=False),
            sa.Column("file_role", sa.String(length=20), nullable=False, server_default="primary"),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=2000), nullable=True),
            sa.Column("file_size", sa.BigInteger(), nullable=True),
            sa.Column("mime_type", sa.String(length=150), nullable=True),
            _user_fk("uploaded_by_id"),
            *_timestamps(), *_soft_delete(),
        )
        op.create_index("ix_design_revision_files_revision_id", "design_revision_files", ["revision_id"])

    if "design_change_notice_documents" not in existing:
        op.create_table(
            "design_change_notice_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ecn_id", sa.Integer(), sa.ForeignKey("design_change_notices.id"), nullable=False),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=False),
            sa.Column("change_description", sa.Text(), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint("ecn_id", "document_id", name="uq_design_ecn_document"),
        )
        op.create_index("ix_design_change_notice_documents_ecn_id", "design_change_notice_documents", ["ecn_id"])
        op.create_index("ix_design_change_notice_documents_document_id", "design_change_notice_documents", ["document_id"])

    if "design_events" not in existing:
        op.create_table(
            "design_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=True),
            sa.Column("revision_id", sa.Integer(), sa.ForeignKey("design_document_revisions.id"), nullable=True),
            sa.Column("ecn_id", sa.Integer(), sa.ForeignKey("design_change_notices.id"), nullable=True),
            sa.Column("action", sa.String(length=40), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            _user_fk("actor_id"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_design_events_document_id", "design_events", ["document_id"])
        op.create_index("ix_design_events_ecn_id", "design_events", ["ecn_id"])

    # Register (or revive) the app in the admin's assignable-modules checklist.
    if inspector.has_table("modules"):
        row = bind.execute(sa.text("SELECT id FROM modules WHERE key = 'design'")).first()
        if row is None:
            bind.execute(
                sa.text(
                    "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                    "VALUES ('design', :label, 'design', :description, true, "
                    "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
                ),
                {"label": DESIGN_MODULE_LABEL, "description": DESIGN_MODULE_DESCRIPTION},
            )
        else:
            bind.execute(
                sa.text("UPDATE modules SET label = :label, description = :description, is_active = true WHERE key = 'design'"),
                {"label": DESIGN_MODULE_LABEL, "description": DESIGN_MODULE_DESCRIPTION},
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("modules"):
        # Strip 'design' from anyone who had it ticked, then drop the registry
        # row (same approach as d8a1c3e5f7b9 / a7c3e5f9b2d6).
        op.execute(
            """
            UPDATE users
               SET assigned_apps = (
                   SELECT COALESCE(json_agg(elem), '[]'::json)
                     FROM json_array_elements_text(assigned_apps) AS elem
                    WHERE elem <> 'design'
               )
             WHERE assigned_apps IS NOT NULL
               AND EXISTS (
                   SELECT 1 FROM json_array_elements_text(assigned_apps) AS e
                    WHERE e = 'design'
               )
            """
        )
        op.execute("DELETE FROM modules WHERE key = 'design'")

    existing = set(inspector.get_table_names())
    for name in reversed(DESIGN_TABLES):
        if name in existing:
            op.drop_table(name)
