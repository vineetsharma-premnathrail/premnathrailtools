"""drop unused company fields: code, is_group, default_holiday_list, default_letter_head

Revision ID: e5a7c9b1f3d4
Revises: d2f4b6a8e0c3
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e5a7c9b1f3d4'
down_revision = 'd2f4b6a8e0c3'
branch_labels = None
depends_on = None

DROPPED_COLUMNS = [
    ("code", sa.String(length=30)),
    ("is_group", sa.Boolean()),
    ("default_holiday_list", sa.String(length=150)),
    ("default_letter_head", sa.String(length=150)),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("companies")}
    indexes = {i["name"] for i in inspector.get_indexes("companies")}
    if "ix_companies_code" in indexes:
        op.drop_index('ix_companies_code', table_name='companies')
    for name, _ in DROPPED_COLUMNS:
        if name in columns:
            op.drop_column("companies", name)


def downgrade() -> None:
    for name, col_type in DROPPED_COLUMNS:
        if name == "is_group":
            op.add_column("companies", sa.Column(name, col_type, nullable=False, server_default=sa.false()))
        else:
            op.add_column("companies", sa.Column(name, col_type, nullable=True))
    op.create_index('ix_companies_code', 'companies', ['code'], unique=True)
