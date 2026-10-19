"""module_settings: shared admin-tunable settings for every module

Backs app/core/settings_framework.py (docs/MODULE_DETAILED_PLAN.md §27).
A row exists only when an admin overrides a code default.

Revision ID: b3d8f1a6c2e9
Revises: 5d8a3c6e2f71
Create Date: 2026-10-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b3d8f1a6c2e9"
down_revision = "5d8a3c6e2f71"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "module_settings" in set(inspector.get_table_names()):
        return
    op.create_table(
        "module_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("module_key", sa.String(length=50), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("value", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("module_key", "key", "branch_id", name="uq_module_settings_key"),
    )
    op.create_index("ix_module_settings_module_key", "module_settings", ["module_key"])
    # NULLs are distinct in a UNIQUE constraint, so the company-wide row
    # (branch_id NULL) needs its own partial unique index (mirrors the model).
    op.create_index("uq_module_settings_global", "module_settings", ["module_key", "key"],
                    unique=True, postgresql_where=sa.text("branch_id IS NULL"),
                    sqlite_where=sa.text("branch_id IS NULL"))


def downgrade() -> None:
    op.drop_index("uq_module_settings_global", table_name="module_settings")
    op.drop_index("ix_module_settings_module_key", table_name="module_settings")
    op.drop_table("module_settings")
