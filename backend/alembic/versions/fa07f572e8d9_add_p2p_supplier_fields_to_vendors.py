"""add p2p supplier quick-create fields to vendors

Revision ID: fa07f572e8d9
Revises: e7a9c1b3d5f6
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'fa07f572e8d9'
down_revision = 'e7a9c1b3d5f6'
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    ('supplier_type', sa.String(length=30)),
    ('gst_category', sa.String(length=40)),
    ('contact_first_name', sa.String(length=100)),
    ('contact_last_name', sa.String(length=100)),
    ('contact_email', sa.String(length=255)),
    ('contact_mobile', sa.String(length=30)),
    ('address_line1', sa.String(length=255)),
    ('address_line2', sa.String(length=255)),
    ('city', sa.String(length=100)),
    ('postal_code', sa.String(length=20)),
    ('state', sa.String(length=100)),
    ('country', sa.String(length=100)),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("vendors")}

    with op.batch_alter_table("vendors") as batch_op:
        for name, col_type in NEW_COLUMNS:
            if name not in columns:
                batch_op.add_column(sa.Column(name, col_type, nullable=True))
        if "is_draft" not in columns:
            batch_op.add_column(sa.Column("is_draft", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("vendors") as batch_op:
        batch_op.drop_column("is_draft")
        for name, _ in NEW_COLUMNS:
            batch_op.drop_column(name)
