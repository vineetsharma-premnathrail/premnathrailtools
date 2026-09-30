"""add approval status to stock adjustments

Stock adjustments used to post to stock the moment they were created, with
`approved_by_id` just a name the creator picked (often themselves). They now
wait in `pending_approval` until the named approver — who can't be the
creator — approves (posts) or rejects them. Rows that already exist were
posted under the old flow, so they're backfilled as `approved`.

Revision ID: f3a5c7e9b1d4
Revises: e1f3a5b7c9d2
Create Date: 2026-09-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f3a5c7e9b1d4'
down_revision = 'e1f3a5b7c9d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("store_stock_adjustments")}
    with op.batch_alter_table("store_stock_adjustments") as batch_op:
        if "status" not in columns:
            batch_op.add_column(sa.Column("status", sa.String(length=20), nullable=False, server_default="approved"))
        if "decided_at" not in columns:
            batch_op.add_column(sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True))
        if "rejected_reason" not in columns:
            batch_op.add_column(sa.Column("rejected_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("store_stock_adjustments") as batch_op:
        batch_op.drop_column("rejected_reason")
        batch_op.drop_column("decided_at")
        batch_op.drop_column("status")
