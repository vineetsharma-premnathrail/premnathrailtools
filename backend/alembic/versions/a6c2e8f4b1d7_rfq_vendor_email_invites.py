"""Procurement: emailed RFQs — vendors invited by email with a quote-by date,
reminders, and the vendor's quotation PDF on their line quotation (2026-10-22).

Revision ID: a6c2e8f4b1d7
Revises: f3b7d1a9c5e2
"""
from alembic import op
import sqlalchemy as sa

revision = "a6c2e8f4b1d7"
down_revision = "f3b7d1a9c5e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    rfq_cols = {c["name"] for c in insp.get_columns("rfqs")}
    with op.batch_alter_table("rfqs") as t:
        if "quote_due_date" not in rfq_cols:
            t.add_column(sa.Column("quote_due_date", sa.Date(), nullable=True))
        if "invite_message" not in rfq_cols:
            t.add_column(sa.Column("invite_message", sa.Text(), nullable=True))
    att_cols = {c["name"] for c in insp.get_columns("rfq_attachments")}
    if "vendor_quotation_id" not in att_cols:
        with op.batch_alter_table("rfq_attachments") as t:
            t.add_column(sa.Column("vendor_quotation_id", sa.Integer(),
                                   sa.ForeignKey("p2p_vendor_quotations.id", ondelete="SET NULL"), nullable=True))
            t.create_index("ix_rfq_attachments_vendor_quotation_id", ["vendor_quotation_id"])
    if "rfq_vendor_invites" not in insp.get_table_names():
        op.create_table(
            "rfq_vendor_invites",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("rfq_id", sa.Integer(), sa.ForeignKey("rfqs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=False),
            sa.Column("vendor_name", sa.String(length=255), nullable=False),
            sa.Column("email", sa.String(length=150), nullable=True),
            sa.Column("email_status", sa.String(length=10), nullable=False, server_default="pending"),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("send_error", sa.Text(), nullable=True),
            sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_rfq_vendor_invites_rfq_id", "rfq_vendor_invites", ["rfq_id"])
        op.create_index("ix_rfq_vendor_invites_vendor_id", "rfq_vendor_invites", ["vendor_id"])


def downgrade() -> None:
    op.drop_index("ix_rfq_vendor_invites_vendor_id", table_name="rfq_vendor_invites")
    op.drop_index("ix_rfq_vendor_invites_rfq_id", table_name="rfq_vendor_invites")
    op.drop_table("rfq_vendor_invites")
    with op.batch_alter_table("rfq_attachments") as t:
        t.drop_index("ix_rfq_attachments_vendor_quotation_id")
        t.drop_column("vendor_quotation_id")
    with op.batch_alter_table("rfqs") as t:
        t.drop_column("invite_message")
        t.drop_column("quote_due_date")
