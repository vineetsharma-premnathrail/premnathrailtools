"""add unique index on crm_products (name, model_number) for live rows

Product creation only checked for a name+model clash at the app level, which is
race-prone the same way organization-name dedup was. This adds a DB-level
backstop, matching migration c3a9e5f21d47 for organizations.

Revision ID: d7f1a4c8e932
Revises: c3a9e5f21d47
Create Date: 2026-09-09 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'd7f1a4c8e932'
down_revision = 'c3a9e5f21d47'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_crm_products_name_model_unique_live "
        "ON crm_products (lower(name), lower(coalesce(model_number, ''))) WHERE is_deleted = false"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_crm_products_name_model_unique_live")
