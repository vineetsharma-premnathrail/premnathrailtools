"""Before-PO receipt files (invoice / challan) and p2p_rfqs.source.

New table store_pre_po_receipt_attachments and one nullable column rfqs.source
('before_po' marks the internal RFQ behind a PO made from a Before-PO receipt;
hidden from RFQ lists). Nothing existing is rewritten.

Revision ID: d7f2a4c8e1b5
Revises: b6e2d8f4a1c7
"""
from alembic import op
import sqlalchemy as sa

revision = "d7f2a4c8e1b5"
down_revision = "b6e2d8f4a1c7"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("store_pre_po_receipt_attachments"):
        op.create_table(
            "store_pre_po_receipt_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("receipt_id", sa.Integer(), sa.ForeignKey("store_pre_po_receipts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("doc_type", sa.String(20), nullable=False, server_default="other"),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(255), nullable=True),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("sharepoint_path", sa.String(1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(1000), nullable=True),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_store_pre_po_receipt_attachments_receipt_id", "store_pre_po_receipt_attachments", ["receipt_id"])
    if insp.has_table("rfqs") and "source" not in {c["name"] for c in insp.get_columns("rfqs")}:
        op.add_column("rfqs", sa.Column("source", sa.String(20), nullable=True))


def downgrade():
    insp = sa.inspect(op.get_bind())
    if insp.has_table("rfqs") and "source" in {c["name"] for c in insp.get_columns("rfqs")}:
        op.drop_column("rfqs", "source")
    if insp.has_table("store_pre_po_receipt_attachments"):
        op.drop_table("store_pre_po_receipt_attachments")
