"""add vendor quotations and PO-draft pipeline stages

Revision ID: 7194d06da32c
Revises: c4d5e6f7a8b9
Create Date: 2026-08-31 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "7194d06da32c"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    rfq_columns = {c["name"] for c in inspector.get_columns("rfqs")}
    with op.batch_alter_table("rfqs") as batch_op:
        if "requires_technical_evaluation" not in rfq_columns:
            batch_op.add_column(sa.Column("requires_technical_evaluation", sa.Boolean(), nullable=False, server_default=sa.false()))

    if "p2p_vendor_quotations" not in inspector.get_table_names():
        op.create_table(
            "p2p_vendor_quotations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("rfq_id", sa.Integer(), sa.ForeignKey("rfqs.id"), nullable=False),
            sa.Column("p2p_request_id", sa.Integer(), sa.ForeignKey("p2p_requests.id"), nullable=False),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("vendor_name", sa.String(length=255), nullable=False),
            sa.Column("quoted_price", sa.Float(), nullable=True),
            sa.Column("delivery_time", sa.String(length=100), nullable=True),
            sa.Column("payment_terms", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("technical_status", sa.String(length=15), nullable=False, server_default="pending"),
            sa.Column("technical_remarks", sa.Text(), nullable=True),
            sa.Column("technical_evaluated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("technical_evaluated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("commercial_status", sa.String(length=15), nullable=False, server_default="pending"),
            sa.Column("commercial_remarks", sa.Text(), nullable=True),
            sa.Column("commercial_evaluated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("commercial_evaluated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_selected", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("submitted_at", sa.Date(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        )
        op.create_index("ix_p2p_vendor_quotations_rfq_id", "p2p_vendor_quotations", ["rfq_id"])
        op.create_index("ix_p2p_vendor_quotations_p2p_request_id", "p2p_vendor_quotations", ["p2p_request_id"])


def downgrade() -> None:
    op.drop_index("ix_p2p_vendor_quotations_p2p_request_id", table_name="p2p_vendor_quotations")
    op.drop_index("ix_p2p_vendor_quotations_rfq_id", table_name="p2p_vendor_quotations")
    op.drop_table("p2p_vendor_quotations")
    with op.batch_alter_table("rfqs") as batch_op:
        batch_op.drop_column("requires_technical_evaluation")
