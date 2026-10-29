"""Tender: free-text Tender Details (scope, items, eligibility).

Revision ID: b30482f9e048
Revises: e5a7c9b1d3f6
Create Date: 2026-10-29
"""
from alembic import op
import sqlalchemy as sa

revision = "b30482f9e048"
down_revision = "e5a7c9b1d3f6"
branch_labels = None
depends_on = None

TABLE = "crm_tenders"


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}
    if "tender_details" not in cols:
        op.add_column(TABLE, sa.Column("tender_details", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column(TABLE, "tender_details")
