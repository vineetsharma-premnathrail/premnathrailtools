"""Item Master: needs_review (owner, 2026-11-14) - an item added from the Before-PO
receipt form is usable at once but flagged until the Item Master owner completes
its details and marks it reviewed.

Defensive: skips the column when it already exists (fresh installs create every
table from the models first).

Revision ID: e4b9d2f7a1c3
Revises: d3f8b2e6a9c1
"""
import sqlalchemy as sa
from alembic import op

revision = "e4b9d2f7a1c3"
down_revision = "d3f8b2e6a9c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_items")}
    if "needs_review" not in cols:
        op.add_column("store_items", sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("store_items", "needs_review")
