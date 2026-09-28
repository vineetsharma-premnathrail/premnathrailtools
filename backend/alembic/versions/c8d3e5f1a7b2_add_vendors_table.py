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
    # On a fresh database, `baseline` may already have created a `vendors`
    # table reflecting whatever current model maps to that name today (the
    # Accounts module's Vendor, added long after this migration was
    # written) via live Base.metadata.create_all() — this old Quality/
    # Vendor-Development-era shape is superseded either way (dropped later
    # by ae88c635814e as dead legacy schema, then the Accounts module
    # creates its own real one), so just skip creating it again here rather
    # than colliding with whatever's already there.
    inspector = sa.inspect(op.get_bind())
    if "vendors" in inspector.get_table_names():
        return

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
    inspector = sa.inspect(op.get_bind())
    if "vendors" not in inspector.get_table_names():
        return
    existing_indexes = {ix["name"] for ix in inspector.get_indexes("vendors")}
    if "ix_vendors_name" in existing_indexes:
        op.drop_index('ix_vendors_name', table_name='vendors')
    op.drop_table('vendors')
