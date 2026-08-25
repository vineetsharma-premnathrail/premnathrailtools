"""add per-role approval comments to p2p_requests

Revision ID: f4b7d2e8a9c1
Revises: e1a9c4d7f3b2
Create Date: 2026-08-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f4b7d2e8a9c1'
down_revision = 'e1a9c4d7f3b2'
branch_labels = None
depends_on = None

NEW_COLUMNS = ["department_head_comment", "project_head_comment", "plant_head_comment"]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    for name in NEW_COLUMNS:
        if name not in columns:
            op.add_column("p2p_requests", sa.Column(name, sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    for name in NEW_COLUMNS:
        if name in columns:
            op.drop_column("p2p_requests", name)
