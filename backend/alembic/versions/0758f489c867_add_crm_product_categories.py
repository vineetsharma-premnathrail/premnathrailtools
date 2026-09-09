"""add crm product categories catalog

Revision ID: 0758f489c867
Revises: da6baf65c39d
Create Date: 2026-09-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0758f489c867'
down_revision = 'da6baf65c39d'
branch_labels = None
depends_on = None

# No seed rows — this is a user-populated catalog (see the "+ New Category" control
# in the CRM Inquiry/Quotation forms), so the dropdown starts empty and only ever
# shows categories a user actually added.


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'crm_product_categories' in inspector.get_table_names():
        return

    op.create_table(
        'crm_product_categories',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(length=100), nullable=False, unique=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('crm_product_categories')
