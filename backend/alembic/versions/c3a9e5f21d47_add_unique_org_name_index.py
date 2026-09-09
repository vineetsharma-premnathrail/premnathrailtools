"""add case-insensitive unique index on crm_organizations.name (live rows only)

The organization-create endpoint only de-duplicated by name via an app-level
SELECT before INSERT, which is race-prone (two concurrent submits for the same
name can both pass the check). This adds a DB-level backstop so a duplicate
insert fails with a constraint violation instead of silently succeeding.

Revision ID: c3a9e5f21d47
Revises: 0341293a0ba6
Create Date: 2026-09-09 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'c3a9e5f21d47'
down_revision = '0341293a0ba6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_crm_organizations_name_unique_live "
        "ON crm_organizations (lower(name)) WHERE is_deleted = false"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_crm_organizations_name_unique_live")
