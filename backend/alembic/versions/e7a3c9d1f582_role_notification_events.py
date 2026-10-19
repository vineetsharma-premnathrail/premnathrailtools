"""Roles: notification subscriptions (roles.notification_events) — which
events a role's members are notified of, and on which channels.

Revision ID: e7a3c9d1f582
Revises: d4f8b2c6e913
"""
from alembic import op
import sqlalchemy as sa

revision = "e7a3c9d1f582"
down_revision = "d4f8b2c6e913"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("roles")}
    if "notification_events" not in cols:
        with op.batch_alter_table("roles") as batch:
            batch.add_column(sa.Column("notification_events", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    with op.batch_alter_table("roles") as batch:
        batch.drop_column("notification_events")
