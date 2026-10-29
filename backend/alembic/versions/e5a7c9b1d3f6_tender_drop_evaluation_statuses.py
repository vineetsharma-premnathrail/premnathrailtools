"""Tender: Technical Evaluation, Commercial Evaluation and Negotiation statuses removed.

These happen after our bid is in, so tenders still on them move to
"Tender Submitted" (owner, 2026-10-29). Not reversible: the old status is not kept.

Revision ID: e5a7c9b1d3f6
Revises: d4f6a8c0e2b4
Create Date: 2026-10-29
"""
from alembic import op
import sqlalchemy as sa

revision = "e5a7c9b1d3f6"
down_revision = "d4f6a8c0e2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "UPDATE crm_tenders SET status = 'Tender Submitted' "
        "WHERE status IN ('Technical Evaluation', 'Commercial Evaluation', 'Negotiation')"
    ))


def downgrade() -> None:
    pass
