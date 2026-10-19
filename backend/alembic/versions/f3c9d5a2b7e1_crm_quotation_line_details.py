"""CRM quotation line details: free-text sub-lines printed under the item name
in the document (e.g. "Total 1 year warranty"), kept apart from the item name
so product matching and duplicate checks still see the plain name.

Revision ID: f3c9d5a2b7e1
Revises: e2b8c4f1a6d9
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "f3c9d5a2b7e1"
down_revision = "e2b8c4f1a6d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("crm_quotation_line_items")}
    if "details" not in cols:
        op.add_column("crm_quotation_line_items", sa.Column("details", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("crm_quotation_line_items")}
    if "details" in cols:
        with op.batch_alter_table("crm_quotation_line_items") as batch:
            batch.drop_column("details")
