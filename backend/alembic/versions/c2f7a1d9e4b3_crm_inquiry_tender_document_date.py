"""Inquiries and tenders get their own document date.

crm_inquiries.inquiry_date and crm_tenders.tender_date (DATE): the day the
customer raised the inquiry / the tender was taken up, editable by the user.
created_at stays the system timestamp of when the record was entered. Existing
rows are filled from created_at, so it is safe on a live database.

Revision ID: c2f7a1d9e4b3
Revises: b8d4f2a6c1e7
"""
from alembic import op
import sqlalchemy as sa

revision = "c2f7a1d9e4b3"
down_revision = "b8d4f2a6c1e7"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    for table, column in (("crm_inquiries", "inquiry_date"), ("crm_tenders", "tender_date")):
        cols = {c["name"] for c in insp.get_columns(table)}
        if column not in cols:
            op.add_column(table, sa.Column(column, sa.Date(), nullable=True))
        op.execute(f"UPDATE {table} SET {column} = created_at::date WHERE {column} IS NULL AND created_at IS NOT NULL")


def downgrade():
    op.drop_column("crm_tenders", "tender_date")
    op.drop_column("crm_inquiries", "inquiry_date")
