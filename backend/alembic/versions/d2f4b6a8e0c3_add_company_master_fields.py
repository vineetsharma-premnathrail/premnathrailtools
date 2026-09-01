"""add company master fields (ERPNext Company-doctype style)

Revision ID: d2f4b6a8e0c3
Revises: c1e3a5f7d9b2
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd2f4b6a8e0c3'
down_revision = 'c1e3a5f7d9b2'
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    ("default_currency", sa.String(length=10)),
    ("country", sa.String(length=100)),
    ("is_group", sa.Boolean()),
    ("parent_company", sa.String(length=150)),
    ("default_holiday_list", sa.String(length=150)),
    ("default_letter_head", sa.String(length=150)),
    ("tax_id", sa.String(length=50)),
    ("domain", sa.String(length=100)),
    ("date_of_establishment", sa.Date()),
    ("gst_category", sa.String(length=50)),
    ("reporting_currency", sa.String(length=10)),
    ("registration_details", sa.Text()),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("companies")}
    for name, col_type in NEW_COLUMNS:
        if name not in columns:
            if name == "is_group":
                op.add_column("companies", sa.Column(name, col_type, nullable=False, server_default=sa.false()))
            else:
                op.add_column("companies", sa.Column(name, col_type, nullable=True))


def downgrade() -> None:
    for name, _ in NEW_COLUMNS:
        op.drop_column("companies", name)
