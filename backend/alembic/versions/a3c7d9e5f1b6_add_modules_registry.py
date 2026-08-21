"""add modules table (display-metadata registry, admin extension Phase 1) + seed existing app keys

Revision ID: a3c7d9e5f1b6
Revises: f2a6b8c4d0e5
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a3c7d9e5f1b6'
down_revision = 'f2a6b8c4d0e5'
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

SEED = [
    {'key': 'erp', 'label': 'Service Module', 'icon': 'erp', 'description': 'Projects, service requests, warranty tracking.', 'is_active': True, 'sort_order': 1},
    {'key': 'rnd', 'label': 'R&D Tools', 'icon': 'rnd', 'description': 'Railway engineering calculators.', 'is_active': True, 'sort_order': 2},
    {'key': 'crm', 'label': 'CRM Module', 'icon': 'crm', 'description': 'Customer relationship management.', 'is_active': True, 'sort_order': 3},
    {'key': 'purchase', 'label': 'Purchase', 'icon': 'purchase', 'description': 'Purchase requisitions from service materials.', 'is_active': True, 'sort_order': 4},
    {'key': 'p2p', 'label': 'P2P', 'icon': 'p2p', 'description': 'Standalone purchase requisitions.', 'is_active': True, 'sort_order': 5},
    {'key': 'store', 'label': 'Store', 'icon': 'store', 'description': 'Stock ledger — items, locations, transactions.', 'is_active': True, 'sort_order': 6},
]


def upgrade() -> None:
    op.create_table(
        'modules',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('key', sa.String(length=50), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('icon', sa.String(length=50), nullable=True),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_modules_key', 'modules', ['key'], unique=True)
    op.bulk_insert(modules_table, SEED)


def downgrade() -> None:
    op.drop_index('ix_modules_key', table_name='modules')
    op.drop_table('modules')
