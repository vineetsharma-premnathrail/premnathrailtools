"""Replace the MD approval flag with Partner

The company's top approval level is its Partners, chosen in Organization →
Company Info (Azure users), not a separate MD flag. Renames users.is_md →
is_partner and the legacy P2P PO approval stamps md_* → partner_*, so
in-flight approvals and history carry over unchanged.

Revision ID: b6e3d8f1a4c7
Revises: d0e1f2a3b4c5
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "b6e3d8f1a4c7"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None

RENAMES = [
    ("users", "is_md", "is_partner"),
    ("p2p_requests", "md_approved_at", "partner_approved_at"),
    ("p2p_requests", "md_approved_by_name", "partner_approved_by_name"),
    ("p2p_requests", "md_comment", "partner_comment"),
]


def _rename(pairs):
    inspector = sa.inspect(op.get_bind())
    for table, old, new in pairs:
        cols = {c["name"] for c in inspector.get_columns(table)}
        if old in cols and new not in cols:
            op.alter_column(table, old, new_column_name=new)


def upgrade() -> None:
    _rename(RENAMES)


def downgrade() -> None:
    _rename([(t, new, old) for t, old, new in RENAMES])
