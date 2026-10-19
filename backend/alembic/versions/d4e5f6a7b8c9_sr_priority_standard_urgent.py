"""Service request priority: Standard / Urgent

The four-level SR priority (critical/high/medium/low) is collapsed to two:
critical/high -> urgent, medium/low (and anything else) -> standard.

Revision ID: d4e5f6a7b8c9
Revises: c7d8e9f0a1b3
Create Date: 2026-10-06

"""
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c7d8e9f0a1b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE erp_service_requests SET priority = 'urgent' WHERE priority IN ('critical', 'high')")
    op.execute("UPDATE erp_service_requests SET priority = 'standard' WHERE priority <> 'urgent'")


def downgrade() -> None:
    op.execute("UPDATE erp_service_requests SET priority = 'high' WHERE priority = 'urgent'")
    op.execute("UPDATE erp_service_requests SET priority = 'medium' WHERE priority = 'standard'")
