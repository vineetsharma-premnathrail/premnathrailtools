"""add items table

Revision ID: 5ff1b53842a1
Revises: 6322bc0e7ac7
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '5ff1b53842a1'
down_revision = '6322bc0e7ac7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'items' not in inspector.get_table_names():
        op.create_table(
            'items',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('item_code', sa.String(length=50), nullable=False, unique=True),
            sa.Column('item_name', sa.String(length=255), nullable=False),
            sa.Column('item_group', sa.String(length=100), nullable=True),
            sa.Column('hsn_sac', sa.String(length=20), nullable=True),
            sa.Column('unit_of_measure', sa.String(length=20), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table('items')
