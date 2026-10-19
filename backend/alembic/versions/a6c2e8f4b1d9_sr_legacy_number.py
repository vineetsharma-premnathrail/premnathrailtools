"""Service request: add legacy_sr_number

The SR's number in the old system, filled only by the SR bulk import; unique
so the same legacy SR can never be imported twice.

Revision ID: a6c2e8f4b1d9
Revises: f3a9c1e7b5d2
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa

revision = "a6c2e8f4b1d9"
down_revision = "f3a9c1e7b5d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("erp_service_requests")}
    if "legacy_sr_number" not in columns:
        op.add_column("erp_service_requests", sa.Column("legacy_sr_number", sa.String(length=100), nullable=True))
        op.create_index("ix_erp_service_requests_legacy_sr_number", "erp_service_requests", ["legacy_sr_number"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_erp_service_requests_legacy_sr_number", table_name="erp_service_requests")
    op.drop_column("erp_service_requests", "legacy_sr_number")
