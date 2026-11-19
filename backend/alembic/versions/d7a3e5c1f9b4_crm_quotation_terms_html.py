"""CRM quotation: Terms & Conditions from the rich-text editor (terms_html)

Revision ID: d7a3e5c1f9b4
Revises: c4f1a7d9e2b3
Create Date: 2026-11-18
"""
from alembic import op
import sqlalchemy as sa

revision = "d7a3e5c1f9b4"
down_revision = "c4f1a7d9e2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("crm_quotations")}
    if "terms_html" not in cols:
        op.add_column("crm_quotations", sa.Column("terms_html", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("crm_quotations", "terms_html")
