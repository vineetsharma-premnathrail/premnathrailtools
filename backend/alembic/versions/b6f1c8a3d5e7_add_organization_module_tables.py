"""add organization module tables: companies, branches, departments

Revision ID: b6f1c8a3d5e7
Revises: 1a5662abf9e6
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b6f1c8a3d5e7'
down_revision = '1a5662abf9e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'companies',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('gst_number', sa.String(length=30), nullable=True),
        sa.Column('pan_number', sa.String(length=20), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('phone', sa.String(length=30), nullable=True),
        sa.Column('email', sa.String(length=150), nullable=True),
        sa.Column('logo_url', sa.String(length=500), nullable=True),
        sa.Column('letterhead_html', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_companies_code', 'companies', ['code'], unique=True)

    op.create_table(
        'branches',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('city', sa.String(length=100), nullable=True),
        sa.Column('state', sa.String(length=100), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_branches_code', 'branches', ['code'], unique=True)

    op.create_table(
        'departments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('branch_id', sa.Integer(), sa.ForeignKey('branches.id'), nullable=True),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('head_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_departments_code', 'departments', ['code'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_departments_code', table_name='departments')
    op.drop_table('departments')
    op.drop_index('ix_branches_code', table_name='branches')
    op.drop_table('branches')
    op.drop_index('ix_companies_code', table_name='companies')
    op.drop_table('companies')
