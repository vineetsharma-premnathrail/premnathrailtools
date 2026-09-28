"""restructure p2p_request_items columns to item description/make/part code/uom/qty/project-inhouse/category/ship to

Revision ID: b7c2f4d9e1a6
Revises: a4b1e6c8d2f3
Create Date: 2026-08-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b7c2f4d9e1a6'
down_revision = 'a4b1e6c8d2f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guarded both ways: on a fresh database, `baseline` already created
    # this table with the CURRENT model's columns (make/project_inhouse/
    # category/ship_to already present, model_number/description/
    # estimated_budget/reason never existed at all) via live
    # Base.metadata.create_all() — so every add/drop here is a no-op there.
    # On a database that actually predates that restructure, this runs the
    # real migration as originally written.
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_request_items")}
    with op.batch_alter_table('p2p_request_items') as batch_op:
        if 'make' not in columns:
            batch_op.add_column(sa.Column('make', sa.String(length=100), nullable=True))
        if 'project_inhouse' not in columns:
            batch_op.add_column(sa.Column('project_inhouse', sa.String(length=100), nullable=True))
        if 'category' not in columns:
            batch_op.add_column(sa.Column('category', sa.String(length=100), nullable=True))
        if 'ship_to' not in columns:
            batch_op.add_column(sa.Column('ship_to', sa.String(length=255), nullable=True))
        if 'model_number' in columns:
            batch_op.drop_column('model_number')
        if 'description' in columns:
            batch_op.drop_column('description')
        if 'estimated_budget' in columns:
            batch_op.drop_column('estimated_budget')
        if 'reason' in columns:
            batch_op.drop_column('reason')


def downgrade() -> None:
    with op.batch_alter_table('p2p_request_items') as batch_op:
        batch_op.add_column(sa.Column('model_number', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('description', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('estimated_budget', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('reason', sa.Text(), nullable=True))
        batch_op.drop_column('make')
        batch_op.drop_column('project_inhouse')
        batch_op.drop_column('category')
        batch_op.drop_column('ship_to')
