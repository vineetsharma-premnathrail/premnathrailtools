"""Procurement redesign: settings-based approvals, vendor master extension,
vendor documents + catalog, RFQ vendor link and terms snapshots.

- p2p_requests.approval_scheme ('settings' for new requisitions)
- vendors.website / terms_conditions / created_by_id
- vendor_documents, vendor_catalog_items (new)
- rfq_attachments.vendor_id → vendors
- rfqs.terms_conditions, p2p_purchase_orders.terms_conditions

Revision ID: c7d1e9a3f5b2
Revises: b4e7d2a9c6f1
Create Date: 2026-10-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "c7d1e9a3f5b2"
down_revision = "b4e7d2a9c6f1"
branch_labels = None
depends_on = None


def _cols(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "p2p_requests" in tables and "approval_scheme" not in _cols(inspector, "p2p_requests"):
        with op.batch_alter_table("p2p_requests") as b:
            b.add_column(sa.Column("approval_scheme", sa.String(length=20), nullable=True))

    if "vendors" in tables:
        cols = _cols(inspector, "vendors")
        with op.batch_alter_table("vendors") as b:
            if "website" not in cols:
                b.add_column(sa.Column("website", sa.String(length=255), nullable=True))
            if "terms_conditions" not in cols:
                b.add_column(sa.Column("terms_conditions", sa.Text(), nullable=True))
            if "created_by_id" not in cols:
                b.add_column(sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_vendors_created_by"), nullable=True))

    if "vendor_documents" not in tables:
        op.create_table(
            "vendor_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
            sa.Column("doc_type", sa.String(length=30), nullable=False, server_default="other"),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=True),
            sa.Column("mime_type", sa.String(length=150), nullable=True),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("uploaded_by_name", sa.String(length=150), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        )
        op.create_index("ix_vendor_documents_vendor_id", "vendor_documents", ["vendor_id"])

    if "vendor_catalog_items" not in tables:
        op.create_table(
            "vendor_catalog_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("part_code", sa.String(length=100), nullable=True),
            sa.Column("make", sa.String(length=150), nullable=True),
            sa.Column("unit", sa.String(length=30), nullable=True),
            sa.Column("unit_price", sa.Numeric(18, 2), nullable=True),
            sa.Column("currency", sa.String(length=10), nullable=False, server_default="INR"),
            sa.Column("dimensions", sa.String(length=255), nullable=True),
            sa.Column("technical_spec", sa.Text(), nullable=True),
            sa.Column("lead_time_days", sa.Integer(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        )
        op.create_index("ix_vendor_catalog_items_vendor_id", "vendor_catalog_items", ["vendor_id"])

    if "rfq_attachments" in tables and "vendor_id" not in _cols(inspector, "rfq_attachments"):
        with op.batch_alter_table("rfq_attachments") as b:
            b.add_column(sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id", ondelete="SET NULL", name="fk_rfq_attachments_vendor"), nullable=True))
        op.create_index("ix_rfq_attachments_vendor_id", "rfq_attachments", ["vendor_id"])

    for table in ("rfqs", "p2p_purchase_orders"):
        if table in tables and "terms_conditions" not in _cols(inspector, table):
            with op.batch_alter_table(table) as b:
                b.add_column(sa.Column("terms_conditions", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table in ("p2p_purchase_orders", "rfqs"):
        if table in tables and "terms_conditions" in _cols(inspector, table):
            with op.batch_alter_table(table) as b:
                b.drop_column("terms_conditions")
    if "rfq_attachments" in tables and "vendor_id" in _cols(inspector, "rfq_attachments"):
        op.drop_index("ix_rfq_attachments_vendor_id", table_name="rfq_attachments")
        with op.batch_alter_table("rfq_attachments") as b:
            b.drop_column("vendor_id")
    if "vendor_catalog_items" in tables:
        op.drop_index("ix_vendor_catalog_items_vendor_id", table_name="vendor_catalog_items")
        op.drop_table("vendor_catalog_items")
    if "vendor_documents" in tables:
        op.drop_index("ix_vendor_documents_vendor_id", table_name="vendor_documents")
        op.drop_table("vendor_documents")
    if "vendors" in tables:
        cols = _cols(inspector, "vendors")
        with op.batch_alter_table("vendors") as b:
            for c in ("created_by_id", "terms_conditions", "website"):
                if c in cols:
                    b.drop_column(c)
    if "p2p_requests" in tables and "approval_scheme" in _cols(inspector, "p2p_requests"):
        with op.batch_alter_table("p2p_requests") as b:
            b.drop_column("approval_scheme")
