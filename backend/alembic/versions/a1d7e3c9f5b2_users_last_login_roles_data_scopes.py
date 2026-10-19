"""users.last_login_at + roles.data_scopes — columns the models declare
(login audit; per-role, per-module data scope) that had no migration, so every
User query failed on a migrated DB. Guarded: adds each column only if missing.

Revision ID: a1d7e3c9f5b2
Revises: f3a9c2e7b5d1
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "a1d7e3c9f5b2"
down_revision = "f3a9c2e7b5d1"
branch_labels = None
depends_on = None


def _cols(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "users" in tables and "last_login_at" not in _cols(inspector, "users"):
        with op.batch_alter_table("users") as b:
            b.add_column(sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    if "roles" in tables and "data_scopes" not in _cols(inspector, "roles"):
        with op.batch_alter_table("roles") as b:
            b.add_column(sa.Column("data_scopes", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "roles" in tables and "data_scopes" in _cols(inspector, "roles"):
        with op.batch_alter_table("roles") as b:
            b.drop_column("data_scopes")
    if "users" in tables and "last_login_at" in _cols(inspector, "users"):
        with op.batch_alter_table("users") as b:
            b.drop_column("last_login_at")
