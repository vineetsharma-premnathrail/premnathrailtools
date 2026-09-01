"""add manufacturing module tables: materials, boms, bom_items, work_orders, stock_entries

Revision ID: e7a9c1b3d5f6
Revises: d5f7b9c1e3a4
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e7a9c1b3d5f6'
down_revision = 'd5f7b9c1e3a4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'manufacturing_materials',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('code', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('unit', sa.String(length=20), nullable=True),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_manufacturing_materials_code', 'manufacturing_materials', ['code'], unique=True)

    op.create_table(
        'manufacturing_boms',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('code', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('output_material_id', sa.Integer(), sa.ForeignKey('manufacturing_materials.id'), nullable=False),
        sa.Column('output_quantity', sa.Float(), nullable=False, server_default='1'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_manufacturing_boms_code', 'manufacturing_boms', ['code'], unique=True)

    op.create_table(
        'manufacturing_bom_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('bom_id', sa.Integer(), sa.ForeignKey('manufacturing_boms.id'), nullable=False),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('manufacturing_materials.id'), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_manufacturing_bom_items_bom_id', 'manufacturing_bom_items', ['bom_id'])

    op.create_table(
        'manufacturing_work_orders',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('wo_number', sa.String(length=30), nullable=False),
        sa.Column('bom_id', sa.Integer(), sa.ForeignKey('manufacturing_boms.id'), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='planned'),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_manufacturing_work_orders_wo_number', 'manufacturing_work_orders', ['wo_number'], unique=True)

    op.create_table(
        'manufacturing_stock_entries',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('manufacturing_materials.id'), nullable=False),
        sa.Column('work_order_id', sa.Integer(), sa.ForeignKey('manufacturing_work_orders.id'), nullable=True),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_manufacturing_stock_entries_material_id', 'manufacturing_stock_entries', ['material_id'])
    op.create_index('ix_manufacturing_stock_entries_work_order_id', 'manufacturing_stock_entries', ['work_order_id'])


def downgrade() -> None:
    op.drop_index('ix_manufacturing_stock_entries_work_order_id', table_name='manufacturing_stock_entries')
    op.drop_index('ix_manufacturing_stock_entries_material_id', table_name='manufacturing_stock_entries')
    op.drop_table('manufacturing_stock_entries')
    op.drop_index('ix_manufacturing_work_orders_wo_number', table_name='manufacturing_work_orders')
    op.drop_table('manufacturing_work_orders')
    op.drop_index('ix_manufacturing_bom_items_bom_id', table_name='manufacturing_bom_items')
    op.drop_table('manufacturing_bom_items')
    op.drop_index('ix_manufacturing_boms_code', table_name='manufacturing_boms')
    op.drop_table('manufacturing_boms')
    op.drop_index('ix_manufacturing_materials_code', table_name='manufacturing_materials')
    op.drop_table('manufacturing_materials')
