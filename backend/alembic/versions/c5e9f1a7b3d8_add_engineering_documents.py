"""add engineering_documents table (shared Design/Electrical/Fluids/R&D document repository) + seed design module

Revision ID: c5e9f1a7b3d8
Revises: b4d8e0f6a2c7
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c5e9f1a7b3d8'
down_revision = 'b4d8e0f6a2c7'
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
        'engineering_documents',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('erp_projects.id'), nullable=False),
        sa.Column('discipline', sa.String(length=20), nullable=False),
        sa.Column('document_type', sa.String(length=30), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='draft'),
        sa.Column('superseded_by_id', sa.Integer(), sa.ForeignKey('engineering_documents.id'), nullable=True),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=255), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('sharepoint_path', sa.String(length=1000), nullable=True),
        sa.Column('sharepoint_url', sa.String(length=1000), nullable=True),
        sa.Column('uploaded_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_engineering_documents_project_id', 'engineering_documents', ['project_id'])

    op.bulk_insert(modules_table, [
        {'key': 'design', 'label': 'Design', 'icon': 'design', 'description': 'Engineering drawings, BOM, and document revisions.', 'is_active': True, 'sort_order': 8},
    ])


def downgrade() -> None:
    op.execute("DELETE FROM modules WHERE key = 'design'")
    op.drop_index('ix_engineering_documents_project_id', table_name='engineering_documents')
    op.drop_table('engineering_documents')
