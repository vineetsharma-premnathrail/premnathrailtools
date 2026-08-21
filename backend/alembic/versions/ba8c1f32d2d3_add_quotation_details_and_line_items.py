"""add quotation details and line items

Revision ID: ba8c1f32d2d3
Revises: e7a1b9c5d2f4
Create Date: 2026-08-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "ba8c1f32d2d3"
down_revision = "e7a1b9c5d2f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_quotations")}

    with op.batch_alter_table("crm_quotations") as batch_op:
        if "revision_number" not in columns:
            batch_op.add_column(sa.Column("revision_number", sa.Integer(), nullable=False, server_default="0"))
        if "quotation_type" not in columns:
            batch_op.add_column(sa.Column("quotation_type", sa.String(length=20), nullable=False, server_default="Domestic"))
        if "quote_date" not in columns:
            batch_op.add_column(sa.Column("quote_date", sa.Date(), nullable=True))
        if "client_name" not in columns:
            batch_op.add_column(sa.Column("client_name", sa.String(length=255), nullable=True))
        if "client_contact_name" not in columns:
            batch_op.add_column(sa.Column("client_contact_name", sa.String(length=150), nullable=True))
        if "client_contact_email" not in columns:
            batch_op.add_column(sa.Column("client_contact_email", sa.String(length=150), nullable=True))
        if "client_contact_phone" not in columns:
            batch_op.add_column(sa.Column("client_contact_phone", sa.String(length=50), nullable=True))

    if "crm_quotation_line_items" not in inspector.get_table_names():
        op.create_table(
            "crm_quotation_line_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("quotation_id", sa.Integer(), sa.ForeignKey("crm_quotations.id"), nullable=False, index=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("model_number", sa.String(length=150), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=True),
            sa.Column("unit_price", sa.Float(), nullable=True),
            sa.Column("gst_percent", sa.Float(), nullable=True),
            sa.Column("subtotal", sa.Float(), nullable=True),
            sa.Column("total", sa.Float(), nullable=True),
        )


def downgrade() -> None:
    op.drop_table("crm_quotation_line_items")
    with op.batch_alter_table("crm_quotations") as batch_op:
        batch_op.drop_column("client_contact_phone")
        batch_op.drop_column("client_contact_email")
        batch_op.drop_column("client_contact_name")
        batch_op.drop_column("client_name")
        batch_op.drop_column("quote_date")
        batch_op.drop_column("quotation_type")
        batch_op.drop_column("revision_number")
