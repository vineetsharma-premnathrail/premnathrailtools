"""Per-user notification overrides (Role editor › Notifications › for one user).

users.notification_overrides: "<module>.<event>" -> channels. An entry
replaces what the user's roles give for that event; an empty list switches it
off for that user only.

Revision ID: c9e5a3b7d2f4
Revises: b8d4f2a6c1e9
"""
from alembic import op
import sqlalchemy as sa

revision = "c9e5a3b7d2f4"
down_revision = "b8d4f2a6c1e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "notification_overrides" not in cols:
        op.add_column("users", sa.Column("notification_overrides", sa.JSON(), nullable=True))


def downgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "notification_overrides" in cols:
        op.drop_column("users", "notification_overrides")
