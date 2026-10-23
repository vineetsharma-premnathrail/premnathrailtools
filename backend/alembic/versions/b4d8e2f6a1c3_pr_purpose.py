"""Procurement: purpose of a purchase requisition — customer order, machine
project, development, department running cost, asset, store stock (2026-10-23).

Revision ID: b4d8e2f6a1c3
Revises: a6c2e8f4b1d7
"""
from alembic import op
import sqlalchemy as sa

revision = "b4d8e2f6a1c3"
down_revision = "a6c2e8f4b1d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("p2p_requests")}
    if "purpose" not in cols:
        with op.batch_alter_table("p2p_requests") as t:
            t.add_column(sa.Column("purpose", sa.String(length=20), nullable=True))


def downgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("p2p_requests")}
    if "purpose" in cols:
        with op.batch_alter_table("p2p_requests") as t:
            t.drop_column("purpose")
