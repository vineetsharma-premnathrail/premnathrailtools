"""add lead_source, priority, bd_owner to crm tenders

Revision ID: 0341293a0ba6
Revises: 0758f489c867
Create Date: 2026-09-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0341293a0ba6'
down_revision = '0758f489c867'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_tenders")}

    with op.batch_alter_table("crm_tenders") as batch_op:
        if "lead_source" not in columns:
            batch_op.add_column(sa.Column("lead_source", sa.String(length=100), nullable=True))
        if "priority" not in columns:
            batch_op.add_column(sa.Column("priority", sa.String(length=20), nullable=False, server_default="Medium"))
        if "bd_owner" not in columns:
            batch_op.add_column(sa.Column("bd_owner", sa.String(length=150), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("crm_tenders") as batch_op:
        batch_op.drop_column("bd_owner")
        batch_op.drop_column("priority")
        batch_op.drop_column("lead_source")
