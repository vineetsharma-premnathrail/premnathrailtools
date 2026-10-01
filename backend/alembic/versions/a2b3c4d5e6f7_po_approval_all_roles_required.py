"""PO approval tracking columns (per-role stamps + director stamp)

Revision ID: a2b3c4d5e6f7
Revises: f3b5d7e9a1c2
Create Date: 2026-10-01

"""
from alembic import op
import sqlalchemy as sa

revision = "a2b3c4d5e6f7"
down_revision = "f3b5d7e9a1c2"
branch_labels = None
depends_on = None

# Idempotent: databases that ran f3b5d7e9a1c2 after it gained these columns
# already have them; production ran it before.
_PO_APPROVER_COLUMNS = (
    ("approved_at", lambda: sa.DateTime(timezone=True), None),
    ("approved_by_id", sa.Integer, "users.id"),
    ("approved_by_name", lambda: sa.String(length=150), None),
    ("comment", sa.Text, None),
)
_PR_COLUMNS = (
    ("director_po_approved_at", lambda: sa.DateTime(timezone=True), None),
    ("director_po_approved_by_id", sa.Integer, "users.id"),
    ("director_po_approved_by_name", lambda: sa.String(length=150), None),
    ("director_po_comment", sa.Text, None),
)


def _add_missing(table: str, columns) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    for name, type_, fk in columns:
        if name in existing:
            continue
        args = [sa.ForeignKey(fk)] if fk else []
        op.add_column(table, sa.Column(name, type_(), *args, nullable=True))


def upgrade() -> None:
    _add_missing("p2p_request_po_approvers", _PO_APPROVER_COLUMNS)
    _add_missing("p2p_requests", _PR_COLUMNS)


def downgrade() -> None:
    # Columns are also created by f3b5d7e9a1c2 on fresh databases; leave them for its downgrade.
    pass
