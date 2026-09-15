"""add PO approver and rejecter names to p2p_requests

Revision ID: b3d9f1a7c5e2
Revises: e8138b471609
Create Date: 2026-09-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b3d9f1a7c5e2'
down_revision = 'e8138b471609'
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    "purchase_head_approved_by_name",
    "director_approved_by_name",
    "md_approved_by_name",
    "rejected_by_name",
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    for name in NEW_COLUMNS:
        if name not in columns:
            op.add_column("p2p_requests", sa.Column(name, sa.String(length=150), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    for name in NEW_COLUMNS:
        if name in columns:
            op.drop_column("p2p_requests", name)
