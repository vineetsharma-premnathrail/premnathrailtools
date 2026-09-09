"""add crm inquiry line items

Revision ID: c57afa1b908f
Revises: d7f1a4c8e932
Create Date: 2026-09-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c57afa1b908f'
down_revision = 'd7f1a4c8e932'
branch_labels = None
depends_on = None

# An inquiry's product/product_category/product_spec/quantity columns hold the first
# (primary) product; this table holds any further products raised in the same inquiry.


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'crm_inquiry_line_items' in inspector.get_table_names():
        return

    op.create_table(
        'crm_inquiry_line_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('inquiry_id', sa.Integer(), sa.ForeignKey('crm_inquiries.id'), nullable=False, index=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('product', sa.String(length=255), nullable=True),
        sa.Column('product_category', sa.String(length=100), nullable=True),
        sa.Column('product_spec', sa.Text(), nullable=True),
        sa.Column('quantity', sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('crm_inquiry_line_items')
