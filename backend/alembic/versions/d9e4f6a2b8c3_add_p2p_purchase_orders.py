"""add p2p_purchase_orders and p2p_purchase_order_items tables

Revision ID: d9e4f6a2b8c3
Revises: c8d3e5f1a7b2
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd9e4f6a2b8c3'
down_revision = 'c8d3e5f1a7b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'p2p_purchase_orders',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('po_number', sa.String(length=50), nullable=False),
        sa.Column('p2p_request_id', sa.Integer(), sa.ForeignKey('p2p_requests.id'), nullable=True),
        sa.Column('vendor_id', sa.Integer(), sa.ForeignKey('vendors.id'), nullable=True),
        sa.Column('vendor_name', sa.String(length=255), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='draft'),
        sa.Column('po_date', sa.Date(), nullable=False),
        sa.Column('expected_delivery', sa.Date(), nullable=True),
        sa.Column('delivery_terms', sa.Text(), nullable=True),
        sa.Column('total_value', sa.Float(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_p2p_purchase_orders_po_number', 'p2p_purchase_orders', ['po_number'], unique=True)

    op.create_table(
        'p2p_purchase_order_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('purchase_order_id', sa.Integer(), sa.ForeignKey('p2p_purchase_orders.id'), nullable=False),
        sa.Column('item_name', sa.String(length=255), nullable=False),
        sa.Column('make', sa.String(length=100), nullable=True),
        sa.Column('part_code', sa.String(length=100), nullable=True),
        sa.Column('unit', sa.String(length=20), nullable=True),
        sa.Column('quantity', sa.Float(), nullable=False, server_default='1'),
        sa.Column('unit_price', sa.Float(), nullable=True),
        sa.Column('tax_rate', sa.Float(), nullable=True),
        sa.Column('line_total', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('p2p_purchase_order_items')
    op.drop_index('ix_p2p_purchase_orders_po_number', table_name='p2p_purchase_orders')
    op.drop_table('p2p_purchase_orders')
