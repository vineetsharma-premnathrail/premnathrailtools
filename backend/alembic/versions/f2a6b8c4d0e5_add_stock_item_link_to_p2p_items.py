"""add stock_item_id link to p2p_request_items (Purchase GRN -> Store integration)

Revision ID: f2a6b8c4d0e5
Revises: e1f5a7b3c9d4
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f2a6b8c4d0e5'
down_revision = 'e1f5a7b3c9d4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('p2p_request_items') as batch_op:
        batch_op.add_column(sa.Column('stock_item_id', sa.Integer(), sa.ForeignKey('stock_items.id'), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('p2p_request_items') as batch_op:
        batch_op.drop_column('stock_item_id')
