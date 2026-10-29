"""Tender: closing date and time; status 'Requirement Received' renamed.

crm_tenders.closing_at holds the tender closing date and time as printed on the
tender (India wall-clock). The first tender status is now "Waiting for Future
Tender"; existing tenders on the old name are moved to it. Inquiries keep
"Requirement Received".

Revision ID: d4f6a8c0e2b4
Revises: e5a7c9e1d3f6
Create Date: 2026-10-29
"""
from alembic import op
import sqlalchemy as sa

revision = "d4f6a8c0e2b4"
down_revision = "e5a7c9e1d3f6"
branch_labels = None
depends_on = None

TABLE = "crm_tenders"


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}
    if "closing_at" not in cols:
        op.add_column(TABLE, sa.Column("closing_at", sa.DateTime(), nullable=True))
    op.execute(sa.text(
        f"UPDATE {TABLE} SET status = 'Waiting for Future Tender' WHERE status = 'Requirement Received'"
    ))


def downgrade() -> None:
    op.execute(sa.text(
        f"UPDATE {TABLE} SET status = 'Requirement Received' WHERE status = 'Waiting for Future Tender'"
    ))
    op.drop_column(TABLE, "closing_at")
