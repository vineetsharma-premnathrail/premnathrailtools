"""CRM Sales Library: nested folders, documents, versions, links, favourites; seeds the 7 root folders.

Revision ID: c9e4a7d1f3b8
Revises: a3c8e1f5d7b4
"""
from alembic import op
import sqlalchemy as sa

revision = "c9e4a7d1f3b8"
down_revision = "a3c8e1f5d7b4"
branch_labels = None
depends_on = None

# (name, is_pricing, is_confidential)
SEED_FOLDERS = [
    ("Products", False, False),
    ("Project References", False, False),
    ("Pricing & Quotations", True, True),
    ("Company Profile & Presentations", False, False),
    ("Technical Resources", False, False),
    ("Customer References", False, False),
    ("Templates", False, False),
]


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if "crm_library_folders" not in existing:
        op.create_table(
            "crm_library_folders",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("parent_id", sa.Integer(), sa.ForeignKey("crm_library_folders.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
            sa.Column("is_confidential", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("is_pricing", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
        op.create_index("ix_crm_library_folders_parent_id", "crm_library_folders", ["parent_id"])
        op.create_index("ix_crm_library_folders_product_id", "crm_library_folders", ["product_id"])
        op.create_index(
            "uq_crm_library_folders_parent_name_live",
            "crm_library_folders",
            [sa.text("coalesce(parent_id, 0)"), sa.text("lower(name)")],
            unique=True,
            postgresql_where=sa.text("is_deleted = false"),
        )

    if "crm_library_documents" not in existing:
        op.create_table(
            "crm_library_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("folder_id", sa.Integer(), sa.ForeignKey("crm_library_folders.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("file_kind", sa.String(20), nullable=False),
            sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("current_version_no", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
        op.create_index("ix_crm_library_documents_folder_id", "crm_library_documents", ["folder_id"])
        op.create_index("ix_crm_library_documents_expiry_date", "crm_library_documents", ["expiry_date"])
        op.create_index("ix_crm_library_documents_created_by_id", "crm_library_documents", ["created_by_id"])

    if "crm_library_document_versions" not in existing:
        op.create_table(
            "crm_library_document_versions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("crm_library_documents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version_no", sa.Integer(), nullable=False),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("sharepoint_path", sa.String(1000), nullable=False),
            sa.Column("sharepoint_url", sa.String(1000), nullable=True),
            sa.Column("file_size", sa.BigInteger(), nullable=True),
            sa.Column("mime_type", sa.String(255), nullable=True),
            sa.Column("change_note", sa.Text(), nullable=True),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("document_id", "version_no", name="uq_crm_library_versions_doc_no"),
        )
        op.create_index("ix_crm_library_document_versions_document_id", "crm_library_document_versions", ["document_id"])

    if "crm_library_document_links" not in existing:
        op.create_table(
            "crm_library_document_links",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("crm_library_documents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("link_type", sa.String(20), nullable=False),
            sa.Column("link_id", sa.Integer(), nullable=False),
            *_ts(),
            sa.UniqueConstraint("document_id", "link_type", "link_id", name="uq_crm_library_links_doc_type_id"),
        )
        op.create_index("ix_crm_library_document_links_document_id", "crm_library_document_links", ["document_id"])
        op.create_index("ix_crm_library_links_type_id", "crm_library_document_links", ["link_type", "link_id"])

    if "crm_library_favorites" not in existing:
        op.create_table(
            "crm_library_favorites",
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("crm_library_documents.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )

    # Seed the 7 root folders (skip any that already exist as a live root folder).
    for order, (name, is_pricing, is_conf) in enumerate(SEED_FOLDERS, start=1):
        bind.execute(
            sa.text(
                "INSERT INTO crm_library_folders "
                "(parent_id, name, is_confidential, is_pricing, sort_order, is_deleted, created_at, updated_at) "
                "SELECT NULL, CAST(:name AS VARCHAR(150)), :conf, :pricing, :ord, false, now(), now() "
                "WHERE NOT EXISTS (SELECT 1 FROM crm_library_folders "
                "WHERE parent_id IS NULL AND lower(name) = lower(CAST(:name AS VARCHAR(150))) AND is_deleted = false)"
            ),
            {"name": name, "conf": is_conf, "pricing": is_pricing, "ord": order},
        )


def downgrade() -> None:
    # Children first. Dropping the tables drops their indexes and constraints; seeded folders go with them.
    op.drop_table("crm_library_favorites")
    op.drop_table("crm_library_document_links")
    op.drop_table("crm_library_document_versions")
    op.drop_table("crm_library_documents")
    op.drop_table("crm_library_folders")
