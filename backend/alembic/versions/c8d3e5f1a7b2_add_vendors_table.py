"""add vendors table (shared master: Purchase transactional + Vendor Development qualification)

Revision ID: c8d3e5f1a7b2
Revises: b7c2f4d9e1a6
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c8d3e5f1a7b2'
down_revision = 'b7c2f4d9e1a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'vendors',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('contact_person', sa.String(length=150), nullable=True),
        sa.Column('phone', sa.String(length=30), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('gstin', sa.String(length=20), nullable=True),
        sa.Column('category', sa.String(length=20), nullable=False, server_default='materials'),
        sa.Column('payment_terms', sa.String(length=150), nullable=True),
        sa.Column('bank_details', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('qualification_status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('is_avl', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('last_audit_date', sa.Date(), nullable=True),
        sa.Column('last_audit_score', sa.Float(), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_vendors_name', 'vendors', ['name'])


def downgrade() -> None:
    op.drop_index('ix_vendors_name', table_name='vendors')
    op.drop_table('vendors')
