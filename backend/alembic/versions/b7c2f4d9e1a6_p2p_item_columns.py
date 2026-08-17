"""restructure p2p_request_items columns to item description/make/part code/uom/qty/project-inhouse/category/ship to

Revision ID: b7c2f4d9e1a6
Revises: a4b1e6c8d2f3
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b7c2f4d9e1a6'
down_revision = 'a4b1e6c8d2f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('p2p_request_items') as batch_op:
        batch_op.add_column(sa.Column('make', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('project_inhouse', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('category', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('ship_to', sa.String(length=255), nullable=True))
        batch_op.drop_column('model_number')
        batch_op.drop_column('description')
        batch_op.drop_column('estimated_budget')
        batch_op.drop_column('reason')


def downgrade() -> None:
    with op.batch_alter_table('p2p_request_items') as batch_op:
        batch_op.add_column(sa.Column('model_number', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('description', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('estimated_budget', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('reason', sa.Text(), nullable=True))
        batch_op.drop_column('make')
        batch_op.drop_column('project_inhouse')
        batch_op.drop_column('category')
        batch_op.drop_column('ship_to')
