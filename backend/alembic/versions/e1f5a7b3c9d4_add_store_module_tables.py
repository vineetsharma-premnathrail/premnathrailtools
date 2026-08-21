"""add store module tables: store_locations, stock_items, stock_balances, stock_transactions

Revision ID: e1f5a7b3c9d4
Revises: d9e4f6a2b8c3
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e1f5a7b3c9d4'
down_revision = 'd9e4f6a2b8c3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'store_locations',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_store_locations_code', 'store_locations', ['code'], unique=True)

    op.create_table(
        'stock_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('part_code', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=False),
        sa.Column('make', sa.String(length=100), nullable=True),
        sa.Column('unit', sa.String(length=20), nullable=True),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('reorder_point', sa.Float(), nullable=False, server_default='0'),
        sa.Column('reorder_quantity', sa.Float(), nullable=False, server_default='0'),
        sa.Column('standard_cost', sa.Float(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_stock_items_part_code', 'stock_items', ['part_code'], unique=True)

    op.create_table(
        'stock_balances',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('stock_item_id', sa.Integer(), sa.ForeignKey('stock_items.id'), nullable=False),
        sa.Column('location_id', sa.Integer(), sa.ForeignKey('store_locations.id'), nullable=False),
        sa.Column('quantity_on_hand', sa.Float(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('stock_item_id', 'location_id', name='uq_stock_balance_item_location'),
    )

    op.create_table(
        'stock_transactions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('stock_item_id', sa.Integer(), sa.ForeignKey('stock_items.id'), nullable=False),
        sa.Column('location_id', sa.Integer(), sa.ForeignKey('store_locations.id'), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('reference_type', sa.String(length=50), nullable=True),
        sa.Column('reference_id', sa.Integer(), nullable=True),
        sa.Column('performed_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_stock_transactions_stock_item_id', 'stock_transactions', ['stock_item_id'])
    op.create_index('ix_stock_transactions_location_id', 'stock_transactions', ['location_id'])


def downgrade() -> None:
    op.drop_index('ix_stock_transactions_location_id', table_name='stock_transactions')
    op.drop_index('ix_stock_transactions_stock_item_id', table_name='stock_transactions')
    op.drop_table('stock_transactions')
    op.drop_table('stock_balances')
    op.drop_index('ix_stock_items_part_code', table_name='stock_items')
    op.drop_table('stock_items')
    op.drop_index('ix_store_locations_code', table_name='store_locations')
    op.drop_table('store_locations')
