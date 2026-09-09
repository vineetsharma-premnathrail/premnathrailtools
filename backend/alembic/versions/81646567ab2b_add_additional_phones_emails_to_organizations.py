"""add additional phones/emails to crm organizations

Revision ID: 81646567ab2b
Revises: 9c3d5f7a1e2b
Create Date: 2026-09-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '81646567ab2b'
down_revision = '9c3d5f7a1e2b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_organizations")}

    with op.batch_alter_table("crm_organizations") as batch_op:
        if "additional_phones" not in columns:
            batch_op.add_column(sa.Column("additional_phones", postgresql.JSONB(), nullable=True))
        if "additional_emails" not in columns:
            batch_op.add_column(sa.Column("additional_emails", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("crm_organizations") as batch_op:
        batch_op.drop_column("additional_emails")
        batch_op.drop_column("additional_phones")
