"""repair crm_activities schema drift and add action_plan

Revision ID: c4d8f2a91b6e
Revises: 9b88ecb3688b
Create Date: 2026-08-01 00:00:00.000000

The local DB was found stamped at an untracked revision (c2a4f9e17b3d)
not present anywhere in this repo's history: some prior, never-committed
change had added `subject` / `meeting_date` columns to `crm_activities`
and dropped `remarks` / `assigned_to`, which the current Activity model
still expects. Both drifted columns were confirmed 100% NULL before
writing this migration, so nothing is lost by removing them.

Any DB still stamped at c2a4f9e17b3d needs `alembic stamp 9b88ecb3688b`
run first so this migration has a known revision to apply on top of.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d8f2a91b6e'
down_revision: Union[str, Sequence[str], None] = '9b88ecb3688b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("crm_activities")}

    def add_column_if_missing(column: sa.Column) -> None:
        if column.name not in existing_columns:
            op.add_column("crm_activities", column)

    add_column_if_missing(sa.Column("remarks", sa.Text(), nullable=True))
    add_column_if_missing(sa.Column("assigned_to", sa.String(length=150), nullable=True))
    add_column_if_missing(sa.Column("action_plan", sa.Text(), nullable=True))

    if "subject" in existing_columns:
        op.drop_column("crm_activities", "subject")
    if "meeting_date" in existing_columns:
        op.drop_column("crm_activities", "meeting_date")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("crm_activities", sa.Column("meeting_date", sa.Date(), nullable=True))
    op.add_column("crm_activities", sa.Column("subject", sa.String(length=255), nullable=True))
    op.drop_column("crm_activities", "action_plan")
    op.drop_column("crm_activities", "assigned_to")
    op.drop_column("crm_activities", "remarks")
