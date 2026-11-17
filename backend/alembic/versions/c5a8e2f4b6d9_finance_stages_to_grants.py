"""Finance approval stages follow the role matrix, not the Finance Manager flag

Owner, 2026-11-14 (permission audit): the tick decides. Untouched default
stages of period close / depreciation / year-end close / 3-way-match variance
that still route to the is_finance_manager flag are re-pointed to holders of
the matching Approve grant. Stages an admin renamed are left alone.

Revision ID: c5a8e2f4b6d9
Revises: e4b9d2f7a1c3
Create Date: 2026-11-14
"""
from alembic import op

revision = "c5a8e2f4b6d9"
down_revision = "e4b9d2f7a1c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from sqlalchemy import inspect

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if not {"approval_workflows", "approval_workflow_stages"} <= tables:
        return
    from app.modules.accounts.migrations import migrate_finance_flag_stages

    migrate_finance_flag_stages(bind)


def downgrade() -> None:
    pass
