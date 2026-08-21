"""add rfqs + rfq_attachments tables

Revision ID: e7a1b9c5d2f4
Revises: d6f0a2b8c4e9
Create Date: 2026-08-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e7a1b9c5d2f4'
down_revision = 'd6f0a2b8c4e9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'rfqs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('rfq_number', sa.String(length=50), nullable=False),
        sa.Column('p2p_request_id', sa.Integer(), sa.ForeignKey('p2p_requests.id'), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='draft'),
        sa.Column('is_single_quotation', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('single_quotation_reason', sa.Text(), nullable=True),
        sa.Column('comments', sa.Text(), nullable=True),
        sa.Column('payment_terms', sa.Text(), nullable=True),
        sa.Column('delivery_lead_time', sa.String(length=100), nullable=True),
        sa.Column('ld_clause', sa.Text(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('locked_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_rfqs_rfq_number', 'rfqs', ['rfq_number'], unique=True)

    op.create_table(
        'rfq_attachments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('rfq_id', sa.Integer(), sa.ForeignKey('rfqs.id'), nullable=False),
        sa.Column('vendor_tier', sa.String(length=2), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=255), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('sharepoint_path', sa.String(length=1000), nullable=True),
        sa.Column('sharepoint_url', sa.String(length=1000), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('rfq_attachments')
    op.drop_index('ix_rfqs_rfq_number', table_name='rfqs')
    op.drop_table('rfqs')
