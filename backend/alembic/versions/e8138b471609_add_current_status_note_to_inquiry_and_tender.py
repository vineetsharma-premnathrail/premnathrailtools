"""add current_status_note to crm inquiries and tenders

Revision ID: e8138b471609
Revises: ae88c635814e
Create Date: 2026-09-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e8138b471609'
down_revision = 'ae88c635814e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    inquiry_columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}
    if "current_status_note" not in inquiry_columns:
        op.add_column("crm_inquiries", sa.Column("current_status_note", sa.Text(), nullable=True))

    tender_columns = {c["name"] for c in inspector.get_columns("crm_tenders")}
    if "current_status_note" not in tender_columns:
        op.add_column("crm_tenders", sa.Column("current_status_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("crm_tenders", "current_status_note")
    op.drop_column("crm_inquiries", "current_status_note")
