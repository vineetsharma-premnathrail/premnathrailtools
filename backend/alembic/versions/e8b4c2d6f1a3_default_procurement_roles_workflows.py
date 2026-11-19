"""Default Procurement roles (PR Requester, Procurement – Approver, Purchaser, Purchase Head)
with their users from data, and the PR / PO approval workflows (owner, 2026-11-19).

Data only - no schema change. Runs once; the admin edits roles and workflows afterwards in
Organization › Role & Permissions / Workflows. See app/modules/p2p/default_access.py.

Revision ID: e8b4c2d6f1a3
Revises: d7a3e5c1f9b4
Create Date: 2026-11-19
"""
from alembic import op

revision = "e8b4c2d6f1a3"
down_revision = "d7a3e5c1f9b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.modules.p2p.default_access import apply_default_procurement_access

    apply_default_procurement_access(op.get_bind())


def downgrade() -> None:
    # Data setup: roles, members and workflow stages stay as they are (the admin owns them now).
    pass
