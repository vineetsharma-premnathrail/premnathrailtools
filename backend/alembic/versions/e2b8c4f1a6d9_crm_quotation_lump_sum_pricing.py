"""CRM quotation lump-sum pricing: a quotation is priced either item-wise
(qty x unit price + GST per line) or as one lump sum for the whole package
(the existing `price` column + one GST % for it) — the company's official
"Commercial Offer" lists Particulars without prices and a single Total Price.

Revision ID: e2b8c4f1a6d9
Revises: d7a3f1c9e5b2
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "e2b8c4f1a6d9"
down_revision = "d7a3f1c9e5b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("crm_quotations")}
    if "pricing_mode" not in cols:
        op.add_column("crm_quotations", sa.Column("pricing_mode", sa.String(20), nullable=False, server_default="itemwise"))
    if "lump_sum_gst_percent" not in cols:
        op.add_column("crm_quotations", sa.Column("lump_sum_gst_percent", sa.Float(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("crm_quotations")}
    with op.batch_alter_table("crm_quotations") as batch:
        if "lump_sum_gst_percent" in cols:
            batch.drop_column("lump_sum_gst_percent")
        if "pricing_mode" in cols:
            batch.drop_column("pricing_mode")
