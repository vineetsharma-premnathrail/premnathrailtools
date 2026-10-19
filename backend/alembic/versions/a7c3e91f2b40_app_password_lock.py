"""App lock: app password on users (hash, lockout, emailed temporary
password) and the lock state + last activity on each sign-in session.

Revision ID: a7c3e91f2b40
Revises: 9e4b2c7a1d38
"""
from alembic import op
import sqlalchemy as sa

revision = "a7c3e91f2b40"
down_revision = "9e4b2c7a1d38"
branch_labels = None
depends_on = None

_USER_COLS = [
    ("app_password_hash", lambda: sa.Column("app_password_hash", sa.String(255), nullable=True)),
    ("app_password_set_at", lambda: sa.Column("app_password_set_at", sa.DateTime(timezone=True), nullable=True)),
    ("app_password_failed", lambda: sa.Column("app_password_failed", sa.Integer(), nullable=False, server_default="0")),
    ("app_password_locked_until", lambda: sa.Column("app_password_locked_until", sa.DateTime(timezone=True), nullable=True)),
    ("app_temp_password_hash", lambda: sa.Column("app_temp_password_hash", sa.String(255), nullable=True)),
    ("app_temp_password_expires_at", lambda: sa.Column("app_temp_password_expires_at", sa.DateTime(timezone=True), nullable=True)),
    ("app_temp_password_sent_at", lambda: sa.Column("app_temp_password_sent_at", sa.DateTime(timezone=True), nullable=True)),
]
_SESSION_COLS = [
    # Existing sessions start locked: everyone sets / enters the app password once after deploy.
    ("app_lock_state", lambda: sa.Column("app_lock_state", sa.String(10), nullable=False, server_default="locked")),
    ("app_activity_at", lambda: sa.Column("app_activity_at", sa.DateTime(timezone=True), nullable=True)),
]


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for table, cols in (("users", _USER_COLS), ("user_sessions", _SESSION_COLS)):
        have = _columns(table)
        for name, col in cols:
            if name not in have:
                op.add_column(table, col())


def downgrade() -> None:
    for table, cols in (("users", _USER_COLS), ("user_sessions", _SESSION_COLS)):
        have = _columns(table)
        for name, _ in cols:
            if name in have:
                op.drop_column(table, name)
