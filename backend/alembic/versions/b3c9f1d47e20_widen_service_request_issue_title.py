"""widen erp_service_requests.issue_title to text

Revision ID: b3c9f1d47e20
Revises: e5a1c7d93f42
Create Date: 2026-09-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b3c9f1d47e20'
down_revision = 'e5a1c7d93f42'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A 300-char title rejected the whole service request with a 500 whenever
    # someone pasted a multi-point issue summary into the field.
    op.alter_column(
        "erp_service_requests", "issue_title",
        existing_type=sa.String(length=300), type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.execute("UPDATE erp_service_requests SET issue_title = left(issue_title, 300)")
    op.alter_column(
        "erp_service_requests", "issue_title",
        existing_type=sa.Text(), type_=sa.String(length=300),
        existing_nullable=False,
    )
