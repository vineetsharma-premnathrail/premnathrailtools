"""add additional mobiles/emails to crm org contacts

Revision ID: da6baf65c39d
Revises: 81646567ab2b
Create Date: 2026-09-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'da6baf65c39d'
down_revision = '81646567ab2b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_org_contacts")}

    with op.batch_alter_table("crm_org_contacts") as batch_op:
        if "additional_mobiles" not in columns:
            batch_op.add_column(sa.Column("additional_mobiles", postgresql.JSONB(), nullable=True))
        if "additional_emails" not in columns:
            batch_op.add_column(sa.Column("additional_emails", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("crm_org_contacts") as batch_op:
        batch_op.drop_column("additional_emails")
        batch_op.drop_column("additional_mobiles")
