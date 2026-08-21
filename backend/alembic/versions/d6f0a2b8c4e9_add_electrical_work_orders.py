"""add electrical_work_orders table + seed electrical module

Revision ID: d6f0a2b8c4e9
Revises: c5e9f1a7b3d8
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd6f0a2b8c4e9'
down_revision = 'c5e9f1a7b3d8'
branch_labels = None
depends_on = None

modules_table = sa.table(
    'modules',
    sa.column('key', sa.String),
    sa.column('label', sa.String),
    sa.column('icon', sa.String),
    sa.column('description', sa.String),
    sa.column('is_active', sa.Boolean),
    sa.column('sort_order', sa.Integer),
)


def upgrade() -> None:
    op.create_table(
        'electrical_work_orders',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('work_order_number', sa.String(length=50), nullable=False),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('erp_projects.id'), nullable=False),
        sa.Column('equipment_tag', sa.String(length=100), nullable=True),
        sa.Column('voltage_system', sa.String(length=50), nullable=True),
        sa.Column('fault_type', sa.String(length=100), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('source_service_request_id', sa.Integer(), sa.ForeignKey('erp_service_requests.id'), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='open'),
        sa.Column('priority', sa.String(length=10), nullable=False, server_default='medium'),
        sa.Column('assigned_to_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('raised_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('expected_completion_date', sa.Date(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_electrical_work_orders_number', 'electrical_work_orders', ['work_order_number'], unique=True)

    op.bulk_insert(modules_table, [
        {'key': 'electrical', 'label': 'Electrical', 'icon': 'electrical', 'description': 'Electrical work orders and fault tracking.', 'is_active': True, 'sort_order': 9},
    ])


def downgrade() -> None:
    op.execute("DELETE FROM modules WHERE key = 'electrical'")
    op.drop_index('ix_electrical_work_orders_number', table_name='electrical_work_orders')
    op.drop_table('electrical_work_orders')
