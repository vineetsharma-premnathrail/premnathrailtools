"""move l1_vendor fields from rfqs to per-tier vendor_name/vendor_contact on rfq_attachments

Revision ID: d4f7b0c3e6a9
Revises: c3e6a8b1d9f2
Create Date: 2026-09-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "d4f7b0c3e6a9"
down_revision = "c3e6a8b1d9f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    attachment_columns = {c["name"] for c in inspector.get_columns("rfq_attachments")}
    if "vendor_name" not in attachment_columns:
        op.add_column("rfq_attachments", sa.Column("vendor_name", sa.String(length=255), nullable=True))
    if "vendor_contact" not in attachment_columns:
        op.add_column("rfq_attachments", sa.Column("vendor_contact", sa.String(length=50), nullable=True))

    # Backfill: copy each RFQ's l1_vendor_name/l1_vendor_contact onto its L1
    # attachment(s) before dropping the columns from rfqs.
    rfq_columns = {c["name"] for c in inspector.get_columns("rfqs")}
    if "l1_vendor_name" in rfq_columns:
        op.execute(
            """
            UPDATE rfq_attachments a
            SET vendor_name = r.l1_vendor_name, vendor_contact = r.l1_vendor_contact
            FROM rfqs r
            WHERE a.rfq_id = r.id AND a.vendor_tier = 'L1'
              AND (r.l1_vendor_name IS NOT NULL OR r.l1_vendor_contact IS NOT NULL)
            """
        )
        with op.batch_alter_table("rfqs") as batch_op:
            batch_op.drop_column("l1_vendor_name")
            batch_op.drop_column("l1_vendor_contact")


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    rfq_columns = {c["name"] for c in inspector.get_columns("rfqs")}
    if "l1_vendor_name" not in rfq_columns:
        op.add_column("rfqs", sa.Column("l1_vendor_name", sa.String(length=255), nullable=True))
        op.add_column("rfqs", sa.Column("l1_vendor_contact", sa.String(length=50), nullable=True))
        op.execute(
            """
            UPDATE rfqs r
            SET l1_vendor_name = a.vendor_name, l1_vendor_contact = a.vendor_contact
            FROM rfq_attachments a
            WHERE a.rfq_id = r.id AND a.vendor_tier = 'L1'
            """
        )

    op.drop_column("rfq_attachments", "vendor_contact")
    op.drop_column("rfq_attachments", "vendor_name")
